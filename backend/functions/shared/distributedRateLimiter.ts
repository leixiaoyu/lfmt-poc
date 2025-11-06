/**
 * Distributed Rate Limiter
 *
 * Implements a distributed token bucket algorithm using DynamoDB to coordinate
 * API rate limits across multiple concurrent Lambda instances.
 *
 * This implementation supports:
 * - Atomic token acquisition with conditional writes to prevent race conditions
 * - Time-based token refill (continuous replenishment)
 * - Multiple rate limit types (RPM, TPM, RPD)
 * - Fallback to per-instance rate limiting on DynamoDB errors
 * - Exponential backoff retry logic
 *
 * OpenSpec: enable-parallel-translation/specs/rate-limiting/spec.md
 */

import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandOutput,
  PutItemCommand,
  UpdateItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  RateLimitBucketItem,
  RateLimitConfig,
  RateLimitType,
  TokenAcquisitionResult,
  GEMINI_RATE_LIMITS,
} from './types/rateLimiting';

/**
 * Configuration for the distributed rate limiter
 */
export interface DistributedRateLimiterConfig extends RateLimitConfig {
  /** DynamoDB table name for rate limit buckets */
  tableName: string;
  /** Maximum number of retry attempts for conditional writes */
  maxRetries?: number;
  /** Enable fallback to per-instance rate limiting on DynamoDB errors */
  enableFallback?: boolean;
}

/**
 * Per-instance token bucket for fallback rate limiting
 */
interface FallbackBucket {
  tokensAvailable: number;
  lastRefillTimestamp: number;
  windowStartTimestamp: number;
}

/**
 * Distributed Rate Limiter
 *
 * Coordinates API rate limits across multiple Lambda instances using DynamoDB.
 */
export class DistributedRateLimiter {
  private readonly dynamoClient: DynamoDBClient;
  private readonly config: Required<DistributedRateLimiterConfig>;
  private readonly fallbackBuckets: Map<string, FallbackBucket> = new Map();

  constructor(config: DistributedRateLimiterConfig) {
    this.config = {
      maxRetries: 3,
      enableFallback: true,
      ...config,
    };
    this.dynamoClient = new DynamoDBClient({});
  }

  /**
   * Acquire tokens from the distributed rate limit bucket
   *
   * @param tokensRequested - Number of tokens to acquire
   * @param limitType - Type of rate limit (RPM, TPM, or RPD)
   * @returns Result indicating success/failure and token availability
   */
  async acquire(
    tokensRequested: number,
    limitType: RateLimitType
  ): Promise<TokenAcquisitionResult> {
    const bucketKey = this.getBucketKey(limitType);
    let lastError: Error | undefined;

    // Retry loop for handling race conditions
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        // Get current bucket state
        const bucket = await this.getBucket(bucketKey, limitType);

        // Calculate refilled tokens
        const now = Date.now();
        const refillSeconds = (now - bucket.lastRefillTimestamp * 1000) / 1000;
        const tokensToAdd = Math.floor(refillSeconds * bucket.refillRate);

        // Check if window needs to be reset (for RPM/TPM: every minute, for RPD: daily)
        const windowDuration = this.getWindowDuration(limitType);
        const windowElapsed = now - bucket.windowStartTimestamp * 1000;
        const shouldResetWindow = windowElapsed >= windowDuration;

        // Calculate available tokens
        let availableTokens: number;
        if (shouldResetWindow) {
          // Window expired, reset to full capacity
          availableTokens = bucket.maxCapacity;
        } else {
          // Add refilled tokens up to capacity
          availableTokens = Math.min(
            bucket.tokensAvailable + tokensToAdd,
            bucket.maxCapacity
          );
        }


        // Check if sufficient tokens available
        if (availableTokens < tokensRequested) {
          const timeToRefill = (tokensRequested - availableTokens) / bucket.refillRate;
          return {
            success: false,
            tokensAcquired: 0,
            tokensRemaining: availableTokens,
            retryAfterMs: Math.ceil(timeToRefill * 1000),
            error: `Rate limit exceeded. Need ${tokensRequested}, have ${availableTokens}`,
          };
        }

        const tokensAfterAcquisition = availableTokens - tokensRequested;

        // Attempt atomic update with conditional write
        try {
          await this.updateBucketAtomic(
            bucketKey,
            tokensAfterAcquisition,
            Math.floor(now / 1000),
            shouldResetWindow ? Math.floor(now / 1000) : bucket.windowStartTimestamp,
            bucket.version
          );

          return {
            success: true,
            tokensAcquired: tokensRequested,
            tokensRemaining: tokensAfterAcquisition,
          };
        } catch (error) {
          if (error instanceof ConditionalCheckFailedException) {
            // Race condition detected, retry
            lastError = error;
            continue;
          }
          throw error;
        }
      } catch (error) {
        // DynamoDB error - try fallback if enabled
        if (this.config.enableFallback && attempt === this.config.maxRetries - 1) {
          return this.acquireFallback(tokensRequested, limitType);
        }
        lastError = error as Error;
      }
    }

    // All retries exhausted
    return {
      success: false,
      tokensAcquired: 0,
      tokensRemaining: 0,
      error: `Failed to acquire tokens after ${this.config.maxRetries} attempts: ${lastError?.message}`,
    };
  }

  /**
   * Get or initialize a rate limit bucket
   */
  private async getBucket(
    bucketKey: string,
    limitType: RateLimitType
  ): Promise<RateLimitBucketItem> {
    try {
      const result = (await this.dynamoClient.send(
        new GetItemCommand({
          TableName: this.config.tableName,
          Key: marshall({ bucketKey }),
        })
      )) as GetItemCommandOutput;

      if (result.Item) {
        return unmarshall(result.Item) as RateLimitBucketItem;
      }

      // Initialize new bucket
      return this.initializeBucket(bucketKey, limitType);
    } catch (error) {
      throw new Error(`Failed to get bucket ${bucketKey}: ${(error as Error).message}`);
    }
  }

  /**
   * Initialize a new rate limit bucket
   */
  private async initializeBucket(
    bucketKey: string,
    limitType: RateLimitType
  ): Promise<RateLimitBucketItem> {
    const now = Date.now();
    const maxCapacity = this.getMaxCapacity(limitType);
    const refillRate = this.getRefillRate(limitType);

    const bucket: RateLimitBucketItem = {
      bucketKey,
      tokensAvailable: maxCapacity,
      maxCapacity,
      refillRate,
      lastRefillTimestamp: Math.floor(now / 1000),
      windowStartTimestamp: Math.floor(now / 1000),
      ttl: Math.floor(now / 1000) + 7 * 24 * 60 * 60, // 7 days
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      version: 0,
    };

    try {
      await this.dynamoClient.send(
        new PutItemCommand({
          TableName: this.config.tableName,
          Item: marshall(bucket),
          ConditionExpression: 'attribute_not_exists(bucketKey)',
        })
      );
    } catch (error) {
      // Bucket was created by another instance, fetch it
      if (error instanceof ConditionalCheckFailedException) {
        const result = (await this.dynamoClient.send(
          new GetItemCommand({
            TableName: this.config.tableName,
            Key: marshall({ bucketKey }),
          })
        )) as GetItemCommandOutput;
        if (result.Item) {
          return unmarshall(result.Item) as RateLimitBucketItem;
        }
      }
      throw error;
    }

    return bucket;
  }

  /**
   * Update bucket with atomic conditional write
   */
  private async updateBucketAtomic(
    bucketKey: string,
    tokensAvailable: number,
    lastRefillTimestamp: number,
    windowStartTimestamp: number,
    expectedVersion: number
  ): Promise<void> {
    const now = Date.now();

    await this.dynamoClient.send(
      new UpdateItemCommand({
        TableName: this.config.tableName,
        Key: marshall({ bucketKey }),
        UpdateExpression:
          'SET tokensAvailable = :tokens, lastRefillTimestamp = :lastRefill, ' +
          'windowStartTimestamp = :windowStart, #version = :newVersion, ' +
          'updatedAt = :updatedAt, #ttl = :ttl',
        ConditionExpression: '#version = :expectedVersion',
        ExpressionAttributeNames: {
          '#version': 'version',
          '#ttl': 'ttl',
        },
        ExpressionAttributeValues: marshall({
          ':tokens': tokensAvailable,
          ':lastRefill': lastRefillTimestamp,
          ':windowStart': windowStartTimestamp,
          ':newVersion': expectedVersion + 1,
          ':expectedVersion': expectedVersion,
          ':updatedAt': new Date(now).toISOString(),
          ':ttl': Math.floor(now / 1000) + 7 * 24 * 60 * 60, // Reset TTL to 7 days
        }),
      })
    );
  }

  /**
   * Fallback to per-instance rate limiting when DynamoDB is unavailable
   */
  private acquireFallback(
    tokensRequested: number,
    limitType: RateLimitType
  ): TokenAcquisitionResult {
    const bucketKey = this.getBucketKey(limitType);
    let bucket = this.fallbackBuckets.get(bucketKey);

    if (!bucket) {
      // Initialize fallback bucket
      bucket = {
        tokensAvailable: this.getMaxCapacity(limitType),
        lastRefillTimestamp: Math.floor(Date.now() / 1000),
        windowStartTimestamp: Math.floor(Date.now() / 1000),
      };
      this.fallbackBuckets.set(bucketKey, bucket);
    }

    // Refill tokens
    const now = Date.now();
    const refillSeconds = (now - bucket.lastRefillTimestamp * 1000) / 1000;
    const tokensToAdd = Math.floor(refillSeconds * this.getRefillRate(limitType));
    bucket.tokensAvailable = Math.min(
      bucket.tokensAvailable + tokensToAdd,
      this.getMaxCapacity(limitType)
    );
    bucket.lastRefillTimestamp = Math.floor(now / 1000);

    // Check window reset
    const windowDuration = this.getWindowDuration(limitType);
    const windowElapsed = now - bucket.windowStartTimestamp * 1000;
    if (windowElapsed >= windowDuration) {
      bucket.tokensAvailable = this.getMaxCapacity(limitType);
      bucket.windowStartTimestamp = Math.floor(now / 1000);
    }

    // Acquire tokens
    if (bucket.tokensAvailable < tokensRequested) {
      const timeToRefill =
        (tokensRequested - bucket.tokensAvailable) / this.getRefillRate(limitType);
      return {
        success: false,
        tokensAcquired: 0,
        tokensRemaining: bucket.tokensAvailable,
        retryAfterMs: Math.ceil(timeToRefill * 1000),
        error: `Rate limit exceeded (fallback mode). Need ${tokensRequested}, have ${bucket.tokensAvailable}`,
      };
    }

    bucket.tokensAvailable -= tokensRequested;
    return {
      success: true,
      tokensAcquired: tokensRequested,
      tokensRemaining: bucket.tokensAvailable,
    };
  }

  /**
   * Generate bucket key for a specific rate limit type
   */
  private getBucketKey(limitType: RateLimitType): string {
    return `${this.config.apiId}-${limitType}`;
  }

  /**
   * Get maximum capacity for a rate limit type
   */
  private getMaxCapacity(limitType: RateLimitType): number {
    switch (limitType) {
      case RateLimitType.RPM:
        return this.config.rpm;
      case RateLimitType.TPM:
        return this.config.tpm;
      case RateLimitType.RPD:
        return this.config.rpd;
    }
  }

  /**
   * Get refill rate (tokens per second) for a rate limit type
   */
  private getRefillRate(limitType: RateLimitType): number {
    switch (limitType) {
      case RateLimitType.RPM:
        return this.config.rpm / 60; // requests per second
      case RateLimitType.TPM:
        return this.config.tpm / 60; // tokens per second
      case RateLimitType.RPD:
        return this.config.rpd / 86400; // requests per second (24 hours)
    }
  }

  /**
   * Get window duration in milliseconds for a rate limit type
   */
  private getWindowDuration(limitType: RateLimitType): number {
    switch (limitType) {
      case RateLimitType.RPM:
      case RateLimitType.TPM:
        return 60 * 1000; // 1 minute
      case RateLimitType.RPD:
        return 24 * 60 * 60 * 1000; // 24 hours
    }
  }
}
