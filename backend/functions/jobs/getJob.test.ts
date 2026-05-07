/**
 * Unit tests for Get Job endpoint
 * GET /jobs/{jobId}
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { handler } from './getJob';

const dynamoMock = mockClient(DynamoDBClient);

describe('getJob endpoint', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  /** Build a minimal API Gateway event for GET /jobs/{jobId} */
  const createEvent = (jobId: string, userId = 'user-123'): Partial<APIGatewayProxyEvent> => ({
    httpMethod: 'GET',
    path: `/jobs/${jobId}`,
    pathParameters: { jobId },
    headers: { Authorization: 'Bearer mock-token' },
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: { sub: userId, email: 'test@example.com' },
      },
    } as any,
  });

  // ---------------------------------------------------------------------------
  // Happy-path
  // ---------------------------------------------------------------------------

  it('should return job data for an owned job', async () => {
    const createdAt = '2026-01-01T00:00:00.000Z';

    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        jobId: { S: 'job-abc' },
        userId: { S: 'user-123' },
        status: { S: 'PENDING_UPLOAD' },
        filename: { S: 'document.txt' },
        fileSize: { N: '1024' },
        createdAt: { S: createdAt },
        updatedAt: { S: createdAt },
      },
    } as any);

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.jobId).toBe('job-abc');
    expect(body.userId).toBe('user-123');
    expect(body.status).toBe('PENDING_UPLOAD');
    expect(body.filename).toBe('document.txt');
    expect(body.fileSize).toBe(1024);
    expect(body.createdAt).toBe(createdAt);
    // requestId is threaded through to the response body
    expect(body.requestId).toBe('test-request-id');
  });

  it('should include translationStatus when present', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        jobId: { S: 'job-abc' },
        userId: { S: 'user-123' },
        status: { S: 'IN_PROGRESS' },
        translationStatus: { S: 'IN_PROGRESS' },
        targetLanguage: { S: 'spanish' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
      },
    } as any);

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.translationStatus).toBe('IN_PROGRESS');
    expect(body.targetLanguage).toBe('spanish');
  });

  // ---------------------------------------------------------------------------
  // BOLA (Broken Object Level Authorization) — OWASP API1:2023
  // ---------------------------------------------------------------------------

  it('returns 404 when job exists but is owned by a different user', async () => {
    // The DynamoDB composite key lookup uses the requester's userId as the RANGE
    // key. If the job belongs to a different user, DynamoDB returns no Item —
    // the same response as a completely missing record. The handler must return
    // 404 (NOT 403) to avoid leaking resource existence to the attacker.
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    // Requester 'attacker-999' asks for a job owned by 'user-123'
    const result = await handler(createEvent('job-abc', 'attacker-999') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
  });

  it('does not return job data in 404 response body (BOLA privacy)', async () => {
    // Even on the error path, the response body must not contain any job fields
    // (jobId, userId, status, filename, etc.) that could confirm the resource exists.
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const result = await handler(createEvent('job-abc', 'attacker-999') as APIGatewayProxyEvent);

    const body = JSON.parse(result.body);
    // Error body should have only `message` (and optionally requestId, errors)
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('filename');
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('createdAt');
  });

  // ---------------------------------------------------------------------------
  // Not found (non-existent job)
  // ---------------------------------------------------------------------------

  it('should return 404 when job does not exist', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const result = await handler(createEvent('missing-job') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('missing-job');
  });

  // ---------------------------------------------------------------------------
  // Auth failures
  // ---------------------------------------------------------------------------

  it('should return 401 when Authorization header is absent', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'GET',
      path: '/jobs/job-abc',
      pathParameters: { jobId: 'job-abc' },
      headers: {},
      requestContext: {
        requestId: 'test-request-id',
        // No authorizer → claims.sub is undefined
      } as any,
    };

    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // Bad request
  // ---------------------------------------------------------------------------

  it('should return 400 when jobId path parameter is missing', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'GET',
      path: '/jobs/',
      pathParameters: null,
      headers: {},
      requestContext: {
        requestId: 'test-request-id',
        authorizer: { claims: { sub: 'user-123' } },
      } as any,
    };

    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // DynamoDB error
  // ---------------------------------------------------------------------------

  it('should return 500 on an unexpected DynamoDB error', async () => {
    dynamoMock.on(GetItemCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Failed to get job');
  });
});
