/**
 * Download Translation Lambda Function
 * GET /translation/{jobId}/download
 *
 * Assembles all translated chunks for a completed job and returns the full
 * translated document as a raw binary response (Content-Type: text/plain).
 *
 * Design decisions:
 *
 * 1. Blob response (not JSON wrapper):
 *    The frontend's downloadTranslation() calls the endpoint with
 *    `responseType: 'blob'` and triggers a browser download via an object URL.
 *    Returning raw text/plain here allows that flow without modification.
 *
 * 2. Ownership enforcement:
 *    Uses loadJobForUser() from jobRepository.ts — the DynamoDB composite key
 *    (jobId HASH + userId RANGE) means any job not owned by the caller returns
 *    null, which maps to 404 (OWASP API1:2023 — BOLA prevention).
 *
 * 3. Status guard — 409 Conflict for non-COMPLETED jobs:
 *    If the job exists but is not COMPLETED, returning 409 is more honest than
 *    404 (the resource exists, but the state does not permit downloading).
 *    The frontend can surface the current status to the user.
 *
 * 4. Chunk ordering:
 *    translateChunk.ts writes chunks to `translated/{jobId}/chunk-{N}.txt`
 *    (0-indexed). We list all objects under that prefix, sort numerically by
 *    the chunk index extracted from the key, and concatenate. Sorted list
 *    order is NOT relied upon because S3 returns keys in lexicographic order
 *    (which means "chunk-10.txt" < "chunk-2.txt" lexicographically).
 *
 * 5. IAM — dedicated role (DownloadTranslationLambdaRole):
 *    Only needs: dynamodb:GetItem on JobsTable + s3:GetObject on
 *    documentBucket's `translated/*` prefix + s3:ListBucket on the bucket.
 *    This is scoped more narrowly than translationRole to satisfy least
 *    privilege.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { getCorsHeaders } from '../shared/api-response';
import { loadJobForUser } from '../shared/jobRepository';

const logger = new Logger('lfmt-download-translation');
const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const DOCUMENT_BUCKET = getRequiredEnv('DOCUMENT_BUCKET');

/**
 * Parse the numeric chunk index from a translated chunk S3 key.
 *
 * Key format: `translated/{jobId}/chunk-{N}.txt`
 * Returns NaN if the key does not match the expected pattern — callers
 * must guard against NaN with isNaN() before using the result in arithmetic.
 */
function parseChunkIndex(key: string): number {
  const match = key.match(/\/chunk-(\d+)\.txt$/);
  return match ? parseInt(match[1], 10) : NaN;
}

/**
 * List all translated chunk keys for a job, sorted in ascending chunk order.
 *
 * S3 ListObjectsV2 returns keys in lexicographic (UTF-8 byte) order, which is
 * not the same as numeric order for keys that contain integers without
 * zero-padding. We extract the numeric index from each key and sort explicitly.
 */
async function listTranslatedChunkKeys(jobId: string): Promise<string[]> {
  const prefix = `translated/${jobId}/`;
  const keys: string[] = [];
  let continuationToken: string | undefined;

  // Paginate through all objects under the prefix (handles large chunk counts)
  do {
    const response: ListObjectsV2CommandOutput = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: DOCUMENT_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith('.txt')) {
        keys.push(obj.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  // Sort numerically by chunk index so the assembled document is in order
  // regardless of how S3 returned the keys.
  keys.sort((a, b) => parseChunkIndex(a) - parseChunkIndex(b));

  return keys;
}

/**
 * Fetch the text content of a single translated chunk from S3.
 */
async function fetchChunkContent(key: string): Promise<string> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: DOCUMENT_BUCKET,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error(`Chunk body missing for key: ${key}`);
  }

  return response.Body.transformToString('utf-8');
}

/**
 * Lambda handler — GET /translation/{jobId}/download
 *
 * Returns the assembled translated document as a raw text/plain response so
 * that the frontend can stream it into a Blob and trigger a browser download.
 *
 * HTTP response codes:
 *   200 — document assembled and returned
 *   400 — missing jobId path parameter
 *   401 — no authenticated user (missing Cognito claims)
 *   404 — job not found or belongs to another user (BOLA-safe)
 *   409 — job exists but translationStatus is not COMPLETED
 *   500 — unexpected error (S3 read failure, data integrity issue, etc.)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Download translation request', {
    requestId,
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // --- Auth -----------------------------------------------------------
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return errorResponse(401, 'Unauthorized', requestId, requestOrigin);
    }

    // --- Path params ----------------------------------------------------
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      return errorResponse(400, 'Missing jobId in path', requestId, requestOrigin);
    }

    // --- Ownership & existence ------------------------------------------
    // loadJobForUser uses the composite DynamoDB key (jobId + userId).
    // Returns null when the job does not exist OR belongs to a different
    // user — both cases map to 404 (BOLA prevention).
    const job = await loadJobForUser(dynamoClient, JOBS_TABLE, jobId, userId);

    if (!job) {
      return errorResponse(404, `Job not found: ${jobId}`, requestId, requestOrigin);
    }

    // --- Status guard ---------------------------------------------------
    // translationStatus is the field set by the Step Functions workflow;
    // the outer `status` field is also set to COMPLETED by UpdateJobCompleted.
    // We check translationStatus for the download guard because it is the
    // authoritative field for translation-specific lifecycle state.
    if (job.translationStatus !== 'COMPLETED') {
      const currentStatus = job.translationStatus ?? 'UNKNOWN';
      return errorResponse(
        409,
        `Translation not yet complete; current status: ${currentStatus}`,
        requestId,
        requestOrigin
      );
    }

    // --- Chunk assembly -------------------------------------------------
    logger.info('Fetching translated chunks', { requestId, jobId });

    const chunkKeys = await listTranslatedChunkKeys(jobId);

    if (chunkKeys.length === 0) {
      // Job is marked COMPLETED but no chunks exist in S3 — data integrity error
      logger.error('COMPLETED job has no translated chunks in S3', { requestId, jobId });
      return errorResponse(
        500,
        'Translation data missing — no translated chunks found for completed job',
        requestId,
        requestOrigin
      );
    }

    // Validate that all chunks have parseable indices (guards against
    // unrecognised key formats in the prefix that might pollute the output)
    const validChunkKeys = chunkKeys.filter((k) => !isNaN(parseChunkIndex(k)));

    if (validChunkKeys.length === 0) {
      logger.error('No chunk keys with parseable indices', { requestId, jobId, chunkKeys });
      return errorResponse(
        500,
        'Translation data corrupt — unrecognised chunk keys',
        requestId,
        requestOrigin
      );
    }

    // Fetch all chunks in parallel. For very large jobs (400K words ≈ 115 chunks
    // at 3500 tokens/chunk) this is significantly faster than sequential fetching.
    // Lambda's default 10-connection limit per socket pool is sufficient here;
    // S3 GetObject is a separate HTTP/1.1 request per chunk.
    const chunkContents = await Promise.all(validChunkKeys.map(fetchChunkContent));

    // Concatenate with a single newline between chunks to preserve paragraph
    // breaks without doubling the whitespace that translateChunk already outputs.
    const assembledDocument = chunkContents.join('\n');

    logger.info('Translation assembled', {
      requestId,
      jobId,
      chunkCount: validChunkKeys.length,
      documentBytes: assembledDocument.length,
    });

    // Derive a safe download filename from the job's original file.
    // `filename` field on the DynamoDB record is the original uploaded name.
    // If not present, fall back to a generic name.
    const originalFilename =
      typeof job.filename === 'string' && job.filename ? job.filename : 'translation.txt';

    const downloadFilename = originalFilename.endsWith('.txt')
      ? `translated_${originalFilename}`
      : `translated_${originalFilename}.txt`;

    // Return the raw document content as text/plain so the frontend
    // can construct a Blob and trigger a browser download via an object URL.
    // CORS headers are included so the browser permits the cross-origin read.
    return {
      statusCode: 200,
      headers: {
        ...getCorsHeaders(requestOrigin),
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        // Prevent caching of translation downloads — the user should always
        // get the latest assembled content if they re-request.
        'Cache-Control': 'no-store',
      },
      body: assembledDocument,
      // API Gateway requires isBase64Encoded: false for text responses.
      isBase64Encoded: false,
    };
  } catch (error) {
    logger.error('Failed to download translation', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return errorResponse(500, 'Failed to download translation', requestId, requestOrigin);
  }
};

/**
 * Build a JSON error response with CORS headers.
 *
 * The download endpoint normally returns raw text, but error responses are
 * JSON (matching the rest of the API) so that the frontend's error handler
 * can parse and display them.
 */
function errorResponse(
  statusCode: number,
  message: string,
  requestId: string,
  requestOrigin: string | undefined
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      ...getCorsHeaders(requestOrigin),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, requestId }),
  };
}
