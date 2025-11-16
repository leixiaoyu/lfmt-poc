# Integration Test Performance Analysis

## Current Performance Issues

### Test Execution Times
- **Health Check Tests**: ~37 tests pass quickly
- **API Integration Tests**: Blocked by compilation error (now fixed)
- **Translation Flow Tests**: **751 seconds** (12.5 minutes) ⚠️
- **Total Test Suite**: **765 seconds** (12.77 minutes) ⚠️

### Root Causes

#### 1. Actual Translation Execution
The translation flow tests perform **real translations** via Gemini API:
- Creates real jobs
- Uploads real documents to S3
- Triggers actual chunking Lambda
- Calls Gemini API for translation
- Polls for completion

**Impact**: Single translation can take 5-10 minutes

#### 2. Aggressive Polling Intervals
```typescript
// test-helpers.ts:338-343
waitForJobStatus: pollInterval = 2000ms (2 seconds)
waitForTranslation: pollInterval = 5000ms (5 seconds)
maxWaitTime = 60000-180000ms (1-3 minutes)
```

**Impact**: Wasteful API calls, slower feedback

#### 3. Sequential Test Execution
```bash
jest --testPathPattern=integration --runInBand
```

**Impact**: Tests run one at a time, no parallelization

#### 4. Long Max Wait Times
- Translation: 180 seconds (3 minutes)
- Chunking: 60 seconds (1 minute)
- Job status: 60 seconds (1 minute)

**Impact**: Tests hang for minutes even when operations fail early

### Total Time Breakdown (Estimated)
```
Translation Flow Test (751s):
  - User registration: ~2s
  - Login: ~2s
  - Upload request: ~2s
  - S3 upload: ~3s
  - Wait for chunking: ~30s
  - Start translation: ~2s
  - Wait for translation: ~700s ⚠️ (BOTTLENECK)
  - Verification: ~10s
```

## Optimization Recommendations

### Short-Term (Quick Wins)

#### 1. Reduce Poll Intervals
```typescript
// Before
waitForJobStatus: pollInterval = 2000ms
waitForTranslation: pollInterval = 5000ms

// After  
waitForJobStatus: pollInterval = 1000ms (50% faster)
waitForTranslation: pollInterval = 2000ms (60% faster)
```

**Expected Savings**: 20-30% reduction in wait time

#### 2. Reduce Max Wait Times
```typescript
// Before
waitForTranslation: maxWaitTime = 180000ms (3 minutes)
waitForChunking: maxWaitTime = 60000ms (1 minute)

// After
waitForTranslation: maxWaitTime = 90000ms (1.5 minutes)
waitForChunking: maxWaitTime = 30000ms (30 seconds)
```

**Expected Savings**: Faster failure detection

#### 3. Skip Translation for Most Tests
```typescript
// Create separate test suites:
// - integration-basic.test.ts (NO translation, <2 minutes)
// - integration-translation.test.ts (WITH translation, ~10 minutes, optional)

// Run fast tests by default:
npm run test:integration -- --testPathIgnorePatterns=translation-flow
```

**Expected Savings**: 90% time reduction for most CI runs

### Medium-Term

#### 4. Mock Translation Engine
```typescript
// Use env variable to enable mock mode
if (process.env.MOCK_TRANSLATION === 'true') {
  // Return fake translation immediately
  return { status: 'COMPLETED', translatedText: '...' };
}
```

**Expected Savings**: Translation tests complete in seconds, not minutes

#### 5. Parallel Test Execution
```bash
# Remove --runInBand for independent tests
jest --testPathPattern=integration --maxWorkers=2
```

**Expected Savings**: 40-50% reduction for independent tests

### Long-Term

#### 6. Test Data Caching
- Pre-create test users
- Pre-upload test documents
- Reuse chunked documents

**Expected Savings**: 30-40% reduction in setup time

#### 7. Dedicated Test Infrastructure
- Separate Cognito pool for tests
- Mock S3 events locally
- LocalStack for DynamoDB

**Expected Savings**: 60-70% reduction in cloud API latency

## Implementation Priority

### Phase 1 (Immediate - 2 hours)
- ✅ Fix variable redeclaration error
- [ ] Reduce poll intervals (1s, 2s)
- [ ] Reduce max wait times (30s, 90s)
- [ ] Split test suites (basic vs translation)

**Target**: < 5 minutes for basic integration tests

### Phase 2 (This Sprint - 1 day)
- [ ] Add MOCK_TRANSLATION environment variable
- [ ] Create separate translation test suite
- [ ] Update CI/CD to run basic tests on every PR

**Target**: < 2 minutes for PR validation

### Phase 3 (Future - 1 week)
- [ ] Implement test data caching
- [ ] Enable parallel test execution
- [ ] Add LocalStack for local testing

**Target**: < 1 minute for local testing

## Success Metrics

| Metric | Current | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|---------|
| Basic Integration Tests | 765s | 300s | 120s | 60s |
| Translation Tests | 751s | 400s | 600s | 300s |
| CI/CD Pipeline Time | 26min | 15min | 8min | 5min |
| Developer Feedback Loop | 12min | 5min | 2min | 1min |

## References

- `backend/functions/__tests__/integration/helpers/test-helpers.ts:338-454`
- `backend/functions/__tests__/integration/translation-flow.integration.test.ts:238-340`
- GitHub Actions logs: Run #19395998371

---

**Last Updated**: 2025-11-15
**Author**: Claude Code
**Status**: Analysis Complete, Awaiting Implementation
