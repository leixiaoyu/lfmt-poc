/**
 * Upload Complete Handler - Comprehensive Test Suite
 * Tests S3 event processing, job status updates, and file validation
 *
 * Test Philosophy:
 * - 100% code coverage across all branches
 * - Test all happy paths and error scenarios
 * - Verify all external service integrations
 * - Validate logging and observability
 * - Security and data integrity checks
 */

import { S3Event, S3EventRecord } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, HeadObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';

// Mock logger - must be defined before jest.mock due to hoisting
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

// Mock environment variables BEFORE importing handler
process.env.JOBS_TABLE = 'test-jobs-table';

// Import handler AFTER mocks and env vars are set up
import { handler } from './uploadComplete';

// Create mocks
const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);

describe('uploadComplete Lambda Function - Comprehensive Coverage', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    dynamoMock.reset();
    s3Mock.reset();
    jest.clearAllMocks();
  });

  // Helper function to create S3 event
  const createS3Event = (
    bucket: string,
    key: string,
    size: number,
    eventTime: string = '2025-01-22T12:00:00.000Z'
  ): S3Event => {
    const record: S3EventRecord = {
      eventVersion: '2.1',
      eventSource: 'aws:s3',
      awsRegion: 'us-east-1',
      eventTime,
      eventName: 'ObjectCreated:Put',
      userIdentity: {
        principalId: 'AWS:test-user',
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
          size,
          eTag: 'test-etag',
          sequencer: 'test-sequencer',
        },
      },
    };

    return {
      Records: [record],
    };
  };

  // Helper function to create S3 metadata
  const createS3Metadata = (
    userId: string,
    fileId: string,
    jobId: string,
    filename: string,
    uploadRequestId: string = 'test-request-123'
  ) => ({
    userid: userId,
    fileid: fileId,
    jobid: jobId,
    originalfilename: filename,
    uploadrequestid: uploadRequestId,
  });

  // Helper function to create job record
  const createJobRecord = (
    jobId: string,
    userId: string,
    documentId: string,
    filename: string,
    fileSize: number,
    status: string = 'PENDING_UPLOAD'
  ) => ({
    jobId,
    userId,
    documentId,
    filename,
    status,
    fileSize,
    s3Key: `uploads/${userId}/${documentId}/${filename}`,
    createdAt: '2025-01-22T11:00:00.000Z',
    updatedAt: '2025-01-22T11:00:00.000Z',
    expiresAt: '2025-01-22T11:15:00.000Z',
    metadata: {
      originalFilename: filename,
      uploadRequestId: 'test-request-123',
    },
  });

  describe('Happy Path - Successful Upload Processing', () => {
    it('should successfully process S3 upload event and update job status to UPLOADED', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      // Mock S3 HeadObject response
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      // Mock DynamoDB GetItem response
      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      // Mock DynamoDB UpdateItem response
      dynamoMock.on(UpdateItemCommand).resolves({});

      // Mock S3 CopyObject response (for copying to documents/ prefix)
      s3Mock.on(CopyObjectCommand).resolves({});

      await handler(event);

      // Verify S3 HeadObject was called
      const s3Calls = s3Mock.commandCalls(HeadObjectCommand);
      expect(s3Calls).toHaveLength(1);
      expect(s3Calls[0].args[0].input).toEqual({
        Bucket: 'test-bucket',
        Key: `uploads/${userId}/${fileId}/${filename}`,
      });

      // Verify DynamoDB GetItem was called
      const getItemCalls = dynamoMock.commandCalls(GetItemCommand);
      expect(getItemCalls).toHaveLength(1);
      expect(getItemCalls[0].args[0].input.TableName).toBe('test-jobs-table');

      // Verify DynamoDB UpdateItem was called with correct parameters
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].args[0].input.TableName).toBe('test-jobs-table');

      // Verify S3 CopyObject was called to trigger chunking
      const copyCalls = s3Mock.commandCalls(CopyObjectCommand);
      expect(copyCalls).toHaveLength(1);
      expect(copyCalls[0].args[0].input).toEqual({
        Bucket: 'test-bucket',
        CopySource: `test-bucket/uploads/${userId}/${fileId}/${filename}`,
        Key: `documents/${userId}/${fileId}/${filename}`,
        Metadata: {
          ...metadata,
          userid: userId,
          fileid: fileId,
          jobid: jobId,
        },
        MetadataDirective: 'REPLACE',
      });

      // Verify logging
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Processing S3 upload completion event',
        { recordCount: 1 }
      );
      expect(mockLoggerInfo).toHaveBeenCalledWith('Job status updated to UPLOADED', {
        jobId,
        fileId,
        userId,
        size: fileSize,
      });
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'File copied successfully, chunking will be triggered automatically',
        {
          sourceKey: `uploads/${userId}/${fileId}/${filename}`,
          destinationKey: `documents/${userId}/${fileId}/${filename}`,
          jobId,
        }
      );
    });

    it('should update job record with correct status and timestamps', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;
      const eventTime = '2025-01-22T12:00:00.000Z';

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize,
        eventTime
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      // Mock S3 CopyObject response
      s3Mock.on(CopyObjectCommand).resolves({});

      await handler(event);

      // Verify UpdateItem was called with correct timestamps
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      const updateInput = updateCalls[0].args[0].input;

      expect(updateInput.UpdateExpression).toContain('uploadedAt');
      expect(updateInput.UpdateExpression).toContain('updatedAt');
      expect(updateInput.UpdateExpression).toContain('#status');
      expect(updateInput.UpdateExpression).toContain('actualFileSize');
    });

    it('should handle URL-encoded S3 keys with spaces', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'my document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/my+document.txt`, // URL-encoded space
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify S3 HeadObject was called with decoded key
      const s3Calls = s3Mock.commandCalls(HeadObjectCommand);
      expect(s3Calls[0].args[0].input.Key).toBe(`uploads/${userId}/${fileId}/my document.txt`);
    });
  });

  describe('File Validation - Metadata Mismatch', () => {
    it('should mark job as VALIDATION_FAILED when documentId does not match', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const wrongFileId = 'file-999';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, wrongFileId, filename, fileSize); // Wrong documentId

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify UpdateItem was called with VALIDATION_FAILED status
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updateCalls).toHaveLength(1);

      const updateInput = updateCalls[0].args[0].input;
      const statusValue = updateInput.ExpressionAttributeValues?.[':status'];
      expect(statusValue).toEqual({ S: 'VALIDATION_FAILED' });

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'File validation failed',
        expect.objectContaining({
          jobId,
          fileId,
          validationErrors: expect.arrayContaining([
            expect.stringContaining('documentId mismatch'),
          ]),
        })
      );
    });

    it('should mark job as VALIDATION_FAILED when userId does not match', async () => {
      const userId = 'user-123';
      const wrongUserId = 'user-999';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, wrongUserId, fileId, filename, fileSize); // Wrong userId

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify validation error includes userId mismatch
      expect(mockLoggerError).toHaveBeenCalledWith(
        'File validation failed',
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.stringContaining('userId mismatch'),
          ]),
        })
      );
    });

    it('should mark job as VALIDATION_FAILED when file size does not match', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const expectedSize = 50000;
      const actualSize = 45000; // Different size

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        actualSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, expectedSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: actualSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify validation error includes fileSize mismatch
      expect(mockLoggerError).toHaveBeenCalledWith(
        'File validation failed',
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.stringContaining('fileSize mismatch'),
          ]),
        })
      );
    });

    it('should include all validation errors when multiple mismatches occur', async () => {
      const userId = 'user-123';
      const wrongUserId = 'user-999';
      const fileId = 'file-456';
      const wrongFileId = 'file-999';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const expectedSize = 50000;
      const actualSize = 45000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        actualSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, wrongUserId, wrongFileId, filename, expectedSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: actualSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify all three validation errors are reported
      expect(mockLoggerError).toHaveBeenCalledWith(
        'File validation failed',
        expect.objectContaining({
          validationErrors: expect.arrayContaining([
            expect.stringContaining('documentId mismatch'),
            expect.stringContaining('userId mismatch'),
            expect.stringContaining('fileSize mismatch'),
          ]),
        })
      );
    });
  });

  describe('S3 Key Validation', () => {
    it('should skip processing for invalid S3 key format (wrong number of parts)', async () => {
      const event = createS3Event('test-bucket', 'invalid/key.txt', 50000);

      await handler(event);

      // Verify warning was logged
      expect(mockLoggerWarn).toHaveBeenCalledWith('Invalid S3 key format, skipping', {
        key: 'invalid/key.txt',
      });

      // Verify no DynamoDB calls were made
      expect(dynamoMock.calls()).toHaveLength(0);
    });

    it('should skip processing for S3 key not starting with "uploads/"', async () => {
      const event = createS3Event(
        'test-bucket',
        'downloads/user-123/file-456/test.txt',
        50000
      );

      await handler(event);

      // Verify warning was logged
      expect(mockLoggerWarn).toHaveBeenCalledWith('Invalid S3 key format, skipping', {
        key: 'downloads/user-123/file-456/test.txt',
      });

      // Verify no DynamoDB calls were made
      expect(dynamoMock.calls()).toHaveLength(0);
    });

    it('should skip processing when jobId is missing from S3 metadata', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      // Missing jobId in metadata
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: {
          userid: userId,
          fileid: fileId,
          // jobid is missing
          uploadrequestid: 'test-request-123',
        },
      });

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Missing jobId in S3 metadata',
        expect.objectContaining({
          key: `uploads/${userId}/${fileId}/${filename}`,
        })
      );

      // Verify no DynamoDB GetItem was called
      expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(0);
    });

    it('should skip processing when uploadRequestId is missing from S3 metadata', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      // Missing uploadRequestId in metadata
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: {
          userid: userId,
          fileid: fileId,
          jobid: 'job-789',
          // uploadrequestid is missing
        },
      });

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Missing uploadRequestId in S3 metadata',
        expect.objectContaining({
          key: `uploads/${userId}/${fileId}/${filename}`,
        })
      );
    });
  });

  describe('DynamoDB Integration', () => {
    it('should skip processing when job record is not found in DynamoDB', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      // Job record not found
      dynamoMock.on(GetItemCommand).resolves({});

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith('Job record not found', {
        jobId,
        fileId,
      });

      // Verify no UpdateItem was called
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(0);
    });

    it('should handle DynamoDB GetItem error gracefully', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      const dynamoError = new Error('DynamoDB service error');
      dynamoMock.on(GetItemCommand).rejects(dynamoError);

      await handler(event);

      // Verify error was logged with stack trace
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error processing upload completion',
        expect.objectContaining({
          key: `uploads/${userId}/${fileId}/${filename}`,
          error: 'DynamoDB service error',
          stack: expect.any(String),
        })
      );
    });

    it('should handle DynamoDB UpdateItem error gracefully', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      const updateError = new Error('ConditionalCheckFailedException');
      updateError.name = 'ConditionalCheckFailedException';
      dynamoMock.on(UpdateItemCommand).rejects(updateError);

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error processing upload completion',
        expect.objectContaining({
          error: 'ConditionalCheckFailedException',
        })
      );
    });
  });

  describe('S3 Integration', () => {
    it('should handle S3 HeadObject error gracefully', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const s3Error = new Error('Access Denied');
      s3Error.name = 'AccessDenied';
      s3Mock.on(HeadObjectCommand).rejects(s3Error);

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error processing upload completion',
        expect.objectContaining({
          error: 'Access Denied',
        })
      );

      // Verify no DynamoDB calls were made
      expect(dynamoMock.calls()).toHaveLength(0);
    });
  });

  describe('Multiple S3 Events Processing', () => {
    it('should process multiple S3 events in a single invocation', async () => {
      const event: S3Event = {
        Records: [
          createS3Event('test-bucket', 'uploads/user1/file1/doc1.txt', 1000).Records[0],
          createS3Event('test-bucket', 'uploads/user2/file2/doc2.txt', 2000).Records[0],
        ],
      };

      const metadata1 = createS3Metadata('user1', 'file1', 'job1', 'doc1.txt');
      const metadata2 = createS3Metadata('user2', 'file2', 'job2', 'doc2.txt');

      const job1 = createJobRecord('job1', 'user1', 'file1', 'doc1.txt', 1000);
      const job2 = createJobRecord('job2', 'user2', 'file2', 'doc2.txt', 2000);

      // Mock S3 responses for both files
      s3Mock
        .on(HeadObjectCommand, { Key: 'uploads/user1/file1/doc1.txt' })
        .resolves({ ContentType: 'text/plain', ContentLength: 1000, Metadata: metadata1 })
        .on(HeadObjectCommand, { Key: 'uploads/user2/file2/doc2.txt' })
        .resolves({ ContentType: 'text/plain', ContentLength: 2000, Metadata: metadata2 });

      // Mock DynamoDB responses for both jobs
      dynamoMock
        .on(GetItemCommand)
        .resolvesOnce({ Item: marshall(job1) })
        .resolvesOnce({ Item: marshall(job2) });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify both files were processed
      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(2);
      expect(dynamoMock.commandCalls(GetItemCommand)).toHaveLength(2);
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(2);

      // Verify logging shows 2 records processed
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Processing S3 upload completion event',
        { recordCount: 2 }
      );
    });

    it('should continue processing other events when one event fails', async () => {
      const event: S3Event = {
        Records: [
          createS3Event('test-bucket', 'uploads/user1/file1/doc1.txt', 1000).Records[0],
          createS3Event('test-bucket', 'invalid/key.txt', 2000).Records[0], // Invalid key
          createS3Event('test-bucket', 'uploads/user3/file3/doc3.txt', 3000).Records[0],
        ],
      };

      const metadata1 = createS3Metadata('user1', 'file1', 'job1', 'doc1.txt');
      const metadata3 = createS3Metadata('user3', 'file3', 'job3', 'doc3.txt');

      const job1 = createJobRecord('job1', 'user1', 'file1', 'doc1.txt', 1000);
      const job3 = createJobRecord('job3', 'user3', 'file3', 'doc3.txt', 3000);

      s3Mock
        .on(HeadObjectCommand, { Key: 'uploads/user1/file1/doc1.txt' })
        .resolves({ ContentType: 'text/plain', ContentLength: 1000, Metadata: metadata1 })
        .on(HeadObjectCommand, { Key: 'uploads/user3/file3/doc3.txt' })
        .resolves({ ContentType: 'text/plain', ContentLength: 3000, Metadata: metadata3 });

      dynamoMock
        .on(GetItemCommand)
        .resolvesOnce({ Item: marshall(job1) })
        .resolvesOnce({ Item: marshall(job3) });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify valid events were processed (2 successful, 1 skipped)
      expect(s3Mock.commandCalls(HeadObjectCommand)).toHaveLength(2);
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(2);

      // Verify invalid key was logged as warning
      expect(mockLoggerWarn).toHaveBeenCalledWith('Invalid S3 key format, skipping', {
        key: 'invalid/key.txt',
      });
    });
  });

  describe('Logging Coverage', () => {
    it('should log all processing steps for successful upload', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify initial logging
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Processing S3 upload completion event',
        { recordCount: 1 }
      );

      // Verify file processing logging
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Processing uploaded file',
        expect.objectContaining({
          bucket: 'test-bucket',
          key: `uploads/${userId}/${fileId}/${filename}`,
          size: fileSize,
        })
      );

      // Verify metadata retrieval logging
      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Retrieved S3 object metadata',
        expect.objectContaining({
          userId,
          fileId,
          filename,
        })
      );

      // Verify completion logging
      expect(mockLoggerInfo).toHaveBeenCalledWith('Job status updated to UPLOADED', {
        jobId,
        fileId,
        userId,
        size: fileSize,
      });

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        'Completed processing S3 upload events',
        { recordCount: 1 }
      );
    });

    it('should log errors with stack traces for exceptions', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const error = new Error('Unexpected error');
      s3Mock.on(HeadObjectCommand).rejects(error);

      await handler(event);

      // Verify error logging includes stack trace
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error processing upload completion',
        expect.objectContaining({
          key: `uploads/${userId}/${fileId}/${filename}`,
          error: 'Unexpected error',
          stack: expect.any(String),
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle S3 metadata with empty values', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      // Metadata with empty values
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: {},
      });

      await handler(event);

      // Verify error about missing uploadRequestId
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Missing uploadRequestId in S3 metadata',
        expect.anything()
      );
    });

    it('should handle S3 event with zero-byte file', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'empty.txt';
      const fileSize = 0;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event);

      // Verify processing completed successfully
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(1);
    });
  });

  /**
   * S3 Copy Operation Error Scenarios
   * Critical for 100% branch coverage
   */
  describe('S3 Copy Operation - Error Handling', () => {
    it('should handle S3 CopyObject failure gracefully', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      // Mock S3 CopyObject to fail
      s3Mock.on(CopyObjectCommand).rejects(new Error('S3 copy operation failed'));

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error processing upload completion',
        expect.objectContaining({
          key: `uploads/${userId}/${fileId}/${filename}`,
          error: 'S3 copy operation failed',
          stack: expect.any(String),
        })
      );

      // Verify DynamoDB update still succeeded (eventual consistency)
      expect(dynamoMock.commandCalls(UpdateItemCommand)).toHaveLength(1);
    });

    it('should handle S3 CopyObject AccessDenied error', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      // Mock S3 CopyObject to fail with AccessDenied
      const accessDeniedError = new Error('Access Denied');
      accessDeniedError.name = 'AccessDenied';
      s3Mock.on(CopyObjectCommand).rejects(accessDeniedError);

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error processing upload completion',
        expect.objectContaining({
          error: 'Access Denied',
        })
      );
    });

    it('should handle S3 CopyObject NoSuchKey error (source file disappeared)', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const jobId = 'job-789';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});

      // Mock S3 CopyObject to fail with NoSuchKey
      const noSuchKeyError = new Error('The specified key does not exist');
      noSuchKeyError.name = 'NoSuchKey';
      s3Mock.on(CopyObjectCommand).rejects(noSuchKeyError);

      await handler(event);

      // Verify error was logged
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Error processing upload completion',
        expect.objectContaining({
          error: 'The specified key does not exist',
        })
      );
    });

    it('should handle S3 HeadObject returning undefined Metadata', async () => {
      const userId = 'user-123';
      const fileId = 'file-456';
      const filename = 'test-document.txt';
      const fileSize = 50000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      // S3 HeadObject returns undefined Metadata (edge case)
      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: undefined, // This tests the || {} fallback on line 60
      });

      await handler(event);

      // Verify error about missing uploadRequestId
      expect(mockLoggerError).toHaveBeenCalledWith(
        'Missing uploadRequestId in S3 metadata',
        expect.objectContaining({
          metadata: {},
        })
      );
    });
  });

  /**
   * S3 Copy Operation - Metadata Preservation
   */
  describe('S3 Copy Operation - Metadata Preservation', () => {
    it('should preserve all required metadata when copying to documents/', async () => {
      const userId = 'user-abc-123';
      const fileId = 'file-def-456';
      const jobId = 'job-ghi-789';
      const filename = 'important-document.txt';
      const fileSize = 75000;

      const event = createS3Event(
        'test-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = {
        userid: userId,
        fileid: fileId,
        jobid: jobId,
        uploadrequestid: 'request-123',
        originalfilename: filename,
        contenttype: 'text/plain',
      };

      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});
      s3Mock.on(CopyObjectCommand).resolves({});

      await handler(event);

      // Verify CopyObject was called with ALL metadata preserved
      const copyCalls = s3Mock.commandCalls(CopyObjectCommand);
      expect(copyCalls).toHaveLength(1);

      const copyInput = copyCalls[0].args[0].input;
      expect(copyInput.Metadata).toEqual({
        ...metadata,
        userid: userId,
        fileid: fileId,
        jobid: jobId,
      });
      expect(copyInput.MetadataDirective).toBe('REPLACE');
    });

    it('should use correct S3 keys for source and destination', async () => {
      const userId = 'user-with-special-chars';
      const fileId = 'file-with-uuid-1234-5678';
      const jobId = 'job-789';
      const filename = 'my-long-document-name-2025.txt';
      const fileSize = 100000;

      const event = createS3Event(
        'production-bucket',
        `uploads/${userId}/${fileId}/${filename}`,
        fileSize
      );

      const metadata = createS3Metadata(userId, fileId, jobId, filename);
      const jobRecord = createJobRecord(jobId, userId, fileId, filename, fileSize);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentType: 'text/plain',
        ContentLength: fileSize,
        Metadata: metadata,
      });

      dynamoMock.on(GetItemCommand).resolves({
        Item: marshall(jobRecord),
      });

      dynamoMock.on(UpdateItemCommand).resolves({});
      s3Mock.on(CopyObjectCommand).resolves({});

      await handler(event);

      // Verify exact S3 copy parameters
      const copyCalls = s3Mock.commandCalls(CopyObjectCommand);
      const copyInput = copyCalls[0].args[0].input;

      expect(copyInput.Bucket).toBe('production-bucket');
      expect(copyInput.CopySource).toBe(`production-bucket/uploads/${userId}/${fileId}/${filename}`);
      expect(copyInput.Key).toBe(`documents/${userId}/${fileId}/${filename}`);
    });
  });
});
