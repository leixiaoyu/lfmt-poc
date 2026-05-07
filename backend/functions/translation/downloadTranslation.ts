/**
 * Download Translation Lambda Function
 * GET /jobs/{jobId}/download
 *
 * Assembles all translated chunks for a completed job and returns the full
 * translated document as a raw binary response (Content-Type: text/plain).
 *
 * Design decisions:
 *
 * 1. URL convention:
 *    Route is /jobs/{jobId}/download — consistent with the established
 *    /jobs/{jobId}/translate and /jobs/{jobId}/translation-status convention.
 *    A /translation/{jobId}/download route was used initially but was renamed
 *    (OMC review #4) to eliminate the degenerate parallel resource hierarchy.
 *
 * 2. Blob response (not JSON wrapper):
 *    The frontend's downloadTranslation() calls the endpoint with
 *    `responseType: 'blob'` and triggers a browser download via an object URL.
 *    Returning raw text/plain here allows that flow without modification.
 *
 * 3. Ownership enforcement (BOLA prevention):
 *    Uses loadJobForUser() from jobRepository.ts — the DynamoDB composite key
 *    (jobId HASH + userId RANGE) means any job not owned by the caller returns
 *    null, which maps to 404 (OWASP API1:2023 — BOLA prevention).
 *
 * 4. Status guard — 409 Conflict for non-COMPLETED jobs:
 *    If the job exists but is not COMPLETED, returning 409 is more honest than
 *    404 (the resource exists, but the state does not permit downloading).
 *    The frontend can surface the current status to the user.
 *
 * 5. Chunk ordering:
 *    translateChunk.ts writes chunks to `translated/{jobId}/chunk-{N}.txt`
 *    (0-indexed). We list all objects under that prefix, sort numerically by
 *    the chunk index extracted from the key, and concatenate. Sorted list
 *    order is NOT relied upon because S3 returns keys in lexicographic order
 *    (which means "chunk-10.txt" < "chunk-2.txt" lexicographically).
 *
 * 6. IAM — dedicated role (DownloadTranslationLambdaRole):
 *    Only needs: dynamodb:GetItem on JobsTable + s3:GetObject on
 *    documentBucket's `translated/*` prefix + s3:ListBucket on the bucket.
 *    This is scoped more narrowly than translationRole to satisfy least
 *    privilege.
 *
 * 7. Size guard — 6 MB ceiling:
 *    API Gateway has a hard 10 MB response body limit. Multi-byte UTF-8 text
 *    (e.g. CJK for a 400 K-word document) can approach that limit. We reject
 *    early with 413 if the assembled document exceeds 6 MB, pointing the
 *    caller toward a future presigned-URL alternative.
 *
 * 8. Chunk count integrity:
 *    If job.totalChunks is recorded and the S3 listing produces a different
 *    count, we log the mismatch and return 500 rather than silently returning
 *    a partial document.
 *
 * 9. Filename sanitization:
 *    The Content-Disposition header is a response seam where unsanitized input
 *    could smuggle header-injection characters. The filename is validated against
 *    an allowlist regex before interpolation.
 *
 * 10. S3 keep-alive:
 *     The NodeHttpHandler is configured with connection keep-alive and a capped
 *     socket pool to reduce TCP overhead on parallel chunk fan-out.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { getCorsHeaders, createErrorResponse } from '../shared/api-response';
import { loadJobForUser } from '../shared/jobRepository';

const logger = new Logger('lfmt-download-translation');
const dynamoClient = new DynamoDBClient({});

// S3 client with keep-alive connections + capped socket pool to reduce TCP overhead
// when fetching many chunks in parallel (400K-word doc ≈ 115 chunks at 3500 tokens).
// maxSockets: 50 caps the pool to avoid exhausting Lambda's ephemeral port budget;
// 50 is well above the Step Functions maxConcurrency: 10, so no requests are queued.
const s3Client = new S3Client({
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
    socketTimeout: 30000,
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 50 }),
  }),
});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const DOCUMENT_BUCKET = getRequiredEnv('DOCUMENT_BUCKET');

/**
 * Maximum assembled document size API Gateway will accept as a response body.
 * API Gateway hard-limits response bodies to 10 MB; we use 6 MB to leave room
 * for multi-byte UTF-8 and response overhead.
 *
 * Documents exceeding this should use a presigned-URL download flow instead
 * (deferred — see OMC performance item #14).
 */
const MAX_RESPONSE_BYTES = 6 * 1024 * 1024; // 6 MB

/**
 * Maximum number of corrupt-key names to include in a single log entry.
 * Prevents log-line bloat on degenerate S3 prefix contents (OMC security #12).
 */
const MAX_CORRUPT_KEYS_LOGGED = 10;

/**
 * Allowlist regex for safe Content-Disposition filenames.
 * Permits: letters, digits, hyphens, underscores, dots, and spaces.
 * Rejects: newlines, quotes, semicolons, and other header-injection characters.
 * (OMC security #10 — defense-in-depth at the response seam.)
 */
const SAFE_FILENAME_PATTERN = /^[\w\-. ]+$/;

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
 * Derive a sanitized Content-Disposition filename from the job's original file.
 *
 * Validates against SAFE_FILENAME_PATTERN to prevent header-injection characters
 * from being interpolated into the response header (defense-in-depth — the
 * filenameSchema upstream also validates, but this seam is the authoritative guard).
 */
function buildSafeDownloadFilename(rawFilename: string | undefined): string {
  const base = typeof rawFilename === 'string' && rawFilename ? rawFilename : 'translation.txt';

  // Strip path separators to prevent directory traversal in the filename token.
  const stripped = base.replace(/[/\\]/g, '_');

  // Add .txt extension if not already present.
  const withExt = stripped.endsWith('.txt') ? stripped : `${stripped}.txt`;

  const candidate = `translated_${withExt}`;

  if (!SAFE_FILENAME_PATTERN.test(candidate)) {
    // Fall back to a generic safe name rather than serving a potentially unsafe header.
    logger.warn('Filename failed allowlist check — using fallback', { rawFilename, candidate });
    return 'translated_document.txt';
  }

  return candidate;
}

/**
 * Lambda handler — GET /jobs/{jobId}/download
 *
 * Returns the assembled translated document as a raw text/plain response so
 * that the frontend can stream it into a Blob and trigger a browser download.
 *
 * HTTP response codes:
 *   200 — document assembled and returned
 *   400 — missing or invalid jobId path parameter
 *   401 — no authenticated user (missing Cognito claims)
 *   404 — job not found or belongs to another user (BOLA-safe)
 *   409 — job exists but translationStatus is not COMPLETED
 *   413 — assembled document exceeds 6 MB response size limit
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
      return createErrorResponse(401, 'Unauthorized', requestId, undefined, requestOrigin);
    }

    // --- Path params + UUID format guard --------------------------------
    // Cognito sub UUIDs and our jobId UUIDs share the same RFC 4122 format.
    // Validating here rejects path-traversal-style attempts before DDB/S3 calls.
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      return createErrorResponse(400, 'Missing jobId in path', requestId, undefined, requestOrigin);
    }
    const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_PATTERN.test(jobId)) {
      return createErrorResponse(
        400,
        'Invalid jobId format — must be a UUID',
        requestId,
        undefined,
        requestOrigin
      );
    }

    // --- Ownership & existence ------------------------------------------
    // loadJobForUser uses the composite DynamoDB key (jobId + userId).
    // Returns null when the job does not exist OR belongs to a different
    // user — both cases map to 404 (BOLA prevention).
    const job = await loadJobForUser(dynamoClient, JOBS_TABLE, jobId, userId);

    if (!job) {
      return createErrorResponse(
        404,
        `Job not found: ${jobId}`,
        requestId,
        undefined,
        requestOrigin
      );
    }

    // --- Status guard ---------------------------------------------------
    // translationStatus is the field set by the Step Functions workflow;
    // the outer `status` field is also set to COMPLETED by UpdateJobCompleted.
    // We check translationStatus for the download guard because it is the
    // authoritative field for translation-specific lifecycle state.
    if (job.translationStatus !== 'COMPLETED') {
      const currentStatus = job.translationStatus ?? 'UNKNOWN';
      return createErrorResponse(
        409,
        `Translation not yet complete; current status: ${currentStatus}`,
        requestId,
        undefined,
        requestOrigin
      );
    }

    // --- Chunk assembly -------------------------------------------------
    logger.info('Fetching translated chunks', { requestId, jobId });

    const chunkKeys = await listTranslatedChunkKeys(jobId);

    if (chunkKeys.length === 0) {
      // Job is marked COMPLETED but no chunks exist in S3 — data integrity error
      logger.error('COMPLETED job has no translated chunks in S3', { requestId, jobId });
      return createErrorResponse(
        500,
        'Translation data missing — no translated chunks found for completed job',
        requestId,
        undefined,
        requestOrigin
      );
    }

    // Validate that all chunks have parseable indices (guards against
    // unrecognised key formats in the prefix that might pollute the output).
    const validChunkKeys = chunkKeys.filter((k) => !isNaN(parseChunkIndex(k)));
    const invalidChunkKeys = chunkKeys.filter((k) => isNaN(parseChunkIndex(k)));

    if (validChunkKeys.length === 0) {
      // Cap logged key names to avoid log-line bloat on degenerate inputs.
      const sampleKeys = invalidChunkKeys.slice(0, MAX_CORRUPT_KEYS_LOGGED);
      logger.error('No chunk keys with parseable indices', {
        requestId,
        jobId,
        totalCorruptKeys: invalidChunkKeys.length,
        sampleKeys,
      });
      return createErrorResponse(
        500,
        'Translation data corrupt — unrecognised chunk keys',
        requestId,
        undefined,
        requestOrigin
      );
    }

    if (invalidChunkKeys.length > 0) {
      // Partial corruption: some keys are parseable, some are not. Log but continue.
      logger.warn('Some chunk keys had unparseable indices — skipped', {
        requestId,
        jobId,
        validCount: validChunkKeys.length,
        invalidCount: invalidChunkKeys.length,
        sampleInvalidKeys: invalidChunkKeys.slice(0, MAX_CORRUPT_KEYS_LOGGED),
      });
    }

    // --- Chunk count integrity check ------------------------------------
    // If job.totalChunks is recorded, the S3 listing must match.
    // A mismatch means some chunks were not written (or were deleted) — returning
    // a partial document silently would mislead the end user.
    if (job.totalChunks !== undefined && validChunkKeys.length !== job.totalChunks) {
      logger.error('Chunk count mismatch — partial document detected', {
        requestId,
        jobId,
        expectedChunks: job.totalChunks,
        foundChunks: validChunkKeys.length,
      });
      return createErrorResponse(
        500,
        `Translation data incomplete — expected ${job.totalChunks} chunks but found ${validChunkKeys.length}`,
        requestId,
        undefined,
        requestOrigin
      );
    }

    // Fetch all chunks in parallel. For very large jobs (400K words ≈ 115 chunks
    // at 3500 tokens/chunk) this is significantly faster than sequential fetching.
    // The S3 client is configured with keep-alive and maxSockets: 50 (module level).
    const chunkContents = await Promise.all(validChunkKeys.map(fetchChunkContent));

    // Concatenate with a single newline between chunks to preserve paragraph
    // breaks without doubling the whitespace that translateChunk already outputs.
    const assembledDocument = chunkContents.join('\n');

    // --- Size guard -------------------------------------------------------
    // API Gateway hard-limits response bodies to 10 MB. We cap at 6 MB to
    // leave headroom for UTF-8 multi-byte expansion. Documents exceeding this
    // should use a presigned-URL download (future work — see #14).
    const documentBytes = Buffer.byteLength(assembledDocument, 'utf-8');
    if (documentBytes > MAX_RESPONSE_BYTES) {
      logger.warn('Assembled document exceeds 6 MB response limit', {
        requestId,
        jobId,
        documentBytes,
        limitBytes: MAX_RESPONSE_BYTES,
      });
      return createErrorResponse(
        413,
        'Assembled translation exceeds the 6 MB download limit via this API. ' +
          'A presigned-URL download endpoint for large documents is planned.',
        requestId,
        undefined,
        requestOrigin
      );
    }

    logger.info('Translation assembled', {
      requestId,
      jobId,
      chunkCount: validChunkKeys.length,
      documentBytes,
    });

    // DynamoDBJob.filename is typed `string | undefined` (the index signature
    // also allows `unknown`). The helper only needs string | undefined.
    const rawFilename = typeof job.filename === 'string' ? job.filename : undefined;
    const downloadFilename = buildSafeDownloadFilename(rawFilename);

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
        // Defense-in-depth: instruct browsers not to sniff the content type.
        'X-Content-Type-Options': 'nosniff',
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

    return createErrorResponse(
      500,
      'Failed to download translation',
      requestId,
      undefined,
      requestOrigin
    );
  }
};
