/**
 * Unit tests for Delete Job endpoint
 * DELETE /jobs/{jobId}
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.DOCUMENT_BUCKET = 'test-document-bucket';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  DeleteItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { handler } from './deleteJob';

const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);

describe('deleteJob endpoint', () => {
  beforeEach(() => {
    dynamoMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  /** Build a minimal API Gateway event for DELETE /jobs/{jobId} */
  const createEvent = (jobId: string, userId = 'user-123'): Partial<APIGatewayProxyEvent> => ({
    httpMethod: 'DELETE',
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

  /** DynamoDB Attributes map for a deleted job (returned via ReturnValues: ALL_OLD) */
  const deletedJobAttributes = {
    jobId: { S: 'job-abc' },
    userId: { S: 'user-123' },
    status: { S: 'PENDING_UPLOAD' },
    s3Key: { S: 'uploads/user-123/file-001/document.txt' },
    createdAt: { S: '2026-01-01T00:00:00.000Z' },
  };

  // ---------------------------------------------------------------------------
  // Happy-path
  // ---------------------------------------------------------------------------

  it('should delete an existing owned job and return 200', async () => {
    dynamoMock.on(DeleteItemCommand).resolves({ Attributes: deletedJobAttributes } as any);
    s3Mock.on(DeleteObjectCommand).resolves({});

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.jobId).toBe('job-abc');
    expect(body.message).toContain('job-abc');
    expect(body.requestId).toBe('test-request-id');
    // No warning when S3 cleanup succeeds
    expect(body.warning).toBeUndefined();
  });

  it('should issue two S3 DeleteObject calls (uploads/ + documents/ copy)', async () => {
    dynamoMock.on(DeleteItemCommand).resolves({ Attributes: deletedJobAttributes } as any);
    s3Mock.on(DeleteObjectCommand).resolves({});

    await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    const s3Calls = s3Mock.commandCalls(DeleteObjectCommand);
    expect(s3Calls).toHaveLength(2);
    const keys = s3Calls.map((c) => c.args[0].input.Key as string);
    expect(keys).toContain('uploads/user-123/file-001/document.txt');
    expect(keys).toContain('documents/user-123/file-001/document.txt');
  });

  // ---------------------------------------------------------------------------
  // BOLA (Broken Object Level Authorization) — OWASP API1:2023
  // ---------------------------------------------------------------------------

  it('returns 404 when job exists but is owned by a different user', async () => {
    // The ConditionExpression (userId = :requesterUserId) fails when the stored
    // userId does not match — DynamoDB throws ConditionalCheckFailedException.
    // The handler must return 404 (NOT 403) to avoid leaking existence.
    dynamoMock
      .on(DeleteItemCommand)
      .rejects(
        new ConditionalCheckFailedException({ message: 'Condition check failed', $metadata: {} })
      );

    // 'attacker-999' tries to delete a job owned by 'user-123'
    const result = await handler(createEvent('job-abc', 'attacker-999') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
  });

  it('does not return job data in 404 response body (BOLA privacy)', async () => {
    // Even on the error path, the response body must not contain any job fields.
    dynamoMock
      .on(DeleteItemCommand)
      .rejects(
        new ConditionalCheckFailedException({ message: 'Condition check failed', $metadata: {} })
      );

    const result = await handler(createEvent('job-abc', 'attacker-999') as APIGatewayProxyEvent);

    const body = JSON.parse(result.body);
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('s3Key');
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('createdAt');
  });

  // ---------------------------------------------------------------------------
  // Not found: job does not exist (same ConditionalCheckFailedException path)
  // ---------------------------------------------------------------------------

  it('should return 404 when job does not exist', async () => {
    dynamoMock
      .on(DeleteItemCommand)
      .rejects(
        new ConditionalCheckFailedException({ message: 'Condition check failed', $metadata: {} })
      );

    const result = await handler(createEvent('missing-job') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('missing-job');
  });

  // ---------------------------------------------------------------------------
  // S3 cleanup failure (non-fatal — warning in response)
  // ---------------------------------------------------------------------------

  it('returns 200 with a warning when DDB delete succeeds but S3 cleanup fails', async () => {
    dynamoMock.on(DeleteItemCommand).resolves({ Attributes: deletedJobAttributes } as any);
    s3Mock.on(DeleteObjectCommand).rejects(new Error('S3 unavailable'));

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    // 200 — user's intent (delete the job) is honored at the DB level
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.jobId).toBe('job-abc');
    expect(typeof body.warning).toBe('string');
    expect(body.warning).toContain('S3 cleanup');
  });

  // ---------------------------------------------------------------------------
  // Auth failures
  // ---------------------------------------------------------------------------

  it('should return 401 when no authorizer claims are present', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'DELETE',
      path: '/jobs/job-abc',
      pathParameters: { jobId: 'job-abc' },
      headers: {},
      requestContext: {
        requestId: 'test-request-id',
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
      httpMethod: 'DELETE',
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
  // Unexpected DynamoDB error (not ConditionalCheckFailed)
  // ---------------------------------------------------------------------------

  it('should return 500 on an unexpected DynamoDB error', async () => {
    dynamoMock.on(DeleteItemCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Failed to delete job');
  });
});
