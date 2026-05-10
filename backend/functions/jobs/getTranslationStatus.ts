/**
 * Get Translation Status Lambda Function
 * GET /jobs/{jobId}/translation-status
 * Returns detailed translation progress and status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBJob, TranslationStatusApiResponse } from '@lfmt/shared-types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createFlatResponse, createErrorResponse } from '../shared/api-response';
// Note: getTranslationStatus does NOT use loadJobForUser from jobRepository.ts.
// It retains ConsistentRead: true (inline below) because it is polled tightly
// during an active translation — the UI updates on every poll response, so a
// stale read could show outdated progress for several hundred milliseconds.
// getJob.ts and deleteJob.ts use eventually-consistent reads via jobRepository,
// which is sufficient for their one-shot access patterns.

const logger = new Logger('lfmt-translation-status');
const dynamoClient = new DynamoDBClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

// Translation status response shape now lives in @lfmt/shared-types
// (TranslationStatusApiResponse) so the backend Lambda and the frontend
// service (translationService.getJobStatus) share a single source of
// truth. Drift between the two — like the 2026-05-09 demo blocker
// where the frontend read response.data.data on a flat envelope — is
// now caught at compile time on either side.
//
// History notes preserved from the previous local interface:
//   - R3 (OMC review follow-up): userId, fileSize, contentType were
//     surfaced here so TranslationDetail.tsx could render them. The
//     fields are persisted on the DDB job record at upload time
//     (uploadRequest.ts:124-126) so surfacing them is a pure wire-shape
//     catch-up with no schema migration.
//   - createdAt is the server-side ISO timestamp recorded when the job
//     record was first persisted (during upload/request). Benchmark
//     tooling uses it as the anchor for end-to-end duration measurements
//     so results aren't skewed by client-side clock drift or upload
//     timing. See backend/tests/performance/performance-benchmark.ts.

/**
 * Lambda handler for getting translation status
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Translation status request', {
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // Get authenticated user from Cognito claims
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized', undefined, undefined, requestOrigin);
    }

    // Extract jobId from path
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      return createErrorResponse(400, 'Missing jobId in path', undefined, undefined, requestOrigin);
    }

    // Load job from DynamoDB (requires both jobId and userId as composite key)
    const job = await loadJob(jobId, userId);

    // Verify job exists
    if (!job) {
      return createErrorResponse(
        404,
        `Job not found: ${jobId}`,
        undefined,
        undefined,
        requestOrigin
      );
    }

    // #227 fix — coerce translatedChunks to a JS number at the response boundary.
    //
    // Root cause: the Step Functions `UpdateJobCompleted` task uses
    // `DynamoAttributeValue.fromString(States.Format('{}', ...))` to write
    // `translatedChunks` — DynamoDB stores the attribute as a NUMBER type when
    // written by Lambda (via `marshall`) but as a STRING type when written by the
    // Step Functions DynamoUpdateItem task.  When `@aws-sdk/util-dynamodb`
    // `unmarshall` reads a `{ S: '1' }` attribute it returns the JS string `'1'`,
    // not the number `1`.  JSON.stringify then serialises it as `"chunksTranslated":"1"`
    // (quoted) instead of `"chunksTranslated":1` (numeric).
    //
    // The fix: call Number() at this seam so the wire always carries a number.
    // The WARN log makes the bug observable in CloudWatch until every write site
    // is confirmed to use a numeric DDB attribute type.
    //
    // NOTE: `totalChunks` has the same exposure via the Step Functions write,
    // so it receives the same coercion guard.
    const rawTranslatedChunks = job.translatedChunks;
    const chunksTranslated =
      typeof rawTranslatedChunks === 'number'
        ? rawTranslatedChunks
        : rawTranslatedChunks !== undefined && rawTranslatedChunks !== null
          ? (() => {
              logger.warn('chunksTranslated read as non-number from DDB — coercing (#227)', {
                jobId,
                rawType: typeof rawTranslatedChunks,
                rawValue: String(rawTranslatedChunks),
              });
              return Number(rawTranslatedChunks);
            })()
          : 0;

    const rawTotalChunks = job.totalChunks;
    const totalChunks =
      typeof rawTotalChunks === 'number'
        ? rawTotalChunks
        : rawTotalChunks !== undefined && rawTotalChunks !== null
          ? Number(rawTotalChunks)
          : 0;

    // Build response — typed with the shared DTO so any drift between
    // backend and frontend surfaces as a compile error.
    const response: TranslationStatusApiResponse = {
      jobId,
      // R3: surface the file/owner metadata persisted at upload time so
      // the Translation Details view can render File Size, Content Type,
      // and File Name without falling back to undefined-shaped UI.
      // DDB stores `filename` (lowercase n); the frontend's wire contract
      // is `fileName` (camelCase) — translate at the response boundary.
      // `fileSize` / `contentType` already match the wire shape.
      userId: job.userId,
      fileName: job.filename,
      fileSize: typeof job.fileSize === 'number' ? job.fileSize : undefined,
      contentType: typeof job.contentType === 'string' ? job.contentType : undefined,
      status: job.status, // Overall job status (PENDING_UPLOAD, UPLOADED, CHUNKED, etc.)
      translationStatus: job.translationStatus || 'NOT_STARTED',
      targetLanguage: job.targetLanguage,
      tone: job.translationTone,
      totalChunks,
      chunksTranslated,
      progressPercentage: calculateProgress(chunksTranslated, totalChunks),
      tokensUsed: job.tokensUsed,
      estimatedCost: job.estimatedCost,
      createdAt: job.createdAt,
      translationStartedAt: job.translationStartedAt,
      translationCompletedAt: job.translationCompletedAt,
    };

    // Add estimated completion for in-progress translations
    if (job.translationStatus === 'IN_PROGRESS') {
      response.estimatedCompletion = calculateEstimatedCompletion(
        chunksTranslated,
        totalChunks,
        job.translationStartedAt
      );
    }

    // Add error information if translation failed
    if (job.translationStatus === 'TRANSLATION_FAILED') {
      response.error = job.translationError || 'Translation failed';
    }

    logger.info('Translation status retrieved', {
      jobId,
      translationStatus: response.translationStatus,
      progressPercentage: response.progressPercentage,
    });

    return createFlatResponse(200, response, undefined, requestOrigin);
  } catch (error) {
    logger.error('Failed to get translation status', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Failed to get translation status',
      undefined,
      undefined,
      requestOrigin
    );
  }
};

/**
 * Load job from DynamoDB
 * DynamoDB table has composite primary key: jobId (HASH) + userId (RANGE)
 * Uses ConsistentRead to ensure we get the latest status updates
 */
async function loadJob(jobId: string, userId: string): Promise<DynamoDBJob | null> {
  const command = new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    ConsistentRead: true, // Ensure we get the latest data, critical for status polling
  });

  const response: GetItemCommandOutput = await dynamoClient.send(command);

  if (!response.Item) {
    return null;
  }

  return unmarshall(response.Item) as DynamoDBJob;
}

/**
 * Calculate progress percentage
 */
function calculateProgress(chunksTranslated: number, totalChunks: number): number {
  if (totalChunks === 0) return 0;
  return Math.round((chunksTranslated / totalChunks) * 100);
}

/**
 * Calculate estimated completion time based on current progress
 */
function calculateEstimatedCompletion(
  chunksTranslated: number,
  totalChunks: number,
  startedAt?: string
): string | undefined {
  if (!startedAt || chunksTranslated === 0) {
    // Can't estimate without start time or progress
    return undefined;
  }

  const startTime = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsed = now - startTime;

  // Calculate average time per chunk
  const avgTimePerChunk = elapsed / chunksTranslated;

  // Estimate remaining time
  const remainingChunks = totalChunks - chunksTranslated;
  const estimatedRemainingMs = remainingChunks * avgTimePerChunk;

  const completionTime = new Date(now + estimatedRemainingMs);
  return completionTime.toISOString();
}
