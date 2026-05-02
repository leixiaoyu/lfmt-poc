/**
 * Document Chunking Lambda Handler
 *
 * Triggered by S3 upload events to process uploaded documents.
 * - Validates document size via HeadObject (DoS guard) before downloading
 * - Streams document body directly into the chunker — never holds the full
 *   document in memory at once (issue #24)
 * - Stores chunks in S3
 * - Updates job status in DynamoDB
 */

import { S3Event, S3Handler } from 'aws-lambda';
import {
  S3Client,
  GetObjectCommand,
  GetObjectCommandOutput,
  HeadObjectCommand,
  HeadObjectCommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  UpdateItemCommand,
  GetItemCommand,
  GetItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { Readable } from 'stream';
import { createChunker, ChunkContext, ChunkingResult } from './documentChunker';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';

const logger = new Logger('lfmt-chunk-document');
const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});

const DOCUMENT_BUCKET = getRequiredEnv('DOCUMENT_BUCKET');
const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

/**
 * Maximum allowed document size in bytes (DoS guard).
 * Matches shared-types/src/validation.ts fileSizeSchema upper bound (100 MB).
 * Documents above this limit are rejected at HeadObject time, before any body
 * is downloaded — bounding both Lambda memory and execution time.
 */
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

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

interface S3ObjectMetadata {
  userId: string;
  jobId: string;
  fileId: string;
  contentLength: number;
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
 * Fetch S3 object metadata + content length via HeadObject (no body download).
 *
 * This is the DoS guard: documents larger than MAX_DOCUMENT_BYTES are rejected
 * here, before any body bytes flow. Also extracts the user/job/file IDs from
 * S3 user-defined metadata so we can update job status before fetching the body.
 */
async function headObjectWithSizeGuard(bucket: string, key: string): Promise<S3ObjectMetadata> {
  const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
  const response: HeadObjectCommandOutput = await s3Client.send(command);

  const contentLength = response.ContentLength ?? 0;

  if (contentLength > MAX_DOCUMENT_BYTES) {
    logger.warn('Rejecting oversized document', {
      bucket,
      key,
      contentLength,
      maxBytes: MAX_DOCUMENT_BYTES,
    });
    throw new Error(
      `Document exceeds maximum size: ${contentLength} bytes (limit: ${MAX_DOCUMENT_BYTES} bytes)`
    );
  }

  const { userId, jobId, fileId } = extractJobMetadata(response.Metadata);
  return { userId, jobId, fileId, contentLength };
}

/**
 * Open a streaming GetObject body for the document.
 *
 * Returns the SDK's Readable directly — the chunker consumes it incrementally
 * via `for await`. No temp file, no in-memory buffer of the whole document.
 */
async function openDocumentStream(bucket: string, key: string): Promise<Readable> {
  logger.info('Opening S3 object stream', { bucket, key });

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response: GetObjectCommandOutput = await s3Client.send(command);

  if (!response.Body) {
    throw new Error('S3 object has no body');
  }

  // In Node.js Lambda the SDK v3 returns a Readable. We do not support the browser
  // ReadableStream/Blob variants here — this Lambda is Node-only.
  const body = response.Body as Readable;
  return body;
}

/**
 * Domain-typed metadata payload for a source chunk written to S3.
 *
 * Each field is typed with its natural domain type — `chunkIndex` and
 * `totalChunks` are real numbers, not pre-stringified. `storeChunks` performs
 * the `String(...)` coercion internally before the values reach
 * PutObjectCommand, so callers cannot accidentally re-introduce the same
 * SigV4 .trim() bug class as issue #172 (which hit translateChunk.ts).
 *
 * Adding a new field here requires updating both the interface and the
 * coercion in `storeChunks` — the build won't succeed otherwise.
 */
interface S3SourceChunkMetadata {
  userId: string;
  fileId: string;
  jobId: string;
  chunkIndex: number; // coerced to string before signing
  totalChunks: number; // coerced to string before signing
}

/**
 * Store chunks in S3.
 *
 * Metadata values MUST be strings — AWS SDK v3 (@smithy/signature-v4) calls
 * .trim() on every S3 metadata header value and throws a TypeError otherwise
 * (the failure mode behind issue #172 in translateChunk). This helper builds
 * a typed `S3SourceChunkMetadata` per chunk and performs the `String(...)`
 * coercion at one seam so callers cannot get it wrong.
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

    const metadata: S3SourceChunkMetadata = {
      userId,
      fileId,
      jobId,
      chunkIndex: chunk.chunkIndex,
      totalChunks: chunk.totalChunks,
    };

    // Coerce every metadata value to a string at this single seam so the
    // SigV4 .trim() invariant holds for every key — including any future
    // numeric / boolean field added to S3SourceChunkMetadata.
    const stringMetadata: Record<string, string> = {
      userId: String(metadata.userId),
      fileId: String(metadata.fileId),
      jobId: String(metadata.jobId),
      chunkIndex: String(metadata.chunkIndex),
      totalChunks: String(metadata.totalChunks),
    };

    const command = new PutObjectCommand({
      Bucket: DOCUMENT_BUCKET,
      Key: chunkKey,
      Body: JSON.stringify(chunk),
      ContentType: 'application/json',
      Metadata: stringMetadata,
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

    // Track metadata so we can report failures even if the body stream fails.
    let metadata: S3ObjectMetadata | null = null;

    try {
      // 1. HeadObject: extract metadata + DoS size guard. Never downloads body.
      metadata = await headObjectWithSizeGuard(bucket, key);
      const { userId, jobId, fileId, contentLength } = metadata;

      // 2. Verify job exists in DynamoDB
      const jobRecord = await getJobRecord(jobId, userId);
      if (!jobRecord) {
        logger.error('Job record not found', { jobId, userId, bucket, key });
        continue;
      }

      // 3. Update job status to CHUNKING
      await updateJobStatus(jobId, userId, 'CHUNKING');

      // 4. Open the body as a Readable stream and chunk incrementally.
      //    Memory peak is bounded by chunk size + small text buffer, NOT by document size.
      const bodyStream = await openDocumentStream(bucket, key);

      logger.info('Starting streaming document chunking', {
        jobId,
        userId,
        fileId,
        contentLength,
      });

      const chunker = createChunker();
      const result: ChunkingResult = await chunker.chunkDocumentStream(bodyStream);

      logger.info('Document chunked successfully', {
        jobId,
        userId,
        fileId,
        bytesProcessed: contentLength,
        totalChunks: result.metadata.totalChunks,
        originalTokenCount: result.metadata.originalTokenCount,
        averageChunkSize: result.metadata.averageChunkSize,
        processingTimeMs: result.metadata.processingTimeMs,
      });

      // 5. Store chunks in S3
      const chunkKeys = await storeChunks(result.chunks, userId, fileId, jobId);

      // 6. Update job status to CHUNKED with metadata
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

      // Best-effort job status update. We use the metadata captured before the failure;
      // if HeadObject itself failed we have no IDs to update with — log and continue.
      if (metadata) {
        try {
          await updateJobStatus(
            metadata.jobId,
            metadata.userId,
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
      }

      // Don't throw - allow other records to process
      continue;
    }
  }

  logger.info('S3 event processing completed', {
    recordCount: event.Records.length,
  });
};
