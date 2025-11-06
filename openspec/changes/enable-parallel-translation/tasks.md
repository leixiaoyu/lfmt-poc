# Implementation Tasks: Enable Parallel Translation

**Change ID**: `enable-parallel-translation`
**Status**: Proposed
**Priority**: P1 - HIGH
**Owner**: xlei-raymond

## Phase 1: Distributed Rate Limiter (Week 1)

### 1.1 DynamoDB Table Design
- [ ] 1.1.1 Design RateLimitBucket table schema
- [ ] 1.1.2 Create CDK construct for RateLimitBucket table
- [ ] 1.1.3 Add IAM policies for Lambda access to rate limit table
- [ ] 1.1.4 Add table to infrastructure stack
- [ ] 1.1.5 Write infrastructure tests for table creation

###1.2 Distributed Rate Limiter Implementation
- [ ] 1.2.1 Create `backend/functions/shared/distributedRateLimiter.ts`
- [ ] 1.2.2 Implement token bucket algorithm with DynamoDB backend
- [ ] 1.2.3 Implement `acquire(tokens)` method with atomic conditional writes
- [ ] 1.2.4 Implement `refillBucket()` method with time-based refill
- [ ] 1.2.5 Add error handling for DynamoDB failures
- [ ] 1.2.6 Add fallback to per-instance rate limiting if DynamoDB unavailable

### 1.3 Rate Limiter Unit Tests
- [ ] 1.3.1 Write tests for token bucket refill logic
- [ ] 1.3.2 Write tests for atomic acquire operations
- [ ] 1.3.3 Write tests for rate limit enforcement (RPM, TPM, RPD)
- [ ] 1.3.4 Write tests for concurrent acquire requests (race conditions)
- [ ] 1.3.5 Write tests for bucket expiration and cleanup
- [ ] 1.3.6 Write tests for fallback behavior on DynamoDB errors
- [ ] 1.3.7 Achieve 90%+ test coverage for rate limiter

### 1.4 Rate Limiter Integration Tests
- [ ] 1.4.1 Test distributed rate limiting across multiple Lambda instances
- [ ] 1.4.2 Test DynamoDB atomic updates prevent over-allocation
- [ ] 1.4.3 Test rate limit compliance under high concurrency
- [ ] 1.4.4 Test bucket refill timing accuracy
- [ ] 1.4.5 Test cleanup of expired buckets

## Phase 2: Parallel Translation (Week 2)

### 2.1 Update translateChunk Lambda
- [ ] 2.1.1 Modify `translateChunk` to use `chunk.previousContext` directly
- [ ] 2.1.2 Remove sequential dependency on previous chunk translation
- [ ] 2.1.3 Integrate `DistributedRateLimiter` in translate Lambda
- [ ] 2.1.4 Add token estimation logic for chunk text
- [ ] 2.1.5 Implement rate limit acquire before translation
- [ ] 2.1.6 Add retry logic for rate limit denials (exponential backoff)

### 2.2 Update Step Functions Definition
- [ ] 2.2.1 Change `maxConcurrency: 1` to `maxConcurrency: 10` in Map state
- [ ] 2.2.2 Add error handling for rate limit errors
- [ ] 2.2.3 Update retry configuration (exponential backoff for 429 errors)
- [ ] 2.2.4 Add CloudWatch Logs for parallel execution tracking
- [ ] 2.2.5 Update infrastructure tests for parallel Map state

### 2.3 Update Lambda Environment Variables
- [ ] 2.3.1 Add `RATE_LIMIT_TABLE_NAME` to translate Lambda env vars
- [ ] 2.3.2 Add `MAX_CONCURRENCY` configuration (default: 10)
- [ ] 2.3.3 Update IAM policies for DynamoDB access
- [ ] 2.3.4 Verify environment variables in all environments (dev/staging/prod)

### 2.4 CloudWatch Metrics & Alarms
- [ ] 2.4.1 Add custom metric: `TranslationSpeed` (time per job)
- [ ] 2.4.2 Add custom metric: `RateLimitViolations` (429 errors)
- [ ] 2.4.3 Add custom metric: `ParallelChunkProcessing` (concurrent chunks)
- [ ] 2.4.4 Create CloudWatch alarm for rate limit violations (threshold: 0)
- [ ] 2.4.5 Create CloudWatch alarm for job failures (threshold: 5%)
- [ ] 2.4.6 Create CloudWatch dashboard for parallel translation metrics

## Phase 3: Testing & Validation (Week 3)

### 3.1 Integration Tests
- [ ] 3.1.1 Create integration test: Parallel vs sequential output comparison
- [ ] 3.1.2 Create integration test: 10-chunk document parallel translation
- [ ] 3.1.3 Create integration test: 60-chunk document parallel translation
- [ ] 3.1.4 Create integration test: Context continuity validation
- [ ] 3.1.5 Create integration test: Missing chunk detection
- [ ] 3.1.6 Create integration test: Rate limit compliance under load

### 3.2 Performance Testing
- [ ] 3.2.1 Benchmark: 65K words (10 chunks) translation time
- [ ] 3.2.2 Benchmark: 400K words (60 chunks) translation time
- [ ] 3.2.3 Verify 5x speedup vs sequential processing
- [ ] 3.2.4 Load test: 5 concurrent translation jobs
- [ ] 3.2.5 Load test: 10 concurrent translation jobs
- [ ] 3.2.6 Measure DynamoDB throughput and latency
- [ ] 3.2.7 Document performance test results

### 3.3 Quality Assurance
- [ ] 3.3.1 A/B test: Compare parallel vs sequential translation quality
- [ ] 3.3.2 Manual review: Sample translations for accuracy
- [ ] 3.3.3 Verify context continuity across chunk boundaries
- [ ] 3.3.4 Test error scenarios: Rate limit violations, DynamoDB failures
- [ ] 3.3.5 Verify graceful degradation on errors

### 3.4 Rate Limit Compliance Testing
- [ ] 3.4.1 Test Gemini API RPM limit (5 requests/min)
- [ ] 3.4.2 Test Gemini API TPM limit (250K tokens/min)
- [ ] 3.4.3 Test Gemini API RPD limit (25 requests/day)
- [ ] 3.4.4 Verify no 429 errors during normal operation
- [ ] 3.4.5 Verify exponential backoff retry strategy works
- [ ] 3.4.6 Test rate limiter coordination across Lambda instances

## Phase 4: Documentation & Deployment (Week 4)

### 4.1 Documentation Updates
- [ ] 4.1.1 Update DEVELOPMENT-ROADMAP.md (mark P1 as complete)
- [ ] 4.1.2 Update README.md with parallel translation info
- [ ] 4.1.3 Update API-REFERENCE.md if needed
- [ ] 4.1.4 Create architecture diagram for parallel processing
- [ ] 4.1.5 Document distributed rate limiter design
- [ ] 4.1.6 Update performance benchmarks in documentation

### 4.2 Code Documentation
- [ ] 4.2.1 Add JSDoc comments to DistributedRateLimiter class
- [ ] 4.2.2 Add inline comments for complex rate limit logic
- [ ] 4.2.3 Document Step Functions parallel Map configuration
- [ ] 4.2.4 Add README to distributed rate limiter module
- [ ] 4.2.5 Update Lambda function documentation

### 4.3 Deployment Preparation
- [ ] 4.3.1 Review CDK changeset for infrastructure updates
- [ ] 4.3.2 Create deployment checklist
- [ ] 4.3.3 Prepare rollback plan
- [ ] 4.3.4 Schedule deployment window
- [ ] 4.3.5 Notify stakeholders of deployment

### 4.4 Development Environment Deployment
- [ ] 4.4.1 Deploy infrastructure to dev environment
- [ ] 4.4.2 Run smoke tests in dev environment
- [ ] 4.4.3 Verify CloudWatch metrics are reporting correctly
- [ ] 4.4.4 Test with sample documents (65K and 400K words)
- [ ] 4.4.5 Verify rate limit compliance in dev

### 4.5 Staging Environment Deployment
- [ ] 4.5.1 Deploy infrastructure to staging environment
- [ ] 4.5.2 Run full integration test suite
- [ ] 4.5.3 Run performance benchmarks
- [ ] 4.5.4 Conduct final QA review
- [ ] 4.5.5 Obtain approval for production deployment

### 4.6 Production Deployment
- [ ] 4.6.1 Deploy infrastructure to production environment
- [ ] 4.6.2 Monitor CloudWatch metrics during rollout
- [ ] 4.6.3 Verify first production translation job succeeds
- [ ] 4.6.4 Monitor for rate limit violations (24 hours)
- [ ] 4.6.5 Confirm performance targets achieved
- [ ] 4.6.6 Archive OpenSpec change proposal

## Phase 5: Post-Deployment (Ongoing)

### 5.1 Monitoring
- [ ] 5.1.1 Monitor CloudWatch alarms (first week)
- [ ] 5.1.2 Review translation job success rates
- [ ] 5.1.3 Track actual speedup vs targets
- [ ] 5.1.4 Monitor DynamoDB costs
- [ ] 5.1.5 Review rate limit compliance metrics

### 5.2 Optimization (If Needed)
- [ ] 5.2.1 Tune `maxConcurrency` based on actual performance
- [ ] 5.2.2 Adjust rate limiter token bucket sizes if needed
- [ ] 5.2.3 Optimize DynamoDB read/write patterns
- [ ] 5.2.4 Fine-tune retry backoff strategy
- [ ] 5.2.5 Document lessons learned

## Success Criteria

### Functional
- [x] P0 (Cost Model) completed
- [ ] Parallel translation produces same quality as sequential
- [ ] Context continuity maintained
- [ ] No translation errors or missing chunks
- [ ] Graceful rate limit handling

### Performance
- [ ] 65K words: <20 seconds (currently ~100s) = **5x faster**
- [ ] 400K words: <90 seconds (currently ~600s) = **6.7x faster**
- [ ] Minimum 5x speedup achieved

### Reliability
- [ ] Zero Gemini API rate limit violations
- [ ] <5% transient error rate
- [ ] >95% job success rate

### Scalability
- [ ] Support 5+ concurrent translation jobs
- [ ] Distributed rate limiter handles high concurrency
- [ ] Cost increase <$5/month

## Estimated Effort

- **Phase 1**: 5 days (Distributed Rate Limiter)
- **Phase 2**: 3 days (Parallel Translation)
- **Phase 3**: 4 days (Testing & Validation)
- **Phase 4**: 3 days (Documentation & Deployment)
- **Total**: ~15 days (3 weeks)

## Dependencies

### Required Implementations
- ✅ Chunk metadata with pre-calculated context (done)
- ✅ Gemini client with rate limiting (done)
- ✅ Step Functions orchestrator (done)
- ⏳ Distributed rate limiter (new)
- ⏳ Updated Step Functions definition (new)

### Blocked By
- ✅ P0: Cost Model & Engine Choice (completed)

### Blocks
- Issue #24: In-Memory File Processing (independent)
- Issue #25: Distributed Rate Limiter (this work addresses it)

---

**Total Tasks**: 88
**Completed**: 0
**Remaining**: 88
**Progress**: 0%
