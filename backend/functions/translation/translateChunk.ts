/**
 * Translate Chunk Lambda Function
 * Translates individual document chunks using Gemini API
 * Manages context from previous chunks for translation continuity
 */

import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandOutput,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { GeminiClient } from './geminiClient';
import { DistributedRateLimiter } from '../shared/distributedRateLimiter';
import { GEMINI_RATE_LIMITS, RateLimitType } from '../shared/types/rateLimiting';
import { TranslationOptions, TranslationContext, GeminiApiError } from './types';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { countTokens } from '../shared/tokenizer';

const logger = new Logger('lfmt-translate-chunk');
const dynamoClient = new DynamoDBClient({});
const s3Client = new S3Client({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const CHUNKS_BUCKET = getRequiredEnv('CHUNKS_BUCKET');
const GEMINI_API_KEY_SECRET = getRequiredEnv('GEMINI_API_KEY_SECRET_NAME');
const RATE_LIMIT_BUCKETS_TABLE = getRequiredEnv('RATE_LIMIT_BUCKETS_TABLE');

// Singleton instances (reused across invocations)
let geminiClient: GeminiClient | null = null;
let distributedRateLimiter: DistributedRateLimiter | null = null;

/**
 * Reset singleton instances (for testing)
 */
export function resetClients(): void {
  geminiClient = null;
  distributedRateLimiter = null;
}

/**
 * Lambda event structure for chunk translation
 */
export interface TranslateChunkEvent {
  jobId: string;
  userId: string;
  chunkIndex: number;
  targetLanguage: string;
  tone?: 'formal' | 'informal' | 'neutral';
  contextChunks?: number; // Number of previous chunks to use as context (default: 2)
}

/**
 * Lambda response structure
 */
export interface TranslateChunkResponse {
  success: boolean;
  jobId: string;
  chunkIndex: number;
  translatedKey?: string;
  tokensUsed?: number;
  estimatedCost?: number;
  processingTimeMs: number;
  error?: string;
  retryable?: boolean;
}

/**
 * Lambda handler for translating a single chunk
 */
export const handler = async (
  event: TranslateChunkEvent
): Promise<TranslateChunkResponse> => {
  const startTime = Date.now();

  logger.info('Starting chunk translation', {
    jobId: event.jobId,
    chunkIndex: event.chunkIndex,
    targetLanguage: event.targetLanguage,
  });

  try {
    // Initialize clients (singleton pattern for Lambda container reuse)
    if (!geminiClient) {
      geminiClient = new GeminiClient({
        apiKeySecretName: GEMINI_API_KEY_SECRET,
        model: 'gemini-1.5-pro',
        maxRetries: 3,
      });
      await geminiClient.initialize();
    }

    if (!distributedRateLimiter) {
      distributedRateLimiter = new DistributedRateLimiter({
        tableName: RATE_LIMIT_BUCKETS_TABLE,
        apiId: GEMINI_RATE_LIMITS.apiId,
        rpm: GEMINI_RATE_LIMITS.rpm,
        tpm: GEMINI_RATE_LIMITS.tpm,
        rpd: GEMINI_RATE_LIMITS.rpd,
      });
    }

    // Validate input
    validateEvent(event);

    // Load job metadata from DynamoDB
    const job = await loadJob(event.jobId, event.userId);

    // Verify job is in correct state
    if (job.status !== 'CHUNKED' && job.translationStatus !== 'IN_PROGRESS') {
      throw new Error(
        `Job ${event.jobId} is not ready for translation (status: ${job.status})`
      );
    }

    // Load current chunk from S3 (includes pre-calculated previousSummary)
    const chunk = await loadChunk(job, event.chunkIndex);

    // Use pre-calculated context from chunk metadata (parallel-safe)
    // This eliminates sequential dependency on previous chunk translations
    const context: TranslationContext = {
      previousChunks: chunk.previousSummary ? [chunk.previousSummary] : [],
      contextTokens: chunk.previousSummary ? countTokens(chunk.previousSummary) : 0,
    };

    // Estimate token count for rate limiting
    const estimatedTokens = estimateTokens(chunk.primaryContent, context);

    logger.info('Estimated token usage', {
      estimatedTokens,
      chunkIndex: event.chunkIndex,
      contextTokens: context.contextTokens,
      hasContext: context.previousChunks.length > 0,
    });

    // Acquire rate limit tokens before making API call
    const rateLimitAcquire = await distributedRateLimiter.acquire(
      estimatedTokens,
      RateLimitType.TPM
    );

    if (!rateLimitAcquire.success) {
      logger.warn('Rate limit exceeded, returning retryable error', {
        error: rateLimitAcquire.error,
        retryAfterMs: rateLimitAcquire.retryAfterMs,
        tokensRemaining: rateLimitAcquire.tokensRemaining,
      });

      return {
        success: false,
        jobId: event.jobId,
        chunkIndex: event.chunkIndex,
        processingTimeMs: Date.now() - startTime,
        error: `Rate limit exceeded: ${rateLimitAcquire.error}`,
        retryable: true,
      };
    }

    // Translate the chunk
    const translationOptions: TranslationOptions = {
      targetLanguage: event.targetLanguage as any,
      tone: event.tone,
      preserveFormatting: true,
    };

    const result = await geminiClient.translate(
      chunk.primaryContent,
      translationOptions,
      context
    );

    logger.info('Translation completed', {
      jobId: event.jobId,
      chunkIndex: event.chunkIndex,
      tokensUsed: result.tokensUsed.total,
      estimatedCost: result.estimatedCost,
      processingTimeMs: result.processingTimeMs,
    });

    // Store translated chunk to S3
    const translatedKey = await storeTranslatedChunk(
      event.jobId,
      event.chunkIndex,
      result.translatedText,
      {
        sourceLanguage: 'en', // Assuming English source
        targetLanguage: event.targetLanguage,
        tokensUsed: result.tokensUsed.total,
        estimatedCost: result.estimatedCost,
        translatedAt: new Date().toISOString(),
      }
    );

    // Update job progress in DynamoDB
    await updateJobProgress(event.jobId, event.userId, {
      translatedChunks: (job.translatedChunks || 0) + 1,
      totalChunks: job.totalChunks,
      tokensUsed: (job.tokensUsed || 0) + result.tokensUsed.total,
      estimatedCost: (job.estimatedCost || 0) + result.estimatedCost,
    });

    return {
      success: true,
      jobId: event.jobId,
      chunkIndex: event.chunkIndex,
      translatedKey,
      tokensUsed: result.tokensUsed.total,
      estimatedCost: result.estimatedCost,
      processingTimeMs: Date.now() - startTime,
    };
  } catch (error) {
    const processingTimeMs = Date.now() - startTime;

    logger.error('Chunk translation failed', {
      jobId: event.jobId,
      chunkIndex: event.chunkIndex,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      processingTimeMs,
    });

    // Determine if error is retryable
    const retryable =
      error instanceof GeminiApiError ? error.retryable : false;

    // Update job status if error is not retryable and we have a valid jobId and userId
    if (!retryable && event.jobId && event.userId) {
      try {
        await updateJobStatus(event.jobId, event.userId, 'TRANSLATION_FAILED', {
          error: error instanceof Error ? error.message : 'Unknown error',
          failedAt: new Date().toISOString(),
        });
      } catch (updateError) {
        logger.error('Failed to update job status after translation error', {
          jobId: event.jobId,
          updateError: updateError instanceof Error ? updateError.message : 'Unknown error',
        });
      }
    }

    return {
      success: false,
      jobId: event.jobId,
      chunkIndex: event.chunkIndex,
      processingTimeMs,
      error: error instanceof Error ? error.message : 'Unknown error',
      retryable,
    };
  }
};

/**
 * Validate translation event
 */
function validateEvent(event: TranslateChunkEvent): void {
  if (!event.jobId) {
    throw new Error('jobId is required');
  }

  if (!event.userId) {
    throw new Error('userId is required');
  }

  if (event.chunkIndex === undefined || event.chunkIndex < 0) {
    throw new Error('chunkIndex must be a non-negative integer');
  }

  if (!event.targetLanguage) {
    throw new Error('targetLanguage is required');
  }

  const validLanguages = ['es', 'fr', 'it', 'de', 'zh'];
  if (!validLanguages.includes(event.targetLanguage)) {
    throw new Error(
      `Invalid targetLanguage: ${event.targetLanguage}. Must be one of: ${validLanguages.join(', ')}`
    );
  }
}

/**
 * Load job metadata from DynamoDB
 * Uses composite primary key (jobId, userId)
 */
async function loadJob(jobId: string, userId: string): Promise<any> {
  const command = new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
  });

  const response: GetItemCommandOutput = await dynamoClient.send(command);

  if (!response.Item) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return unmarshall(response.Item);
}

/**
 * Load chunk content from S3
 * Uses the actual S3 key from job.chunkingMetadata.chunkKeys array
 */
async function loadChunk(
  job: any,
  chunkIndex: number
): Promise<{ primaryContent: string; chunkId: string; previousSummary: string }> {
  // Get the actual S3 key from job metadata
  const chunkKeys = job.chunkingMetadata?.chunkKeys || [];

  if (!chunkKeys[chunkIndex]) {
    throw new Error(`Chunk key not found for index ${chunkIndex}. Job may not be fully chunked.`);
  }

  const key = chunkKeys[chunkIndex];

  logger.debug('Loading chunk from S3', { key, chunkIndex });

  const command = new GetObjectCommand({
    Bucket: CHUNKS_BUCKET,
    Key: key,
  });

  const response: GetObjectCommandOutput = await s3Client.send(command);

  if (!response.Body) {
    throw new Error(`Chunk not found: ${key}`);
  }

  const bodyString = await response.Body.transformToString();
  const chunk = JSON.parse(bodyString);

  return {
    primaryContent: chunk.primaryContent,
    chunkId: chunk.chunkId,
    previousSummary: chunk.previousSummary || '', // Pre-calculated context from chunking phase
  };
}

/**
 * Load translation context from previous translated chunks
 * DEPRECATED: This function is no longer used in parallel translation mode.
 * Context is now pre-calculated during chunking phase and stored in chunk.previousSummary.
 * Keeping this function for reference only - it will be removed in future cleanup.
 */

/**
 * Estimate total tokens for rate limiting
 */
function estimateTokens(content: string, context: TranslationContext): number {
  const contentTokens = countTokens(content);
  const contextTokens = context.contextTokens;
  const promptOverhead = 200; // Estimated tokens for prompt instructions

  return contentTokens + contextTokens + promptOverhead;
}

/**
 * Store translated chunk to S3
 */
async function storeTranslatedChunk(
  jobId: string,
  chunkIndex: number,
  translatedText: string,
  metadata: Record<string, any>
): Promise<string> {
  const key = `translated/${jobId}/chunk-${chunkIndex}.txt`;

  logger.debug('Storing translated chunk to S3', { key });

  const command = new PutObjectCommand({
    Bucket: CHUNKS_BUCKET,
    Key: key,
    Body: translatedText,
    ContentType: 'text/plain; charset=utf-8',
    Metadata: {
      ...metadata,
      chunkIndex: chunkIndex.toString(),
      jobId,
    },
  });

  await s3Client.send(command);

  logger.info('Translated chunk stored', { key, size: translatedText.length });

  return key;
}

/**
 * Update job progress in DynamoDB
 */
async function updateJobProgress(
  jobId: string,
  userId: string,
  progress: {
    translatedChunks: number;
    totalChunks: number;
    tokensUsed: number;
    estimatedCost: number;
  }
): Promise<void> {
  const translationStatus =
    progress.translatedChunks >= progress.totalChunks
      ? 'COMPLETED'
      : 'IN_PROGRESS';

  const command = new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    UpdateExpression:
      'SET translationStatus = :status, translatedChunks = :translated, tokensUsed = :tokens, estimatedCost = :cost, updatedAt = :updatedAt',
    ExpressionAttributeValues: marshall({
      ':status': translationStatus,
      ':translated': progress.translatedChunks,
      ':tokens': progress.tokensUsed,
      ':cost': progress.estimatedCost,
      ':updatedAt': new Date().toISOString(),
    }),
  });

  await dynamoClient.send(command);

  logger.info('Job progress updated', {
    jobId,
    userId,
    translatedChunks: progress.translatedChunks,
    totalChunks: progress.totalChunks,
    translationStatus,
  });
}

/**
 * Update job status in DynamoDB
 */
async function updateJobStatus(
  jobId: string,
  userId: string,
  status: string,
  additionalData: Record<string, any> = {}
): Promise<void> {
  const updateExpression = ['SET #status = :status, updatedAt = :updatedAt'];
  const expressionAttributeNames: Record<string, string> = {
    '#status': 'status',
  };
  const expressionAttributeValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  // Add additional fields
  Object.entries(additionalData).forEach(([key, value], index) => {
    const placeholder = `:val${index}`;
    const attributeName = `#attr${index}`;
    updateExpression.push(`${attributeName} = ${placeholder}`);
    expressionAttributeNames[attributeName] = key;
    expressionAttributeValues[placeholder] = value;
  });

  const command = new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    UpdateExpression: updateExpression.join(', '),
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: marshall(expressionAttributeValues),
  });

  await dynamoClient.send(command);

  logger.info('Job status updated', { jobId, userId, status });
}
