/**
 * List Jobs Lambda Function
 * GET /jobs
 *
 * Returns all translation jobs owned by the authenticated user.
 *
 * Security design (OWASP API1:2023 — Broken Object Level Authorization):
 * The userId is read EXCLUSIVELY from `event.requestContext.authorizer.claims.sub`
 * — the Cognito JWT claim injected by API Gateway after token validation.
 * Any `userId` query-string parameter or path component provided by the client
 * is SILENTLY IGNORED. The DynamoDB Query targets the `UserJobsIndex` GSI
 * (partition key: userId) so the result set is hard-bounded to the caller's
 * records at the database level; no post-filter is needed or trusted.
 *
 * IAM: the execution role grants `dynamodb:Query` scoped to the GSI ARN only
 * (not the full table ARN). This is enforced in the CDK stack as
 * `ListJobsLambdaRole` — do NOT switch this Lambda to `translationRole`,
 * which is a broader shared role.
 *
 * Response envelope: flat array (dominant convention). Frontend callers access
 * `response.data` directly — no `data` wrapper. Consistent with every other
 * LFMT job endpoint except `POST /jobs/upload`.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  QueryCommand,
  QueryCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { ListJobsApiResponse, ListJobsItem } from '@lfmt/shared-types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createFlatResponse, createErrorResponse } from '../shared/api-response';

const logger = new Logger('lfmt-list-jobs');
const dynamoClient = new DynamoDBClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const USER_JOBS_INDEX = 'UserJobsIndex';

/**
 * Maximum number of jobs returned per request.
 * Prevents runaway scans on accounts with many historical jobs.
 * A pagination token can be added in a follow-up if required.
 */
const MAX_ITEMS = 100;

/** Lambda handler */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('List jobs request', {
    requestId,
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // SECURITY: read userId from Cognito authorizer claim ONLY.
    // Never read from query string — doing so would allow IDOR (OWASP API1:2023).
    // Any client-supplied ?userId=... is intentionally not read here.
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized', requestId, undefined, requestOrigin);
    }

    // Query the UserJobsIndex GSI — partition key: userId, sort key: createdAt.
    // This is an eventually-consistent read (suitable for a list page; no
    // tight polling loop requires the stronger guarantee).
    const jobs = await queryUserJobs(userId);

    // Project each DDB item to the public wire shape (omit internal fields).
    const items: ListJobsApiResponse = jobs.map((job) => {
      const item: ListJobsItem = {
        jobId: job.jobId as string,
        userId: job.userId as string,
        status: job.status as string,
        filename: typeof job.filename === 'string' ? job.filename : undefined,
        fileSize: typeof job.fileSize === 'number' ? job.fileSize : undefined,
        createdAt: job.createdAt as string,
        updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : undefined,
        translationStatus:
          typeof job.translationStatus === 'string' ? job.translationStatus : undefined,
        targetLanguage: typeof job.targetLanguage === 'string' ? job.targetLanguage : undefined,
      };
      return item;
    });

    logger.info('Jobs listed', { requestId, userId, count: items.length });

    // Return the array directly as the flat response body.
    // `createFlatResponse` spreads the body object into the JSON payload; since
    // `ListJobsApiResponse` is an array (not an object) we wrap it in a carrier
    // object with a `jobs` key and also surface the count for convenience.
    return createFlatResponse(
      200,
      { jobs: items, count: items.length },
      requestId,
      requestOrigin
    );
  } catch (error) {
    logger.error('Failed to list jobs', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(500, 'Failed to list jobs', requestId, undefined, requestOrigin);
  }
};

/**
 * Query DynamoDB UserJobsIndex GSI for all jobs belonging to userId.
 *
 * Uses eventually-consistent reads (default for Query on a GSI) — sufficient
 * for the History page. Returns up to MAX_ITEMS results sorted by createdAt
 * descending (most recent first) via ScanIndexForward: false.
 *
 * @param userId - Cognito sub from the authorizer claim (never from client input)
 * @returns Array of unmarshalled DynamoDB item records
 */
async function queryUserJobs(userId: string): Promise<Record<string, unknown>[]> {
  const command = new QueryCommand({
    TableName: JOBS_TABLE,
    IndexName: USER_JOBS_INDEX,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: {
      ':uid': { S: userId },
    },
    ScanIndexForward: false, // Most recent jobs first (createdAt DESC on the GSI sort key)
    Limit: MAX_ITEMS,
  });

  const result: QueryCommandOutput = await dynamoClient.send(command);

  return (result.Items || []).map((item) => unmarshall(item) as Record<string, unknown>);
}
