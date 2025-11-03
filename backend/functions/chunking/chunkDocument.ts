/**
 * Document Chunking Lambda Handler
 *
 * Triggered by S3 upload events to process uploaded documents
 * - Downloads document from S3
 * - Chunks document using sliding window algorithm
 * - Stores chunks in S3
 * - Updates job status in DynamoDB
 */

import { S3Event, S3Handler } from 'aws-lambda';
import {
  S3Client,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  GetItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { createChunker, ChunkContext } from './documentChunker';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';

const logger = new Logger('lfmt-chunk-document');
const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});

const DOCUMENT_BUCKET = getRequiredEnv('DOCUMENT_BUCKET');
const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

interface JobRecord {
  jobId: string;
  userId: string;
  documentId: string;
  filename: string;
  status: string;
  s3Key: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    originalFilename?: string;
    uploadRequestId?: string;
  };
}

/**
 * Extract job metadata from S3 object metadata
 */
function extractJobMetadata(s3Metadata: Record<string, string> | undefined): {
  userId: string;
  jobId: string;
  fileId: string;
} {
  if (!s3Metadata) {
    throw new Error('S3 object metadata is missing');
  }

  const { userid: userId, jobid: jobId, fileid: fileId } = s3Metadata;

  if (!userId || !jobId || !fileId) {
    throw new Error('Required metadata fields missing from S3 object');
  }

  return { userId, jobId, fileId };
}

/**
 * Download document content from S3
 */
async function downloadDocument(bucket: string, key: string): Promise<string> {
  logger.info('Downloading document from S3', { bucket, key });

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response: GetObjectCommandOutput = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('S3 object has no body');
  }

  // Convert stream to string
  const content = await response.Body.transformToString('utf-8');

  logger.info('Document downloaded successfully', {
    bucket,
    key,
    contentLength: content.length,
  });

  return content;
}

/**
 * Store chunks in S3
 */
async function storeChunks(
  chunks: ChunkContext[],
  userId: string,
  fileId: string,
  jobId: string
): Promise<string[]> {
  logger.info('Storing chunks in S3', {
    chunkCount: chunks.length,
    userId,
    fileId,
    jobId,
  });

  const s3Keys: string[] = [];

  for (const chunk of chunks) {
    const chunkKey = `chunks/${userId}/${fileId}/${chunk.chunkId}.json`;

    const command = new PutObjectCommand({
      Bucket: DOCUMENT_BUCKET,
      Key: chunkKey,
      Body: JSON.stringify(chunk),
      ContentType: 'application/json',
      Metadata: {
        userId,
        fileId,
        jobId,
        chunkIndex: chunk.chunkIndex.toString(),
        totalChunks: chunk.totalChunks.toString(),
      },
    });

    await s3Client.send(command);
    s3Keys.push(chunkKey);
  }

  logger.info('All chunks stored successfully', {
    chunkCount: chunks.length,
    s3Keys,
  });

  return s3Keys;
}

/**
 * Get job record from DynamoDB
 */
async function getJobRecord(jobId: string, userId: string): Promise<JobRecord | null> {
  logger.info('Fetching job record', { jobId, userId });

  const command = new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
  });

  const response: GetItemCommandOutput = await dynamoClient.send(command);

  if (!response.Item) {
    logger.warn('Job record not found', { jobId, userId });
    return null;
  }

  return unmarshall(response.Item) as JobRecord;
}

/**
 * Update job status in DynamoDB
 */
async function updateJobStatus(
  jobId: string,
  userId: string,
  status: string,
  chunkData?: {
    totalChunks: number;
    chunkKeys: string[];
    originalTokenCount: number;
    averageChunkSize: number;
    processingTimeMs: number;
  },
  errorMessage?: string
): Promise<void> {
  logger.info('Updating job status', { jobId, userId, status });

  const now = new Date().toISOString();
  const updateExpression: string[] = ['updatedAt = :updatedAt', '#status = :status'];
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
    ':status': status,
  };
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
  };

  if (chunkData) {
    updateExpression.push('chunkingMetadata = :chunkingMetadata');
    expressionAttributeValues[':chunkingMetadata'] = chunkData;
  }

  if (errorMessage) {
    updateExpression.push('errorMessage = :errorMessage');
    expressionAttributeValues[':errorMessage'] = errorMessage;
  }

  const command = new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    UpdateExpression: `SET ${updateExpression.join(', ')}`,
    ExpressionAttributeValues: marshall(expressionAttributeValues),
    ExpressionAttributeNames: expressionAttributeNames,
  });

  await dynamoClient.send(command);

  logger.info('Job status updated successfully', { jobId, userId, status });
}

/**
 * Main Lambda handler for S3 events
 */
export const handler: S3Handler = async (event: S3Event): Promise<void> => {
  logger.info('Processing S3 event', {
    recordCount: event.Records.length,
  });

  // Process each S3 record
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

    logger.info('Processing S3 object', { bucket, key });

    try {
      // Get object metadata to extract job information
      const getObjectCommand = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      const objectResponse: GetObjectCommandOutput = await s3Client.send(getObjectCommand);
      const { userId, jobId, fileId } = extractJobMetadata(objectResponse.Metadata);

      // Verify job exists in DynamoDB
      const jobRecord = await getJobRecord(jobId, userId);
      if (!jobRecord) {
        logger.error('Job record not found', { jobId, userId, bucket, key });
        continue;
      }

      // Update job status to CHUNKING
      await updateJobStatus(jobId, userId, 'CHUNKING');

      // Download document content
      const content = await downloadDocument(bucket, key);

      // Chunk the document
      logger.info('Starting document chunking', {
        jobId,
        userId,
        fileId,
        contentLength: content.length,
      });

      const chunker = createChunker();
      const result = chunker.chunkDocument(content);

      logger.info('Document chunked successfully', {
        jobId,
        userId,
        fileId,
        totalChunks: result.metadata.totalChunks,
        originalTokenCount: result.metadata.originalTokenCount,
        averageChunkSize: result.metadata.averageChunkSize,
        processingTimeMs: result.metadata.processingTimeMs,
      });

      // Store chunks in S3
      const chunkKeys = await storeChunks(result.chunks, userId, fileId, jobId);

      // Update job status to CHUNKED with metadata
      await updateJobStatus(jobId, userId, 'CHUNKED', {
        totalChunks: result.metadata.totalChunks,
        chunkKeys,
        originalTokenCount: result.metadata.originalTokenCount,
        averageChunkSize: result.metadata.averageChunkSize,
        processingTimeMs: result.metadata.processingTimeMs,
      });

      logger.info('Document chunking completed successfully', {
        jobId,
        fileId,
        totalChunks: result.metadata.totalChunks,
      });
    } catch (error) {
      logger.error('Error processing document', {
        bucket,
        key,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Try to extract job ID and user ID from key for error reporting
      try {
        const getObjectCommand = new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        });
        const objectResponse: GetObjectCommandOutput = await s3Client.send(getObjectCommand);
        const { jobId, userId } = extractJobMetadata(objectResponse.Metadata);

        await updateJobStatus(
          jobId,
          userId,
          'CHUNKING_FAILED',
          undefined,
          error instanceof Error ? error.message : 'Unknown error'
        );
      } catch (updateError) {
        logger.error('Failed to update job status after error', {
          bucket,
          key,
          updateError: updateError instanceof Error ? updateError.message : 'Unknown error',
        });
      }

      // Don't throw - allow other records to process
      continue;
    }
  }

  logger.info('S3 event processing completed', {
    recordCount: event.Records.length,
  });
};
