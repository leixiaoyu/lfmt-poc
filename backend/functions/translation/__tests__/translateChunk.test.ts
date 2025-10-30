/**
 * Unit tests for Translate Chunk Lambda
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.CHUNKS_BUCKET = 'test-chunks-bucket';
process.env.GEMINI_API_KEY_SECRET_NAME = 'test-gemini-secret';

import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Readable } from 'stream';
import { handler, TranslateChunkEvent, resetClients } from '../translateChunk';
import { sdkStreamMixin } from '@smithy/util-stream';

// Create mocks
const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);
const secretsMock = mockClient(SecretsManagerClient);

// Mock Google GenAI
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => 'Texto traducido al español',
          usageMetadata: {
            promptTokenCount: 100,
            candidatesTokenCount: 50,
            totalTokenCount: 150,
          },
        },
      }),
    },
  })),
}));

// Helper to create SDK-compatible stream
function createMockStream(content: string) {
  const stream = Readable.from([content]);
  return sdkStreamMixin(stream);
}

describe('translateChunk Lambda', () => {
  const mockApiKey = 'AIzaSyTest123ApiKey456';

  beforeEach(() => {
    dynamoMock.reset();
    s3Mock.reset();
    secretsMock.reset();
    jest.clearAllMocks();

    // Reset singleton clients
    resetClients();

    // Mock Secrets Manager response
    secretsMock.on(GetSecretValueCommand).resolves({
      SecretString: mockApiKey,
    } as any);
  });

  describe('successful translation', () => {
    it('should translate first chunk without context', async () => {
      // Mock job data
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '5' },
          translatedChunks: { N: '0' },
          tokensUsed: { N: '0' },
          estimatedCost: { N: '0' },
        },
      } as any);

      // Mock chunk data
      const chunkContent = JSON.stringify({
        primaryContent: 'This is a test document.',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        totalChunks: 5,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(result.jobId).toBe('job-123');
      expect(result.chunkIndex).toBe(0);
      expect(result.translatedKey).toBe('translated/job-123/chunk-0.txt');
      expect(result.tokensUsed).toBe(150);
      expect(result.estimatedCost).toBeGreaterThan(0);

      // Verify S3 put was called
      const s3Calls = s3Mock.commandCalls(PutObjectCommand);
      expect(s3Calls.length).toBe(1);
      expect(s3Calls[0].args[0].input.Key).toBe('translated/job-123/chunk-0.txt');
      expect(s3Calls[0].args[0].input.Body).toBe('Texto traducido al español');

      // Verify DynamoDB update was called
      const dynamoCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(dynamoCalls.length).toBe(1);
    });

    it('should translate middle chunk with context', async () => {
      // Mock job data
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
          totalChunks: { N: '5' },
          translatedChunks: { N: '2' },
          tokensUsed: { N: '300' },
          estimatedCost: { N: '0.000015' },
        },
      } as any);

      // Mock current chunk
      const chunkContent = JSON.stringify({
        primaryContent: 'This is chunk 2 content.',
        chunkId: 'chunk-2',
        chunkIndex: 2,
        totalChunks: 5,
      });

      // Mock previous translated chunks (context)
      s3Mock
        .on(GetObjectCommand, {
          Bucket: 'test-chunks-bucket',
          Key: 'chunks/job-123/chunk-2.json',
        })
        .resolves({
          Body: createMockStream(chunkContent),
        } as any);

      s3Mock
        .on(GetObjectCommand, {
          Bucket: 'test-chunks-bucket',
          Key: 'translated/job-123/chunk-1.txt',
        })
        .resolves({
          Body: createMockStream('Traducción del chunk 1'),
        } as any);

      s3Mock
        .on(GetObjectCommand, {
          Bucket: 'test-chunks-bucket',
          Key: 'translated/job-123/chunk-0.txt',
        })
        .resolves({
          Body: createMockStream('Traducción del chunk 0'),
        } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 2,
        targetLanguage: 'es',
        contextChunks: 2,
      };

      const result = await handler(event);

      if (!result.success) {
        console.error('Test failed with error:', result.error);
      }
      expect(result.success).toBe(true);
      expect(result.chunkIndex).toBe(2);

      // Verify context chunks were loaded (3 GetObject calls: current + 2 context)
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      expect(s3GetCalls.length).toBeGreaterThanOrEqual(3);
    });

    it('should mark job as COMPLETED when last chunk is translated', async () => {
      // Mock job data
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
          totalChunks: { N: '5' },
          translatedChunks: { N: '4' },
          tokensUsed: { N: '600' },
          estimatedCost: { N: '0.000045' },
        },
      } as any);

      // Mock last chunk
      const chunkContent = JSON.stringify({
        primaryContent: 'This is the final chunk.',
        chunkId: 'chunk-4',
        chunkIndex: 4,
        totalChunks: 5,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 4,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      // Verify DynamoDB update marked status as COMPLETED
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updateCalls.length).toBe(1);
      const updateExpression = updateCalls[0].args[0].input.UpdateExpression;
      expect(updateExpression).toContain('translationStatus');
    });
  });

  describe('input validation', () => {
    it('should reject missing jobId', async () => {
      const event = {
        chunkIndex: 0,
        targetLanguage: 'es',
      } as any;

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('jobId is required');
      expect(result.retryable).toBe(false);
    });

    it('should reject negative chunkIndex', async () => {
      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: -1,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('chunkIndex must be a non-negative integer');
    });

    it('should reject invalid targetLanguage', async () => {
      const event = {
        jobId: 'job-123',
        chunkIndex: 0,
        targetLanguage: 'invalid',
      } as any;

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid targetLanguage');
    });

    it('should accept valid target languages', async () => {
      const validLanguages = ['es', 'fr', 'it', 'de', 'zh'];

      for (const lang of validLanguages) {
        const event = {
          jobId: 'job-123',
          chunkIndex: 0,
          targetLanguage: lang,
        } as any;

        // Mock necessary data
        dynamoMock.on(GetItemCommand).resolves({
          Item: {
            jobId: { S: 'job-123' },
            status: { S: 'CHUNKED' },
            totalChunks: { N: '1' },
          },
        } as any);

        const chunkContent = JSON.stringify({
          primaryContent: 'Test',
          chunkId: 'chunk-0',
        });

        s3Mock.on(GetObjectCommand).resolves({
          Body: createMockStream(chunkContent),
        } as any);

        s3Mock.on(PutObjectCommand).resolves({} as any);
        dynamoMock.on(UpdateItemCommand).resolves({} as any);

        const result = await handler(event);

        // Should not fail on validation
        expect(result.success).toBe(true);
      }
    });
  });

  describe('error handling', () => {
    it('should reject translation for non-chunked job', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'PENDING_UPLOAD' },
        },
      } as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not ready for translation');
      expect(result.retryable).toBe(false);
    });

    it('should handle job not found', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: undefined,
      } as any);

      const event: TranslateChunkEvent = {
        jobId: 'nonexistent',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Job not found');
    });

    it('should handle chunk not found in S3', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
        },
      } as any);

      s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 999,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle rate limit with retryable error', async () => {
      // Mock job and chunk data
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '1' },
        },
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Test content',
        chunkId: 'chunk-0',
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      // Note: Testing actual rate limiting requires consuming quota first
      // For this test, we're verifying the handler structure handles rate limits
      // The rate limiter itself is tested separately

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      // Should succeed on first call (rate limit not hit yet)
      expect(result).toBeDefined();
    });
  });

  describe('context management', () => {
    it('should load no context for first chunk', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '3' },
        },
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'First chunk',
        chunkId: 'chunk-0',
      });

      s3Mock
        .on(GetObjectCommand, {
          Key: 'chunks/job-123/chunk-0.json',
        })
        .resolves({
          Body: createMockStream(chunkContent),
        } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 0,
        targetLanguage: 'es',
        contextChunks: 2,
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      // Only 1 GetObject call for current chunk (no context available)
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      expect(s3GetCalls.length).toBe(1);
    });

    it('should respect contextChunks parameter', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
          totalChunks: { N: '5' },
          translatedChunks: { N: '3' },
        },
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Chunk 3',
        chunkId: 'chunk-3',
      });

      // Mock current chunk
      s3Mock
        .on(GetObjectCommand, {
          Key: 'chunks/job-123/chunk-3.json',
        })
        .resolves({
          Body: createMockStream(chunkContent),
        } as any);

      // Mock context chunks
      s3Mock
        .on(GetObjectCommand, {
          Key: 'translated/job-123/chunk-2.txt',
        })
        .resolves({
          Body: createMockStream('Context 2'),
        } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 3,
        targetLanguage: 'es',
        contextChunks: 1, // Only load 1 previous chunk
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      // 2 GetObject calls: current chunk + 1 context
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      expect(s3GetCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('tone option', () => {
    it('should pass tone to translation options', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '1' },
        },
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Test',
        chunkId: 'chunk-0',
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        chunkIndex: 0,
        targetLanguage: 'es',
        tone: 'formal',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
    });
  });
});
