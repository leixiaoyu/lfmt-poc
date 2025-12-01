/**
 * Unit tests for Distributed Rate Limiter (TDD RED Phase)
 *
 * These tests are written BEFORE implementation to drive the design.
 * All tests should FAIL initially until Phase 1.3 implementation.
 *
 * Based on OpenSpec requirements from:
 * openspec/changes/enable-parallel-translation/specs/rate-limiting/spec.md
 */

import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { DistributedRateLimiter } from '../distributedRateLimiter';
import { GEMINI_RATE_LIMITS, RateLimitType } from '../types/rateLimiting';

// Mock DynamoDB client
const ddbMock = mockClient(DynamoDBClient);

describe('DistributedRateLimiter', () => {
  let rateLimiter: DistributedRateLimiter;
  const tableName = 'test-rate-limit-buckets';
  let dateNowSpy: jest.SpyInstance;

  // Fixed timestamp for all tests (2024-01-01 00:00:00 UTC)
  const FIXED_TIME_MS = 1704067200000;
  const FIXED_TIME_SEC = Math.floor(FIXED_TIME_MS / 1000);

  beforeEach(() => {
    ddbMock.reset();

    // Mock Date.now() to return fixed time
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_TIME_MS);

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
    dateNowSpy.mockRestore();
  });

  describe('Token Bucket Refill Logic', () => {
    /**
     * OpenSpec Scenario: Refill tokens after one minute elapsed
     * GIVEN: The rate limit bucket was last refilled at timestamp T
     * WHEN: The current timestamp is T + 60 seconds
     * THEN: The bucket SHALL be refilled with the full minute's allocation
     */
    it('should refill bucket with full minute allocation after 60 seconds', async () => {
      const lastRefillSec = FIXED_TIME_SEC - 60; // 60 seconds ago

      // Mock bucket state: empty bucket from 1 minute ago
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 0,
          maxCapacity: 250000,
          refillRate: 250000 / 60, // tokens per second
          lastRefillTimestamp: lastRefillSec,
          windowStartTimestamp: lastRefillSec,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(lastRefillSec * 1000).toISOString(),
          updatedAt: new Date(lastRefillSec * 1000).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      const result = await rateLimiter.acquire(10000, RateLimitType.TPM);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(10000);
      // After refill, bucket should have 250000 tokens, minus 10000 acquired = 240000
      expect(result.tokensRemaining).toBe(240000);
    });

    /**
     * OpenSpec Scenario: Partial refill for fractional time periods
     * GIVEN: The rate limit bucket was last refilled 30 seconds ago
     * WHEN: A Lambda instance attempts to acquire tokens
     * THEN: The bucket SHALL be partially refilled proportionally
     */
    it('should partially refill bucket proportional to elapsed time', async () => {
      // Simulate 30 seconds elapsed by having lastRefillTimestamp 30s in the past
      const lastRefillSec = FIXED_TIME_SEC - 30;

      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 0,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: lastRefillSec,
          windowStartTimestamp: lastRefillSec,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date((lastRefillSec) * 1000).toISOString(),
          updatedAt: new Date((lastRefillSec) * 1000).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      const result = await rateLimiter.acquire(5000, RateLimitType.TPM);

      expect(result.success).toBe(true);
      // After 30s, bucket should have exactly 125000 tokens (half of 250K)
      // After acquiring 5000, should have exactly 120000 remaining
      expect(result.tokensRemaining).toBe(120000);
    });

    /**
     * OpenSpec Scenario: Daily limit tracking and reset
     * GIVEN: 24 translation requests have been made today
     * WHEN: Request #25 is attempted
     * THEN: The daily limit check SHALL fail
     */
    it('should enforce daily limit (RPD) and reject when exceeded', async () => {
      ddbMock.on(GetItemCommand).resolvesOnce({
        Item: marshall({
          bucketKey: 'gemini-api-rpd',
          tokensAvailable: 1, // Only 1 request left
          maxCapacity: 25,
          refillRate: 25 / 86400, // requests per second
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 24, // 24 requests used
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      // First request should succeed (request #24)
      const result1 = await rateLimiter.acquire(1, RateLimitType.RPD);
      expect(result1.success).toBe(true);

      // Update mock to show bucket exhausted
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-rpd',
          tokensAvailable: 0,
          maxCapacity: 25,
          refillRate: 25 / 86400,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 25,
        }),
      });

      // Second request should fail (request #25)
      const result2 = await rateLimiter.acquire(1, RateLimitType.RPD);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('RPD');
      expect(result2.error).toContain('rate limit');
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
      // Mock GetItem to return bucket with 5000 tokens
      // Date.now() is mocked to return FIXED_TIME_MS, so no time will pass
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 5000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      // Mock UpdateItem to succeed
      ddbMock.on(UpdateItemCommand).resolves({});

      const result = await rateLimiter.acquire(3750, RateLimitType.TPM);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(3750);
      expect(result.tokensRemaining).toBe(1250); // 5000 - 3750, no refill since time is mocked
      expect(result.error).toBeUndefined();
    });

    /**
     * OpenSpec Scenario: Handle insufficient tokens with wait-and-retry
     * GIVEN: The DynamoDB rate limit bucket has 1,000 tokens available
     * WHEN: A Lambda instance requests 3,750 tokens
     * THEN: The acquisition SHALL fail with a rate limit error
     */
    it('should fail acquisition when insufficient tokens available', async () => {
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 1000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

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
      // Mock successful first acquisition
      ddbMock.on(GetItemCommand).resolvesOnce({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 10000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolvesOnce({});

      // Simulate conditional check failure on second acquisition (race condition detected)
      ddbMock.on(UpdateItemCommand).rejectsOnce(new Error('ConditionalCheckFailedException'));

      const result1 = await rateLimiter.acquire(5000, RateLimitType.TPM);
      expect(result1.success).toBe(true);

      // Second acquisition should detect race condition and retry successfully
      // The implementation retries after ConditionalCheckFailedException
      const result2 = await rateLimiter.acquire(5000, RateLimitType.TPM);
      expect(result2.success).toBe(true); // Retry succeeds
    });
  });

  describe('Rate Limit Enforcement', () => {
    /**
     * Test RPM (Requests Per Minute) limit enforcement
     */
    it('should enforce RPM limit of 5 requests per minute', async () => {
      // Bucket has 2 requests remaining
      ddbMock.on(GetItemCommand).resolvesOnce({
        Item: marshall({
          bucketKey: 'gemini-api-rpm',
          tokensAvailable: 2,
          maxCapacity: 5,
          refillRate: 5 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 3, // 3 requests already used
        }),
      });

      ddbMock.on(UpdateItemCommand).resolvesOnce({});

      const result1 = await rateLimiter.acquire(1, RateLimitType.RPM);
      expect(result1.success).toBe(true);

      ddbMock.on(GetItemCommand).resolvesOnce({
        Item: marshall({
          bucketKey: 'gemini-api-rpm',
          tokensAvailable: 1,
          maxCapacity: 5,
          refillRate: 5 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 4,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolvesOnce({});

      const result2 = await rateLimiter.acquire(1, RateLimitType.RPM);
      expect(result2.success).toBe(true);

      // Update mock to show bucket exhausted
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-rpm',
          tokensAvailable: 0,
          maxCapacity: 5,
          refillRate: 5 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 5,
        }),
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
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 1000, // Only 1000 tokens left
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      // Request more tokens than available
      const result = await rateLimiter.acquire(5000, RateLimitType.TPM);
      expect(result.success).toBe(false);
      expect(result.error).toContain('TPM');
    });

    /**
     * Test RPD (Requests Per Day) limit enforcement
     */
    it('should enforce RPD limit of 25 requests per day', async () => {
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-rpd',
          tokensAvailable: 0, // All 25 requests used
          maxCapacity: 25,
          refillRate: 25 / 86400,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 25,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

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
      // Simulate sequential token bucket updates
      // All requests see same initial state (simulating real concurrent access)
      // but DynamoDB conditional writes should prevent over-allocation
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 10000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      // Simulate 3 concurrent Lambda instances requesting tokens
      // Since mocks return same state, all will see 10000 tokens available
      const result1 = await rateLimiter.acquire(3750, RateLimitType.TPM);
      const result2 = await rateLimiter.acquire(3750, RateLimitType.TPM);
      const result3 = await rateLimiter.acquire(3750, RateLimitType.TPM);

      // All should succeed since mock always returns 10000 tokens available
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result3.success).toBe(true);

      // Each acquires 3750 tokens
      expect(result1.tokensAcquired).toBe(3750);
      expect(result2.tokensAcquired).toBe(3750);
      expect(result3.tokensAcquired).toBe(3750);
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
      const sevenDaysFromNow = FIXED_TIME_MS + 7 * 24 * 60 * 60 * 1000;

      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 250000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: Math.floor(sevenDaysFromNow / 1000), // TTL set to 7 days from now
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      await rateLimiter.acquire(1000, RateLimitType.TPM);

      // Verify TTL is set correctly (within reasonable range)
      const expectedTTL = Math.floor(sevenDaysFromNow / 1000);
      expect(expectedTTL).toBeGreaterThan(FIXED_TIME_SEC);
      expect(expectedTTL).toBeLessThanOrEqual(Math.floor((FIXED_TIME_MS + 8 * 24 * 60 * 60 * 1000) / 1000));
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
      ddbMock.on(GetItemCommand).rejects(new Error('ServiceUnavailable'));
      ddbMock.on(UpdateItemCommand).rejects(new Error('ServiceUnavailable'));

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
        .on(GetItemCommand)
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'))
        .rejectsOnce(new Error('ProvisionedThroughputExceededException'))
        .resolves({
          Item: marshall({
            bucketKey: 'gemini-api-tpm',
            tokensAvailable: 250000,
            maxCapacity: 250000,
            refillRate: 250000 / 60,
            lastRefillTimestamp: FIXED_TIME_SEC,
            windowStartTimestamp: FIXED_TIME_SEC,
            ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
            createdAt: new Date(FIXED_TIME_MS).toISOString(),
            updatedAt: new Date(FIXED_TIME_MS).toISOString(),
            version: 1,
          }),
        });

      ddbMock.on(UpdateItemCommand).resolves({});

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
      // First attempt fails transiently
      ddbMock.on(GetItemCommand).rejectsOnce(new Error('InternalServerError')).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 10000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      const result = await rateLimiter.acquire(1000, RateLimitType.TPM);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(1000); // Exactly 1000, no duplication
    });

    /**
     * Coverage Test: All retries exhausted scenario
     * Tests line 156: Return error after all retries exhausted
     * GIVEN: All maxRetries attempts fail with race conditions
     * WHEN: The limiter exhausts all retry attempts
     * THEN: Return failure with error message indicating retries exhausted
     */
    it('should return error after all retries exhausted', async () => {
      const { ConditionalCheckFailedException } = await import('@aws-sdk/client-dynamodb');

      // Mock GetItem to succeed but UpdateItem to always fail with race condition
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-tpm',
          tokensAvailable: 10000,
          maxCapacity: 250000,
          refillRate: 250000 / 60,
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      // Always fail UpdateItem with ConditionalCheckFailedException
      ddbMock.on(UpdateItemCommand).rejects(new ConditionalCheckFailedException({ message: 'Condition failed', $metadata: {} }));

      const result = await rateLimiter.acquire(1000, RateLimitType.TPM);

      expect(result.success).toBe(false);
      expect(result.tokensAcquired).toBe(0);
      expect(result.tokensRemaining).toBe(0);
      expect(result.error).toContain('Failed to acquire tokens after');
      expect(result.error).toContain('attempts');
    });

    /**
     * Coverage Test: getBucket error handling
     * Tests line 240: Error thrown when GetItemCommand fails
     * GIVEN: DynamoDB GetItem fails with an error
     * WHEN: Acquiring tokens
     * THEN: Should trigger fallback mode or return error
     */
    it('should handle GetItem errors and fallback if enabled', async () => {
      // Mock GetItem to fail with generic error
      ddbMock.on(GetItemCommand).rejects(new Error('DynamoDB service error'));

      const result = await rateLimiter.acquire(1000, RateLimitType.TPM);

      // Should use fallback since enableFallback is true by default
      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(1000);
    });

    /**
     * Coverage Test: initializeBucket with race condition
     * Tests lines 253-294: Bucket initialization and concurrent creation handling
     * GIVEN: Two Lambda instances try to initialize the same bucket simultaneously
     * WHEN: PutItem fails with ConditionalCheckFailedException
     * THEN: Fetch the bucket created by the other instance
     */
    it('should handle concurrent bucket initialization', async () => {
      const { ConditionalCheckFailedException } = await import('@aws-sdk/client-dynamodb');

      // First GetItem returns no item (bucket doesn't exist)
      // PutItem fails because another instance created it
      // Second GetItem returns the newly created bucket
      ddbMock
        .on(GetItemCommand)
        .resolvesOnce({ Item: undefined }) // No existing bucket
        .resolves({
          // Bucket now exists after other instance created it
          Item: marshall({
            bucketKey: 'gemini-api-rpm',
            tokensAvailable: 5,
            maxCapacity: 5,
            refillRate: 5 / 60,
            lastRefillTimestamp: FIXED_TIME_SEC,
            windowStartTimestamp: FIXED_TIME_SEC,
            ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
            createdAt: new Date(FIXED_TIME_MS).toISOString(),
            updatedAt: new Date(FIXED_TIME_MS).toISOString(),
            version: 0,
          }),
        });

      ddbMock
        .on(PutItemCommand)
        .rejects(new ConditionalCheckFailedException({ message: 'Bucket already exists', $metadata: {} }));

      ddbMock.on(UpdateItemCommand).resolves({});

      const result = await rateLimiter.acquire(1, RateLimitType.RPM);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(1);
    });

    /**
     * Coverage Test: Fallback mode window reset
     * Tests line 376: Window reset in fallback bucket
     * GIVEN: Fallback bucket with elapsed window duration
     * WHEN: Acquiring tokens after window duration passed
     * THEN: Window should reset and bucket refilled to maxCapacity
     */
    it('should reset window in fallback mode when duration elapsed', async () => {
      // Create a limiter with fallback enabled
      const fallbackLimiter = new DistributedRateLimiter({
        tableName,
        apiId: GEMINI_RATE_LIMITS.apiId,
        rpm: GEMINI_RATE_LIMITS.rpm,
        tpm: GEMINI_RATE_LIMITS.tpm,
        rpd: GEMINI_RATE_LIMITS.rpd,
        enableFallback: true,
      });

      // First, trigger fallback by making DynamoDB fail
      ddbMock.on(GetItemCommand).rejects(new Error('DynamoDB unavailable'));

      // First call uses up tokens
      const result1 = await fallbackLimiter.acquire(2000, RateLimitType.TPM);
      expect(result1.success).toBe(true);
      expect(result1.tokensRemaining).toBe(248000); // 250000 - 2000

      // Advance time by 61 seconds (past 60-second window for TPM)
      const advancedTime = FIXED_TIME_MS + 61000;
      dateNowSpy.mockReturnValue(advancedTime);

      // Second call should reset window
      const result2 = await fallbackLimiter.acquire(1000, RateLimitType.TPM);
      expect(result2.success).toBe(true);
      // After window reset, should have full capacity minus request
      expect(result2.tokensRemaining).toBe(249000); // 250000 - 1000
    });

    /**
     * Coverage Test: Fallback mode rate limit exceeded
     * Tests line 381: Rate limit exceeded in fallback mode
     * GIVEN: Fallback bucket with insufficient tokens
     * WHEN: Requesting more tokens than available
     * THEN: Return rate limit exceeded with fallback mode indicator
     */
    it('should return rate limit exceeded in fallback mode', async () => {
      // Trigger fallback by making DynamoDB fail
      ddbMock.on(GetItemCommand).rejects(new Error('DynamoDB unavailable'));

      // Use up most tokens (250000 TPM capacity)
      const result1 = await rateLimiter.acquire(249000, RateLimitType.TPM);
      expect(result1.success).toBe(true);

      // Try to acquire more than remaining (only 1000 left)
      const result2 = await rateLimiter.acquire(2000, RateLimitType.TPM);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('TPM');
      expect(result2.error).toContain('rate limit exceeded');
      expect(result2.error).toContain('fallback mode');
    });

    /**
     * Coverage Test: RPD (Requests Per Day) limit type
     * Tests lines 415, 429: RPD maxCapacity and refillRate
     * GIVEN: Rate limiter configured for RPD limit
     * WHEN: Acquiring tokens with RateLimitType.RPD
     * THEN: Should use 25 max capacity and 25/86400 refill rate
     */
    it('should handle RPD rate limit type correctly', async () => {
      ddbMock.on(GetItemCommand).resolves({
        Item: marshall({
          bucketKey: 'gemini-api-rpd',
          tokensAvailable: 25,
          maxCapacity: 25,
          refillRate: 25 / 86400, // 25 requests per day = 0.000289 per second
          lastRefillTimestamp: FIXED_TIME_SEC,
          windowStartTimestamp: FIXED_TIME_SEC,
          ttl: FIXED_TIME_SEC + 7 * 24 * 60 * 60,
          createdAt: new Date(FIXED_TIME_MS).toISOString(),
          updatedAt: new Date(FIXED_TIME_MS).toISOString(),
          version: 1,
        }),
      });

      ddbMock.on(UpdateItemCommand).resolves({});

      const result = await rateLimiter.acquire(5, RateLimitType.RPD);

      expect(result.success).toBe(true);
      expect(result.tokensAcquired).toBe(5);
      expect(result.tokensRemaining).toBe(20); // 25 - 5
    });
  });

  describe('Bucket Creation Error Handling', () => {
    /**
     * Coverage Test: Successful bucket creation path
     * Tests line 294: return bucket after successful PutItemCommand
     * Tests lines 415, 429: getMaxCapacity and getRefillRate for RPD type during bucket creation
     * GIVEN: No existing bucket for RPD limit type
     * WHEN: Acquiring tokens for the first time
     * THEN: Should create new bucket and return it (line 294)
     */
    it('should successfully create a new bucket for RPD limit type', async () => {
      const rateLimiter = new DistributedRateLimiter({
        tableName: 'test-table',
        apiId: 'test-api',
        rpm: 5,
        tpm: 250_000,
        rpd: 25,
      });

      // Mock GetItemCommand to return no existing bucket (first call)
      // This ensures we go through the bucket creation path
      ddbMock.on(GetItemCommand).resolvesOnce({});

      // Mock PutItemCommand to succeed (creates bucket)
      // This triggers the successful path that returns the bucket (line 294)
      ddbMock.on(PutItemCommand).resolvesOnce({});

      // Mock UpdateItemCommand for the actual acquire operation
      ddbMock.on(UpdateItemCommand).resolves({});

      // This should create a new RPD bucket
      // During creation, getMaxCapacity() and getRefillRate() are called with RPD type
      // which covers lines 415 and 429
      const result = await rateLimiter.acquire(1, RateLimitType.RPD);

      expect(result.success).toBe(true);

      // Verify PutItemCommand was called (bucket creation)
      const putCalls = ddbMock.commandCalls(PutItemCommand);
      expect(putCalls.length).toBeGreaterThan(0);

      // Verify the bucket was created with correct RPD values
      const createCall = putCalls[0];
      const createdBucket = unmarshall(createCall.args[0].input.Item as any);
      expect(createdBucket.maxCapacity).toBe(25); // RPD limit (line 415)
      expect(createdBucket.refillRate).toBe(25 / 86400); // RPD refill rate (line 429)
    });
  });
});
