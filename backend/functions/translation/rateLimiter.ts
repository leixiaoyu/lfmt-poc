/**
 * Rate Limiter for Gemini API
 * Enforces free tier limits: 5 RPM, 250K TPM, 25 RPD
 */

import Logger from '../shared/logger';

const logger = new Logger('lfmt-rate-limiter');

/**
 * Rate limit configuration for Gemini API free tier
 */
export interface RateLimitConfig {
  /**
   * Requests per minute
   * @default 5
   */
  requestsPerMinute?: number;

  /**
   * Tokens per minute
   * @default 250000
   */
  tokensPerMinute?: number;

  /**
   * Requests per day
   * @default 25
   */
  requestsPerDay?: number;

  /**
   * Timezone for daily reset (IANA format)
   * @default 'America/Los_Angeles' (Pacific time for Gemini API)
   */
  dailyResetTimezone?: string;
}

/**
 * Token bucket for rate limiting
 */
interface TokenBucket {
  /**
   * Maximum capacity
   */
  capacity: number;

  /**
   * Current available tokens
   */
  tokens: number;

  /**
   * Refill rate (tokens per second)
   */
  refillRate: number;

  /**
   * Last refill timestamp (ms)
   */
  lastRefill: number;
}

/**
 * Rate limit check result
 */
export interface RateLimitCheckResult {
  /**
   * Whether the request is allowed
   */
  allowed: boolean;

  /**
   * If denied, milliseconds to wait before retry
   */
  retryAfterMs?: number;

  /**
   * Reason for denial
   */
  reason?: string;

  /**
   * Current usage statistics
   */
  usage: {
    rpm: { used: number; limit: number };
    tpm: { used: number; limit: number };
    rpd: { used: number; limit: number };
  };
}

/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
  private config: Required<RateLimitConfig>;
  private rpmBucket: TokenBucket;
  private tpmBucket: TokenBucket;
  private dailyRequestCount: number = 0;
  private dailyResetTime: number;

  constructor(config: RateLimitConfig = {}) {
    this.config = {
      requestsPerMinute: config.requestsPerMinute ?? 5,
      tokensPerMinute: config.tokensPerMinute ?? 250_000,
      requestsPerDay: config.requestsPerDay ?? 25,
      dailyResetTimezone: config.dailyResetTimezone ?? 'America/Los_Angeles',
    };

    // Initialize RPM bucket (5 requests per minute)
    this.rpmBucket = {
      capacity: this.config.requestsPerMinute,
      tokens: this.config.requestsPerMinute,
      refillRate: this.config.requestsPerMinute / 60, // tokens per second
      lastRefill: Date.now(),
    };

    // Initialize TPM bucket (250K tokens per minute)
    this.tpmBucket = {
      capacity: this.config.tokensPerMinute,
      tokens: this.config.tokensPerMinute,
      refillRate: this.config.tokensPerMinute / 60, // tokens per second
      lastRefill: Date.now(),
    };

    // Calculate next daily reset time (midnight Pacific)
    this.dailyResetTime = this.calculateNextDailyReset();

    logger.info('RateLimiter initialized', {
      rpm: this.config.requestsPerMinute,
      tpm: this.config.tokensPerMinute,
      rpd: this.config.requestsPerDay,
      timezone: this.config.dailyResetTimezone,
    });
  }

  /**
   * Check if a request with given token count is allowed
   *
   * @param estimatedTokens - Estimated tokens for the request
   * @returns Rate limit check result
   */
  checkLimit(estimatedTokens: number): RateLimitCheckResult {
    // Refill buckets based on elapsed time
    this.refillBuckets();

    // Check daily reset
    this.checkDailyReset();

    // Check daily request limit (RPD)
    if (this.dailyRequestCount >= this.config.requestsPerDay) {
      const msUntilReset = this.dailyResetTime - Date.now();
      logger.warn('Daily request limit exceeded', {
        used: this.dailyRequestCount,
        limit: this.config.requestsPerDay,
        resetInMs: msUntilReset,
      });

      return {
        allowed: false,
        retryAfterMs: msUntilReset,
        reason: 'Daily request limit (RPD) exceeded',
        usage: this.getCurrentUsage(estimatedTokens),
      };
    }

    // Check requests per minute (RPM)
    if (this.rpmBucket.tokens < 1) {
      const msUntilRefill = this.calculateRefillTime(this.rpmBucket, 1);
      logger.warn('Requests per minute limit exceeded', {
        available: this.rpmBucket.tokens,
        limit: this.config.requestsPerMinute,
        retryInMs: msUntilRefill,
      });

      return {
        allowed: false,
        retryAfterMs: msUntilRefill,
        reason: 'Requests per minute (RPM) limit exceeded',
        usage: this.getCurrentUsage(estimatedTokens),
      };
    }

    // Check tokens per minute (TPM)
    if (this.tpmBucket.tokens < estimatedTokens) {
      const msUntilRefill = this.calculateRefillTime(
        this.tpmBucket,
        estimatedTokens
      );
      logger.warn('Tokens per minute limit exceeded', {
        available: Math.floor(this.tpmBucket.tokens),
        required: estimatedTokens,
        limit: this.config.tokensPerMinute,
        retryInMs: msUntilRefill,
      });

      return {
        allowed: false,
        retryAfterMs: msUntilRefill,
        reason: 'Tokens per minute (TPM) limit exceeded',
        usage: this.getCurrentUsage(estimatedTokens),
      };
    }

    // All checks passed
    logger.debug('Rate limit check passed', {
      estimatedTokens,
      rpmAvailable: Math.floor(this.rpmBucket.tokens),
      tpmAvailable: Math.floor(this.tpmBucket.tokens),
      dailyUsed: this.dailyRequestCount,
    });

    return {
      allowed: true,
      usage: this.getCurrentUsage(estimatedTokens),
    };
  }

  /**
   * Consume rate limit quota for a request
   *
   * @param actualTokens - Actual tokens used by the request
   */
  consume(actualTokens: number): void {
    // Consume 1 request from RPM bucket
    this.rpmBucket.tokens = Math.max(0, this.rpmBucket.tokens - 1);

    // Consume tokens from TPM bucket
    this.tpmBucket.tokens = Math.max(0, this.tpmBucket.tokens - actualTokens);

    // Increment daily request count
    this.dailyRequestCount++;

    logger.info('Rate limit consumed', {
      actualTokens,
      rpmRemaining: Math.floor(this.rpmBucket.tokens),
      tpmRemaining: Math.floor(this.tpmBucket.tokens),
      dailyUsed: this.dailyRequestCount,
    });
  }

  /**
   * Get current usage statistics
   */
  getCurrentUsage(estimatedTokens: number = 0): {
    rpm: { used: number; limit: number };
    tpm: { used: number; limit: number };
    rpd: { used: number; limit: number };
  } {
    return {
      rpm: {
        used: this.config.requestsPerMinute - Math.floor(this.rpmBucket.tokens),
        limit: this.config.requestsPerMinute,
      },
      tpm: {
        used:
          this.config.tokensPerMinute -
          Math.floor(this.tpmBucket.tokens) +
          estimatedTokens,
        limit: this.config.tokensPerMinute,
      },
      rpd: {
        used: this.dailyRequestCount,
        limit: this.config.requestsPerDay,
      },
    };
  }

  /**
   * Reset rate limiter (for testing)
   */
  reset(): void {
    this.rpmBucket.tokens = this.rpmBucket.capacity;
    this.rpmBucket.lastRefill = Date.now();
    this.tpmBucket.tokens = this.tpmBucket.capacity;
    this.tpmBucket.lastRefill = Date.now();
    this.dailyRequestCount = 0;
    this.dailyResetTime = this.calculateNextDailyReset();

    logger.info('RateLimiter reset');
  }

  /**
   * Refill token buckets based on elapsed time
   */
  private refillBuckets(): void {
    const now = Date.now();

    // Refill RPM bucket
    const rpmElapsed = (now - this.rpmBucket.lastRefill) / 1000; // seconds
    const rpmTokensToAdd = rpmElapsed * this.rpmBucket.refillRate;
    this.rpmBucket.tokens = Math.min(
      this.rpmBucket.capacity,
      this.rpmBucket.tokens + rpmTokensToAdd
    );
    this.rpmBucket.lastRefill = now;

    // Refill TPM bucket
    const tpmElapsed = (now - this.tpmBucket.lastRefill) / 1000; // seconds
    const tpmTokensToAdd = tpmElapsed * this.tpmBucket.refillRate;
    this.tpmBucket.tokens = Math.min(
      this.tpmBucket.capacity,
      this.tpmBucket.tokens + tpmTokensToAdd
    );
    this.tpmBucket.lastRefill = now;
  }

  /**
   * Calculate time needed to refill required tokens
   */
  private calculateRefillTime(bucket: TokenBucket, required: number): number {
    const deficit = required - bucket.tokens;
    if (deficit <= 0) return 0;

    const secondsNeeded = deficit / bucket.refillRate;
    return Math.ceil(secondsNeeded * 1000); // Convert to milliseconds
  }

  /**
   * Check if daily reset time has passed
   */
  private checkDailyReset(): void {
    const now = Date.now();
    if (now >= this.dailyResetTime) {
      logger.info('Daily rate limit reset', {
        previousCount: this.dailyRequestCount,
        resetTime: new Date(this.dailyResetTime).toISOString(),
      });

      this.dailyRequestCount = 0;
      this.dailyResetTime = this.calculateNextDailyReset();
    }
  }

  /**
   * Calculate next daily reset time (midnight Pacific)
   */
  private calculateNextDailyReset(): number {
    const now = new Date();

    // Get current time in Pacific timezone
    const pacificTime = new Date(
      now.toLocaleString('en-US', { timeZone: this.config.dailyResetTimezone })
    );

    // Calculate next midnight Pacific
    const nextMidnight = new Date(pacificTime);
    nextMidnight.setHours(24, 0, 0, 0);

    // Convert back to UTC timestamp
    const utcMidnight = new Date(
      nextMidnight.toLocaleString('en-US', { timeZone: 'UTC' })
    );

    return utcMidnight.getTime();
  }
}

/**
 * Create a rate limiter instance
 */
export function createRateLimiter(config?: RateLimitConfig): RateLimiter {
  return new RateLimiter(config);
}
