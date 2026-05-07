/**
 * Get Job Lambda Function
 * GET /jobs/{jobId}
 *
 * Returns the current state of a job record owned by the authenticated user.
 * The response shape is a flat object (not wrapped in a `data` envelope) so
 * that the smoke-test polling assertion `response.data.jobId` resolves directly.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBJob } from '@lfmt/shared-types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';

const logger = new Logger('lfmt-get-job');
const dynamoClient = new DynamoDBClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

/**
 * Public shape returned by this endpoint.
 * Kept minimal — callers that need translation detail should use
 * GET /jobs/{jobId}/translation-status instead.
 *
 * The index signature `[key: string]: unknown` is required so that this type
 * satisfies the `ApiSuccessResponse` constraint used by `createSuccessResponse`.
 */
interface GetJobResponse {
  jobId: string;
  userId: string;
  status: string;
  filename?: string;
  fileSize?: number;
  createdAt: string;
  updatedAt?: string;
  translationStatus?: string;
  targetLanguage?: string;
  [key: string]: unknown;
}

/**
 * Load a job record from DynamoDB, enforcing user ownership.
 * The table uses a composite primary key (jobId HASH, userId RANGE).
 */
async function loadJob(jobId: string, userId: string): Promise<DynamoDBJob | null> {
  const command = new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    ConsistentRead: true,
  });

  const result: GetItemCommandOutput = await dynamoClient.send(command);

  if (!result.Item) {
    return null;
  }

  return unmarshall(result.Item) as DynamoDBJob;
}

/** Lambda handler */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Get job request', {
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // Verify authentication
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized', undefined, undefined, requestOrigin);
    }

    // Extract jobId from path parameters
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      return createErrorResponse(400, 'Missing jobId in path', undefined, undefined, requestOrigin);
    }

    // Load job from DynamoDB — the composite key enforces ownership automatically
    const job = await loadJob(jobId, userId);

    if (!job) {
      return createErrorResponse(404, `Job not found: ${jobId}`, undefined, undefined, requestOrigin);
    }

    const responseBody: GetJobResponse = {
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

    logger.info('Job retrieved', { jobId, status: job.status });

    // Return the response as a flat object (no `data` wrapper) so that the
    // smoke-test assertion `response.data.jobId` resolves without an extra
    // level of nesting.
    return createSuccessResponse(200, responseBody, undefined, requestOrigin);
  } catch (error) {
    logger.error('Failed to get job', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(500, 'Failed to get job', undefined, undefined, requestOrigin);
  }
};
