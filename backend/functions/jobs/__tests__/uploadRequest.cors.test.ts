/**
 * Upload Request CORS Tests
 *
 * Tests to prevent regression of CORS issues encountered during development:
 * - Issue #1: Lambda functions not extracting requestOrigin from headers
 * - Issue #2: CORS headers not included in error responses
 * - Issue #3: CloudFront URL not in allowed origins
 */

// Set required environment variables BEFORE imports
process.env.DOCUMENT_BUCKET = 'test-bucket';
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.ATTESTATIONS_TABLE = 'test-attestations-table';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://localhost:3000,https://d39xcun7144jgl.cloudfront.net,https://staging.lfmt.yourcompany.com';

// Mock AWS SDK clients BEFORE importing handler
const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: mockS3Send,
  })),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockDynamoSend,
  })),
  PutItemCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import { handler } from '../uploadRequest';
import { APIGatewayProxyEvent } from 'aws-lambda';

describe('Upload Request - CORS Tests', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Default successful mock responses
    mockGetSignedUrl.mockResolvedValue('https://test-bucket.s3.amazonaws.com/test-upload-url');
    mockDynamoSend.mockResolvedValue({});
  });

  const mockEvent = (origin: string, overrides = {}): APIGatewayProxyEvent => ({
    headers: {
      origin,
      Authorization: 'Bearer mock-token',
      'Content-Type': 'application/json',
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
      fileName: 'test.txt',
      fileSize: 1024,
      contentType: 'text/plain',
      legalAttestation: {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: new Date().toISOString(),
      },
    }),
    ...overrides,
  } as any);

  describe('CORS Headers in Success Responses', () => {
    it('should include CORS headers with CloudFront origin', async () => {
      const event = mockEvent('https://d39xcun7144jgl.cloudfront.net');
      const response = await handler(event);

      expect(response.headers).toBeDefined();
      expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
      expect(response.headers!['Access-Control-Allow-Credentials']).toBe('true');
      expect(response.headers!['Access-Control-Allow-Methods']).toBeDefined();
    });

    it('should include CORS headers with localhost origin', async () => {
      const event = mockEvent('http://localhost:3000');
      const response = await handler(event);

      expect(response.headers).toBeDefined();
      expect(response.headers!['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    });

    it('should handle Origin header with capital O', async () => {
      const event = mockEvent('https://d39xcun7144jgl.cloudfront.net', {
        headers: {
          Origin: 'https://d39xcun7144jgl.cloudfront.net', // Capital O
          Authorization: 'Bearer mock-token',
        },
      });
      const response = await handler(event);

      expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
    });
  });

  describe('CORS Headers in Error Responses', () => {
    it('should include CORS headers in 401 Unauthorized response', async () => {
      const event = mockEvent('https://d39xcun7144jgl.cloudfront.net', {
        requestContext: {
          requestId: 'test-request-id',
          authorizer: {
            claims: {}, // No sub - will trigger 401
          },
        },
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
    });

    it('should include CORS headers in 400 Bad Request response', async () => {
      const event = mockEvent('https://d39xcun7144jgl.cloudfront.net', {
        body: JSON.stringify({
          fileName: '', // Invalid - empty filename
          fileSize: 1024,
          contentType: 'text/plain',
        }),
      });
      const response = await handler(event);

      expect(response.statusCode).toBe(400);
      expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
    });

    it('should include CORS headers in 500 error responses', async () => {
      // Mock getSignedUrl to throw error
      mockGetSignedUrl.mockRejectedValueOnce(new Error('S3 Error'));

      const event = mockEvent('https://d39xcun7144jgl.cloudfront.net');
      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      expect(response.headers!['Access-Control-Allow-Origin']).toBe('https://d39xcun7144jgl.cloudfront.net');
    });
  });

  describe('Multiple Origin Support', () => {
    const origins = [
      'http://localhost:3000',
      'https://localhost:3000',
      'https://d39xcun7144jgl.cloudfront.net',
      'https://staging.lfmt.yourcompany.com',
    ];

    origins.forEach((origin) => {
      it(`should support origin: ${origin}`, async () => {
        const event = mockEvent(origin);
        const response = await handler(event);

        expect(response.headers!['Access-Control-Allow-Origin']).toBe(origin);
      });
    });
  });

  describe('Missing Origin Header', () => {
    it('should handle missing origin header gracefully', async () => {
      const event = mockEvent('', {
        headers: {
          Authorization: 'Bearer mock-token',
          'Content-Type': 'application/json',
          // No origin header
        },
      });
      const response = await handler(event);

      // Should still work, may use default origin or undefined
      expect(response).toBeDefined();
      expect(response.statusCode).toBeLessThan(500);
    });
  });
});
