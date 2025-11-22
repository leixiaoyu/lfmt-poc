/**
 * Start Translation CORS Tests
 *
 * Tests to prevent regression of CORS issues in startTranslation Lambda
 */

// Set required environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.STATE_MACHINE_NAME = 'test-state-machine';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://localhost:3000,https://d39xcun7144jgl.cloudfront.net,https://staging.lfmt.yourcompany.com';

// Mock AWS SDK clients BEFORE importing handler
jest.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({
        Item: {
          jobId: { S: 'test-job-id' },
          userId: { S: 'test-user-123' },
          fileName: { S: 'test.txt' },
          fileSize: { N: '1024' },
          contentType: { S: 'text/plain' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '5' },
          createdAt: { S: new Date().toISOString() },
          updatedAt: { S: new Date().toISOString() },
        },
      }),
    })),
    GetItemCommand: jest.fn(),
    UpdateItemCommand: jest.fn(),
  };
});

jest.mock('@aws-sdk/client-sfn', () => {
  return {
    SFNClient: jest.fn().mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({
        executionArn: 'arn:aws:states:us-east-1:123456789012:execution:test-state-machine:test-execution',
        startDate: new Date(),
      }),
    })),
    StartExecutionCommand: jest.fn(),
  };
});

import { handler } from '../startTranslation';
import { APIGatewayProxyEvent } from 'aws-lambda';

describe('Start Translation - CORS Tests', () => {
  const mockEvent = (origin: string): APIGatewayProxyEvent => ({
    headers: {
      origin,
      Authorization: 'Bearer mock-token',
    },
    pathParameters: {
      jobId: 'test-job-id',
    },
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: {
          sub: 'test-user-123',
        },
      },
    } as any,
    body: JSON.stringify({
      targetLanguage: 'es',
      tone: 'formal',
    }),
  } as any);

  it('should include CORS headers with CloudFront origin', async () => {
    const event = mockEvent('https://d39xcun7144jgl.cloudfront.net');
    const response = await handler(event);

    expect(response.headers).toBeDefined();
    expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
    expect(response.headers!['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('should include CORS headers in error responses', async () => {
    const event = mockEvent('https://d39xcun7144jgl.cloudfront.net');
    event.requestContext.authorizer = undefined as any; // Trigger 401

    const response = await handler(event);

    expect(response.statusCode).toBe(401);
    expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
  });

  it('should handle Origin with capital O', async () => {
    const event = mockEvent('https://d39xcun7144jgl.cloudfront.net');
    event.headers = {
      Origin: 'https://d39xcun7144jgl.cloudfront.net', // Capital O
      Authorization: 'Bearer mock-token',
    };

    const response = await handler(event);
    expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
  });
});
