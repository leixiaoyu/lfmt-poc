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
import { handler } from './listJobs';

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
});
