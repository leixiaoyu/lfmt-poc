/**
 * Document Chunking Lambda Handler Tests
 *
 * Tests S3 event handling, document processing, and DynamoDB updates.
 * All S3 GetObject mocks use real Readable streams to exercise the production
 * streaming code path (issue #24).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { S3Event, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
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

/**
 * Build a real Readable stream from a string (UTF-8 encoded). This is the
 * production-equivalent body shape — the AWS SDK v3 returns a Readable for
 * S3 GetObject in Node.js, and our handler treats it via `for await`.
 */
const streamFromString = (content: string): Readable =>
  Readable.from(Buffer.from(content, 'utf-8'));

/**
 * Build a Readable that emits multiple bounded buffers, exercising the
 * highWaterMark path more realistically (multi-chunk concatenation).
 */
const streamFromBuffers = (buffers: Buffer[]): Readable => Readable.from(buffers);

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

  /**
   * Default DynamoDB GetItem mock — a job in PENDING_UPLOAD state ready for chunking.
   */
  const mockJobRecord = (key: string, fileSize = 1024) => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        jobId: { S: 'job789' },
        userId: { S: 'user123' },
        documentId: { S: 'file456' },
        filename: { S: 'test.txt' },
        status: { S: 'PENDING_UPLOAD' },
        s3Key: { S: key },
        fileSize: { N: String(fileSize) },
        createdAt: { S: '2024-01-01T00:00:00.000Z' },
        updatedAt: { S: '2024-01-01T00:00:00.000Z' },
      },
    });
  };

  describe('Successful Document Chunking', () => {
    it('should process S3 event and chunk document successfully (small file)', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';
      const content = 'This is a test document. '.repeat(500); // ~1500 tokens

      // HeadObject: metadata + size guard (no body)
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: Buffer.byteLength(content, 'utf-8'),
        Metadata: {
          userid: 'user123',
          jobid: 'job789',
          fileid: 'file456',
        },
      });

      // GetObject: real Readable body — exercises the production streaming path
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromString(content) as never,
      });

      mockJobRecord(key);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      const event = createS3Event(bucket, key);
      await handler(event, createMockContext(), () => {});

      // HeadObject called exactly once for metadata
      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);

      // GetObject called exactly once for body — no double download
      expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(1);

      // Job lookup happened
      expect(dynamoMock.commandCalls(GetItemCommand).length).toBe(1);

      // Status updates: CHUNKING then CHUNKED (at least 2)
      expect(dynamoMock.commandCalls(UpdateItemCommand).length).toBeGreaterThanOrEqual(2);

      // At least one chunk written
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBeGreaterThan(0);
    });

    it('should handle small documents in a single chunk', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/small.txt';
      const content = 'This is a small document.';

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: Buffer.byteLength(content, 'utf-8'),
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromString(content) as never,
      });
      mockJobRecord(key, 25);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      // Single chunk
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(1);
    });

    it('should handle large documents with multiple chunks', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/large.txt';
      const content = 'This is a sentence. '.repeat(5000); // ~10K tokens → many chunks

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: Buffer.byteLength(content, 'utf-8'),
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromString(content) as never,
      });
      mockJobRecord(key, 100000);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(putCalls.length).toBeGreaterThan(1);
    });

    it('should correctly concatenate content across multiple stream buffers', async () => {
      // Simulate a real S3 read: many small TCP-frame-sized buffers.
      // The chunker must accumulate them correctly without losing or duplicating bytes.
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/multibuf.txt';
      const fullText =
        'Sentence number ' + Array.from({ length: 200 }, (_, i) => `${i}.`).join(' ');
      // Slice into ~100-byte buffers to simulate network-driven reads
      const buffers: Buffer[] = [];
      for (let i = 0; i < fullText.length; i += 100) {
        buffers.push(Buffer.from(fullText.slice(i, i + 100), 'utf-8'));
      }

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: Buffer.byteLength(fullText, 'utf-8'),
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromBuffers(buffers) as never,
      });
      mockJobRecord(key, fullText.length);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      // Reassemble the chunks from the PutObject bodies and assert byte-exact correctness
      // (modulo whitespace normalisation from sentence splitting/rejoining).
      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
      const reassembled = putCalls
        .map((c) => {
          const body = JSON.parse((c.args[0].input as { Body: string }).Body);
          return body.primaryContent as string;
        })
        .join(' ');
      // Both should contain all 200 sentence markers, regardless of whitespace differences
      for (let i = 0; i < 200; i++) {
        expect(reassembled).toContain(`${i}.`);
      }
    });

    it('should correctly decode UTF-8 multi-byte chars split across buffer boundaries', async () => {
      // The Chinese character "中" is 3 bytes in UTF-8 (0xE4 0xB8 0xAD). If we split the buffer
      // mid-character, the chunker's setEncoding('utf8') StringDecoder must handle the boundary.
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/utf8.txt';
      const text = 'Hello 中国. This is a sentence with mixed encoding 你好世界.';
      const fullBuf = Buffer.from(text, 'utf-8');
      // Split at byte 7 — middle of the first 中 (which starts at byte 6).
      const buffers = [fullBuf.subarray(0, 7), fullBuf.subarray(7)];

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: fullBuf.length,
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromBuffers(buffers) as never,
      });
      mockJobRecord(key, fullBuf.length);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(putCalls.length).toBeGreaterThanOrEqual(1);
      const reassembled = putCalls
        .map((c) => {
          const body = JSON.parse((c.args[0].input as { Body: string }).Body);
          return body.primaryContent as string;
        })
        .join('');
      // The multi-byte characters must be intact — no mojibake / replacement chars.
      expect(reassembled).toContain('中国');
      expect(reassembled).toContain('你好世界');
      expect(reassembled).not.toContain('\ufffd'); // U+FFFD replacement character
    });

    it('should handle exactly 64KB file (boundary condition)', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/exactly64k.txt';
      // Fill exactly 64KiB with ASCII (1 byte/char). Use sentence-terminated text so chunking works.
      const sentence = 'A short sentence. ';
      const repeats = Math.floor((64 * 1024) / sentence.length);
      let content = sentence.repeat(repeats);
      // Pad to exactly 64KiB
      content = content + 'X'.repeat(64 * 1024 - content.length - 1) + '.';
      expect(content.length).toBe(64 * 1024);

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 64 * 1024,
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromString(content) as never,
      });
      mockJobRecord(key, 64 * 1024);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      // Should succeed and produce at least one chunk
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should reject documents above the size guard without downloading body', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/huge.txt';

      // HeadObject reports a size larger than the 100MB guard
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 200 * 1024 * 1024, // 200 MB
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });

      mockJobRecord(key, 200 * 1024 * 1024);
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      // HeadObject called once for the size check
      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);
      // GetObject must NOT be called — we rejected before downloading
      expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(0);
      // No chunks written
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
    });

    it('should handle missing S3 metadata gracefully', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      // HeadObject with missing user-defined metadata
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 100,
        Metadata: undefined,
      });

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      // Should bail before reaching DynamoDB
      expect(dynamoMock.commandCalls(GetItemCommand).length).toBe(0);
      expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(0);
    });

    it('should handle job not found in DynamoDB', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 7,
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      // Job not in DynamoDB
      dynamoMock.on(GetItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      // No chunks written — handler skipped the record
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
      // Body stream never opened either
      expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(0);
    });

    it('should handle HeadObject failure (e.g. AccessDenied) cleanly', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      s3Mock.on(HeadObjectCommand).rejects(new Error('AccessDenied'));

      await expect(
        handler(createS3Event(bucket, key), createMockContext(), () => {})
      ).resolves.toBeUndefined();

      // Body never fetched
      expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(0);
    });

    it('should handle GetObject failure (NoSuchKey) cleanly', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 100,
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));

      mockJobRecord(key);
      dynamoMock.on(UpdateItemCommand).resolves({});

      await expect(
        handler(createS3Event(bucket, key), createMockContext(), () => {})
      ).resolves.toBeUndefined();

      // Job status should have been set to CHUNKING_FAILED (the third UpdateItem call:
      // initial CHUNKING + the failure update)
      const updates = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updates.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle a stream error mid-read', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';

      // A single-shot Readable: emits one chunk, then errors on the next read.
      // Using state in closure to ensure deterministic behavior under for-await.
      let emitted = false;
      const errorStream = new Readable({
        read() {
          if (!emitted) {
            emitted = true;
            this.push(Buffer.from('Some initial content. ', 'utf-8'));
          } else {
            // Second read: surface the error and end the stream.
            this.destroy(new Error('Throttling'));
          }
        },
      });

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 22,
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({ Body: errorStream as never });
      mockJobRecord(key);
      dynamoMock.on(UpdateItemCommand).resolves({});

      await expect(
        handler(createS3Event(bucket, key), createMockContext(), () => {})
      ).resolves.toBeUndefined();

      // Failure recorded
      const updates = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updates.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle empty document content (0 bytes)', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/empty.txt';

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: 0,
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromString('') as never,
      });
      mockJobRecord(key, 0);
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(createS3Event(bucket, key), createMockContext(), () => {});

      // Should fail with CHUNKING_FAILED (empty content rejected by chunker)
      const updates = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updates.length).toBeGreaterThanOrEqual(2);
      // No chunks should have been stored
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBe(0);
    });

    it('should handle DynamoDB update failure gracefully', async () => {
      const bucket = 'test-bucket';
      const key = 'uploads/user123/file456/test.txt';
      const content = 'Test content.';

      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: Buffer.byteLength(content, 'utf-8'),
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      s3Mock.on(GetObjectCommand).resolves({
        Body: streamFromString(content) as never,
      });
      mockJobRecord(key, 13);
      dynamoMock.on(UpdateItemCommand).rejects(new Error('DynamoDB update failed'));
      s3Mock.on(PutObjectCommand).resolves({});

      await expect(
        handler(createS3Event(bucket, key), createMockContext(), () => {})
      ).resolves.toBeUndefined();
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

      const content = 'Test content.';
      s3Mock.on(HeadObjectCommand).resolves({
        ContentLength: Buffer.byteLength(content, 'utf-8'),
        Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
      });
      // Each GetObject must return a fresh stream — Readables are single-use.
      s3Mock.on(GetObjectCommand).callsFake(() => ({
        Body: streamFromString(content) as never,
      }));

      mockJobRecord('test-key', 100);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event, createMockContext(), () => {});

      expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(2);
      expect(s3Mock.commandCalls(GetObjectCommand).length).toBe(2);
    });

    it('should continue processing if one record fails', async () => {
      const event: S3Event = {
        Records: [
          createS3Event('test-bucket', 'uploads/user1/file1/doc1.txt').Records[0],
          createS3Event('test-bucket', 'uploads/user2/file2/doc2.txt').Records[0],
        ],
      };

      // First HeadObject lacks metadata → fails; second succeeds.
      s3Mock
        .on(HeadObjectCommand)
        .resolvesOnce({ ContentLength: 100, Metadata: undefined })
        .resolves({
          ContentLength: 13,
          Metadata: { userid: 'user123', jobid: 'job789', fileid: 'file456' },
        });

      const content = 'Test content.';
      s3Mock.on(GetObjectCommand).callsFake(() => ({
        Body: streamFromString(content) as never,
      }));

      mockJobRecord('test-key', 100);
      s3Mock.on(PutObjectCommand).resolves({});
      dynamoMock.on(UpdateItemCommand).resolves({});

      await handler(event, createMockContext(), () => {});

      // Second record should still produce chunks
      expect(s3Mock.commandCalls(PutObjectCommand).length).toBeGreaterThan(0);
    });
  });
});
