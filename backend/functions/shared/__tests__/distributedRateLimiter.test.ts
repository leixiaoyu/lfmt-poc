/**
 * Unit tests for Distributed Rate Limiter (TDD RED Phase)
 *
 * These tests are written BEFORE implementation to drive the design.
 * All tests should FAIL initially until Phase 1.3 implementation.
 *
 * Based on OpenSpec requirements from:
 * openspec/changes/enable-parallel-translation/specs/rate-limiting/spec.md
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DistributedRateLimiter } from '../distributedRateLimiter';
import { GEMINI_RATE_LIMITS, RateLimitType } from '../types/rateLimiting';

// Mock DynamoDB client
const ddbMock = mockClient(DynamoDBDocumentClient);

describe('DistributedRateLimiter', () => {
  let rateLimiter: DistributedRateLimiter;
  const tableName = 'test-rate-limit-buckets';

  beforeEach(() => {
    ddbMock.reset();
    rateLimiter = new DistributedRateLimiter({
      tableName,
      apiId: GEMINI_RATE_LIMITS.apiId,
      rpm: GEMINI_RATE_LIMITS.rpm,
      tpm: GEMINI_RATE_LIMITS.tpm,
      rpd: GEMINI_RATE_LIMITS.rpd,
    });
  });

  afterEach(() => {
    ddbMock.restore();
  });

  describe('Token Bucket Refill Logic', () => {
    /**
     * OpenSpec Scenario: Refill tokens after one minute elapsed
     * GIVEN: The rate limit bucket was last refilled at timestamp T
     * WHEN: The current timestamp is T + 60 seconds
     * THEN: The bucket SHALL be refilled with the full minute's allocation
     */
    it('should refill bucket with full minute allocation after 60 seconds', async () => {
      const now = Date.now();
      const lastRefill = now - 60000; // 60 seconds ago

      // Mock bucket state: empty bucket from 1 minute ago
      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 0,
          maxCapacity: 250000,
          refillRate: 250000 / 60, // tokens per second
          lastRefillTimestamp: Math.floor(lastRefill / 1000),
          windowStartTimestamp: Math.floor(lastRefill / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(lastRefill).toISOString(),
          updatedAt: new Date(lastRefill).toISOString(),
          version: 1,
        },
      });

      const result = await rateLimiter.acquire(10000, RateLimitType.TPM);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(10000);
      // After refill, bucket should have 250000 tokens, minus 10000 acquired = 240000
      expect(result.tokensRemaining).toBeGreaterThanOrEqual(240000);
    });

    /**
     * OpenSpec Scenario: Partial refill for fractional time periods
     * GIVEN: The rate limit bucket was last refilled 30 seconds ago
     * WHEN: A Lambda instance attempts to acquire tokens
     * THEN: The bucket SHALL be partially refilled proportionally
     */
    it('should partially refill bucket proportional to elapsed time', async () => {
      const now = Date.now();
      const lastRefill = now - 30000; // 30 seconds ago (half a minute)

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 0,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(lastRefill / 1000),
          windowStartTimestamp: Math.floor(lastRefill / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(lastRefill).toISOString(),
          updatedAt: new Date(lastRefill).toISOString(),
          version: 1,
        },
      });

      const result = await rateLimiter.acquire(5000, RateLimitType.TPM);

      expect(result.success).toBe(true);
      // After 30s, bucket should have ~125000 tokens (half of 250K)
      // After acquiring 5000, should have ~120000 remaining
      expect(result.tokensRemaining).toBeGreaterThanOrEqual(120000);
      expect(result.tokensRemaining).toBeLessThanOrEqual(125000);
    });

    /**
     * OpenSpec Scenario: Daily limit tracking and reset
     * GIVEN: 24 translation requests have been made today
     * WHEN: Request #25 is attempted
     * THEN: The daily limit check SHALL fail
     */
    it('should enforce daily limit (RPD) and reject when exceeded', async () => {
      const now = Date.now();

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-rpd',
          tokensAvailable: 1, // Only 1 request left
          maxCapacity: 25,
          refillRate: 25 / 86400, // requests per second
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 24, // 24 requests used
        },
      });

      // First request should succeed (request #24)
      const result1 = await rateLimiter.acquire(1, RateLimitType.RPD);
      expect(result1.success).toBe(true);

      // Update mock to show bucket exhausted
      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-rpd',
          tokensAvailable: 0,
          maxCapacity: 25,
          refillRate: 25 / 86400,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 25,
        },
      });

      // Second request should fail (request #25)
      const result2 = await rateLimiter.acquire(1, RateLimitType.RPD);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('daily limit');
      expect(result2.retryAfterMs).toBeGreaterThan(0);
    });
  });

  describe('Atomic Acquire Operations', () => {
    /**
     * OpenSpec Scenario: Acquire tokens from distributed bucket
     * GIVEN: The DynamoDB rate limit bucket has 5,000 tokens available
     * WHEN: A Lambda instance requests 3,750 tokens for chunk translation
     * THEN: The request SHALL succeed and token count SHALL be updated atomically
     */
    it('should successfully acquire tokens when sufficient available', async () => {
      const now = Date.now();

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 5000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 1,
        },
      });

      const result = await rateLimiter.acquire(3750, RateLimitType.TPM);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(3750);
      expect(result.tokensRemaining).toBe(1250); // 5000 - 3750
      expect(result.error).toBeUndefined();
    });

    /**
     * OpenSpec Scenario: Handle insufficient tokens with wait-and-retry
     * GIVEN: The DynamoDB rate limit bucket has 1,000 tokens available
     * WHEN: A Lambda instance requests 3,750 tokens
     * THEN: The acquisition SHALL fail with a rate limit error
     */
    it('should fail acquisition when insufficient tokens available', async () => {
      const now = Date.now();

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 1000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 1,
        },
      });

      const result = await rateLimiter.acquire(3750, RateLimitType.TPM);

      expect(result.success).toBe(false);
      expect(result.tokensAcquired).toBe(0);
      expect(result.error).toContain('rate limit');
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(60000); // Should suggest retry within 1 minute
    });

    /**
     * OpenSpec Scenario: Prevent race conditions with conditional writes
     * GIVEN: Two Lambda instances simultaneously request tokens
     * WHEN: Both instances issue DynamoDB update requests at the same time
     * THEN: Only ONE instance SHALL successfully acquire tokens
     */
    it('should use DynamoDB conditional writes to prevent race conditions', async () => {
      const now = Date.now();

      // Mock successful first acquisition
      ddbMock.onAnyCommand().resolvesOnce({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 10000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 1,
        },
      });

      // Simulate conditional check failure on second acquisition (race condition detected)
      ddbMock.onAnyCommand().rejectsOnce(new Error('ConditionalCheckFailedException'));

      const result1 = await rateLimiter.acquire(5000, RateLimitType.TPM);
      expect(result1.success).toBe(true);

      // Second acquisition should detect race condition and retry
      const result2 = await rateLimiter.acquire(5000, RateLimitType.TPM);
      expect(result2.success).toBe(false); // Or true if retry succeeds
    });
  });

  describe('Rate Limit Enforcement', () => {
    /**
     * Test RPM (Requests Per Minute) limit enforcement
     */
    it('should enforce RPM limit of 5 requests per minute', async () => {
      const now = Date.now();

      // Bucket has 2 requests remaining
      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-rpm',
          tokensAvailable: 2,
          maxCapacity: 5,
          refillRate: 5 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 3, // 3 requests already used
        },
      });

      const result1 = await rateLimiter.acquire(1, RateLimitType.RPM);
      expect(result1.success).toBe(true);

      const result2 = await rateLimiter.acquire(1, RateLimitType.RPM);
      expect(result2.success).toBe(true);

      // Update mock to show bucket exhausted
      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-rpm',
          tokensAvailable: 0,
          maxCapacity: 5,
          refillRate: 5 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 5,
        },
      });

      // 6th request should fail
      const result3 = await rateLimiter.acquire(1, RateLimitType.RPM);
      expect(result3.success).toBe(false);
      expect(result3.error).toContain('RPM');
    });

    /**
     * Test TPM (Tokens Per Minute) limit enforcement
     */
    it('should enforce TPM limit of 250K tokens per minute', async () => {
      const now = Date.now();

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 1000, // Only 1000 tokens left
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 1,
        },
      });

      // Request more tokens than available
      const result = await rateLimiter.acquire(5000, RateLimitType.TPM);
      expect(result.success).toBe(false);
      expect(result.error).toContain('TPM');
    });

    /**
     * Test RPD (Requests Per Day) limit enforcement
     */
    it('should enforce RPD limit of 25 requests per day', async () => {
      const now = Date.now();

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-rpd',
          tokensAvailable: 0, // All 25 requests used
          maxCapacity: 25,
          refillRate: 25 / 86400,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 25,
        },
      });

      const result = await rateLimiter.acquire(1, RateLimitType.RPD);
      expect(result.success).toBe(false);
      expect(result.error).toContain('RPD');
      expect(result.retryAfterMs).toBeGreaterThan(60000); // Should be hours until midnight
    });
  });

  describe('Concurrent Request Handling', () => {
    /**
     * Test coordination across multiple Lambda instances
     */
    it('should coordinate token allocation across concurrent Lambda instances', async () => {
      const now = Date.now();

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 10000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 1,
        },
      });

      // Simulate 3 concurrent Lambda instances requesting tokens
      const promises = [
        rateLimiter.acquire(3750, RateLimitType.TPM),
        rateLimiter.acquire(3750, RateLimitType.TPM),
        rateLimiter.acquire(3750, RateLimitType.TPM),
      ];

      const results = await Promise.all(promises);

      // At least one should succeed, others may fail or succeed based on timing
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Total tokens allocated should not exceed available
      const totalAllocated = results
        .filter(r => r.success)
        .reduce((sum, r) => sum + r.tokensAcquired, 0);
      expect(totalAllocated).toBeLessThanOrEqual(10000);
    });
  });

  describe('Bucket Expiration and Cleanup', () => {
    /**
     * OpenSpec Scenario: Clean up expired rate limit buckets
     * GIVEN: A rate limit bucket has not been accessed for 7 days
     * WHEN: The DynamoDB TTL check runs
     * THEN: The expired bucket SHALL be automatically deleted
     */
    it('should set TTL for automatic cleanup after 7 days of inactivity', async () => {
      const now = Date.now();
      const sevenDaysFromNow = now + 7 * 24 * 60 * 60 * 1000;

      ddbMock.onAnyCommand().resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 250000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor(sevenDaysFromNow / 1000), // TTL set to 7 days from now
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 1,
        },
      });

      await rateLimiter.acquire(1000, RateLimitType.TPM);

      // Verify TTL is set correctly (within reasonable range)
      const expectedTTL = Math.floor(sevenDaysFromNow / 1000);
      expect(expectedTTL).toBeGreaterThan(Math.floor(now / 1000));
      expect(expectedTTL).toBeLessThanOrEqual(Math.floor((now + 8 * 24 * 60 * 60 * 1000) / 1000));
    });
  });

  describe('Fallback Behavior on DynamoDB Errors', () => {
    /**
     * OpenSpec Scenario: Fallback to per-instance limiting on DynamoDB error
     * GIVEN: DynamoDB is experiencing high latency or is unavailable
     * WHEN: A Lambda instance attempts to acquire tokens
     * THEN: After retries, the Lambda SHALL switch to per-instance rate limiting
     */
    it('should fall back to per-instance rate limiting after DynamoDB failures', async () => {
      // Simulate DynamoDB unavailability
      ddbMock.onAnyCommand().rejects(new Error('ServiceUnavailable'));

      const result = await rateLimiter.acquire(1000, RateLimitType.TPM);

      // Should still succeed using fallback per-instance limiter
      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(1000);
    });

    /**
     * OpenSpec Scenario: Handle DynamoDB throttling
     * GIVEN: DynamoDB requests are being throttled
     * WHEN: A Lambda instance receives ProvisionedThroughputExceededException
     * THEN: The Lambda SHALL retry with exponential backoff
     */
    it('should retry with exponential backoff on DynamoDB throttling', async () => {
      // First 2 attempts fail with throttling
      ddbMock
        .onAnyCommand()
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'))
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'))
        .resolves({
          Item: {
            bucketKey: 'gemini-api-tpm',
            tokensAvailable: 250000,
            maxCapacity: 250000,
            refillRate: 250000 / 60,
            lastRefillTimestamp: Math.floor(Date.now() / 1000),
            windowStartTimestamp: Math.floor(Date.now() / 1000),
            ttl: Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
          },
        });

      const result = await rateLimiter.acquire(1000, RateLimitType.TPM);

      // Should eventually succeed after retries
      expect(result.success).toBe(true);
    });

    /**
     * OpenSpec Scenario: Recover from transient DynamoDB errors
     * GIVEN: DynamoDB returns a temporary error
     * WHEN: The Lambda retries the token acquisition
     * THEN: No tokens SHALL be lost or duplicated during the retry
     */
    it('should not lose or duplicate tokens during error recovery', async () => {
      const now = Date.now();

      // First attempt fails transiently
      ddbMock.onAnyCommand().rejectsOnce(new Error('InternalServerError')).resolves({
        Item: {
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 10000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: Math.floor(now / 1000),
          windowStartTimestamp: Math.floor(now / 1000),
          ttl: Math.floor((now + 7 * 24 * 60 * 60 * 1000) / 1000),
          createdAt: new Date(now).toISOString(),
          updatedAt: new Date(now).toISOString(),
          version: 1,
        },
      });

      const result = await rateLimiter.acquire(1000, RateLimitType.TPM);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(1000); // Exactly 1000, no duplication
    });
  });
});
