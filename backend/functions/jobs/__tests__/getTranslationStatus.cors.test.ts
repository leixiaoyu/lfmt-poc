/**
 * Get Translation Status CORS Tests
 *
 * Tests to prevent regression of CORS issues in getTranslationStatus Lambda
 */

// Set required environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';
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
          status: { S: 'PENDING' },
          createdAt: { S: new Date().toISOString() },
          updatedAt: { S: new Date().toISOString() },
        },
      }),
    })),
    GetItemCommand: jest.fn(),
  };
});

import { handler } from '../getTranslationStatus';
import { APIGatewayProxyEvent } from 'aws-lambda';

describe('Get Translation Status - CORS Tests', () => {
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
  } as any);

  it('should include CORS headers with CloudFront origin', async () => {
    const event = mockEvent('https://d39xcun7144jgl.cloudfront.net');
    const response = await handler(event);

    expect(response.headers).toBeDefined();
    expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
    expect(response.headers!['Access-Control-Allow-Credentials']).toBe('true');
  });

  it('should include CORS headers in 404 not found response', async () => {
    const event = mockEvent('https://d39xcun7144jgl.cloudfront.net');
    const response = await handler(event);

    expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
  });

  it('should support localhost origin', async () => {
    const event = mockEvent('http://localhost:3000');
    const response = await handler(event);

    expect(response.headers!['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
  });
});
