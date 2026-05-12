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
 * Response envelope: `{ jobs: ListJobsItem[], count: number }`. Frontend
 * callers access `response.data.jobs` directly — no extra `data` wrapper.
 * The `count` field mirrors the array length for convenience. Consistent with
 * the flat-envelope convention (no `{message, data}` nesting) except
 * `POST /jobs/upload` which retains the wrapped shape for historical reasons.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, QueryCommand, QueryCommandOutput } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { AttributeValue } from '@aws-sdk/client-dynamodb';
import { ListJobsApiResponse, ListJobsItem, ListJobsEnvelope } from '@lfmt/shared-types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createFlatResponse, createErrorResponse } from '../shared/api-response';

const logger = new Logger('lfmt-list-jobs');
const dynamoClient = new DynamoDBClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const USER_JOBS_INDEX = 'UserJobsIndex';

/**
 * Maximum number of jobs returned per page.
 * Prevents runaway scans on accounts with many historical jobs.
 * Callers receive a `nextCursor` token when more pages exist.
 */
const MAX_ITEMS = 100;

// ---------------------------------------------------------------------------
// Cursor helpers — encode/decode DynamoDB LastEvaluatedKey as opaque base64.
//
// Security note: the cursor is opaque to the client, but a hostile caller
// can still forge arbitrary base64. DynamoDB tolerates a mismatched
// ExclusiveStartKey on a GSI-scoped Query by returning an empty result set
// (not an error), so a crafted cursor cannot bypass the userId GSI filter.
// Defense-in-depth: after decoding we validate the key contains the caller's
// userId — if it does not, we reject the cursor with 400 rather than silently
// proceeding with an empty page that could confuse the client.
// ---------------------------------------------------------------------------

/**
 * Encode a DynamoDB `LastEvaluatedKey` as an opaque base64 string suitable
 * for transmission on the wire as a URL query-parameter value.
 */
export function encodeCursor(key: Record<string, AttributeValue>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

/**
 * Decode a cursor string back to a DynamoDB `ExclusiveStartKey`.
 * Returns `null` when the cursor is malformed (not valid JSON after decode).
 *
 * Issue #246: tightened to reject any decoded value that is not a non-empty
 * plain object. Base64 decoding is inherently tolerant — Node's
 * `Buffer.from(s, 'base64url')` silently ignores unrecognised characters,
 * which can produce valid-but-empty buffers from garbage input. The
 * additional `Object.keys(parsed).length > 0` guard catches the empty-object
 * case that would otherwise pass through the truthy check in the handler and
 * silently produce an empty DDB page instead of a 400.
 */
export function decodeCursor(cursor: string): Record<string, AttributeValue> | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed as object).length === 0
    ) {
      return null;
    }
    return parsed as Record<string, AttributeValue>;
  } catch {
    return null;
  }
}

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

    // Optional pagination cursor from query string.
    // The cursor is an opaque base64-encoded DynamoDB LastEvaluatedKey.
    const rawCursor = event.queryStringParameters?.cursor;
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;
    if (rawCursor) {
      const decoded = decodeCursor(rawCursor);
      if (!decoded) {
        return createErrorResponse(400, 'Invalid cursor', requestId, undefined, requestOrigin);
      }
      // Defense-in-depth: the GSI query is already scoped by userId, so a
      // mismatched cursor would yield an empty result rather than leaking data.
      // We additionally validate the cursor carries the caller's own userId
      // (#244): if the key is missing OR mismatched, reject with 400. A
      // truthy-only check is insufficient — a crafted cursor without a
      // `userId` key would have skipped the guard entirely (`cursorUserId`
      // would be `undefined`, falsy), leaving defense-in-depth to the GSI
      // partition alone. By failing fast on a missing key, we keep the
      // guard's intent (fail-fast on malformed cursors) regardless of
      // future code paths that might break the GSI assumption.
      const cursorUserId = (decoded['userId'] as { S?: string })?.S;
      if (!cursorUserId) {
        return createErrorResponse(
          400,
          'Cursor missing userId',
          requestId,
          undefined,
          requestOrigin
        );
      }
      if (cursorUserId !== userId) {
        return createErrorResponse(
          400,
          'Cursor userId mismatch',
          requestId,
          undefined,
          requestOrigin
        );
      }
      exclusiveStartKey = decoded;
    }

    // Query the UserJobsIndex GSI — partition key: userId, sort key: createdAt.
    // This is an eventually-consistent read (suitable for a list page; no
    // tight polling loop requires the stronger guarantee).
    const { items: rawJobs, lastEvaluatedKey } = await queryUserJobs(userId, exclusiveStartKey);

    // Project each DDB item to the public wire shape (omit internal fields).
    const items: ListJobsApiResponse = rawJobs.map((job) => {
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

    logger.info('Jobs listed', {
      requestId,
      userId,
      count: items.length,
      hasMore: !!lastEvaluatedKey,
    });

    // Build the response envelope. `nextCursor` is omitted when this is the last page
    // (consistent with the `ListJobsEnvelope` type — absent, not null).
    const envelope: ListJobsEnvelope = {
      jobs: items,
      count: items.length,
      ...(lastEvaluatedKey ? { nextCursor: encodeCursor(lastEvaluatedKey) } : {}),
    };

    return createFlatResponse(200, envelope, requestId, requestOrigin);
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
 * Query DynamoDB UserJobsIndex GSI for jobs belonging to userId.
 *
 * Uses eventually-consistent reads (default for Query on a GSI) — sufficient
 * for the History page. Returns up to MAX_ITEMS results sorted by createdAt
 * descending (most recent first) via ScanIndexForward: false.
 *
 * @param userId - Cognito sub from the authorizer claim (never from client input)
 * @param exclusiveStartKey - Optional DDB continuation key for pagination
 * @returns Unmarshalled items and the raw LastEvaluatedKey if a next page exists
 */
async function queryUserJobs(
  userId: string,
  exclusiveStartKey?: Record<string, AttributeValue>
): Promise<{
  items: Record<string, unknown>[];
  lastEvaluatedKey: Record<string, AttributeValue> | undefined;
}> {
  const command = new QueryCommand({
    TableName: JOBS_TABLE,
    IndexName: USER_JOBS_INDEX,
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: {
      ':uid': { S: userId },
    },
    ScanIndexForward: false, // Most recent jobs first (createdAt DESC on the GSI sort key)
    Limit: MAX_ITEMS,
    ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
  });

  const result: QueryCommandOutput = await dynamoClient.send(command);

  return {
    items: (result.Items || []).map((item) => unmarshall(item) as Record<string, unknown>),
    lastEvaluatedKey: result.LastEvaluatedKey as Record<string, AttributeValue> | undefined, // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
  };
}
