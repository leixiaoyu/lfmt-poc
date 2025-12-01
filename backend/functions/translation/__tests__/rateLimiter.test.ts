/**
 * Unit tests for Rate Limiter
 */

import { RateLimiter, createRateLimiter } from '../rateLimiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      requestsPerMinute: 5,
      tokensPerMinute: 250_000,
      requestsPerDay: 25,
      dailyResetTimezone: 'America/Los_Angeles',
    });
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const limiter = new RateLimiter();
      const result = limiter.checkLimit(1000);

      expect(result.allowed).toBe(true);
      expect(result.usage.rpm.limit).toBe(5);
      expect(result.usage.tpm.limit).toBe(250_000);
      expect(result.usage.rpd.limit).toBe(25);
    });

    it('should initialize with custom config', () => {
      const limiter = new RateLimiter({
        requestsPerMinute: 10,
        tokensPerMinute: 500_000,
        requestsPerDay: 50,
      });

      const result = limiter.checkLimit(1000);

      expect(result.usage.rpm.limit).toBe(10);
      expect(result.usage.tpm.limit).toBe(500_000);
      expect(result.usage.rpd.limit).toBe(50);
    });
  });

  describe('checkLimit - RPM (requests per minute)', () => {
    it('should allow requests within RPM limit', () => {
      // First 5 requests should be allowed
      for (let i = 0; i < 5; i++) {
        const result = rateLimiter.checkLimit(1000);
        expect(result.allowed).toBe(true);
        expect(result.usage.rpm.used).toBeLessThanOrEqual(i + 1); // May include current check
        rateLimiter.consume(1000);
      }
    });

    it('should deny 6th request when RPM limit exceeded', () => {
      // Consume 5 requests
      for (let i = 0; i < 5; i++) {
        rateLimiter.checkLimit(1000);
        rateLimiter.consume(1000);
      }

      // 6th request should be denied
      const result = rateLimiter.checkLimit(1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Requests per minute');
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60_000); // Max 1 minute
    });

    it('should allow requests after RPM bucket refills', async () => {
      // Consume 5 requests
      for (let i = 0; i < 5; i++) {
        rateLimiter.checkLimit(1000);
        rateLimiter.consume(1000);
      }

      // 6th request denied
      expect(rateLimiter.checkLimit(1000).allowed).toBe(false);

      // Wait for partial refill (12 seconds = 1 request at 5/min)
      await sleep(12_000);

      // Should allow 1 more request
      const result = rateLimiter.checkLimit(1000);
      expect(result.allowed).toBe(true);
    }, 15_000);
  });

  describe('checkLimit - TPM (tokens per minute)', () => {
    it('should allow requests within TPM limit', () => {
      const result = rateLimiter.checkLimit(100_000);
      expect(result.allowed).toBe(true);
      expect(result.usage.tpm.used).toBe(100_000);

      rateLimiter.consume(100_000);

      const result2 = rateLimiter.checkLimit(100_000);
      expect(result2.allowed).toBe(true);
    });

    it('should deny request when TPM limit would be exceeded', () => {
      // Consume 200K tokens
      rateLimiter.checkLimit(200_000);
      rateLimiter.consume(200_000);

      // Try to use another 100K (total would be 300K > 250K limit)
      const result = rateLimiter.checkLimit(100_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tokens per minute');
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('should allow request with exact remaining tokens', () => {
      // Consume 200K tokens
      rateLimiter.checkLimit(200_000);
      rateLimiter.consume(200_000);

      // Should allow exactly 50K more
      const result = rateLimiter.checkLimit(50_000);
      expect(result.allowed).toBe(true);
    });

    it('should allow requests after TPM bucket refills', async () => {
      // Consume all 250K tokens
      rateLimiter.checkLimit(250_000);
      rateLimiter.consume(250_000);

      // Next request denied
      expect(rateLimiter.checkLimit(10_000).allowed).toBe(false);

      // Wait for partial refill (3 seconds = ~12.5K tokens at 250K/min)
      await sleep(3_000);

      // Should allow small request
      const result = rateLimiter.checkLimit(10_000);
      expect(result.allowed).toBe(true);
    }, 5_000);
  });

  describe('checkLimit - RPD (requests per day)', () => {
    it('should allow requests within RPD limit', () => {
      // Create a rate limiter with higher RPM to avoid hitting that limit
      const testLimiter = new RateLimiter({
        requestsPerMinute: 100, // High RPM so we can test RPD in isolation
        tokensPerMinute: 500_000,
        requestsPerDay: 25,
      });

      // Consume 24 requests
      for (let i = 0; i < 24; i++) {
        const result = testLimiter.checkLimit(1000);
        expect(result.allowed).toBe(true);
        testLimiter.consume(1000);
      }

      // 25th request should still be allowed
      const result = testLimiter.checkLimit(1000);
      expect(result.allowed).toBe(true);
      expect(result.usage.rpd.used).toBe(24);
    });

    it('should deny 26th request when RPD limit exceeded', () => {
      // Create a rate limiter with higher RPM to avoid hitting that limit
      const testLimiter = new RateLimiter({
        requestsPerMinute: 100, // High RPM so we can test RPD in isolation
        tokensPerMinute: 500_000,
        requestsPerDay: 25,
      });

      // Consume 25 requests
      for (let i = 0; i < 25; i++) {
        testLimiter.checkLimit(1000);
        testLimiter.consume(1000);
      }

      // 26th request should be denied
      const result = testLimiter.checkLimit(1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily request limit');
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.usage.rpd.used).toBe(25);
    });

    it('should reset daily counter at midnight Pacific', () => {
      // Create a rate limiter with higher RPM to avoid hitting that limit
      const testLimiter = new RateLimiter({
        requestsPerMinute: 100, // High RPM so we can test RPD in isolation
        tokensPerMinute: 500_000,
        requestsPerDay: 25,
      });

      // Consume 25 requests
      for (let i = 0; i < 25; i++) {
        testLimiter.checkLimit(1000);
        testLimiter.consume(1000);
      }

      // 26th request denied
      expect(testLimiter.checkLimit(1000).allowed).toBe(false);

      // Reset (simulates midnight)
      testLimiter.reset();

      // Should allow requests again
      const result = testLimiter.checkLimit(1000);
      expect(result.allowed).toBe(true);
      expect(result.usage.rpd.used).toBe(0);
    });
  });

  describe('consume', () => {
    it('should consume 1 request from RPM bucket', () => {
      const before = rateLimiter.checkLimit(0);
      expect(before.usage.rpm.used).toBe(0);

      rateLimiter.consume(5000);

      const after = rateLimiter.checkLimit(0);
      expect(after.usage.rpm.used).toBe(1);
    });

    it('should consume tokens from TPM bucket', () => {
      const before = rateLimiter.checkLimit(10_000);
      expect(before.usage.tpm.used).toBe(10_000);

      rateLimiter.consume(10_000);

      const after = rateLimiter.checkLimit(0);
      // Due to refilling, the used amount may be slightly less than consumed
      expect(after.usage.tpm.used).toBeGreaterThan(9_000);
    });

    it('should increment daily request count', () => {
      const before = rateLimiter.checkLimit(0);
      expect(before.usage.rpd.used).toBe(0);

      rateLimiter.consume(1000);

      const after = rateLimiter.checkLimit(0);
      expect(after.usage.rpd.used).toBe(1);
    });

    it('should handle multiple consumes correctly', () => {
      rateLimiter.consume(10_000);
      rateLimiter.consume(20_000);
      rateLimiter.consume(30_000);

      const result = rateLimiter.checkLimit(0);
      expect(result.usage.rpm.used).toBe(3);
      // Due to refilling, the used amount may be slightly less than consumed
      expect(result.usage.tpm.used).toBeGreaterThan(50_000);
      expect(result.usage.rpd.used).toBe(3);
    });
  });

  describe('getCurrentUsage', () => {
    it('should return accurate usage statistics', () => {
      rateLimiter.consume(50_000);
      rateLimiter.consume(50_000);

      const usage = rateLimiter.getCurrentUsage(10_000);

      expect(usage.rpm.used).toBe(2);
      expect(usage.rpm.limit).toBe(5);
      expect(usage.tpm.used).toBeGreaterThanOrEqual(110_000);
      expect(usage.tpm.limit).toBe(250_000);
      expect(usage.rpd.used).toBe(2);
      expect(usage.rpd.limit).toBe(25);
    });

    it('should include estimated tokens in TPM usage', () => {
      const usage = rateLimiter.getCurrentUsage(100_000);
      expect(usage.tpm.used).toBe(100_000);
    });
  });

  describe('reset', () => {
    it('should reset all counters and buckets', () => {
      // Consume some quota
      for (let i = 0; i < 3; i++) {
        rateLimiter.checkLimit(50_000);
        rateLimiter.consume(50_000);
      }

      // Verify quota consumed
      let result = rateLimiter.checkLimit(0);
      expect(result.usage.rpm.used).toBe(3);
      expect(result.usage.tpm.used).toBeGreaterThan(0);
      expect(result.usage.rpd.used).toBe(3);

      // Reset
      rateLimiter.reset();

      // Verify quota restored
      result = rateLimiter.checkLimit(0);
      expect(result.usage.rpm.used).toBe(0);
      expect(result.usage.tpm.used).toBe(0);
      expect(result.usage.rpd.used).toBe(0);
    });
  });

  describe('retryAfterMs calculation', () => {
    it('should calculate correct retry time for RPM limit', () => {
      // Consume all 5 requests
      for (let i = 0; i < 5; i++) {
        rateLimiter.consume(1000);
      }

      const result = rateLimiter.checkLimit(1000);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(12_000); // Max time for 1 request refill
    });

    it('should calculate correct retry time for TPM limit', () => {
      // Consume all tokens
      rateLimiter.consume(250_000);

      // Try to use 10K more
      const result = rateLimiter.checkLimit(10_000);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(3_000); // ~2.4s for 10K tokens
    });

    it('should calculate correct retry time for RPD limit', () => {
      // Create a rate limiter with higher RPM to avoid hitting that limit
      const testLimiter = new RateLimiter({
        requestsPerMinute: 100, // High RPM so we can test RPD in isolation
        tokensPerMinute: 500_000,
        requestsPerDay: 25,
      });

      // Consume all 25 daily requests
      for (let i = 0; i < 25; i++) {
        testLimiter.consume(1000);
      }

      const result = testLimiter.checkLimit(1000);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000); // Max 24 hours
    });
  });

  describe('combined limits', () => {
    it('should enforce all three limits simultaneously', () => {
      // Scenario: Hit TPM limit before RPM limit
      rateLimiter.consume(240_000); // 1 request, 240K tokens

      // 2nd request with 20K tokens should be denied (TPM: 260K > 250K)
      const result = rateLimiter.checkLimit(20_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Tokens per minute');

      // But RPM should still have capacity
      expect(result.usage.rpm.used).toBe(1);
      expect(result.usage.rpm.limit).toBe(5);
    });

    it('should enforce RPM even with low token usage', () => {
      // Use 5 requests with minimal tokens
      for (let i = 0; i < 5; i++) {
        rateLimiter.consume(100);
      }

      // 6th request denied due to RPM, not TPM
      const result = rateLimiter.checkLimit(100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Requests per minute');

      // TPM should have plenty of capacity
      expect(result.usage.tpm.used).toBeLessThan(1000);
    });
  });

  describe('createRateLimiter factory', () => {
    it('should create a RateLimiter instance', () => {
      const limiter = createRateLimiter();
      expect(limiter).toBeInstanceOf(RateLimiter);
    });

    it('should pass config to RateLimiter', () => {
      const limiter = createRateLimiter({
        requestsPerMinute: 10,
      });

      const result = limiter.checkLimit(0);
      expect(result.usage.rpm.limit).toBe(10);
    });
  });

  describe('Daily Reset', () => {
    it.skip('should reset daily counter when daily reset time is reached', () => {
      // Use fake timers to control time
      jest.useFakeTimers();
      const startTime = new Date('2024-01-15T10:00:00.000-08:00').getTime(); // 10 AM Pacific
      jest.setSystemTime(startTime);

      const limiter = new RateLimiter({
        requestsPerMinute: 100, // High enough to not hit RPM limit
        tokensPerMinute: 1_000_000, // High enough to not hit TPM limit
        requestsPerDay: 5,
        dailyResetTimezone: 'America/Los_Angeles',
      });

      // Make 5 requests to hit the daily limit
      for (let i = 0; i < 5; i++) {
        const result = limiter.checkLimit(1000);
        expect(result.allowed).toBe(true);
      }

      // Next request should be blocked due to daily limit
      let result = limiter.checkLimit(1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily request limit exceeded');

      // Advance time to next day at 1 AM Pacific (past midnight reset)
      const nextDay = new Date('2024-01-16T01:00:00.000-08:00').getTime();
      jest.setSystemTime(nextDay);

      // Next request should succeed because daily counter was reset
      result = limiter.checkLimit(1000);
      expect(result.allowed).toBe(true);
      expect(result.usage.rpd.used).toBe(1); // Counter should be reset to 1

      // Restore real timers
      jest.useRealTimers();
    });
  });
});

/**
 * Sleep utility for async tests
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
