/**
 * Rate Limiting Types
 *
 * Defines the schema for the distributed rate limiter using DynamoDB.
 * Supports token bucket algorithm with atomic conditional writes to coordinate
 * rate limits across multiple concurrent Lambda instances.
 */

/**
 * DynamoDB Rate Limit Bucket Item
 *
 * Represents a token bucket for a specific API rate limit (RPM, TPM, or RPD).
 * Uses atomic conditional writes to prevent race conditions when multiple
 * Lambda instances request tokens simultaneously.
 */
export interface RateLimitBucketItem {
  /**
   * Partition key: Unique identifier for the rate limit bucket
   * Examples: "gemini-api-rpm", "gemini-api-tpm", "gemini-api-rpd"
   */
  bucketKey: string;

  /**
   * Current number of tokens available in the bucket
   * For RPM (requests per minute): 0-5
   * For TPM (tokens per minute): 0-250000
   * For RPD (requests per day): 0-25
   */
  tokensAvailable: number;

  /**
   * Maximum capacity of the bucket (refill limit)
   * RPM: 5 requests per minute
   * TPM: 250000 tokens per minute
   * RPD: 25 requests per day
   */
  maxCapacity: number;

  /**
   * Rate at which tokens refill (per second)
   * RPM: 5/60 = 0.0833 requests/second
   * TPM: 250000/60 = 4166.67 tokens/second
   * RPD: 25/86400 = 0.000289 requests/second
   */
  refillRate: number;

  /**
   * Unix timestamp (seconds) of the last bucket refill
   * Used to calculate how many tokens to add based on elapsed time
   */
  lastRefillTimestamp: number;

  /**
   * Unix timestamp (seconds) when the current time window started
   * For RPM/TPM: Start of current minute
   * For RPD: Start of current day (midnight UTC)
   */
  windowStartTimestamp: number;

  /**
   * TTL (Time To Live) for automatic DynamoDB cleanup
   * Set to 7 days after last access to minimize storage costs
   * Unix timestamp in seconds
   */
  ttl: number;

  /**
   * ISO 8601 timestamp of when the bucket was created
   */
  createdAt: string;

  /**
   * ISO 8601 timestamp of when the bucket was last updated
   */
  updatedAt: string;

  /**
   * Version number for optimistic locking
   * Incremented on each update to detect concurrent modifications
   */
  version: number;
}

/**
 * Rate limit types supported by the system
 */
export enum RateLimitType {
  /** Requests Per Minute */
  RPM = 'rpm',
  /** Tokens Per Minute */
  TPM = 'tpm',
  /** Requests Per Day */
  RPD = 'rpd',
}

/**
 * Rate limit configuration for a specific API
 */
export interface RateLimitConfig {
  /** API identifier (e.g., "gemini-api") */
  apiId: string;
  /** Requests per minute limit */
  rpm: number;
  /** Tokens per minute limit */
  tpm: number;
  /** Requests per day limit */
  rpd: number;
}

/**
 * Result of a token acquisition attempt
 */
export interface TokenAcquisitionResult {
  /** Whether tokens were successfully acquired */
  success: boolean;
  /** Number of tokens acquired (0 if unsuccessful) */
  tokensAcquired: number;
  /** Number of tokens remaining in the bucket after acquisition */
  tokensRemaining: number;
  /** If unsuccessful, milliseconds to wait before retrying */
  retryAfterMs?: number;
  /** Error message if unsuccessful */
  error?: string;
}

/**
 * Gemini API Rate Limits (Free Tier)
 * Source: https://ai.google.dev/gemini-api/docs/models/gemini#model-variations
 */
export const GEMINI_RATE_LIMITS: RateLimitConfig = {
  apiId: 'gemini-api',
  rpm: 5,       // 5 requests per minute
  tpm: 250000,  // 250K tokens per minute (combined input + output)
  rpd: 25,      // 25 requests per day
};
