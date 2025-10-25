/**
 * Comprehensive Unit Tests for Upload Request Lambda Function
 * Coverage Target: 100% for all paths
 *
 * Test Philosophy:
 * - Test happy paths and all error conditions
 * - Verify logging at all decision points
 * - Validate security constraints
 * - Test edge cases and boundary conditions
 * - Ensure proper error handling for external service failures
 */

import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, PutItemCommand, ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { handler } from './uploadRequest';

// Mock AWS SDK clients
const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBClient);

// Mock getSignedUrl
const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: any[]) => mockGetSignedUrl(...args),
}));

// Mock Logger to verify logging calls
const mockLoggerInfo = jest.fn();
const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();

jest.mock('../shared/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }));
});

// Mock environment variables
process.env.DOCUMENT_BUCKET = 'test-document-bucket';
process.env.JOBS_TABLE = 'test-jobs-table';

describe('uploadRequest Lambda Function - Comprehensive Coverage', () => {
  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    mockGetSignedUrl.mockResolvedValue('https://mocked-presigned-url.s3.amazonaws.com');
    jest.clearAllMocks();
  });

  const createMockEvent = (body: any, userId = 'test-user-123'): APIGatewayProxyEvent => ({
    body: JSON.stringify(body),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/v1/jobs/upload',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: userId ? {
        claims: {
          sub: userId,
          email: 'test@example.com',
        },
      } : undefined,
      protocol: 'HTTP/1.1',
      httpMethod: 'POST',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'jest-test',
        userArn: null,
      },
      path: '/v1/jobs/upload',
      stage: 'test',
      requestId: 'test-request-123',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/v1/jobs/upload',
    },
    resource: '/v1/jobs/upload',
  });

  describe('Happy Path - Successful Upload Request', () => {
    it('should generate presigned URL and create job record for valid file', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'test-document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('Upload URL generated successfully');
      expect(body.data.uploadUrl).toBe('https://mocked-presigned-url.s3.amazonaws.com');
      expect(body.data.fileId).toBeDefined();
      expect(body.data.expiresIn).toBe(900);
      expect(body.data.requiredHeaders).toEqual({
        'Content-Type': 'text/plain',
        'Content-Length': '50000',
      });

      // Verify DynamoDB put was called
      expect(dynamoMock.calls()).toHaveLength(1);
      expect(dynamoMock.call(0).args[0].input.TableName).toBe('test-jobs-table');

      // Verify logging
      expect(mockLoggerInfo).toHaveBeenCalledWith('Processing upload request', { requestId: 'test-request-123' });
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Generating presigned URL',
        expect.objectContaining({
          requestId: 'test-request-123',
          userId: 'test-user-123',
          filename: 'test-document.txt',
          fileSize: 50000,
        })
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Job record created successfully',
        expect.objectContaining({
          requestId: 'test-request-123',
          userId: 'test-user-123',
        })
      );
    });

    it('should create job record with correct structure and all required fields', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 75000,
        contentType: 'text/plain',
      });

      await handler(event);

      const putCall = dynamoMock.call(0).args[0];
      const item = putCall.input.Item;

      // Verify all required fields in job record
      expect(item.jobId).toBeDefined();
      expect(item.userId).toBeDefined();
      expect(item.documentId).toBeDefined();
      expect(item.filename.S).toBe('document.txt');
      expect(item.status.S).toBe('PENDING_UPLOAD');
      expect(item.fileSize.N).toBe('75000');
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
      expect(item.expiresAt).toBeDefined();
      expect(item.s3Key).toBeDefined();
      expect(item.metadata).toBeDefined();
      expect(item.metadata.M.originalFilename.S).toBe('document.txt');
      expect(item.metadata.M.uploadRequestId.S).toBe('test-request-123');
    });

    it('should generate correct S3 key with user ID and file ID', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const userId = 'user-abc-123';
      const event = createMockEvent({
        fileName: 'my-document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      }, userId);

      await handler(event);

      const putCall = dynamoMock.call(0).args[0];
      const s3Key = putCall.input.Item.s3Key.S;

      expect(s3Key).toMatch(new RegExp(`^uploads/${userId}/[a-f0-9-]+/my-document\\.txt$`));
    });

    it('should set correct expiration timestamp (15 minutes from now)', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const beforeRequest = Date.now();

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      await handler(event);

      const afterRequest = Date.now();
      const putCall = dynamoMock.call(0).args[0];
      const expiresAt = new Date(putCall.input.Item.expiresAt.S).getTime();

      // Expiration should be 15 minutes (900 seconds) from now
      const expectedMin = beforeRequest + 900 * 1000;
      const expectedMax = afterRequest + 900 * 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
      expect(expiresAt).toBeLessThanOrEqual(expectedMax);
    });

    it('should pass correct parameters to getSignedUrl', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'test.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      await handler(event);

      expect(mockGetSignedUrl).toHaveBeenCalledWith(
        expect.any(S3Client),
        expect.any(PutObjectCommand),
        { expiresIn: 900 }
      );

      // Verify PutObjectCommand parameters
      const putCommand = mockGetSignedUrl.mock.calls[0][1];
      expect(putCommand.input.Bucket).toBe('test-document-bucket');
      expect(putCommand.input.ContentType).toBe('text/plain');
      expect(putCommand.input.ContentLength).toBe(50000);
      expect(putCommand.input.Metadata.userId).toBe('test-user-123');
      expect(putCommand.input.Metadata.jobId).toBeDefined(); // jobId is a UUID
      expect(putCommand.input.Metadata.originalFilename).toBe('test.txt');
      expect(putCommand.input.Metadata.uploadRequestId).toBe('test-request-123');
    });
  });

  describe('File Validation - Size Constraints', () => {
    it('should reject files exceeding maximum size (>100MB)', async () => {
      const event = createMockEvent({
        fileName: 'large-file.txt',
        fileSize: 101 * 1024 * 1024, // 101MB
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('exceeds maximum allowed size of 100MB');

      // Verify no DynamoDB calls were made
      expect(dynamoMock.calls()).toHaveLength(0);
    });

    it('should reject files below minimum size (<1KB)', async () => {
      const event = createMockEvent({
        fileName: 'tiny-file.txt',
        fileSize: 999, // Less than 1000 bytes
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('below minimum required size of 1000 bytes');

      // Verify no DynamoDB calls were made
      expect(dynamoMock.calls()).toHaveLength(0);
    });

    it('should accept file at exactly maximum size (100MB)', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'max-size.txt',
        fileSize: 100 * 1024 * 1024, // Exactly 100MB
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });

    it('should accept file at exactly minimum size (1KB)', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'min-size.txt',
        fileSize: 1000, // Exactly 1KB
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('File Validation - Content Type and Extension', () => {
    it('should reject invalid content type (PDF)', async () => {
      const event = createMockEvent({
        fileName: 'document.pdf',
        fileSize: 50000,
        contentType: 'application/pdf',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Invalid content type. Only text/plain is allowed');

      // Verify warning was logged
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'File validation failed',
        expect.objectContaining({ requestId: 'test-request-123' })
      );
    });

    it('should reject invalid file extension (.pdf)', async () => {
      const event = createMockEvent({
        fileName: 'document.pdf',
        fileSize: 50000,
        contentType: 'text/plain', // Correct content type but wrong extension
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Invalid file extension. Only .txt files are allowed');
    });

    it('should reject file without extension', async () => {
      const event = createMockEvent({
        fileName: 'document',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });

    it('should reject file with double extension (.txt.exe)', async () => {
      const event = createMockEvent({
        fileName: 'malicious.txt.exe',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Invalid file extension');
    });
  });

  describe('File Validation - Filename Security', () => {
    it('should reject filename with path traversal attempt (../)', async () => {
      const event = createMockEvent({
        fileName: '../../../etc/passwd.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('File validation failed');
    });

    it('should reject filename with special characters (spaces)', async () => {
      const event = createMockEvent({
        fileName: 'my document.txt', // Space is not allowed
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('File validation failed');
    });

    it('should accept valid filename with allowed characters (letters, numbers, dash, underscore, dot)', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'My_Document-v2.1.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(200);
    });

    it('should reject empty filename', async () => {
      const event = createMockEvent({
        fileName: '',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });

    it('should reject filename with null bytes', async () => {
      const event = createMockEvent({
        fileName: 'document\0.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });
  });

  describe('Authorization', () => {
    it('should reject request without authorizer context', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      // Remove authorizer context entirely
      delete event.requestContext.authorizer;

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Unauthorized - user ID not found');

      // Verify warning was logged
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Missing user ID from authorizer',
        { requestId: 'test-request-123' }
      );
    });

    it('should reject request with empty authorizer context', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      // Set empty authorizer
      event.requestContext.authorizer = {};

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });

    it('should reject request with authorizer but no claims', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      // Set authorizer without claims
      event.requestContext.authorizer = { claims: {} };

      const result = await handler(event);

      expect(result.statusCode).toBe(401);
    });
  });

  describe('Request Validation', () => {
    it('should handle malformed JSON gracefully', async () => {
      const event = createMockEvent({}, 'test-user');
      event.body = 'invalid json {';

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Failed to generate upload URL');

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected error during upload request processing',
        expect.objectContaining({
          requestId: 'test-request-123',
          error: expect.any(String),
        })
      );
    });

    it('should handle null body', async () => {
      const event = createMockEvent({}, 'test-user');
      event.body = null as any;

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('File validation failed');
    });

    it('should handle empty body string', async () => {
      const event = createMockEvent({}, 'test-user');
      event.body = '';

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });

    it('should reject request with missing fileName field', async () => {
      const event = createMockEvent({
        // fileName missing
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toBe('File validation failed');
      expect(body.errors).toBeDefined();
      expect(body.errors.filename).toBeDefined();
    });

    it('should reject request with missing fileSize field', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        // fileSize missing
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.errors.fileSize).toBeDefined();
    });

    it('should reject request with missing contentType field', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        // contentType missing
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.errors.contentType).toBeDefined();
    });

    it('should reject request with invalid fileSize type (string instead of number)', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: '50000', // String instead of number
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(400);
    });
  });

  describe('DynamoDB Integration', () => {
    it('should handle DynamoDB network errors gracefully', async () => {
      dynamoMock.on(PutItemCommand).rejects(new Error('Network error'));

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Failed to generate upload URL');

      // Verify error logging
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected error during upload request processing',
        expect.objectContaining({
          error: 'Network error',
        })
      );
    });

    it('should handle DynamoDB ConditionalCheckFailedException (duplicate jobId)', async () => {
      const conditionalError = new ConditionalCheckFailedException({
        message: 'The conditional request failed',
        $metadata: {},
      });

      dynamoMock.on(PutItemCommand).rejects(conditionalError);

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(500);

      // Should log the error
      expect(mockLoggerError).toHaveBeenCalled();
    });

    it('should include conditional expression to prevent duplicate jobId', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      await handler(event);

      const putCall = dynamoMock.call(0).args[0];
      expect(putCall.input.ConditionExpression).toBe('attribute_not_exists(jobId)');
    });

    it('should use marshall with removeUndefinedValues option', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      await handler(event);

      // Item should not contain any undefined values
      const putCall = dynamoMock.call(0).args[0];
      const itemString = JSON.stringify(putCall.input.Item);
      expect(itemString).not.toContain('undefined');
    });
  });

  describe('S3 Integration', () => {
    it('should handle S3 getSignedUrl failures', async () => {
      mockGetSignedUrl.mockRejectedValueOnce(new Error('S3 error'));

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(500);

      // DynamoDB should not be called if S3 fails
      expect(dynamoMock.calls()).toHaveLength(0);

      // Error should be logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected error during upload request processing',
        expect.objectContaining({
          error: 'S3 error',
        })
      );
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in successful response', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Access-Control-Allow-Credentials');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('should include CORS headers in error response (401)', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      delete event.requestContext.authorizer;

      const result = await handler(event);

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(result.headers).toHaveProperty('Content-Type', 'application/json');
    });

    it('should include CORS headers in validation error response (400)', async () => {
      const event = createMockEvent({
        fileName: 'invalid.pdf',
        fileSize: 50000,
        contentType: 'application/pdf',
      });

      const result = await handler(event);

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
    });

    it('should include CORS headers in server error response (500)', async () => {
      dynamoMock.on(PutItemCommand).rejects(new Error('Internal error'));

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.headers).toHaveProperty('Access-Control-Allow-Origin');
    });
  });

  describe('Response Data Completeness', () => {
    it('should return all required fields in success response', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'test.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('requestId');
      expect(body.data).toHaveProperty('uploadUrl');
      expect(body.data).toHaveProperty('fileId');
      expect(body.data).toHaveProperty('expiresIn');
      expect(body.data).toHaveProperty('requiredHeaders');
      expect(body.data.requiredHeaders).toHaveProperty('Content-Type');
      expect(body.data.requiredHeaders).toHaveProperty('Content-Length');
    });

    it('should include requestId in error responses', async () => {
      const event = createMockEvent({
        fileName: 'toolarge.txt',
        fileSize: 101 * 1024 * 1024,
        contentType: 'text/plain',
      });

      const result = await handler(event);
      const body = JSON.parse(result.body);

      expect(body.requestId).toBe('test-request-123');
    });
  });

  describe('Edge Cases and Concurrent Requests', () => {
    it('should generate unique fileIds for concurrent requests', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const events = [
        createMockEvent({ fileName: 'doc1.txt', fileSize: 50000, contentType: 'text/plain' }),
        createMockEvent({ fileName: 'doc2.txt', fileSize: 50000, contentType: 'text/plain' }),
        createMockEvent({ fileName: 'doc3.txt', fileSize: 50000, contentType: 'text/plain' }),
      ];

      const results = await Promise.all(events.map(handler));

      const fileIds = results.map(r => JSON.parse(r.body).data.fileId);
      const uniqueFileIds = new Set(fileIds);

      expect(uniqueFileIds.size).toBe(3); // All fileIds should be unique
    });

    it('should generate unique jobIds for concurrent requests', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const events = [
        createMockEvent({ fileName: 'doc1.txt', fileSize: 50000, contentType: 'text/plain' }),
        createMockEvent({ fileName: 'doc2.txt', fileSize: 50000, contentType: 'text/plain' }),
      ];

      await Promise.all(events.map(handler));

      const jobId1 = dynamoMock.call(0).args[0].input.Item.jobId.S;
      const jobId2 = dynamoMock.call(1).args[0].input.Item.jobId.S;

      expect(jobId1).not.toBe(jobId2);
    });

    it('should handle very long filenames (within limits)', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const longFilename = 'a'.repeat(200) + '.txt'; // 204 characters
      const event = createMockEvent({
        fileName: longFilename,
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      // Should be accepted (no hard limit on filename length in current implementation)
      expect(result.statusCode).toBe(200);
    });

    it('should handle different user IDs correctly', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const userId1 = 'user-1';
      const userId2 = 'user-2';

      const event1 = createMockEvent({ fileName: 'doc1.txt', fileSize: 50000, contentType: 'text/plain' }, userId1);
      const event2 = createMockEvent({ fileName: 'doc2.txt', fileSize: 50000, contentType: 'text/plain' }, userId2);

      await handler(event1);
      await handler(event2);

      const s3Key1 = dynamoMock.call(0).args[0].input.Item.s3Key.S;
      const s3Key2 = dynamoMock.call(1).args[0].input.Item.s3Key.S;

      expect(s3Key1).toContain(userId1);
      expect(s3Key2).toContain(userId2);
      expect(s3Key1).not.toContain(userId2);
      expect(s3Key2).not.toContain(userId1);
    });
  });

  describe('Error Handling - Non-Error Exceptions', () => {
    it('should handle non-Error thrown exceptions', async () => {
      mockGetSignedUrl.mockRejectedValueOnce('String error');

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(500);

      // Should log 'Unknown error' when error is not an instance of Error
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected error during upload request processing',
        expect.objectContaining({
          error: 'Unknown error',
        })
      );
    });

    it('should handle error without stack trace', async () => {
      const errorWithoutStack = new Error('Error without stack');
      delete (errorWithoutStack as any).stack;

      mockGetSignedUrl.mockRejectedValueOnce(errorWithoutStack);

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      const result = await handler(event);

      expect(result.statusCode).toBe(500);

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected error during upload request processing',
        expect.objectContaining({
          error: 'Error without stack',
          stack: undefined,
        })
      );
    });
  });

  describe('Logging Coverage', () => {
    it('should log all steps in successful flow', async () => {
      dynamoMock.on(PutItemCommand).resolves({});

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      await handler(event);

      // Verify all info logs were called
      expect(mockLoggerInfo).toHaveBeenCalledTimes(3);
      expect(mockLoggerInfo).toHaveBeenNthCalledWith(1, 'Processing upload request', expect.any(Object));
      expect(mockLoggerInfo).toHaveBeenNthCalledWith(2, 'Generating presigned URL', expect.any(Object));
      expect(mockLoggerInfo).toHaveBeenNthCalledWith(3, 'Job record created successfully', expect.any(Object));
    });

    it('should log warnings for validation failures', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 'invalid', // Invalid type
        contentType: 'text/plain',
      });

      await handler(event);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'File validation failed',
        expect.objectContaining({ requestId: 'test-request-123' })
      );
    });

    it('should log warnings for authorization failures', async () => {
      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      delete event.requestContext.authorizer;

      await handler(event);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        'Missing user ID from authorizer',
        { requestId: 'test-request-123' }
      );
    });

    it('should log errors with stack traces for exceptions', async () => {
      const testError = new Error('Test error');
      mockGetSignedUrl.mockRejectedValueOnce(testError);

      const event = createMockEvent({
        fileName: 'document.txt',
        fileSize: 50000,
        contentType: 'text/plain',
      });

      await handler(event);

      expect(mockLoggerError).toHaveBeenCalledWith(
        'Unexpected error during upload request processing',
        expect.objectContaining({
          requestId: 'test-request-123',
          error: 'Test error',
          stack: expect.any(String),
        })
      );
    });
  });
});
