# Proposal: Enable Parallel Translation

**Change ID**: `enable-parallel-translation`
**Status**: Phase 2 Complete - Deployment Pending
**Priority**: P1 - HIGH (Critical Performance Blocker)
**Related Issues**: #23 (main), #25 (distributed rate limiter - ✅ completed via PR #39)
**Owner**: xlei-raymond (Principal Engineer / Team Lead)
**Created**: 2025-11-06
**Updated**: 2025-11-08
**PR #39**: Distributed rate limiter implementation - ✅ merged to main
**Current Branch**: feature/enable-parallel-translation-phase2 (ready for PR)

## Problem Statement

The V1 Step Functions orchestrator intentionally processes translation chunks **sequentially** (`maxConcurrency: 1`). This was a temporary trade-off for context continuity during initial implementation, but it creates a critical performance bottleneck that prevents the system from meeting performance goals.

### Current Performance (Sequential Processing)
- **65K words** (10 chunks): ~100 seconds
- **400K words** (60 chunks): ~600 seconds (10 minutes)

### Target Performance (Parallel Processing)
- **65K words** (10 chunks): ~15-20 seconds **(5-7x faster)**
- **400K words** (60 chunks): ~60-90 seconds **(6-10x faster)**

### Business Impact
- **User Experience**: Long wait times for large documents reduce usability
- **Cost Efficiency**: Sequential processing underutilizes available API capacity
- **Scalability**: Cannot handle multiple concurrent translation jobs efficiently
- **Competitive Advantage**: Performance is key differentiator for translation services

## Proposed Solution

Enable true parallel translation processing by:

1. **Remove Sequential Constraint** in Step Functions Map state
2. **Use Pre-Calculated Context** from chunk metadata (already implemented in chunking phase)
3. **Implement Distributed Rate Limiting** to respect Gemini API limits across parallel executions
4. **Add Integration Tests** to verify parallel processing maintains translation quality

## Technical Approach

### 1. Chunk Context is Already Pre-Calculated

The chunking Lambda (`createChunk`) already generates self-contained chunks with context windows:

```typescript
// Each chunk includes:
{
  jobId: string,
  chunkIndex: number,
  text: string,           // 3,500 tokens of primary content
  previousContext: string // 250 tokens from previous chunk (overlap)
}
```

**Key Insight**: Context continuity doesn't require sequential processing because each chunk already has its context embedded.

### 2. Step Functions Modification

**Current (Sequential)**:
```typescript
const processChunksMap = new stepfunctions.Map(this, 'ProcessChunksMap', {
  maxConcurrency: 1, // ❌ Sequential processing
  itemsPath: stepfunctions.JsonPath.stringAt('$.chunks'),
  parameters: {
    'jobId.$': '$.jobId',
    'chunk.$': '$$.Map.Item.Value'
  }
});
```

**Proposed (Parallel)**:
```typescript
const processChunksMap = new stepfunctions.Map(this, 'ProcessChunksMap', {
  maxConcurrency: 10, // ✅ Parallel processing (up to 10 concurrent chunks)
  itemsPath: stepfunctions.JsonPath.stringAt('$.chunks'),
  parameters: {
    'jobId.$': '$.jobId',
    'chunk.$': '$$.Map.Item.Value'
  }
});
```

**Rationale for `maxConcurrency: 10`**:
- Gemini free tier: 5 requests/min, 250K tokens/min
- Each chunk: ~3,750 tokens (3,500 + 250 context)
- Theoretical max: 66 chunks/min (250K / 3,750)
- **Safe limit**: 10 concurrent to leave headroom for rate limiting and retries

###3. Distributed Rate Limiting

**Problem**: Current `RateLimiter` is per-Lambda instance, not global.

**Solution**: DynamoDB-backed distributed rate limiter using token bucket algorithm.

```typescript
// backend/functions/shared/distributedRateLimiter.ts
export class DistributedRateLimiter {
  private tableName: string;
  private rpm: number;     // Requests per minute
  private tpm: number;     // Tokens per minute
  private rpd: number;     // Requests per day

  async acquire(tokens: number): Promise<boolean> {
    // 1. Read current bucket state from DynamoDB
    // 2. Check if sufficient tokens available
    // 3. Update bucket state atomically (conditional write)
    // 4. Return true if acquired, false if rate limited
  }

  private async refillBucket(): Promise<void> {
    // Refill tokens based on time elapsed
    // Uses DynamoDB atomic counter updates
  }
}
```

**DynamoDB Schema**:
```typescript
// RateLimitBucket table
{
  bucketKey: string,        // PK: "gemini-api-rate-limit"
  rpm: number,              // Requests remaining in current minute
  tpm: number,              // Tokens remaining in current minute
  rpd: number,              // Requests remaining today
  lastRefillTimestamp: number,
  ttl: number               // Auto-delete old buckets
}
```

### 4. Translation Lambda Modification

**Current (`translateChunk`)**:
```typescript
export const handler = async (event: TranslateChunkEvent): Promise<void> => {
  const { jobId, chunk } = event;

  // ❌ Fetches context from previous chunk (sequential dependency)
  const context = await getContextFromPreviousChunk(jobId, chunk.chunkIndex);

  const result = await geminiClient.translate(chunk.text, {
    targetLanguage: chunk.targetLanguage,
    tone: chunk.tone
  }, context);

  await storeTranslatedChunk(jobId, chunk.chunkIndex, result);
};
```

**Proposed (Parallel-Safe)**:
```typescript
export const handler = async (event: TranslateChunkEvent): Promise<void> => {
  const { jobId, chunk } = event;

  // ✅ Uses pre-calculated context from chunk object (no dependencies)
  const context = {
    previousChunk: chunk.previousContext // Already in chunk metadata
  };

  // ✅ Acquire tokens from distributed rate limiter
  const rateLimiter = new DistributedRateLimiter();
  const estimatedTokens = estimateTokenCount(chunk.text);

  const acquired = await rateLimiter.acquire(estimatedTokens);
  if (!acquired) {
    throw new Error('Rate limit exceeded - will retry with exponential backoff');
  }

  const result = await geminiClient.translate(chunk.text, {
    targetLanguage: chunk.targetLanguage,
    tone: chunk.tone
  }, context);

  await storeTranslatedChunk(jobId, chunk.chunkIndex, result);
};
```

## Success Criteria

### Functional Requirements
- ✅ Parallel translation produces same quality output as sequential
- ✅ Context continuity maintained across chunks
- ✅ No translation errors or missing chunks
- ✅ Graceful handling of rate limit violations

### Performance Requirements
- ✅ **65K words**: Complete in <20 seconds (currently ~100s)
- ✅ **400K words**: Complete in <90 seconds (currently ~600s)
- ✅ **Speedup**: Minimum 5x improvement for large documents

### Reliability Requirements
- ✅ **Rate Limit Compliance**: Zero API rate limit violations
- ✅ **Error Rate**: <5% transient errors (retries succeed)
- ✅ **Success Rate**: >95% of jobs complete successfully

### Scalability Requirements
- ✅ **Concurrent Jobs**: Support 5+ simultaneous translation jobs
- ✅ **DynamoDB**: Distributed rate limiter handles high concurrency
- ✅ **Cost**: Performance improvement without significant cost increase

## Implementation Plan

### Phase 1: Distributed Rate Limiter (Week 1)
1. Create DynamoDB table for rate limit state
2. Implement `DistributedRateLimiter` class
3. Add comprehensive unit tests (token bucket logic)
4. Add integration tests (DynamoDB atomic updates)

### Phase 2: Parallel Translation (Week 2)
1. Modify `translateChunk` to use pre-calculated context
2. Update Step Functions Map state (`maxConcurrency: 10`)
3. Add retry logic for rate limit errors
4. Update CloudWatch metrics and alarms

### Phase 3: Testing & Validation (Week 3)
1. Integration tests: Parallel vs sequential translation comparison
2. Load testing: 10 concurrent jobs with large documents
3. Rate limit compliance testing
4. Performance benchmarking

### Phase 4: Documentation & Deployment (Week 4)
1. Update DEVELOPMENT-ROADMAP.md with completion status
2. Update API documentation
3. Deploy to dev environment
4. Production deployment after validation

## Risks & Mitigation

### Risk 1: Translation Quality Degradation
**Likelihood**: Low
**Impact**: High
**Mitigation**:
- Pre-calculated context already validated in chunking phase
- Comprehensive A/B testing: parallel vs sequential output comparison
- Rollback plan: Revert to `maxConcurrency: 1` if quality issues detected

### Risk 2: Rate Limit Violations
**Likelihood**: Medium
**Impact**: High
**Mitigation**:
- Distributed rate limiter with conservative limits
- Exponential backoff retry strategy
- CloudWatch alarms for rate limit violations
- Circuit breaker pattern for API calls

### Risk 3: DynamoDB Contention
**Likelihood**: Low
**Impact**: Medium
**Mitigation**:
- DynamoDB on-demand billing (auto-scaling)
- Conditional writes prevent race conditions
- Monitoring for throttling events
- Fallback to per-instance rate limiting if DynamoDB unavailable

### Risk 4: Increased AWS Costs
**Likelihood**: Low
**Impact**: Low
**Mitigation**:
- DynamoDB on-demand minimal cost for rate limit state (~$1/month)
- Faster processing reduces Lambda execution time (cost savings)
- Gemini free tier sufficient (no API cost increase)

## Alternatives Considered

### Alternative 1: Sequential Processing with Larger Chunks
**Rejected**: Larger chunks reduce translation quality and exceed context windows

### Alternative 2: Queue-Based Processing
**Rejected**: Adds unnecessary complexity; Step Functions Map already provides parallelization

### Alternative 3: Claude API Instead of Gemini
**Rejected**: Claude pricing ($3/1M tokens) exceeds budget; Gemini free tier meets cost target

### Alternative 4: Client-Side Rate Limiting
**Rejected**: Cannot coordinate across multiple Lambda instances

## Dependencies

### Required Implementations
- ✅ Chunk metadata includes pre-calculated context (already done)
- ✅ Gemini client with rate limiting (already done)
- ✅ **Distributed rate limiter (Phase 1 - COMPLETED via PR #39)**
  - DynamoDB table for rate limit state
  - DistributedRateLimiter class with token bucket algorithm
  - 95.65% test coverage with 21 comprehensive unit tests
  - Integration with translateChunk Lambda
  - Issue #25 resolved
- ⏳ Updated Step Functions definition (Phase 2 - PENDING)
  - Change maxConcurrency from 1 to 10
  - Update translateChunk to use previousContext
  - Add CloudWatch metrics and alarms

### External Dependencies
- AWS DynamoDB (for distributed state)
- Gemini API (5 RPM, 250K TPM limits)
- Step Functions (Map state parallelization)

## Rollout Strategy

1. **Dev Environment**: Deploy and validate with test documents
2. **Integration Testing**: Run full test suite with parallel processing
3. **Performance Benchmarking**: Measure actual speedup vs targets
4. **Staging Environment**: Deploy for final validation
5. **Production Deployment**: Gradual rollout with monitoring
6. **Rollback Plan**: Revert CDK changeset if issues detected

## Metrics & Monitoring

### Key Performance Indicators (KPIs)
- **Translation Speed**: Avg time per 10K words (target: <3 seconds)
- **API Rate Limit Compliance**: % of requests within limits (target: 100%)
- **Job Success Rate**: % of jobs completing successfully (target: >95%)
- **Concurrent Job Capacity**: Max simultaneous jobs (target: 5+)

### CloudWatch Metrics
- `TranslationSpeed`: Time from job start to completion
- `RateLimitViolations`: Count of 429 errors from Gemini API
- `DistributedRateLimiterAcquireFailures`: Rate limit denials
- `ParallelChunkProcessing`: Concurrent chunks being translated

### CloudWatch Alarms
- 🚨 **Critical**: Rate limit violations > 0 (immediate investigation)
- 🚨 **High**: Job failure rate > 5% (review and fix)
- ⚠️ **Medium**: Translation speed > target (performance degradation)

## Testing Strategy

### Unit Tests
- DistributedRateLimiter token bucket logic
- Token estimation for chunk text
- Rate limit error handling

### Integration Tests
- Parallel translation produces correct output
- DynamoDB atomic updates prevent race conditions
- Rate limiter coordinates across multiple Lambda instances

### Performance Tests
- Benchmark: 65K words (10 chunks) in <20s
- Benchmark: 400K words (60 chunks) in <90s
- Load test: 10 concurrent jobs

### Quality Assurance Tests
- A/B comparison: Parallel vs sequential translation output
- Context continuity validation
- Missing chunk detection

## Approval Requirements

Before implementation begins:
- [x] P0 (Cost Model) complete ✅ (Issue #13 closed)
- [x] Team lead approval (xlei-raymond) ✅
- [x] Architecture review ✅
- [x] Security review (distributed rate limiter) ✅
- [x] Cost analysis approval (<$55/month total) ✅

## Implementation Progress

### ✅ Phase 1: Distributed Rate Limiter (COMPLETED - PR #39)
- **Completion Date**: 2025-11-07
- **PR**: #39 merged to main
- **Deliverables**:
  - ✅ DynamoDB RateLimitBucket table design and CDK construct
  - ✅ DistributedRateLimiter implementation with token bucket algorithm
  - ✅ 95.65% test coverage with 21 comprehensive unit tests
  - ✅ Integration with translateChunk Lambda
  - ✅ Environment variables and IAM permissions
  - ✅ Jest test configuration with environment setup
  - 📋 Future enhancement tracked: RateLimitError exception (Issue #40)

### ✅ Phase 2: Parallel Translation (COMPLETED - 2025-11-08)
- **Completion Date**: 2025-11-08
- **PR**: #43 (open, ready for review)
- **Branch**: feature/enable-parallel-translation-phase2
- **Commits**:
  - `89196fc` - docs(openspec): Add P1 proposals aligned with team lead execution plan
  - `7785bb5` - feat(translation): Enable parallel translation with maxConcurrency: 10
  - `e026d79` - test: Add comprehensive tests for parallel translation behavior
  - `099682a` - docs: Update PROGRESS.md and OpenSpec for Phase 2 completion
  - `73f73d7` - test: Add comprehensive test coverage for parallel translation (98.05%)
  - `f74b562` - test: Fix infrastructure test for parallel translation
- **Deliverables**:
  - ✅ Updated Step Functions Map state to `maxConcurrency: 10`
  - ✅ translateChunk uses chunk.previousSummary directly (parallel-safe)
  - ✅ **Comprehensive test coverage: 98.05%** (328 total tests, +26 new tests)
  - ✅ **Infrastructure tests updated** to validate parallel processing (maxConcurrency: 10)
  - ✅ All 375 frontend + 328 backend tests passing (100% pass rate)
  - ✅ Integration with distributed rate limiter validated
  - ✅ Retry configuration for rate limit errors working
  - ✅ PROGRESS.md updated with Phase 7 completion
  - ✅ **OpenSpec P1 proposals** added (CI/CD, security, bugs, smoke tests)
  - 📋 CloudWatch metrics and alarms deferred to Phase 3

### ⏳ Phase 3: Testing & Validation (PENDING - Next Step)
- **Status**: Ready to begin after deployment
- **Tasks**:
  - Deploy to dev environment
  - End-to-end testing with 65K and 400K word documents
  - Validate actual performance improvement (target: 5-7x)
  - Monitor rate limit compliance in CloudWatch
  - Load testing with 5+ concurrent jobs

### ⏳ Phase 4: Documentation & Deployment (PENDING)

## References

- **DEVELOPMENT-ROADMAP.md**: Lines 78-106 (P1 specification)
- **Issue #23**: Enable Parallel Translation
- **Issue #25**: Distributed Rate Limiter
- **PR #33**: Step Functions orchestrator implementation
- **PR #6**: Gemini translation engine with rate limiting

---

**Status**: Phase 2 Complete - PR #43 Ready for Review and Merge
**Next Step**:
1. Team reviews and merges PR #43
2. Deploy to dev environment
3. Execute Phase 3 (E2E testing & performance validation)

**Branch**: feature/enable-parallel-translation-phase2
**Test Coverage**: 98.05% (328 backend tests + 375 frontend tests = 703 total tests passing)
