# Rate Limiting Capability

## ADDED Requirements

### Requirement: Distributed Token Bucket Rate Limiter
The rate limiting system MUST implement a distributed token bucket algorithm using DynamoDB to coordinate API rate limits across multiple concurrent Lambda instances.

**Rationale**: The current per-instance rate limiter cannot coordinate across multiple Lambda instances processing chunks in parallel. A distributed rate limiter is required to ensure the aggregate API usage from all instances stays within Gemini's limits (5 RPM, 250K TPM, 25 RPD).

#### Scenario: Acquire tokens from distributed bucket
- **GIVEN** The DynamoDB rate limit bucket has 5,000 tokens available
- **WHEN** A Lambda instance requests 3,750 tokens for chunk translation
- **THEN** The request SHALL succeed immediately
- **AND** The bucket SHALL have 1,250 tokens remaining
- **AND** The token count SHALL be updated atomically in DynamoDB
- **AND** No other instance SHALL be able to use the allocated 3,750 tokens

#### Scenario: Handle insufficient tokens with wait-and-retry
- **GIVEN** The DynamoDB rate limit bucket has 1,000 tokens available
- **WHEN** A Lambda instance requests 3,750 tokens
- **THEN** The acquisition SHALL fail with a rate limit error
- **AND** The Lambda SHALL wait using exponential backoff (2s, 4s, 8s)
- **AND** The Lambda SHALL retry acquisition after waiting
- **AND** After bucket refill, the acquisition SHALL succeed

#### Scenario: Prevent race conditions with conditional writes
- **GIVEN** Two Lambda instances simultaneously request tokens from the same bucket
- **WHEN** Both instances issue DynamoDB update requests at the same time
- **THEN** Only ONE instance SHALL successfully acquire tokens
- **AND** The second instance SHALL receive a ConditionalCheckFailedException
- **AND** The failed instance SHALL retry the acquisition
- **AND** The bucket token count SHALL remain consistent
- **AND** No tokens SHALL be double-allocated

### Requirement: Token Bucket Refill Logic
The distributed rate limiter MUST automatically refill tokens based on API rate limits and elapsed time to maintain accurate rate limiting.

#### Scenario: Refill tokens after one minute elapsed
- **GIVEN** The rate limit bucket was last refilled at timestamp T
- **WHEN** The current timestamp is T + 60 seconds
- **THEN** The bucket SHALL be refilled with the full minute's allocation (5 requests, 250K tokens)
- **AND** The refill SHALL be atomic and idempotent
- **AND** Multiple refill attempts within the same minute SHALL only credit tokens once
- **AND** The `lastRefillTimestamp` SHALL be updated to current minute boundary

#### Scenario: Partial refill for fractional time periods
- **GIVEN** The rate limit bucket was last refilled 30 seconds ago
- **WHEN** A Lambda instance attempts to acquire tokens
- **THEN** The bucket SHALL be partially refilled (2.5 requests worth, 125K tokens)
- **AND** The refill SHALL be proportional to time elapsed
- **AND** The `lastRefillTimestamp` SHALL be updated to current time
- **AND** Subsequent refills SHALL account for the partial refill

#### Scenario: Daily limit tracking and reset
- **GIVEN** 24 translation requests have been made today
- **WHEN** Request #25 is attempted
- **THEN** The daily limit check SHALL fail (25 RPD limit)
- **AND** The request SHALL be rejected with a daily limit error
- **AND** The error SHALL include the reset timestamp (next midnight)
- **AND** At midnight, the daily counter SHALL reset to 0

### Requirement: Distributed State Management
The distributed rate limiter MUST maintain consistent state in DynamoDB with automatic cleanup of expired buckets.

#### Scenario: Create rate limit bucket on first use
- **GIVEN** No rate limit bucket exists for the Gemini API
- **WHEN** The first Lambda instance attempts to acquire tokens
- **THEN** A new DynamoDB item SHALL be created with initial token counts
- **AND** The bucket SHALL be initialized with full capacity (5 RPM, 250K TPM, 25 RPD)
- **AND** A TTL SHALL be set for automatic cleanup after 7 days of inactivity
- **AND** The creation SHALL be atomic using conditional write

#### Scenario: Update bucket state atomically
- **GIVEN** A rate limit bucket exists with 10,000 tokens
- **WHEN** A Lambda instance acquires 3,750 tokens
- **THEN** The DynamoDB update SHALL use a conditional write based on current token count
- **AND** If the condition fails (concurrent modification), the operation SHALL retry
- **AND** The final token count SHALL be exactly 6,250 (10,000 - 3,750)
- **AND** No tokens SHALL be lost or double-counted

#### Scenario: Clean up expired rate limit buckets
- **GIVEN** A rate limit bucket has not been accessed for 7 days
- **WHEN** The DynamoDB TTL check runs
- **THEN** The expired bucket item SHALL be automatically deleted
- **AND** No manual cleanup SHALL be required
- **AND** Storage costs SHALL be minimized
- **AND** New requests SHALL create a fresh bucket if needed

### Requirement: Fallback and Error Handling
The distributed rate limiter MUST gracefully degrade to per-instance rate limiting if DynamoDB is unavailable, ensuring translation jobs can continue with reduced concurrency.

#### Scenario: Fallback to per-instance limiting on DynamoDB error
- **GIVEN** DynamoDB is experiencing high latency or is unavailable
- **WHEN** A Lambda instance attempts to acquire tokens
- **THEN** After 3 failed DynamoDB attempts, the Lambda SHALL switch to per-instance rate limiting
- **AND** Translation SHALL continue with conservative per-instance limits
- **AND** A CloudWatch metric SHALL be emitted: `RateLimiterFallbackActivated`
- **AND** When DynamoDB recovers, the Lambda SHALL resume distributed rate limiting

#### Scenario: Handle DynamoDB throttling
- **GIVEN** DynamoDB requests are being throttled due to high concurrency
- **WHEN** A Lambda instance receives a ProvisionedThroughputExceededException
- **THEN** The Lambda SHALL retry with exponential backoff
- **AND** The maximum retry attempts SHALL be 5
- **AND** If retries are exhausted, the Lambda SHALL fall back to per-instance limiting
- **AND** A CloudWatch alarm SHALL trigger if DynamoDB throttling persists

#### Scenario: Recover from transient DynamoDB errors
- **GIVEN** DynamoDB returns a temporary error (ServiceUnavailable)
- **WHEN** The Lambda retries the token acquisition
- **THEN** The retry SHALL use the same token amount as the original request
- **AND** The retry SHALL include jitter to prevent thundering herd
- **AND** Successful retry SHALL resume normal distributed rate limiting
- **AND** No tokens SHALL be lost or duplicated during the retry

### Requirement: Monitoring and Observability
The distributed rate limiter MUST provide comprehensive metrics and alarms for rate limit compliance and performance monitoring.

#### Scenario: Emit rate limit compliance metrics
- **GIVEN** Translation jobs are being processed with parallel chunks
- **WHEN** Tokens are acquired and consumed
- **THEN** CloudWatch SHALL receive metrics for:
  - `RateLimiterTokensAcquired` (per acquisition)
  - `RateLimiterTokensAvailable` (current bucket state)
  - `RateLimiterAcquisitionLatency` (DynamoDB operation time)
  - `RateLimiterAcquisitionFailures` (rate limit denials)
- **AND** Metrics SHALL be tagged with bucket type (RPM, TPM, RPD)
- **AND** Metrics SHALL be available in real-time dashboards

#### Scenario: Alert on rate limit violations
- **GIVEN** A chunk translation receives a 429 error from Gemini API
- **WHEN** The error is detected
- **THEN** A critical CloudWatch alarm SHALL fire immediately
- **AND** The alarm SHALL include:
  - Timestamp of violation
  - Bucket state at time of violation
  - Number of concurrent requests
  - Token acquisition history
- **AND** The alarm SHALL notify operators via SNS
- **AND** The incident SHALL be logged for post-mortem analysis

#### Scenario: Track distributed coordinator performance
- **GIVEN** Multiple Lambda instances are coordinating via DynamoDB
- **WHEN** Token acquisitions are happening
- **THEN** DynamoDB read/write latency SHALL be tracked
- **AND** Conditional write failure rate SHALL be monitored
- **AND** Retry attempt distribution SHALL be recorded
- **AND** Performance SHALL meet target of <50ms per acquisition

---

**Change ID**: enable-parallel-translation
**Capability**: rate-limiting
**Priority**: P1 - HIGH
