/**
 * Get Job Lambda Function
 * GET /jobs/{jobId}
 *
 * Returns the current state of a job record owned by the authenticated user.
 * The response shape is flat (no `data` wrapper) so that callers access
 * `response.data.jobId` directly without an extra nesting level.
 *
 * Ownership enforcement:
 * The DynamoDB table uses a composite primary key (jobId HASH + userId RANGE).
 * GetItem with both keys naturally enforces ownership — a request for a job
 * owned by a different user returns null (Item not found), which maps to 404.
 * This avoids leaking resource existence to cross-ownership probes (OWASP
 * API1:2023 — Broken Object Level Authorization).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetJobApiResponse } from '@lfmt/shared-types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import { loadJobForUser } from '../shared/jobRepository';

const logger = new Logger('lfmt-get-job');
const dynamoClient = new DynamoDBClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

/** Lambda handler */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Get job request', {
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

    // Load job from DynamoDB — composite key enforces ownership automatically.
    // Returns null if the job does not exist OR belongs to a different user;
    // both cases map to 404 (privacy-preserving: don't leak existence).
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

    const responseBody: GetJobApiResponse = {
      jobId: job.jobId,
      userId: job.userId,
      status: job.status,
      filename: job.filename,
      fileSize: typeof job.fileSize === 'number' ? job.fileSize : undefined,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      translationStatus: job.translationStatus,
      targetLanguage: job.targetLanguage,
    };

    logger.info('Job retrieved', { requestId, jobId, status: job.status });

    return createSuccessResponse(200, responseBody, requestId, requestOrigin);
  } catch (error) {
    logger.error('Failed to get job', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(500, 'Failed to get job', requestId, undefined, requestOrigin);
  }
};
