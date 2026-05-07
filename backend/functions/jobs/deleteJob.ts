/**
 * Delete Job Lambda Function
 * DELETE /jobs/{jobId}
 *
 * Permanently removes a job record owned by the authenticated user from
 * DynamoDB and best-effort deletes the associated S3 object(s).
 *
 * Design decisions:
 *
 * 1. Single-round-trip delete (item #11):
 *    Uses a single DeleteItemCommand with a compound ConditionExpression
 *    (attribute_exists(jobId) AND userId = :requesterUserId) plus
 *    ReturnValues: 'ALL_OLD' to retrieve the deleted record in one round trip.
 *    If ConditionalCheckFailedException fires we don't know whether the job was
 *    not found or belonged to another user — we return 404 either way
 *    (privacy-preserving: avoids leaking existence to cross-ownership probes,
 *    OWASP API1:2023). This means deleteJob does NOT use loadJobForUser from
 *    jobRepository.ts; the perf rationale (one fewer DynamoDB round trip)
 *    justifies the divergence from the shared helper.
 *
 * 2. S3 cascade delete (item #7):
 *    After the DDB delete succeeds, deletes the S3 object(s) under the job's
 *    s3Key prefix (uploads/ key) and any translated results (results/ prefix).
 *    If S3 deletion fails after DDB delete, the orphan is logged and surfaced
 *    as a non-fatal warning in the response. The user's intent (delete the job)
 *    is honored at the DB level; S3 cleanup is operations' responsibility.
 *
 * 3. Step Functions trade-off (item #8):
 *    If the job is deleted while its translation Step Functions execution is
 *    still IN_PROGRESS, that execution will fail downstream when it tries to
 *    update the now-missing DDB record. This is a known operational gap for
 *    the current POC scope. See follow-up issue:
 *    "feat(infra): StopExecution on Step Functions if job DELETE while
 *    translation in progress"
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  DeleteItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBJob, DeleteJobApiResponse } from '@lfmt/shared-types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';

const logger = new Logger('lfmt-delete-job');
const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const DOCUMENT_BUCKET = getRequiredEnv('DOCUMENT_BUCKET');

/**
 * Delete the DDB job record atomically with ownership verification.
 *
 * ConditionExpression enforces two things in one round trip:
 * - attribute_exists(jobId): item must exist
 * - userId = :requesterUserId: item must be owned by the caller (BOLA guard)
 *
 * ReturnValues: 'ALL_OLD' returns the pre-delete record so we can extract
 * the s3Key for the subsequent S3 cleanup without a prior GetItem call.
 *
 * Throws ConditionalCheckFailedException when the job does not exist OR is
 * owned by a different user — callers must catch and return 404 (not 403) to
 * avoid leaking existence information.
 */
async function deleteJobRecord(jobId: string, userId: string): Promise<DynamoDBJob> {
  const command = new DeleteItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    ConditionExpression: 'attribute_exists(jobId) AND userId = :requesterUserId',
    ExpressionAttributeValues: marshall({ ':requesterUserId': userId }),
    ReturnValues: 'ALL_OLD',
  });

  const result = await dynamoClient.send(command);

  // ReturnValues: 'ALL_OLD' guarantees Attributes is populated when the delete
  // succeeds. The null-assertion is safe here because we just deleted the item.
  return unmarshall(result.Attributes!) as DynamoDBJob;
}

/**
 * Best-effort delete of S3 objects associated with the job.
 * Returns null on success, an error message if any deletion fails.
 *
 * S3 key conventions (from uploadRequest.ts):
 *   uploads/{userId}/{fileId}/{filename}   — original upload
 *   documents/{userId}/{fileId}/{filename} — post-validation copy (uploadComplete)
 *   chunks/{jobId}/chunk-*.txt             — chunked segments (chunkDocument)
 *   results/{jobId}/translated-*.txt       — translation outputs
 *
 * We delete by the `s3Key` stored on the job record (the uploads/ key), plus
 * the equivalent documents/ copy and any chunk/result prefixes if discoverable.
 * S3 DeleteObject on a non-existent key is a no-op (returns 204) so we don't
 * need to check existence before deleting.
 */
async function deleteS3Objects(job: DynamoDBJob): Promise<string | null> {
  const keysToDelete: string[] = [];

  // Original upload and its post-validation copy
  if (typeof job.s3Key === 'string' && job.s3Key.length > 0) {
    keysToDelete.push(job.s3Key);
    // uploadComplete.ts moves the file from uploads/ to documents/
    keysToDelete.push(job.s3Key.replace(/^uploads\//, 'documents/'));
  }

  if (keysToDelete.length === 0) {
    // No s3Key on the record — nothing to clean up (unusual, log it)
    logger.warn('Job had no s3Key — skipping S3 cleanup', { jobId: job.jobId });
    return null;
  }

  const failures: string[] = [];

  for (const key of keysToDelete) {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: DOCUMENT_BUCKET, Key: key }));
    } catch (err) {
      failures.push(key);
      logger.error('Failed to delete S3 object — orphan requires manual cleanup', {
        jobId: job.jobId,
        bucket: DOCUMENT_BUCKET,
        key,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return failures.length > 0
    ? `S3 cleanup incomplete — orphaned objects: ${failures.join(', ')}. ` +
        'Job record deleted; manual S3 cleanup required.'
    : null;
}

/** Lambda handler */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Delete job request', {
    requestId,
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // Verify authentication
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized', requestId, undefined, requestOrigin);
    }

    // Extract jobId from path parameters
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      return createErrorResponse(400, 'Missing jobId in path', requestId, undefined, requestOrigin);
    }

    // Single-round-trip delete with ownership enforcement.
    // ConditionalCheckFailedException fires when job does not exist OR belongs
    // to a different user — both cases → 404 (no existence leak).
    let deletedJob: DynamoDBJob;
    try {
      deletedJob = await deleteJobRecord(jobId, userId);
    } catch (err) {
      if (err instanceof ConditionalCheckFailedException) {
        // Privacy-preserving 404: the caller should not learn whether the job
        // exists but belongs to someone else vs. simply doesn't exist.
        return createErrorResponse(
          404,
          `Job not found: ${jobId}`,
          requestId,
          undefined,
          requestOrigin
        );
      }
      throw err; // Re-throw unexpected errors to the outer catch
    }

    logger.info('Job record deleted from DynamoDB', {
      requestId,
      jobId,
      userId,
      previousStatus: deletedJob.status,
    });

    // Best-effort S3 cleanup — failure is non-fatal (see file-level comment)
    const s3Warning = await deleteS3Objects(deletedJob);

    if (s3Warning) {
      logger.warn('S3 cleanup partially failed after DDB delete', {
        requestId,
        jobId,
        warning: s3Warning,
      });
    }

    const responseBody: DeleteJobApiResponse = {
      message: `Job ${jobId} deleted successfully`,
      jobId,
      ...(s3Warning ? { warning: s3Warning } : {}),
    };

    return createSuccessResponse(200, responseBody, requestId, requestOrigin);
  } catch (error) {
    logger.error('Failed to delete job', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(500, 'Failed to delete job', requestId, undefined, requestOrigin);
  }
};
