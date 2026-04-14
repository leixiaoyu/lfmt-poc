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
import { createWriteStream, createReadStream, unlinkSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

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
 * Download document content from S3 to temporary file using streaming
 * This avoids loading the entire document into memory, which can cause
 * memory exhaustion for large files (approaching the 100MB limit).
 */
async function downloadDocumentToTempFile(bucket: string, key: string): Promise<string> {
  logger.info('Streaming document from S3 to temp file', { bucket, key });

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response: GetObjectCommandOutput = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('S3 object has no body');
  }

  // Generate unique temp file path
  const tempFilePath = `/tmp/document-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`;

  // Stream S3 object body to temp file
  const bodyStream = response.Body as Readable;
  const fileWriteStream = createWriteStream(tempFilePath);

  await pipeline(bodyStream, fileWriteStream);

  logger.info('Document streamed to temp file successfully', {
    bucket,
    key,
    tempFilePath,
  });

  return tempFilePath;
}

/**
 * Read document content from temporary file in chunks/lines
 * to avoid loading entire file into memory at once
 */
async function readDocumentFromTempFile(tempFilePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readStream = createReadStream(tempFilePath, {
      encoding: 'utf8',
      highWaterMark: 64 * 1024, // 64KB chunks
    });

    readStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    readStream.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf8');
      resolve(content);
    });

    readStream.on('error', (error) => {
      reject(error);
    });
  });
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
  const expressionAttributeValues: Record<string, unknown> = {
    ':updatedAt': now,
    ':status': status,
  };
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
  };

  if (chunkData) {
    updateExpression.push('chunkingMetadata = :chunkingMetadata');
    updateExpression.push('totalChunks = :totalChunks');
    expressionAttributeValues[':chunkingMetadata'] = chunkData;
    expressionAttributeValues[':totalChunks'] = chunkData.totalChunks;
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

      let tempFilePath: string | null = null;

      try {
        // Stream document to temp file to avoid memory exhaustion
        tempFilePath = await downloadDocumentToTempFile(bucket, key);

        // Read document content from temp file
        const content = await readDocumentFromTempFile(tempFilePath);

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
      } finally {
        // Clean up temp file
        if (tempFilePath) {
          try {
            unlinkSync(tempFilePath);
            logger.info('Temp file cleaned up', { tempFilePath });
          } catch (cleanupError) {
            logger.warn('Failed to clean up temp file', {
              tempFilePath,
              error: cleanupError instanceof Error ? cleanupError.message : 'Unknown error',
            });
          }
        }
      }
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
