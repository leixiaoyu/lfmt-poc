/**
 * Unit tests for Delete Job endpoint
 * DELETE /jobs/{jobId}
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb';
import { handler } from './deleteJob';

const dynamoMock = mockClient(DynamoDBClient);

describe('deleteJob endpoint', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  /** Build a minimal API Gateway event for DELETE /jobs/{jobId} */
  const createEvent = (jobId: string, userId = 'user-123'): Partial<APIGatewayProxyEvent> => ({
    httpMethod: 'DELETE',
    path: `/jobs/${jobId}`,
    pathParameters: { jobId },
    headers: { Authorization: 'Bearer mock-token' },
    requestContext: {
      authorizer: {
        claims: { sub: userId, email: 'test@example.com' },
      },
    } as any,
  });

  // ---------------------------------------------------------------------------
  // Happy-path
  // ---------------------------------------------------------------------------

  it('should delete an existing owned job and return 200', async () => {
    // First call: GetItem (existence check)
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        jobId: { S: 'job-abc' },
        userId: { S: 'user-123' },
        status: { S: 'PENDING_UPLOAD' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
      },
    } as any);

    // Second call: DeleteItem (the actual removal)
    dynamoMock.on(DeleteItemCommand).resolves({});

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.jobId).toBe('job-abc');
    expect(body.message).toContain('job-abc');
  });

  // ---------------------------------------------------------------------------
  // Not found
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

  it('should return 401 when no authorizer claims are present', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'DELETE',
      path: '/jobs/job-abc',
      pathParameters: { jobId: 'job-abc' },
      headers: {},
      requestContext: {} as any,
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
        authorizer: { claims: { sub: 'user-123' } },
      } as any,
    };

    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
  });

  // ---------------------------------------------------------------------------
  // DynamoDB error on GetItem
  // ---------------------------------------------------------------------------

  it('should return 500 when DynamoDB GetItem fails unexpectedly', async () => {
    dynamoMock.on(GetItemCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Failed to delete job');
  });

  // ---------------------------------------------------------------------------
  // DynamoDB error on DeleteItem
  // ---------------------------------------------------------------------------

  it('should return 500 when DynamoDB DeleteItem fails unexpectedly', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        jobId: { S: 'job-abc' },
        userId: { S: 'user-123' },
        status: { S: 'PENDING_UPLOAD' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
      },
    } as any);

    dynamoMock.on(DeleteItemCommand).rejects(new Error('DeleteItem failed'));

    const result = await handler(createEvent('job-abc') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toBe('Failed to delete job');
  });
});
