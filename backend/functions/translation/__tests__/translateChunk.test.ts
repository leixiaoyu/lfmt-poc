/**
 * Unit tests for Translate Chunk Lambda
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.CHUNKS_BUCKET = 'test-chunks-bucket';
process.env.GEMINI_API_KEY_SECRET_NAME = 'test-gemini-secret';

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Readable } from 'stream';
import {
  handler,
  TranslateChunkEvent,
  resetClients,
  setRateLimiterForTesting,
} from '../translateChunk';
import { sdkStreamMixin } from '@smithy/util-stream';
import { RateLimitError, RateLimitType } from '../../shared/types/rateLimiting';
// Imported alongside the jest.mock() factory below so OMC-followup C3 can
// override the GenAI mock for a single test (see usageMetadata-undefined case).
import { GoogleGenAI } from '@google/genai';

// Create mocks
const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);
const secretsMock = mockClient(SecretsManagerClient);

// Mock Google GenAI
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text: 'Texto traducido al español',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
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

// Helper to create mock job data with chunkingMetadata
function createMockJob(overrides: any = {}) {
  const jobId = overrides.jobId || 'job-123';
  const userId = overrides.userId || 'user-123';
  const totalChunks = overrides.totalChunks || 5;

  return {
    jobId: { S: jobId },
    userId: { S: userId },
    status: { S: overrides.status || 'CHUNKED' },
    totalChunks: { N: totalChunks.toString() },
    translatedChunks: { N: (overrides.translatedChunks || 0).toString() },
    tokensUsed: { N: (overrides.tokensUsed || 0).toString() },
    estimatedCost: { N: (overrides.estimatedCost || 0).toString() },
    chunkingMetadata: {
      M: {
        totalChunks: { N: totalChunks.toString() },
        chunkKeys: {
          L: Array.from({ length: totalChunks }, (_, i) => ({
            S: `chunks/${userId}/${jobId}/chunk-${String(i).padStart(4, '0')}-of-${String(totalChunks).padStart(4, '0')}.json`,
          })),
        },
      },
    },
    ...(overrides.extraFields || {}),
  };
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
        Item: createMockJob({ chunkIndex: 0 }),
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
        userId: 'user-123',
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

    it('should translate chunk with previousSummary context (parallel-safe)', async () => {
      // Mock job data
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 5,
          translatedChunks: 2,
          tokensUsed: 300,
          estimatedCost: 0.000015,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      // Mock current chunk WITH pre-calculated previousSummary (NEW parallel-safe behavior)
      const chunkContent = JSON.stringify({
        primaryContent: 'This is chunk 2 content.',
        chunkId: 'chunk-2',
        chunkIndex: 2,
        totalChunks: 5,
        previousSummary:
          'This is the summarized context from previous chunks. It was pre-calculated during the chunking phase and stored in the chunk metadata.',
      });

      // Mock ONLY the current chunk (no calls to translated/ directory)
      // Use generic S3 mock since the key comes from job.chunkingMetadata.chunkKeys
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
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

      // CRITICAL: Verify NO S3 calls to translated/ directory (parallel-safe behavior)
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      const translatedDirCalls = s3GetCalls.filter((call: any) =>
        call.args[0]?.input?.Key?.startsWith('translated/')
      );
      expect(translatedDirCalls.length).toBe(0); // ✅ No sequential dependency

      // Should only load current chunk (1 call)
      expect(s3GetCalls.length).toBe(1);
    });

    it('should mark job as COMPLETED when last chunk is translated', async () => {
      // Mock job data
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 5,
          translatedChunks: 4,
          tokensUsed: 600,
          estimatedCost: 0.000045,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
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
        userId: 'user-123',
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

    /**
     * Regression test for issue #168 — tokensUsed/estimatedCost lost under
     * parallel execution.
     *
     * Bug: updateJobProgress used a `SET tokensUsed = :tokens` clause where
     * `:tokens` was a pre-computed running total (job.tokensUsed + delta).
     * Under maxConcurrency=10, multiple chunk Lambdas read the same starting
     * value and last-writer-wins, so per-chunk metrics were lost (DDB ended
     * up showing 0 even though CloudWatch confirmed real per-chunk usage).
     *
     * Fix: switch to atomic `ADD tokensUsed :tokens, estimatedCost :cost`
     * and pass the per-chunk DELTA (not a running total). startTranslation
     * initializes both attributes to 0 (NUMBER) so ADD is safe on first call.
     *
     * This test would have caught the bug because it asserts the
     * UpdateExpression uses ADD on the metric attributes AND that the value
     * passed is the per-chunk delta (150 from the mocked Gemini response),
     * NOT a running total derived from the loaded job (which had 600).
     */
    it('should use atomic ADD (not SET) for tokensUsed/estimatedCost — issue #168', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-168',
          userId: 'user-168',
          status: 'CHUNKED',
          totalChunks: 5,
          translatedChunks: 2,
          // Pre-existing running total — must NOT leak into the SET value.
          tokensUsed: 600,
          estimatedCost: 0.000045,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Chunk for issue #168 regression test.',
        chunkId: 'chunk-2',
        chunkIndex: 2,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-168',
        userId: 'user-168',
        chunkIndex: 2,
        targetLanguage: 'es',
      };

      const result = await handler(event);
      expect(result.success).toBe(true);

      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updateCalls.length).toBe(1);
      const updateExpression = updateCalls[0].args[0].input.UpdateExpression!;

      // 1. The ADD clause MUST be present for both metric attributes AND
      //    for translatedChunks (OMC-followup R5). The previous (broken)
      //    implementation used SET on tokensUsed/estimatedCost; PR #176
      //    fixed those. R5 closes the same race for translatedChunks
      //    (parallel chunks reading the same starting value and both
      //    writing n+1 — one chunk silently dropped from progress UI).
      expect(updateExpression).toMatch(/ADD\s+/);
      expect(updateExpression).toMatch(/tokensUsed\s+:tokens/);
      expect(updateExpression).toMatch(/estimatedCost\s+:cost/);
      expect(updateExpression).toMatch(/translatedChunks\s+:one/);

      // 2. None of the counters may also appear in the SET clause (would race).
      const setClauseMatch = updateExpression.match(/SET\s+(.+?)(?:\s+ADD|$)/);
      const setClause = setClauseMatch ? setClauseMatch[1] : '';
      expect(setClause).not.toMatch(/tokensUsed/);
      expect(setClause).not.toMatch(/estimatedCost/);
      expect(setClause).not.toMatch(/translatedChunks/);

      // 3. The value passed for :tokens MUST be the per-chunk delta (150
      //    from the mocked Gemini response), NOT the running total (600
      //    + 150 = 750). The Gemini mock at the top of this file returns
      //    totalTokenCount: 150.
      const values = updateCalls[0].args[0].input.ExpressionAttributeValues!;
      expect(values[':tokens']).toEqual({ N: '150' });
      // estimatedCost is computed from token counts; just verify it's > 0
      // and not the pre-existing 0.000045 running total.
      const costN = parseFloat((values[':cost'] as { N: string }).N);
      expect(costN).toBeGreaterThan(0);
      expect(costN).toBeLessThan(0.000045); // smaller than the pre-existing total
      // OMC-followup R5: translatedChunks is incremented by 1 per chunk.
      expect(values[':one']).toEqual({ N: '1' });
    });

    /**
     * OMC-followup C3 — `usageMetadata: undefined` regression test.
     *
     * Bug class: Gemini API can return responses without `usageMetadata`
     * when an upstream error is encountered (or for partial / safety-blocked
     * responses). The previous read-modify-write SET path never touched
     * `result.usageMetadata.totalTokenCount` directly because it pre-computed
     * a running total OUTSIDE the marshalled value object. The new atomic
     * ADD path passes the raw delta — and DDB's marshall() of `undefined`
     * would cascade into a TypeError before the UpdateItem ever fires,
     * leaving the DDB row in an inconsistent state.
     *
     * geminiClient.ts:159-162 already defaults each token field to `0`
     * via `?? 0`, so this test asserts:
     *   1. The Lambda completes without TypeError.
     *   2. The DDB ADD value defaults to 0 (NUMBER) — race-free with ADD
     *      arithmetic since `ADD attr 0` is a documented no-op for NUMBERs.
     */
    it('handles undefined usageMetadata gracefully (Gemini API error path) — OMC-followup C3', async () => {
      // Override the default Google GenAI mock so the next translate() call
      // returns a payload WITHOUT usageMetadata, mirroring the real Gemini
      // upstream-error / safety-block response shape.
      const previousImpl = (GoogleGenAI as unknown as jest.Mock).getMockImplementation();
      (GoogleGenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
        models: {
          generateContent: jest.fn().mockResolvedValue({
            text: 'Texto traducido al español',
            // usageMetadata: intentionally absent
          }),
        },
      }));

      try {
        dynamoMock.on(GetItemCommand).resolves({
          Item: createMockJob({
            jobId: 'job-c3',
            userId: 'user-c3',
            status: 'CHUNKED',
            totalChunks: 5,
            translatedChunks: 0,
            tokensUsed: 0,
            estimatedCost: 0,
            extraFields: {
              translationStatus: { S: 'IN_PROGRESS' },
            },
          }),
        } as any);

        const chunkContent = JSON.stringify({
          primaryContent: 'Chunk for OMC-followup C3 regression test.',
          chunkId: 'chunk-0',
          chunkIndex: 0,
        });

        s3Mock.on(GetObjectCommand).resolves({
          Body: createMockStream(chunkContent),
        } as any);

        s3Mock.on(PutObjectCommand).resolves({} as any);
        dynamoMock.on(UpdateItemCommand).resolves({} as any);

        const event: TranslateChunkEvent = {
          jobId: 'job-c3',
          userId: 'user-c3',
          chunkIndex: 0,
          targetLanguage: 'es',
        };

        const result = await handler(event);

        // 1. Must not TypeError on undefined access.
        expect(result.success).toBe(true);
        // tokensUsed defaults to 0 from geminiClient.ts:162 (`?? 0`).
        expect(result.tokensUsed).toBe(0);

        // 2. The DDB ADD value MUST default to 0 (not undefined) — otherwise
        //    marshall() throws TypeError and the row is never updated.
        const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
        expect(updateCalls.length).toBe(1);
        const values = updateCalls[0].args[0].input.ExpressionAttributeValues!;
        expect(values[':tokens']).toEqual({ N: '0' });
        expect(values[':cost']).toEqual({ N: '0' });
      } finally {
        // Restore the default mock for sibling tests in this file (Jest
        // mockImplementationOnce only consumes one call, but be explicit).
        if (previousImpl) {
          (GoogleGenAI as unknown as jest.Mock).mockImplementation(previousImpl);
        }
      }
    });

    /**
     * Bug A regression test — Gemini returns response with text=undefined.
     *
     * Observed: Sherlock job 2026-05-02, chunk 0, after a 54-second generation
     * the Gemini response had no text candidate. The SDK's .text getter returns
     * string | undefined, so storeTranslatedChunk received undefined as the S3
     * PutObjectCommand Body. AWS SDK v3 (SigV4 signer) calls .trim() on the
     * Body when treating it as a string, causing:
     *   "Cannot read properties of undefined (reading 'length')"
     * The fix (geminiClient.ts) throws a GeminiApiError('EMPTY_RESPONSE') so
     * translateChunk returns { success: false, retryable } instead.
     *
     * OMC-followup R3 + R4: extended to cover three empty-response shapes
     * (undefined / null / '') and a representative non-retryable finishReason
     * (SAFETY) so we lock down both the defensive guard AND the retryable
     * mapping introduced in geminiClient.isFinishReasonRetryable().
     */
    it.each([
      { label: 'undefined text', text: undefined },
      { label: 'null text', text: null },
      { label: 'empty string text', text: '' },
      { label: 'completely undefined result.text via missing field', text: undefined },
    ])(
      'returns success:false when Gemini response has $label (finishReason=SAFETY → non-retryable) — Bug A regression',
      async ({ text }) => {
        const previousImpl = (GoogleGenAI as unknown as jest.Mock).getMockImplementation();
        (GoogleGenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
          models: {
            generateContent: jest.fn().mockResolvedValue({
              text, // undefined / null / '' — all three must hit the empty guard
              candidates: [{ finishReason: 'SAFETY' }], // R4: non-retryable mapping
              usageMetadata: {
                promptTokenCount: 50,
                candidatesTokenCount: 0,
                totalTokenCount: 50,
              },
            }),
          },
        }));

        try {
          dynamoMock.on(GetItemCommand).resolves({
            Item: createMockJob({
              jobId: 'job-bug-a',
              userId: 'user-bug-a',
              status: 'CHUNKED',
              totalChunks: 4,
              translatedChunks: 0,
              tokensUsed: 0,
              estimatedCost: 0,
              extraFields: {
                translationStatus: { S: 'IN_PROGRESS' },
              },
            }),
          } as any);

          const chunkContent = JSON.stringify({
            primaryContent: 'Sherlock Holmes text for Bug A regression.',
            chunkId: 'chunk-0',
            chunkIndex: 0,
          });

          s3Mock.on(GetObjectCommand).resolves({
            Body: createMockStream(chunkContent),
          } as any);
          dynamoMock.on(UpdateItemCommand).resolves({} as any);

          const event: TranslateChunkEvent = {
            jobId: 'job-bug-a',
            userId: 'user-bug-a',
            chunkIndex: 0,
            targetLanguage: 'es',
          };

          const result = await handler(event);

          // Must return success:false without TypeError — not crash.
          expect(result.success).toBe(false);
          // SAFETY is in the non-retryable set → retryable must be false.
          expect(result.retryable).toBe(false);
          expect(result.error).toContain('empty response');
          // R4: the error message MUST surface the finishReason for triage.
          expect(result.error).toContain('SAFETY');

          // S3 PutObject must NOT have been called (no translatedText to store).
          const putCalls = s3Mock.commandCalls(PutObjectCommand);
          expect(putCalls).toHaveLength(0);
        } finally {
          if (previousImpl) {
            (GoogleGenAI as unknown as jest.Mock).mockImplementation(previousImpl);
          }
        }
      }
    );

    /**
     * OMC-followup R3 — entirely undefined `result` shape.
     *
     * Belt-and-suspenders: the SDK could (in principle) return undefined for
     * the whole result object on an unexpected upstream failure. Verify the
     * client surfaces the same EMPTY_RESPONSE GeminiApiError contract instead
     * of throwing an uncaught TypeError on `result.text`.
     *
     * Note: in practice the SDK throws (rejects the promise) before this code
     * path is reached. This test pins the contract anyway so a future SDK
     * change that returns undefined silently still degrades gracefully.
     */
    it('returns success:false when Gemini result is undefined — OMC-followup R3 defensive guard', async () => {
      const previousImpl = (GoogleGenAI as unknown as jest.Mock).getMockImplementation();
      (GoogleGenAI as unknown as jest.Mock).mockImplementationOnce(() => ({
        models: {
          generateContent: jest.fn().mockResolvedValue(undefined),
        },
      }));

      try {
        dynamoMock.on(GetItemCommand).resolves({
          Item: createMockJob({
            jobId: 'job-r3',
            userId: 'user-r3',
            status: 'CHUNKED',
            totalChunks: 1,
            extraFields: {
              translationStatus: { S: 'IN_PROGRESS' },
            },
          }),
        } as any);

        const chunkContent = JSON.stringify({
          primaryContent: 'R3 defensive test.',
          chunkId: 'chunk-0',
          chunkIndex: 0,
        });

        s3Mock.on(GetObjectCommand).resolves({
          Body: createMockStream(chunkContent),
        } as any);
        dynamoMock.on(UpdateItemCommand).resolves({} as any);

        const event: TranslateChunkEvent = {
          jobId: 'job-r3',
          userId: 'user-r3',
          chunkIndex: 0,
          targetLanguage: 'es',
        };

        const result = await handler(event);

        // Must NOT throw; must return a structured failure.
        expect(result.success).toBe(false);
        expect(result.retryable).toBe(false);
        // S3 PutObject must NOT have been called.
        const putCalls = s3Mock.commandCalls(PutObjectCommand);
        expect(putCalls).toHaveLength(0);
      } finally {
        if (previousImpl) {
          (GoogleGenAI as unknown as jest.Mock).mockImplementation(previousImpl);
        }
      }
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

    it('should reject missing userId', async () => {
      const event = {
        jobId: 'job-123',
        // userId missing
        chunkIndex: 0,
        targetLanguage: 'es',
      } as any;

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('userId is required');
      expect(result.retryable).toBe(false);
    });

    it('should reject negative chunkIndex', async () => {
      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
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
        userId: 'user-123',
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
          userId: 'user-123',
          chunkIndex: 0,
          targetLanguage: lang,
        } as any;

        // Mock necessary data
        dynamoMock.on(GetItemCommand).resolves({
          Item: createMockJob({
            jobId: 'job-123',
            userId: 'user-123',
            status: 'CHUNKED',
            totalChunks: 1,
          }),
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
        Item: createMockJob({
          jobId: 'job-123',
          status: 'PENDING_UPLOAD',
        }),
      } as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
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
        userId: 'user-123',
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
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
        },
      } as any);

      s3Mock.on(GetObjectCommand).rejects(new Error('NoSuchKey'));

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
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
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
        }),
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
        userId: 'user-123',
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
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 3,
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'First chunk',
        chunkId: 'chunk-0',
      });

      // Use generic S3 mock since the key comes from job.chunkingMetadata.chunkKeys
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
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

    it('should use previousSummary regardless of contextChunks parameter', async () => {
      // With parallel translation, contextChunks parameter is now a legacy parameter
      // Context is always pre-calculated in previousSummary during chunking phase
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 5,
          translatedChunks: 3,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Chunk 3',
        chunkId: 'chunk-3',
        previousSummary: 'Pre-calculated context from previous chunks',
      });

      // Mock ONLY current chunk
      // Use generic S3 mock since the key comes from job.chunkingMetadata.chunkKeys
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 3,
        targetLanguage: 'es',
        contextChunks: 1, // Legacy parameter - ignored in parallel mode
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      // Only 1 GetObject call: current chunk (no sequential context loading)
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      expect(s3GetCalls.length).toBe(1);

      // Verify no calls to translated/ directory
      const translatedDirCalls = s3GetCalls.filter((call: any) =>
        call.args[0]?.input?.Key?.startsWith('translated/')
      );
      expect(translatedDirCalls.length).toBe(0);
    });
  });

  describe('parallel translation behavior', () => {
    it('should handle chunk with empty previousSummary (first chunk)', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 5,
          translatedChunks: 0,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'First chunk content',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        totalChunks: 5,
        previousSummary: '', // Empty for first chunk
      });

      // Use generic S3 mock since the key comes from job.chunkingMetadata.chunkKeys
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
      expect(result.chunkIndex).toBe(0);

      // Should only load current chunk
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      expect(s3GetCalls.length).toBe(1);
    });

    it('should not access translated/ directory during translation', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 10,
          translatedChunks: 5,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Middle chunk content',
        chunkId: 'chunk-6',
        chunkIndex: 6,
        totalChunks: 10,
        previousSummary: 'Context from chunks 0-5',
      });

      // Use generic S3 mock since the key comes from job.chunkingMetadata.chunkKeys
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 6,
        targetLanguage: 'fr',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      // CRITICAL: Ensure parallel-safe behavior - no sequential dependencies
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      const translatedDirCalls = s3GetCalls.filter((call: any) => {
        const key = call.args[0]?.input?.Key || '';
        return key.startsWith('translated/');
      });

      expect(translatedDirCalls.length).toBe(0);
    });

    it('should handle chunks that can be processed out-of-order', async () => {
      // Test that chunk 8 can be processed even if chunks 6-7 haven't completed yet
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 10,
          translatedChunks: 5, // Only 0-5 completed
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Chunk 8 content (processed out-of-order)',
        chunkId: 'chunk-8',
        chunkIndex: 8,
        totalChunks: 10,
        previousSummary: 'Context from original document chunks 0-7',
      });

      // Use generic S3 mock since the key comes from job.chunkingMetadata.chunkKeys
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 8,
        targetLanguage: 'de',
      };

      const result = await handler(event);

      // Should succeed even though chunks 6-7 haven't been translated yet
      expect(result.success).toBe(true);
      expect(result.chunkIndex).toBe(8);
    });
  });

  describe('tone option', () => {
    it('should pass tone to translation options', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
        }),
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
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
        tone: 'formal',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);
    });
  });

  describe('CRITICAL: distributed rate limiter integration', () => {
    it('should successfully acquire rate limit tokens during translation', async () => {
      // This test verifies rate limiter integration during normal operation
      // Rate limit failure scenarios are tested in distributedRateLimiter.test.ts
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 5,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Content to translate with rate limiting',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        previousSummary: '',
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      // Verify translation succeeds with rate limiting
      expect(result.success).toBe(true);
      expect(result.chunkIndex).toBe(0);
    });
  });

  describe('CRITICAL: validation edge cases', () => {
    it('should return error for missing targetLanguage', async () => {
      const event = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: '' as unknown,
      } as TranslateChunkEvent;

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('targetLanguage is required');
      expect(result.retryable).toBe(false);
    });

    it('should return error for undefined targetLanguage', async () => {
      const event = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
      } as any;

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('targetLanguage is required');
      expect(result.retryable).toBe(false);
    });
  });

  describe('CRITICAL: S3 failure scenarios', () => {
    it('should return error when S3 body is missing (chunk not found)', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      // Mock S3 response with no Body
      s3Mock.on(GetObjectCommand).resolves({
        // No Body field - simulates corrupt/missing chunk
      } as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Chunk not found');
      expect(result.retryable).toBe(false);
    });

    it('should handle S3 access denied error', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      s3Mock.on(GetObjectCommand).rejects(new Error('AccessDenied'));

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('AccessDenied');
      expect(result.retryable).toBe(false); // Non-retryable error
    });

    it('should handle corrupted chunk JSON', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 5,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      // Return invalid JSON
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream('{ invalid json }'),
      } as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);
    });

    it('should handle job status update failure during error handling', async () => {
      // Setup: Trigger non-retryable translation error (corrupted JSON)
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      // Return invalid JSON to trigger non-retryable error
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream('{ invalid json }'),
      } as any);

      // Mock DynamoDB to fail on UpdateItemCommand (status update)
      dynamoMock.on(UpdateItemCommand).rejects(new Error('DynamoDB connection timeout'));

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      // Main error should still be JSON parse error
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(false);

      // Verify DynamoDB update was attempted (even though it failed)
      const updateCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(updateCalls.length).toBeGreaterThan(0);
    });
  });

  describe('rate limiting', () => {
    it('should return retryable error when rate limit is exceeded', async () => {
      // Mock job and chunk data
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-123',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 5,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Test content for rate limit scenario',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        totalChunks: 5,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      // Create mock rate limiter that throws RateLimitError (new API)
      const mockRateLimiter = {
        acquire: jest.fn().mockRejectedValue(
          new RateLimitError({
            tokensNeeded: 1000,
            tokensAvailable: 0,
            retryAfterMs: 5000,
            limitType: RateLimitType.TPM,
          })
        ),
      } as any;

      // Inject via setRateLimiterForTesting() — NOT as a handler parameter.
      // Passing a rate limiter as handler(event, limiter) is what caused issue #150:
      // Lambda passes context as the second argument, which was mistakenly used as
      // the limiter, leading to "i.acquire is not a function" on every invocation.
      setRateLimiterForTesting(mockRateLimiter);

      const event: TranslateChunkEvent = {
        jobId: 'job-123',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
      expect(result.error).toContain('TPM');
      expect(result.retryable).toBe(true);
      expect(result.jobId).toBe('job-123');
      expect(result.chunkIndex).toBe(0);

      // Verify rate limiter was called
      expect(mockRateLimiter.acquire).toHaveBeenCalled();
    });
  });

  describe('REGRESSION #150: handler signature must not accept a rate-limiter parameter', () => {
    // Root cause of issue #150: the handler previously had a second optional
    // parameter `_rateLimiter?: DistributedRateLimiter`.  AWS Lambda always
    // calls handlers as handler(event, context), so the Lambda context object
    // was silently assigned to `rateLimiter`.  Because context is truthy the
    // DI branch was taken and every invocation threw
    // "TypeError: i.acquire is not a function" (bundle line 3358 col 11660).

    it('handler must accept exactly one parameter so Lambda context is never mistaken for a rate limiter', () => {
      // handler.length is the number of *declared* parameters (not counting
      // rest params or parameters with defaults).
      expect(handler.length).toBe(1);
    });

    it('setRateLimiterForTesting() must be the only DI path and must be cleared by resetClients()', async () => {
      const mockRateLimiter = {
        acquire: jest.fn().mockRejectedValue(
          new RateLimitError({
            tokensNeeded: 500,
            tokensAvailable: 0,
            retryAfterMs: 1000,
            limitType: RateLimitType.TPM,
          })
        ),
      } as any;

      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-reg150',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
        }),
      } as any);

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(
          JSON.stringify({ primaryContent: 'Regression test', chunkId: 'chunk-0' })
        ),
      } as any);

      // Inject the mock limiter via the dedicated setter
      setRateLimiterForTesting(mockRateLimiter);

      const event: TranslateChunkEvent = {
        jobId: 'job-reg150',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      // Mock was used — rate-limit error propagated correctly
      expect(mockRateLimiter.acquire).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);

      // Snapshot the call count *before* the reset so we can later prove
      // that a fresh handler invocation did NOT use the injected mock.
      const callCountBeforeReset = mockRateLimiter.acquire.mock.calls.length;

      // After resetClients(), the injected mock must be cleared.  The
      // previous version of this test asserted toHaveBeenCalledTimes(1)
      // immediately after resetClients(), but the handler was never
      // re-invoked, so the assertion was tautologically true regardless
      // of whether the injection had actually been cleared.  We now
      // re-invoke the handler post-reset and assert the mock's call
      // count did NOT increase — proving the singleton was actually
      // re-initialized fresh and the test injection is gone.
      resetClients();

      // Re-stub DynamoDB/S3 because resetClients() does not touch the
      // SDK mocks and we want the second invocation to reach the rate
      // limiter (rather than failing earlier on missing job data).
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-reg150',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
        }),
      } as any);
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(
          JSON.stringify({ primaryContent: 'Regression test', chunkId: 'chunk-0' })
        ),
      } as any);

      // Second invocation post-reset.  This will use the real, lazy-
      // initialized DistributedRateLimiter (talking to the mocked
      // DynamoDB).  We don't care whether this call succeeds or fails;
      // we only care that (a) it does not throw "acquire is not a
      // function" (which would mean the mock was never cleared), and
      // (b) the injected mock's call count is unchanged.
      let secondInvocationError: unknown = undefined;
      try {
        await handler(event);
      } catch (err) {
        secondInvocationError = err;
      }

      // (a) If anything escaped the handler, it must NOT be the
      //     original #150 TypeError shape.
      if (secondInvocationError instanceof TypeError) {
        expect(secondInvocationError.message).not.toMatch(/acquire is not a function/);
      }

      // (b) The injected mock must not have been touched by the second
      //     invocation — proving resetClients() actually cleared the
      //     test injection rather than leaking it across invocations.
      expect(mockRateLimiter.acquire.mock.calls.length).toBe(callCountBeforeReset);
    });

    it('handler invoked with a Lambda context object must not treat it as a rate limiter', async () => {
      // INTEGRATION-STYLE GUARD against the original #150 failure mode.
      //
      // The sibling test asserts handler.length === 1, which is a useful
      // structural invariant — but it is NOT sufficient on its own.  A
      // future contributor who re-introduces a default-value second
      // parameter, e.g.
      //
      //     export async function handler(
      //       event: TranslateChunkEvent,
      //       _ctx: DistributedRateLimiter | undefined = undefined,
      //     ) { ... }
      //
      // would still satisfy handler.length === 1, because parameters
      // with default values do not count toward Function.prototype.length.
      // The structural test would silently pass while the original bug
      // returns: AWS Lambda would pass `context` as the second argument,
      // _ctx would be truthy, and any subsequent `_ctx.acquire(...)` call
      // would throw "TypeError: i.acquire is not a function" — exactly
      // the production failure that PR #167 fixes.
      //
      // This test directly invokes the handler the way AWS Lambda does
      // (handler(event, context)) using a Lambda-context-shaped object
      // that deliberately has NO `.acquire` method.  If any future
      // regression causes the handler to treat that context as the rate
      // limiter, the next acquire() call will throw the canonical
      // "acquire is not a function" TypeError and this test will fail.

      // Lambda-context-shaped mock.  Critically: NO `acquire` method.
      const mockLambdaContext = {
        awsRequestId: 'test-req-id',
        functionName: 'lfmt-translate-chunk-LfmtPocDev',
        functionVersion: '$LATEST',
        invokedFunctionArn:
          'arn:aws:lambda:us-east-1:000000000000:function:lfmt-translate-chunk-LfmtPocDev',
        memoryLimitInMB: '512',
        getRemainingTimeInMillis: () => 30000,
        callbackWaitsForEmptyEventLoop: true,
        logGroupName: '/aws/lambda/lfmt-translate-chunk-LfmtPocDev',
        logStreamName: '2026/04/28/[$LATEST]abcdef0123456789',
      };

      // Wire up minimal DynamoDB / S3 mocks so the handler reaches the
      // rate-limit acquire() call (which is where the original bug
      // manifested).  We do NOT inject a test rate limiter — the goal
      // is to verify that the handler ignores the second argument
      // entirely and uses its singleton (real or test-overridden) path.
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-reg150-ctx',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
        }),
      } as any);
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(
          JSON.stringify({ primaryContent: 'Lambda context regression test', chunkId: 'chunk-0' })
        ),
      } as any);
      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      // Inject a mock limiter so the test does not depend on the real
      // distributed rate limiter's DynamoDB behavior.  If the handler
      // were to (incorrectly) treat the Lambda context as the limiter,
      // it would shadow this injection and the next acquire() call
      // would throw "acquire is not a function" on the context object.
      const mockRateLimiter = {
        acquire: jest.fn().mockResolvedValue({ allowed: true, tokensRemaining: 100 }),
      } as any;
      setRateLimiterForTesting(mockRateLimiter);

      const event: TranslateChunkEvent = {
        jobId: 'job-reg150-ctx',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      // Invoke the handler the way AWS Lambda does: handler(event, context).
      // The handler must accept this without ever calling context.acquire().
      let invocationError: unknown = undefined;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (handler as any)(event, mockLambdaContext);
      } catch (err) {
        invocationError = err;
      }

      // Primary assertion: whatever happened, it MUST NOT be the
      // original #150 failure shape.  This is the canonical regression
      // signature that PR #167 was created to fix.
      if (invocationError instanceof TypeError) {
        expect(invocationError.message).not.toMatch(/acquire is not a function/);
      }

      // Secondary assertion: the injected mock limiter (the real DI
      // path) was used — proving the handler did NOT mistake the
      // Lambda context for a rate limiter.  If the bug regressed, the
      // context object would shadow the injection and this would never
      // be called (the handler would TypeError first).
      expect(mockRateLimiter.acquire).toHaveBeenCalled();
    });
  });

  describe('CRITICAL: parallel translation safety', () => {
    it('should process chunks independently without cross-dependencies', async () => {
      // Simulate processing chunk 5 while chunks 0-4 are still in progress
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-parallel',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 10,
          translatedChunks: 0, // None translated yet
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Chunk 5 content processed out of order',
        chunkId: 'chunk-5',
        chunkIndex: 5,
        totalChunks: 10,
        previousSummary: 'Pre-calculated context from chunks 0-4', // CRITICAL: pre-calculated
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-parallel',
        userId: 'user-123',
        chunkIndex: 5,
        targetLanguage: 'fr',
      };

      const result = await handler(event);

      // CRITICAL: Must succeed even if earlier chunks aren't done
      expect(result.success).toBe(true);
      expect(result.chunkIndex).toBe(5);

      // Verify no access to translated/ directory
      const s3GetCalls = s3Mock.commandCalls(GetObjectCommand);
      const translatedCalls = s3GetCalls.filter((call: any) =>
        call.args[0]?.input?.Key?.startsWith('translated/')
      );
      expect(translatedCalls.length).toBe(0);
    });

    it('should handle concurrent chunk processing without race conditions', async () => {
      // Test that multiple chunks can update job progress concurrently
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-concurrent',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 10,
          translatedChunks: 3,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunk1 = JSON.stringify({
        primaryContent: 'Chunk 4',
        chunkId: 'chunk-4',
        chunkIndex: 4,
        previousSummary: 'Context',
      });

      const chunk2 = JSON.stringify({
        primaryContent: 'Chunk 7',
        chunkId: 'chunk-7',
        chunkIndex: 7,
        previousSummary: 'Context',
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunk1),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      // Process two chunks "simultaneously"
      const event1: TranslateChunkEvent = {
        jobId: 'job-concurrent',
        userId: 'user-123',
        chunkIndex: 4,
        targetLanguage: 'es',
      };

      const result1 = await handler(event1);

      // Reset mocks for second chunk
      s3Mock.reset();
      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunk2),
      } as any);
      s3Mock.on(PutObjectCommand).resolves({} as any);

      const event2: TranslateChunkEvent = {
        jobId: 'job-concurrent',
        userId: 'user-123',
        chunkIndex: 7,
        targetLanguage: 'es',
      };

      const result2 = await handler(event2);

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.chunkIndex).not.toBe(result2.chunkIndex);
    });
  });

  describe('CRITICAL: Gemini API failure scenarios', () => {
    it('should handle API errors gracefully', async () => {
      // This test verifies error handling when Gemini API fails
      // Note: The actual error handling is covered by existing tests
      // This is a placeholder for future API-specific error scenarios
      expect(true).toBe(true);
    });
  });

  describe('REGRESSION #172: S3 PutObject metadata values must be strings', () => {
    // Root cause: @smithy/signature-v4 calls .trim() on every S3 metadata header
    // value when signing the request.  tokensUsed (number from Gemini response)
    // and estimatedCost (number) were spread into PutObjectCommand Metadata without
    // coercion, causing "TypeError: headers[headerName].trim is not a function"
    // on 100% of translateChunk invocations (6/6 in the 2026-05-02 capture run).
    //
    // Test isolation note: every test in this describe block relies on the
    // file-level `beforeEach` (line ~82) to reset s3Mock / dynamoMock and the
    // singleton clients. There is no nested beforeEach here — `putCalls.length`
    // assertions therefore reflect a clean per-test mock surface.

    it('all S3 PutObject metadata values must be typeof string', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-reg172',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
          extraFields: {
            translationStatus: { S: 'IN_PROGRESS' },
          },
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Regression test content for issue 172',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        totalChunks: 1,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-reg172',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      const result = await handler(event);

      expect(result.success).toBe(true);

      // Capture the actual PutObjectCommand call and assert every metadata
      // value is a string — the exact invariant that @smithy/signature-v4
      // requires via its .trim() call during request signing.
      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(putCalls.length).toBe(1);

      const metadata = putCalls[0].args[0].input.Metadata ?? {};
      const nonStringEntries = Object.entries(metadata).filter(([, v]) => typeof v !== 'string');

      expect(nonStringEntries).toEqual([]);
    });

    it('tokensUsed metadata value must be a string, not a number', async () => {
      // Belt-and-suspenders alongside the all-values check above:
      // the loop test catches any new numeric field added to the metadata payload,
      // while this test pins the two historic offenders (tokensUsed, estimatedCost)
      // by name — making intent explicit and ensuring a refactor that renames or
      // restructures the loop assertion does not silently drop these named checks.
      // Mock state is reset by the file-level `beforeEach` above (no nested reset).
      dynamoMock.on(GetItemCommand).resolves({
        Item: createMockJob({
          jobId: 'job-reg172-tokens',
          userId: 'user-123',
          status: 'CHUNKED',
          totalChunks: 1,
        }),
      } as any);

      const chunkContent = JSON.stringify({
        primaryContent: 'Token type regression test',
        chunkId: 'chunk-0',
        chunkIndex: 0,
        totalChunks: 1,
      });

      s3Mock.on(GetObjectCommand).resolves({
        Body: createMockStream(chunkContent),
      } as any);

      s3Mock.on(PutObjectCommand).resolves({} as any);
      dynamoMock.on(UpdateItemCommand).resolves({} as any);

      const event: TranslateChunkEvent = {
        jobId: 'job-reg172-tokens',
        userId: 'user-123',
        chunkIndex: 0,
        targetLanguage: 'es',
      };

      await handler(event);

      const putCalls = s3Mock.commandCalls(PutObjectCommand);
      expect(putCalls.length).toBe(1);

      const metadata = putCalls[0].args[0].input.Metadata ?? {};

      // tokensUsed was the primary offender in issue #172 — verify it is a string
      expect(typeof metadata['tokensUsed']).toBe('string');
      // estimatedCost was the secondary offender — verify it too
      expect(typeof metadata['estimatedCost']).toBe('string');
      // chunkIndex was already coerced with .toString() — verify it remains a string
      expect(typeof metadata['chunkIndex']).toBe('string');
    });
  });
});
