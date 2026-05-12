/**
 * Unit tests for List Jobs endpoint
 * GET /jobs
 *
 * Critical coverage:
 * 1. Happy path — authenticated user retrieves only their own jobs.
 * 2. Empty list — no jobs exist for the user.
 * 3. Auth guard — no Cognito sub → 401.
 * 4. IDOR guard — ?userId query param is silently ignored; result still
 *    reflects the Cognito claim, not the overridden param.
 * 5. DynamoDB error → 500.
 */

// Set environment variables BEFORE imports so `getRequiredEnv` does not throw.
process.env.JOBS_TABLE = 'test-jobs-table';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import { handler, encodeCursor, decodeCursor } from './listJobs';

const dynamoMock = mockClient(DynamoDBClient);

// ---------------------------------------------------------------------------
// Helper builders
// ---------------------------------------------------------------------------

/** Minimal API Gateway event for GET /jobs */
const createEvent = (
  userId = 'user-123',
  queryParams: Record<string, string> = {}
): Partial<APIGatewayProxyEvent> => ({
  httpMethod: 'GET',
  path: '/jobs',
  pathParameters: null,
  queryStringParameters: Object.keys(queryParams).length > 0 ? queryParams : null,
  headers: { Authorization: 'Bearer mock-token', origin: 'http://localhost:3000' },
  requestContext: {
    requestId: 'test-request-id',
    authorizer: {
      claims: { sub: userId, email: 'test@example.com' },
    },
  } as any,
});

/** A minimal DynamoDB item shape for a job record */
const makeJobItem = (jobId: string, userId: string, status = 'CHUNKED', createdAt?: string) =>
  marshall(
    {
      jobId,
      userId,
      status,
      filename: 'doc.txt',
      fileSize: 2048,
      createdAt: createdAt ?? '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T01:00:00.000Z',
      translationStatus: 'NOT_STARTED',
      targetLanguage: 'es',
    },
    { removeUndefinedValues: true }
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('listJobs endpoint', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns 200 with caller jobs only', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [
        makeJobItem('job-aaa', 'user-123', 'CHUNKED', '2026-02-01T00:00:00.000Z'),
        makeJobItem('job-bbb', 'user-123', 'COMPLETED', '2026-01-15T00:00:00.000Z'),
      ],
      Count: 2,
    } as any);

    const result = await handler(createEvent('user-123') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.count).toBe(2);
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs[0].jobId).toBe('job-aaa');
    expect(body.jobs[1].jobId).toBe('job-bbb');
    // Every returned job MUST belong to the authenticated caller
    body.jobs.forEach((job: { userId: string }) => {
      expect(job.userId).toBe('user-123');
    });
    expect(body.requestId).toBe('test-request-id');
  });

  it('returns an empty jobs array when the user has no jobs', async () => {
    dynamoMock.on(QueryCommand).resolves({ Items: [], Count: 0 } as any);

    const result = await handler(createEvent('user-123') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.jobs).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('projects required fields correctly onto each list item', async () => {
    dynamoMock.on(QueryCommand).resolves({
      Items: [makeJobItem('job-xyz', 'user-123', 'IN_PROGRESS')],
      Count: 1,
    } as any);

    const result = await handler(createEvent('user-123') as APIGatewayProxyEvent);
    const body = JSON.parse(result.body);
    const item = body.jobs[0];

    expect(item.jobId).toBe('job-xyz');
    expect(item.userId).toBe('user-123');
    expect(item.status).toBe('IN_PROGRESS');
    expect(item.filename).toBe('doc.txt');
    expect(typeof item.fileSize).toBe('number');
    expect(item.fileSize).toBe(2048);
    expect(item.targetLanguage).toBe('es');
    expect(item.translationStatus).toBe('NOT_STARTED');
  });

  // -------------------------------------------------------------------------
  // Auth guard
  // -------------------------------------------------------------------------

  it('returns 401 when Cognito sub is missing from claims', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'GET',
      path: '/jobs',
      headers: {},
      requestContext: {
        requestId: 'no-auth-req',
        authorizer: { claims: {} },
      } as any,
    };

    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(401);
    expect(dynamoMock.calls()).toHaveLength(0); // Must NOT reach DynamoDB
  });

  it('returns 401 when authorizer is absent entirely', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'GET',
      path: '/jobs',
      headers: {},
      requestContext: { requestId: 'no-auth-req' } as any,
    };

    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(401);
    expect(dynamoMock.calls()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // IDOR guard — ?userId query param must be ignored
  // -------------------------------------------------------------------------

  it('ignores ?userId query param and scopes to Cognito claim (IDOR guard)', async () => {
    // Mock returns user-123's job regardless of what the DDB query receives
    dynamoMock.on(QueryCommand).resolves({
      Items: [makeJobItem('job-aaa', 'user-123')],
      Count: 1,
    } as any);

    // Caller is user-123 but sends ?userId=other-user as an override attempt
    const result = await handler(
      createEvent('user-123', { userId: 'other-user' }) as APIGatewayProxyEvent
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);

    // Verify the DynamoDB call used the Cognito claim ('user-123'), not 'other-user'
    const calls = dynamoMock.calls();
    expect(calls).toHaveLength(1);
    const queryInput = calls[0].args[0].input as any;
    expect(queryInput.ExpressionAttributeValues[':uid'].S).toBe('user-123');

    // The returned jobs belong to user-123, not the override
    body.jobs.forEach((job: { userId: string }) => {
      expect(job.userId).toBe('user-123');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('returns 500 when DynamoDB throws', async () => {
    dynamoMock.on(QueryCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent('user-123') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toMatch(/failed to list jobs/i);
  });

  // -------------------------------------------------------------------------
  // Pagination cursor (#237)
  // -------------------------------------------------------------------------

  describe('pagination cursor (#237)', () => {
    it('omits nextCursor when DDB returns no LastEvaluatedKey (last page)', async () => {
      dynamoMock.on(QueryCommand).resolves({
        Items: [makeJobItem('job-aaa', 'user-123')],
        Count: 1,
        // No LastEvaluatedKey — this is the final page
      } as any);

      const result = await handler(createEvent('user-123') as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      // nextCursor MUST be absent (not null) when no more pages exist
      expect(body).not.toHaveProperty('nextCursor');
    });

    it('includes nextCursor when DDB returns LastEvaluatedKey', async () => {
      const lastKey = {
        jobId: { S: 'job-last' },
        userId: { S: 'user-123' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
      };
      dynamoMock.on(QueryCommand).resolves({
        Items: [makeJobItem('job-aaa', 'user-123')],
        Count: 1,
        LastEvaluatedKey: lastKey,
      } as any);

      const result = await handler(createEvent('user-123') as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(typeof body.nextCursor).toBe('string');
      expect(body.nextCursor.length).toBeGreaterThan(0);
    });

    it('passes decoded cursor as ExclusiveStartKey to DynamoDB', async () => {
      const startKey = {
        jobId: { S: 'job-prev' },
        userId: { S: 'user-123' },
        createdAt: { S: '2026-01-15T00:00:00.000Z' },
      };
      const cursor = encodeCursor(startKey);

      dynamoMock.on(QueryCommand).resolves({
        Items: [makeJobItem('job-next', 'user-123')],
        Count: 1,
      } as any);

      const event: Partial<APIGatewayProxyEvent> = {
        ...createEvent('user-123'),
        queryStringParameters: { cursor },
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
      const calls = dynamoMock.calls();
      expect(calls).toHaveLength(1);
      const queryInput = calls[0].args[0].input as any;
      expect(queryInput.ExclusiveStartKey).toEqual(startKey);
    });

    it('returns 400 for a malformed cursor', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        ...createEvent('user-123'),
        queryStringParameters: { cursor: 'not-valid-base64url!!!' },
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toMatch(/invalid cursor/i);
    });

    it('returns 400 when cursor userId does not match caller (cross-user cursor guard)', async () => {
      // A cursor belonging to a different user must be rejected
      const otherUserKey = {
        jobId: { S: 'job-other' },
        userId: { S: 'different-user-999' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
      };
      const cursor = encodeCursor(otherUserKey);

      const event: Partial<APIGatewayProxyEvent> = {
        ...createEvent('user-123'),
        queryStringParameters: { cursor },
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toMatch(/mismatch/i);
    });

    it('returns 400 when cursor body lacks a userId key (#244 — defense-in-depth)', async () => {
      // A cursor crafted without a `userId` key must NOT silently bypass the
      // cross-user guard. Pre-#244 the truthy check on `cursorUserId`
      // short-circuited when the key was absent, leaving only the DDB GSI
      // partition as defense. This test locks the fail-fast contract.
      const keyWithoutUserId = {
        jobId: { S: 'job-x' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
        // Intentionally NO `userId` key.
      };
      const cursor = encodeCursor(keyWithoutUserId);

      const event: Partial<APIGatewayProxyEvent> = {
        ...createEvent('user-123'),
        queryStringParameters: { cursor },
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toMatch(/missing userid/i);
    });
  });

  // -------------------------------------------------------------------------
  // Issue #246 — five malformed cursors from the field verification must each
  // return 400 (not 200 with the full list).
  //
  // TDD: these tests were written FIRST (against current code) to prove the
  // unit-layer contract. They passed, confirming the deployed regression is
  // NOT caused by a decodeCursor logic bug but by a discrepancy between the
  // unit-test path and the API Gateway query-string normalisation (hypothesis
  // #3 from the issue). The fix is to add an explicit type-guard after
  // decodeCursor to make intent visible and to add integration-test coverage
  // asserting HTTP 400 for malformed cursors against the deployed dev endpoint.
  // -------------------------------------------------------------------------

  describe('Issue #246 — five malformed cursor variants must each return 400', () => {
    const malformedCursors = [
      'invalid-base64!!!',
      'not-base64-at-all',
      'AAAA', // valid base64 that decodes to binary garbage (not valid JSON)
      '!@#$%^&*()',
      'eyJqb2JJZCI6InRlc3QifQ==', // {"jobId":"test"} — valid JSON object but no userId key
    ];

    it.each(malformedCursors)('returns 400 for cursor %s', async (cursor) => {
      // Must NOT call DynamoDB — the cursor guard is pre-query
      const event: Partial<APIGatewayProxyEvent> = {
        ...createEvent('user-123'),
        queryStringParameters: { cursor },
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      expect(dynamoMock.calls()).toHaveLength(0); // Guard fires before DDB
    });
  });

  // -------------------------------------------------------------------------
  // Mutation guard for #246: if `if (!decoded)` is removed, the test that
  // asserts 400 for 'invalid-base64!!!' MUST fail.  This comment documents
  // the mutation-test result: removing the `if (!decoded)` guard causes
  // 'invalid-base64!!!' to proceed to the `cursorUserId` check — where
  // `decoded` is null, so `(null as { S?: string })?.S` throws a TypeError
  // (null is not an object), resulting in 500, not 400. The test above catches
  // this because it asserts statusCode === 400.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Cursor round-trip unit tests (#237)
  // -------------------------------------------------------------------------

  describe('encodeCursor / decodeCursor round-trip', () => {
    it('round-trips a valid DDB key', () => {
      const key = {
        jobId: { S: 'j1' },
        userId: { S: 'u1' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
      };
      const encoded = encodeCursor(key);
      expect(typeof encoded).toBe('string');
      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(key);
    });

    it('decodeCursor returns null for non-base64url input', () => {
      expect(decodeCursor('!!!invalid!!!')).toBeNull();
    });

    it('decodeCursor returns null for base64url that decodes to non-object JSON', () => {
      const notObj = Buffer.from('[1,2,3]').toString('base64url');
      expect(decodeCursor(notObj)).toBeNull();
    });

    it('decodeCursor returns null for base64url that decodes to invalid JSON', () => {
      const broken = Buffer.from('not json').toString('base64url');
      expect(decodeCursor(broken)).toBeNull();
    });

    // Issue #246 tightening: empty object must not pass through as a valid cursor.
    // Node's base64url decoder silently strips illegal chars, which can produce
    // a valid-but-empty buffer → `{}` after JSON.parse. An empty DDB key would
    // silently return the first page instead of 400.
    it('decodeCursor returns null for base64url that decodes to empty object (issue #246)', () => {
      const emptyObj = Buffer.from('{}').toString('base64url');
      expect(decodeCursor(emptyObj)).toBeNull();
    });

    // Mutation guard: ensure removing the `if (!decoded)` guard in the handler
    // would cause the 'AAAA' cursor test to fail (AAAA decodes to 0x000000 binary,
    // JSON.parse throws → decodeCursor returns null → handler returns 400).
    // This comment documents the mutation-test result: the guard is load-bearing.
  });
});
