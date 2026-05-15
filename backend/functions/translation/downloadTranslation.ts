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
 *
 * 11. Multi-format output (issue #28 — ePub + PDF):
 *     The `?format=` query parameter selects the output format. The default
 *     (`markdown`, or absent) preserves the legacy raw text/plain response so
 *     existing clients are unaffected. `epub` and `pdf` follow a different
 *     wire contract: we generate the bytes lazily on demand, persist them to
 *     S3 under `translated-output/{jobId}/translation.{ext}`, and return a
 *     15-minute presigned GET URL inside a JSON envelope. Rationale:
 *       - ePub/PDF bytes routinely exceed the 6 MB API Gateway response cap.
 *       - Cache-by-S3-key means a second request for the same format reuses
 *         the existing object (idempotent + safe under concurrent callers).
 *       - Lazy generation avoids the storage and reassembly-Lambda churn of
 *         eager pre-generation when most casual readers only download one
 *         format. See PR body for the full lazy-vs-eager decision.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { getCorsHeaders, createErrorResponse } from '../shared/api-response';
import { loadJobForUser } from '../shared/jobRepository';
import {
  OutputFormat,
  OUTPUT_FORMAT_CONTENT_TYPES,
  OUTPUT_FORMAT_FILE_EXTENSIONS,
  isOutputFormat,
} from '@lfmt/shared-types';
import { convertMarkdownToEpub, convertMarkdownToPdf } from './formatConverters';

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
 * Presigned-URL expiry, in seconds. 15 minutes is long enough for the
 * browser to follow the redirect even on a slow connection while keeping
 * the link unattractive as a shareable artefact.
 */
const PRESIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Maximum source-document size (in bytes) we are willing to convert into
 * ePub / PDF inside a single Lambda invocation.
 *
 * Rationale: the existing 6 MB API Gateway markdown cap already gates the
 * common case. For ePub/PDF, conversion runs in memory (PDFKit and the
 * ePub generator both hold the full document in heap). 8 MB is a
 * defense-in-depth ceiling: anything past this is almost certainly a
 * partial-corruption red flag, not a real book.
 *
 * Documents that legitimately exceed this should be paginated by chapter
 * — out of scope for v1 (#28 OMC R1 H3-cq).
 */
const MAX_CONVERSION_SOURCE_BYTES = 8 * 1024 * 1024;

/**
 * Parse and validate the `format` query parameter.
 *
 * Defaults to `markdown` when the parameter is absent or empty so the
 * legacy GET /jobs/{jobId}/download contract is preserved for clients
 * that haven't been updated.
 *
 * Returns `null` when the value is present but not in OutputFormat;
 * callers map that to 400 Bad Request.
 */
function parseFormatParam(event: APIGatewayProxyEvent): OutputFormat | null {
  const raw = event.queryStringParameters?.format;
  if (raw === undefined || raw === null || raw === '') {
    return 'markdown';
  }
  return isOutputFormat(raw) ? raw : null;
}

/**
 * Build the deterministic S3 key for a generated ePub/PDF output.
 *
 * `translated-output/{jobId}/translation.{ext}` lives under a NEW prefix
 * (translated-output/) so the IAM grant on the existing `translated/`
 * prefix does NOT accidentally widen to include generated artefacts.
 * The Lambda's role is updated separately in the CDK stack to add the
 * write permission only on this prefix.
 */
function buildOutputObjectKey(jobId: string, format: OutputFormat): string {
  return `translated-output/${jobId}/translation.${OUTPUT_FORMAT_FILE_EXTENSIONS[format]}`;
}

/**
 * Best-effort title derivation from the job's filename.
 *
 * Strips the extension and replaces underscores with spaces so an ePub
 * generated from `the_brothers_karamazov.txt` shows as
 * "the brothers karamazov" in the device library rather than the raw
 * filename. Returns "Translation" when the filename is missing or
 * unparseable.
 */
function deriveTitle(rawFilename: string | undefined): string {
  if (!rawFilename) return 'Translation';
  const base = rawFilename.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
  return base.length > 0 ? base : 'Translation';
}

/**
 * Check whether a generated artefact already exists at the given key.
 *
 * Used for the cache-by-S3-key optimisation: when two users (or the same
 * user) request the same job + format, the second request reuses the
 * existing object instead of regenerating. HeadObject is cheap (~5 ms)
 * compared with PDF/ePub generation (1–5 s).
 *
 * Returns `true` if the object exists, `false` if not, and rethrows on
 * any other error (e.g. AccessDenied — surfacing an IAM misconfiguration
 * rather than silently falling through to regeneration).
 */
async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * Assemble the translated Markdown document for a job — encapsulates the
 * full chunk-listing → ordering → fetching → concatenation pipeline so the
 * handler can dispatch on `?format=` without duplicating this logic.
 *
 * Returns an error envelope (statusCode + message) on data-integrity
 * failures so the caller can map directly to an `APIGatewayProxyResult`
 * without re-deriving the appropriate HTTP code.
 */
async function assembleMarkdown(
  job: { totalChunks?: number },
  jobId: string,
  requestId: string
): Promise<{ ok: true; markdown: string } | { ok: false; statusCode: number; message: string }> {
  const chunkKeys = await listTranslatedChunkKeys(jobId);

  if (chunkKeys.length === 0) {
    logger.error('COMPLETED job has no translated chunks in S3', { requestId, jobId });
    return {
      ok: false,
      statusCode: 500,
      message: 'Translation data missing — no translated chunks found for completed job',
    };
  }

  const validChunkKeys = chunkKeys.filter((k) => !isNaN(parseChunkIndex(k)));
  const invalidChunkKeys = chunkKeys.filter((k) => isNaN(parseChunkIndex(k)));

  if (validChunkKeys.length === 0) {
    const sampleKeys = invalidChunkKeys.slice(0, MAX_CORRUPT_KEYS_LOGGED);
    logger.error('No chunk keys with parseable indices', {
      requestId,
      jobId,
      totalCorruptKeys: invalidChunkKeys.length,
      sampleKeys,
    });
    return {
      ok: false,
      statusCode: 500,
      message: 'Translation data corrupt — unrecognised chunk keys',
    };
  }

  if (invalidChunkKeys.length > 0) {
    logger.warn('Some chunk keys had unparseable indices — skipped', {
      requestId,
      jobId,
      validCount: validChunkKeys.length,
      invalidCount: invalidChunkKeys.length,
      sampleInvalidKeys: invalidChunkKeys.slice(0, MAX_CORRUPT_KEYS_LOGGED),
    });
  }

  if (job.totalChunks !== undefined && validChunkKeys.length !== job.totalChunks) {
    logger.error('Chunk count mismatch — partial document detected', {
      requestId,
      jobId,
      expectedChunks: job.totalChunks,
      foundChunks: validChunkKeys.length,
    });
    return {
      ok: false,
      statusCode: 500,
      message: `Translation data incomplete — expected ${job.totalChunks} chunks but found ${validChunkKeys.length}`,
    };
  }

  const chunkContents = await Promise.all(validChunkKeys.map(fetchChunkContent));
  return { ok: true, markdown: chunkContents.join('\n') };
}

/**
 * Lambda handler — GET /jobs/{jobId}/download[?format=markdown|epub|pdf]
 *
 * Format dispatch:
 *   - `markdown` (default) — returns the raw text/plain body inline,
 *     preserving the pre-#28 contract.
 *   - `epub` / `pdf` — generates the output if not already cached in S3,
 *     uploads under `translated-output/{jobId}/translation.{ext}`, and
 *     returns a JSON envelope `{ downloadUrl, expiresIn, format, ... }`
 *     pointing at a 15-minute presigned GET URL.
 *
 * HTTP response codes:
 *   200 — document assembled and returned / presigned URL ready
 *   400 — missing or invalid jobId; unsupported `format` value
 *   401 — no authenticated user (missing Cognito claims)
 *   404 — job not found or belongs to another user (BOLA-safe)
 *   409 — job exists but translationStatus is not COMPLETED
 *   413 — assembled markdown exceeds 6 MB inline-response limit
 *          (markdown path only; ePub/PDF bypass this via S3)
 *   500 — unexpected error (S3 read failure, conversion failure, etc.)
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Download translation request', {
    requestId,
    path: event.path,
    method: event.httpMethod,
    format: event.queryStringParameters?.format,
  });

  try {
    // --- Auth -----------------------------------------------------------
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized', requestId, undefined, requestOrigin);
    }

    // --- Format param ---------------------------------------------------
    const format = parseFormatParam(event);
    if (format === null) {
      return createErrorResponse(
        400,
        `Unsupported format: ${event.queryStringParameters?.format}. Allowed: markdown, epub, pdf.`,
        requestId,
        undefined,
        requestOrigin
      );
    }

    // --- Path params + UUID format guard --------------------------------
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

    const rawFilename = typeof job.filename === 'string' ? job.filename : undefined;

    // -----------------------------------------------------------------
    // ePub / PDF path — generate-or-reuse via S3 + presigned URL.
    // -----------------------------------------------------------------
    if (format === 'epub' || format === 'pdf') {
      return await handleConvertedFormat({
        format,
        job,
        jobId,
        requestId,
        requestOrigin,
        rawFilename,
      });
    }

    // -----------------------------------------------------------------
    // Markdown path (legacy, unchanged) — inline text/plain response.
    // -----------------------------------------------------------------
    logger.info('Fetching translated chunks (markdown path)', { requestId, jobId });
    const assembled = await assembleMarkdown(job, jobId, requestId);
    if (!assembled.ok) {
      return createErrorResponse(
        assembled.statusCode,
        assembled.message,
        requestId,
        undefined,
        requestOrigin
      );
    }
    const assembledDocument = assembled.markdown;

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
          'Use ?format=pdf or ?format=epub for a presigned-URL download of large documents.',
        requestId,
        undefined,
        requestOrigin
      );
    }

    logger.info('Translation assembled (markdown)', {
      requestId,
      jobId,
      documentBytes,
    });

    const downloadFilename = buildSafeDownloadFilename(rawFilename);

    return {
      statusCode: 200,
      headers: {
        ...getCorsHeaders(requestOrigin),
        'Content-Type': OUTPUT_FORMAT_CONTENT_TYPES.markdown,
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
      body: assembledDocument,
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

/**
 * Generate (or reuse) an ePub/PDF artefact and return a presigned-URL
 * JSON envelope so the SPA can issue a follow-up direct-to-S3 download.
 *
 * Caching: keyed off `translated-output/{jobId}/translation.{ext}`. If
 * the object already exists, we skip the (expensive) conversion and go
 * straight to presigning. This is the deduplication strategy mentioned
 * in the issue brief — both concurrent callers succeed; the second
 * request just pays for a HeadObject + Presign instead of a full render.
 */
async function handleConvertedFormat(params: {
  format: 'epub' | 'pdf';
  job: { totalChunks?: number };
  jobId: string;
  requestId: string;
  requestOrigin: string | undefined;
  rawFilename: string | undefined;
}): Promise<APIGatewayProxyResult> {
  const { format, job, jobId, requestId, requestOrigin, rawFilename } = params;
  const outputKey = buildOutputObjectKey(jobId, format);

  // Cache hit — short-circuit straight to a presigned URL.
  if (await objectExists(DOCUMENT_BUCKET, outputKey)) {
    logger.info('Reusing cached generated artefact', {
      requestId,
      jobId,
      format,
      outputKey,
    });
    const url = await presignDownload(outputKey, rawFilename, format);
    return jsonOk(url, format, outputKey, requestOrigin);
  }

  // Cache miss — fetch the markdown source, convert, and upload.
  logger.info('Generating converted artefact', { requestId, jobId, format });

  const assembled = await assembleMarkdown(job, jobId, requestId);
  if (!assembled.ok) {
    return createErrorResponse(
      assembled.statusCode,
      assembled.message,
      requestId,
      undefined,
      requestOrigin
    );
  }

  const sourceBytes = Buffer.byteLength(assembled.markdown, 'utf-8');
  if (sourceBytes > MAX_CONVERSION_SOURCE_BYTES) {
    logger.warn('Source document exceeds conversion size cap', {
      requestId,
      jobId,
      format,
      sourceBytes,
      limitBytes: MAX_CONVERSION_SOURCE_BYTES,
    });
    return createErrorResponse(
      413,
      `Translation source exceeds the ${MAX_CONVERSION_SOURCE_BYTES} byte ePub/PDF conversion limit. ` +
        'Per-chapter export is planned (see issue #28 follow-up).',
      requestId,
      undefined,
      requestOrigin
    );
  }

  const title = deriveTitle(rawFilename);
  const author = 'Translated by LFMT';

  let body: Buffer;
  try {
    body =
      format === 'epub'
        ? await convertMarkdownToEpub({ title, author, markdown: assembled.markdown })
        : await convertMarkdownToPdf({ title, author, markdown: assembled.markdown });
  } catch (err) {
    logger.error('Conversion failed', {
      requestId,
      jobId,
      format,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    return createErrorResponse(
      500,
      `Failed to generate ${format.toUpperCase()} output`,
      requestId,
      undefined,
      requestOrigin
    );
  }

  // Write to S3. CacheControl: no-store on the object so that if we ever
  // need to invalidate (e.g. translation rerun), we don't have to fight a
  // long-lived CDN cache.
  await s3Client.send(
    new PutObjectCommand({
      Bucket: DOCUMENT_BUCKET,
      Key: outputKey,
      Body: body,
      ContentType: OUTPUT_FORMAT_CONTENT_TYPES[format],
      CacheControl: 'no-store',
    })
  );

  logger.info('Generated artefact uploaded', {
    requestId,
    jobId,
    format,
    outputKey,
    bytes: body.length,
  });

  const url = await presignDownload(outputKey, rawFilename, format);
  return jsonOk(url, format, outputKey, requestOrigin);
}

/**
 * Build a 15-minute presigned GET URL for an S3 object. We set
 * `ResponseContentDisposition` so the browser preserves the suggested
 * filename even though the request hits S3 directly (the presigned URL
 * carries it as a query parameter).
 */
async function presignDownload(
  key: string,
  rawFilename: string | undefined,
  format: 'epub' | 'pdf'
): Promise<string> {
  const ext = OUTPUT_FORMAT_FILE_EXTENSIONS[format];
  const baseName = (rawFilename ? rawFilename.replace(/\.[^.]+$/, '') : 'translation').replace(
    /[/\\]/g,
    '_'
  );
  const safe = /^[\w\-. ]+$/.test(baseName) ? baseName : 'translation';
  const filename = `translated_${safe}.${ext}`;

  return await getSignedUrl(
    s3Client,
    new GetObjectCommand({
      Bucket: DOCUMENT_BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
      ResponseContentType: OUTPUT_FORMAT_CONTENT_TYPES[format],
    }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS }
  );
}

/**
 * Build the JSON-envelope success response for ePub/PDF downloads.
 *
 * Shape:
 *   { format: 'epub' | 'pdf',
 *     downloadUrl: string,
 *     expiresInSeconds: number,
 *     objectKey: string }
 *
 * Frontend reads `downloadUrl` and triggers a `window.location =` (or an
 * anchor.click()) — the browser fetches direct from S3 with no Lambda
 * round trip for the actual bytes.
 */
function jsonOk(
  url: string,
  format: 'epub' | 'pdf',
  objectKey: string,
  requestOrigin: string | undefined
): APIGatewayProxyResult {
  return {
    statusCode: 200,
    headers: {
      ...getCorsHeaders(requestOrigin),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({
      format,
      downloadUrl: url,
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
      objectKey,
    }),
    isBase64Encoded: false,
  };
}
