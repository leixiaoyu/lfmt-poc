/**
 * Delete Job Lambda Function
 * DELETE /jobs/{jobId}
 *
 * Permanently removes a job record owned by the authenticated user from
 * DynamoDB.  Only the record owner can delete their own job (enforced by the
 * composite DynamoDB key: jobId HASH + userId RANGE).
 *
 * Note: This does NOT cancel a running Step Functions execution.  Deleting a
 * job that is still IN_PROGRESS will leave orphaned executions running until
 * they finish naturally.  That trade-off is acceptable for the current POC
 * scope — a future improvement can issue a StopExecution call here.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  DeleteItemCommand,
  GetItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBJob } from '@lfmt/shared-types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';

const logger = new Logger('lfmt-delete-job');
const dynamoClient = new DynamoDBClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

/**
 * Load a job record to verify it exists and belongs to the caller before
 * attempting deletion.
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

/**
 * Delete the job record from DynamoDB.
 * The ConditionExpression ensures the record still exists at delete time
 * (guards against a race between a concurrent delete and this request).
 */
async function deleteJob(jobId: string, userId: string): Promise<void> {
  const command = new DeleteItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    ConditionExpression: 'attribute_exists(jobId)',
  });

  await dynamoClient.send(command);
}

/** Lambda handler */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Delete job request', {
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

    // Confirm the job exists and belongs to this user before deleting
    const job = await loadJob(jobId, userId);
    if (!job) {
      return createErrorResponse(404, `Job not found: ${jobId}`, undefined, undefined, requestOrigin);
    }

    // Perform the deletion
    await deleteJob(jobId, userId);

    logger.info('Job deleted', { jobId, userId, previousStatus: job.status });

    return createSuccessResponse(
      200,
      { message: `Job ${jobId} deleted successfully`, jobId },
      undefined,
      requestOrigin
    );
  } catch (error) {
    logger.error('Failed to delete job', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(500, 'Failed to delete job', undefined, undefined, requestOrigin);
  }
};
