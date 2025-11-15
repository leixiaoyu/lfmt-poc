/**
 * Upload Complete Handler Lambda Function
 * Triggered by S3 PUT events when users upload documents
 * Updates job status and validates uploaded files
 */

import { S3Event } from 'aws-lambda';
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  GetItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { S3Client, HeadObjectCommand, HeadObjectCommandOutput, CopyObjectCommand } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';

const logger = new Logger('lfmt-upload-complete');
const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

export const handler = async (event: S3Event): Promise<void> => {
  logger.info('Processing S3 upload completion event', {
    recordCount: event.Records.length,
  });

  // Process each S3 event record
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const size = record.s3.object.size;
    const eventTime = record.eventTime;

    logger.info('Processing uploaded file', {
      bucket,
      key,
      size,
      eventTime,
    });

    try {
      // Extract metadata from S3 key: uploads/{userId}/{fileId}/{filename}
      const keyParts = key.split('/');
      if (keyParts.length !== 4 || keyParts[0] !== 'uploads') {
        logger.warn('Invalid S3 key format, skipping', { key });
        continue;
      }

      const [, userId, fileId, filename] = keyParts;

      // Retrieve file metadata from S3
      const headCommand = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const headResponse: HeadObjectCommandOutput = await s3Client.send(headCommand);
      const metadata = headResponse.Metadata || {};

      logger.info('Retrieved S3 object metadata', {
        userId,
        fileId,
        filename,
        contentType: headResponse.ContentType,
        contentLength: headResponse.ContentLength,
        metadata,
      });

      // Find the corresponding job record
      // Since we don't have jobId in S3 key, we need to query by documentId (fileId)
      // For now, we'll use the uploadRequestId from metadata to find the job
      const uploadRequestId = metadata.uploadrequestid;

      if (!uploadRequestId) {
        logger.error('Missing uploadRequestId in S3 metadata', {
          key,
          metadata,
        });
        continue;
      }

      // Query DynamoDB to find job by uploadRequestId
      // Note: This requires a GSI on metadata.uploadRequestId
      // For POC, we'll use a simple approach: iterate through jobs for this user
      // In production, you'd want a GSI on documentId or uploadRequestId

      // Alternative: Store jobId in S3 metadata during presigned URL generation
      const jobId = metadata.jobid;

      if (!jobId) {
        logger.error('Missing jobId in S3 metadata', {
          key,
          metadata,
        });
        continue;
      }

      // Get the job record
      // DynamoDB table has composite primary key: jobId (HASH) + userId (RANGE)
      const getItemCommand = new GetItemCommand({
        TableName: JOBS_TABLE,
        Key: marshall({ jobId, userId }),
      });

      const getResult: GetItemCommandOutput = await dynamoClient.send(getItemCommand);

      if (!getResult.Item) {
        logger.error('Job record not found', {
          jobId,
          userId,
          fileId,
        });
        continue;
      }

      const jobRecord = unmarshall(getResult.Item);

      // Validate file matches job expectations
      const validationErrors: string[] = [];

      if (jobRecord.documentId !== fileId) {
        validationErrors.push(
          `documentId mismatch: expected ${jobRecord.documentId}, got ${fileId}`
        );
      }

      if (jobRecord.userId !== userId) {
        validationErrors.push(
          `userId mismatch: expected ${jobRecord.userId}, got ${userId}`
        );
      }

      if (headResponse.ContentLength !== jobRecord.fileSize) {
        validationErrors.push(
          `fileSize mismatch: expected ${jobRecord.fileSize}, got ${headResponse.ContentLength}`
        );
      }

      if (validationErrors.length > 0) {
        logger.error('File validation failed', {
          jobId,
          fileId,
          validationErrors,
        });

        // Update job status to VALIDATION_FAILED
        const updateCommand = new UpdateItemCommand({
          TableName: JOBS_TABLE,
          Key: marshall({ jobId, userId }),
          UpdateExpression:
            'SET #status = :status, updatedAt = :updatedAt, errorMessage = :errorMessage',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: marshall({
            ':status': 'VALIDATION_FAILED',
            ':updatedAt': new Date().toISOString(),
            ':errorMessage': `File validation failed: ${validationErrors.join(', ')}`,
          }),
        });

        await dynamoClient.send(updateCommand);
        continue;
      }

      // Update job status to UPLOADED
      const updateCommand = new UpdateItemCommand({
        TableName: JOBS_TABLE,
        Key: marshall({ jobId, userId }),
        UpdateExpression:
          'SET #status = :status, updatedAt = :updatedAt, uploadedAt = :uploadedAt, actualFileSize = :actualFileSize',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: marshall({
          ':status': 'UPLOADED',
          ':updatedAt': new Date().toISOString(),
          ':uploadedAt': eventTime,
          ':actualFileSize': size,
          ':expectedStatus': 'PENDING_UPLOAD',
        }),
        ConditionExpression: '#status = :expectedStatus',
      });

      await dynamoClient.send(updateCommand);

      logger.info('Job status updated to UPLOADED', {
        jobId,
        fileId,
        userId,
        size,
      });

      // Copy file from uploads/ to documents/ to trigger chunking
      // The S3 event on documents/ prefix will automatically trigger chunkDocumentFunction
      const sourceKey = key; // uploads/{userId}/{fileId}/{filename}
      const destinationKey = `documents/${userId}/${fileId}/${filename}`;

      logger.info('Copying file to documents/ prefix for chunking', {
        sourceKey,
        destinationKey,
        bucket,
      });

      const copyCommand = new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${sourceKey}`,
        Key: destinationKey,
        Metadata: {
          ...metadata,
          // Preserve all metadata for chunking Lambda
          userid: userId,
          fileid: fileId,
          jobid: jobId,
        },
        MetadataDirective: 'REPLACE', // Use our metadata instead of copying from source
      });

      await s3Client.send(copyCommand);

      logger.info('File copied successfully, chunking will be triggered automatically', {
        sourceKey,
        destinationKey,
        jobId,
      });
    } catch (error) {
      logger.error('Error processing upload completion', {
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Don't throw - we want to continue processing other records
      // Failed records will be retried by Lambda's event source mapping
    }
  }

  logger.info('Completed processing S3 upload events', {
    recordCount: event.Records.length,
  });
};
