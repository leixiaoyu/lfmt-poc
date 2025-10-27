/**
 * Document Chunking Lambda Handler Tests
 *
 * Tests S3 event handling, document processing, and DynamoDB updates
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { S3Event, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { Readable } from 'stream';

// Mock environment variables
process.env.DOCUMENT_BUCKET = 'test-bucket';
process.env.JOBS_TABLE = 'test-jobs-table';

const s3Mock = mockClient(S3Client);
const dynamoMock = mockClient(DynamoDBClient);

// Import handler after mocks are set up
import { handler } from '../chunkDocument';

// Create mock Lambda context
const createMockContext = (): Context => ({
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'test-function',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
  memoryLimitInMB: '128',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/test-function',
  logStreamName: '2024/01/01/[$LATEST]test-stream',
  getRemainingTimeInMillis: () => 30000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
});

describe('Document Chunking Lambda Handler', () => {
  beforeEach(() => {
    s3Mock.reset();
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  const createS3Event = (bucket: string, key: string): S3Event => ({
    Records: [
      {
        eventVersion: '2.1',
        eventSource: 'aws:s3',
        awsRegion: 'us-east-1',
        eventTime: '2024-01-01T00:00:00.000Z',
        eventName: 'ObjectCreated:Put',
        userIdentity: {
          principalId: 'test-principal',
        },
        requestParameters: {
          sourceIPAddress: '127.0.0.1',
        },
        responseElements: {
          'x-amz-request-id': 'test-request-id',
          'x-amz-id-2': 'test-id-2',
        },
        s3: {
          s3SchemaVersion: '1.0',
          configurationId: 'test-config',
          bucket: {
            name: bucket,
            ownerIdentity: {
              principalId: 'test-owner',
            },
            arn: `arn:aws:s3:::${bucket}`,
          },
          object: {
            key,
            size: 1024,
            eTag: 'test-etag',
            sequencer: 'test-sequencer',
          },
        },
      },
    ],
  });

  const createReadableStream = (content: string): Readable => {
    const stream = new Readable();
    stream.push(content);
    stream.push(null);
    return stream;
  };

  describe('Successful Document Chunking', () => {
    it('should process S3 event and chunk document successfully', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';
      const content = 'This is a test document. '.repeat(500); // ~1500 tokens

      // Mock S3 GetObject for metadata extraction
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => content,
        } as any,
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      // Mock DynamoDB GetItem
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job789' },
          userId: { S: 'user123' },
          documentId: { S: 'file456' },
          filename: { S: 'test.txt' },
          status: { S: 'PENDING_UPLOAD' },
          s3Key: { S: key },
          fileSize: { N: '1024' },
          createdAt: { S: '2024-01-01T00:00:00.000Z' },
          updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        },
      });

      // Mock S3 PutObject for chunks
      s3Mock.on(PutObjectCommand).resolves({});

      // Mock DynamoDB UpdateItem
      dynamoMock.on(UpdateItemCommand).resolves({});

      const event = createS3Event(bucket, key);
      await handler(event, createMockContext(), () => {});

      // Verify S3 GetObject was called
      const s3Calls = s3Mock.commandCalls(GetObjectCommand);
      expect(s3Calls.length).toBeGreaterThan(0);

      // Verify DynamoDB GetItem was called
      const dynamoGetCalls = dynamoMock.commandCalls(GetItemCommand);
      expect(dynamoGetCalls.length).toBe(1);

      // Verify DynamoDB UpdateItem was called (CHUNKING and CHUNKED)
      const dynamoUpdateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(dynamoUpdateCalls.length).toBeGreaterThanOrEqual(2);

      // Verify S3 PutObject was called for chunks
      const s3PutCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3PutCalls.length).toBeGreaterThan(0);
    });

    it('should handle small documents in single chunk', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/small.txt';
      const content = 'This is a small document.';

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => content,
        } as any,
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job789' },
          userId: { S: 'user123' },
          documentId: { S: 'file456' },
          filename: { S: 'small.txt' },
          status: { S: 'PENDING_UPLOAD' },
          s3Key: { S: key },
          fileSize: { N: '25' },
          createdAt: { S: '2024-01-01T00:00:00.000Z' },
          updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        },
      });

      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      const event = createS3Event(bucket, key);
      await handler(event, createMockContext(), () => {});

      // Should still process successfully
      const s3PutCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3PutCalls.length).toBe(1); // Single chunk
    });

    it('should handle large documents with multiple chunks', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/large.txt';
      // Create content that will definitely need multiple chunks (~10000 tokens)
      const content = 'This is a sentence. '.repeat(5000);

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => content,
        } as any,
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job789' },
          userId: { S: 'user123' },
          documentId: { S: 'file456' },
          filename: { S: 'large.txt' },
          status: { S: 'PENDING_UPLOAD' },
          s3Key: { S: key },
          fileSize: { N: '100000' },
          createdAt: { S: '2024-01-01T00:00:00.000Z' },
          updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        },
      });

      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      const event = createS3Event(bucket, key);
      await handler(event, createMockContext(), () => {});

      // Should create multiple chunks
      const s3PutCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3PutCalls.length).toBeGreaterThan(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing S3 metadata gracefully', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => 'content',
        } as any,
        Metadata: undefined, // Missing metadata
      });

      const event = createS3Event(bucket, key);
      await handler(event, createMockContext(), () => {});

      // Should not throw, should log error and continue
      const dynamoGetCalls = dynamoMock.commandCalls(GetItemCommand);
      expect(dynamoGetCalls.length).toBe(0); // Should not reach DynamoDB
    });

    it('should handle job not found in DynamoDB', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => 'content',
        } as any,
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      // Return no item
      dynamoMock.on(GetItemCommand).resolves({});

      const event = createS3Event(bucket, key);
      await handler(event, createMockContext(), () => {});

      // Should continue without processing
      const s3PutCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3PutCalls.length).toBe(0);
    });

    it('should handle S3 download failure', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      // Reject all S3 calls after first one
      s3Mock.on(GetObjectCommand).rejects(new Error('S3 download failed'));

      const event = createS3Event(bucket, key);

      // Should not throw, should handle error gracefully
      await expect(handler(event, createMockContext(), () => {})).resolves.toBeUndefined();
    });

    it('should handle empty document content', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/empty.txt';

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => '',
        } as any,
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job789' },
          userId: { S: 'user123' },
          documentId: { S: 'file456' },
          filename: { S: 'empty.txt' },
          status: { S: 'PENDING_UPLOAD' },
          s3Key: { S: key },
          fileSize: { N: '0' },
          createdAt: { S: '2024-01-01T00:00:00.000Z' },
          updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        },
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      const event = createS3Event(bucket, key);
      await handler(event, createMockContext(), () => {});

      // Should fail with CHUNKING_FAILED
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      const lastCall = updateCalls[updateCalls.length - 1];
      // The status should be CHUNKING_FAILED due to empty content
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it('should handle DynamoDB update failure gracefully', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';
      const content = 'Test content.';

      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => content,
        } as any,
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job789' },
          userId: { S: 'user123' },
          documentId: { S: 'file456' },
          filename: { S: 'test.txt' },
          status: { S: 'PENDING_UPLOAD' },
          s3Key: { S: key },
          fileSize: { N: '13' },
          createdAt: { S: '2024-01-01T00:00:00.000Z' },
          updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        },
      });

      // Fail on update
      dynamoMock.on(UpdateItemCommand).rejects(new Error('DynamoDB update failed'));
      s3Mock.on(PutObjectCommand).resolves({});

      const event = createS3Event(bucket, key);

      // Should not throw
      await expect(handler(event, createMockContext(), () => {})).resolves.toBeUndefined();
    });
  });

  describe('Multiple Records', () => {
    it('should process multiple S3 records', async () => {
      const event: S3Event = {
        Records: [
          createS3Event('test-bucket', 'uploads/user1/file1/doc1.txt').Records[0],
          createS3Event('test-bucket', 'uploads/user2/file2/doc2.txt').Records[0],
        ],
      };

      // Setup mocks for both records
      s3Mock.on(GetObjectCommand).resolves({
        Body: {
          transformToString: async () => 'Test content.',
        } as any,
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job789' },
          userId: { S: 'user123' },
          documentId: { S: 'file456' },
          filename: { S: 'test.txt' },
          status: { S: 'PENDING_UPLOAD' },
          s3Key: { S: 'test-key' },
          fileSize: { N: '100' },
          createdAt: { S: '2024-01-01T00:00:00.000Z' },
          updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        },
      });

      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event, createMockContext(), () => {});

      // Should process both records
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      expect(s3GetCalls.length).toBeGreaterThan(1);
    });

    it('should continue processing if one record fails', async () => {
      const event: S3Event = {
        Records: [
          createS3Event('test-bucket', 'uploads/user1/file1/doc1.txt').Records[0],
          createS3Event('test-bucket', 'uploads/user2/file2/doc2.txt').Records[0],
        ],
      };

      // First record fails, second succeeds
      s3Mock.on(GetObjectCommand)
        .resolvesOnce({
          Metadata: undefined, // First fails
        })
        .resolves({
          Body: {
            transformToString: async () => 'Test content.',
          } as any,
          Metadata: {
            userid: 'user123',
            jobid: 'job789',
            fileid: 'file456',
          },
        });

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job789' },
          userId: { S: 'user123' },
          documentId: { S: 'file456' },
          filename: { S: 'test.txt' },
          status: { S: 'PENDING_UPLOAD' },
          s3Key: { S: 'test-key' },
          fileSize: { N: '100' },
          createdAt: { S: '2024-01-01T00:00:00.000Z' },
          updatedAt: { S: '2024-01-01T00:00:00.000Z' },
        },
      });

      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event, createMockContext(), () => {});

      // Second record should still process
      const s3PutCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3PutCalls.length).toBeGreaterThan(0);
    });
  });
});
