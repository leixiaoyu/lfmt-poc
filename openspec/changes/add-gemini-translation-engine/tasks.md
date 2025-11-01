# Implementation Tasks: Add Gemini Translation Engine

**Change ID:** `add-gemini-translation-engine`
**Status:** Not Started
**Created:** 2025-10-29

## Prerequisites

- [x] Phase 5 (Document Chunking) deployed to dev
- [x] Chunks stored correctly in S3 (verified)
- [x] OpenSpec proposal approved
- [ ] Gemini API key obtained from AI Studio
- [ ] API key stored in AWS Secrets Manager

## Phase 1: Gemini Client Setup (3-4 hours)

### 1.1 Dependencies and Configuration
- [ ] Install @google/genai package (`npm install @google/genai`)
- [ ] Add TypeScript types for Gemini API
- [ ] Create AWS Secrets Manager secret for API key
- [ ] Add GEMINI_API_KEY_SECRET_NAME to environment variables
- [ ] Update CDK stack to grant Lambda Secrets Manager access

### 1.2 Gemini Client Implementation
- [ ] Create `backend/functions/translation/geminiClient.ts`
- [ ] Implement `GeminiClient` class with initialization
- [ ] Add `translate()` method with parameters:
  - `text`: string (chunk content)
  - `targetLanguage`: string (language code)
  - `context`: string[] (previous chunks)
  - `options`: TranslationOptions
- [ ] Implement API key retrieval from Secrets Manager
- [ ] Add request/response type definitions
- [ ] Implement error handling for API errors
- [ ] Add retry logic with exponential backoff
- [ ] Add request logging (sanitize sensitive data)

### 1.3 Unit Tests
- [ ] Test Gemini client initialization
- [ ] Test successful translation request
- [ ] Test API key retrieval from Secrets Manager
- [ ] Test error handling (401, 429, 500 errors)
- [ ] Test retry logic with exponential backoff
- [ ] Mock Gemini API responses
- [ ] Achieve 90%+ test coverage

## Phase 2: Rate Limiting Service (2-3 hours)

### 2.1 Token Bucket Implementation
- [ ] Create `backend/functions/translation/rateLimiter.ts`
- [ ] Implement `RateLimiter` class
- [ ] Add token bucket for RPM (requests per minute) - 5 limit
- [ ] Add token bucket for TPM (tokens per minute) - 250K limit
- [ ] Add daily counter for RPD (requests per day) - 25 limit (free tier)
- [ ] Implement `checkLimit()` method returning allowed/denied
- [ ] Implement `consumeTokens()` method for successful requests
- [ ] Add token refill logic (time-based)

### 2.2 Queue Management
- [ ] Implement request queue for rate-limited requests
- [ ] Add priority queue support (fail-fast vs retry)
- [ ] Implement queue processor with configurable intervals
- [ ] Add queue size limits (prevent memory overflow)
- [ ] Implement queue metrics (depth, wait time)

### 2.3 Monitoring and Metrics
- [ ] Add CloudWatch custom metrics for:
  - Requests per minute (current rate)
  - Tokens per minute (current usage)
  - Requests per day (daily total)
  - Queue depth
  - Rate limit denials
- [ ] Create CloudWatch alarms for rate limit approaching
- [ ] Add logging for rate limit hits

### 2.4 Unit Tests
- [ ] Test token bucket with 5 RPM limit
- [ ] Test token bucket with 250K TPM limit
- [ ] Test daily limit enforcement (25 RPD)
- [ ] Test token refill over time
- [ ] Test queue behavior when rate limited
- [ ] Test priority queue ordering
- [ ] Achieve 90%+ test coverage

## Phase 3: Translation Lambda (3-4 hours)

### 3.1 Lambda Function Setup
- [ ] Create `backend/functions/translation/translateChunk.ts`
- [ ] Define Lambda handler signature
- [ ] Add environment variables:
  - DOCUMENT_BUCKET
  - JOBS_TABLE
  - GEMINI_API_KEY_SECRET_NAME
- [ ] Configure Lambda timeout (5 minutes)
- [ ] Configure Lambda memory (512 MB)
- [ ] Add IAM permissions:
  - S3 read (chunks/)
  - S3 write (translations/)
  - DynamoDB read/write (Jobs table)
  - Secrets Manager read

### 3.2 Translation Logic
- [ ] Implement `handler()` function
- [ ] Parse event (jobId, chunkIndex, targetLanguage)
- [ ] Retrieve job record from DynamoDB
- [ ] Validate job status (must be CHUNKED)
- [ ] Load current chunk from S3
- [ ] Load previous 2 chunks for context (if exist)
- [ ] Call Gemini client with chunk + context
- [ ] Store translated chunk in S3 (translations/ prefix)
- [ ] Update job record:
  - Increment chunksTranslated
  - Update translationStatus
  - Track token usage
  - Estimate cost
- [ ] Handle errors:
  - Retry transient failures (429, 500)
  - Fail job on permanent failures (401, 400)
  - Log all errors with context

### 3.3 Context Management
- [ ] Implement `loadChunksForContext()` function
- [ ] Retrieve previous N chunks (default: 2)
- [ ] Concatenate context with delimiters
- [ ] Validate total tokens < 250K (context + chunk)
- [ ] Dynamically reduce context if exceeding limit

### 3.4 Progress Tracking
- [ ] Calculate progress percentage
- [ ] Estimate time remaining based on rate
- [ ] Log progress every 10 chunks
- [ ] Update DynamoDB with progress fields

### 3.5 Unit Tests
- [ ] Test successful translation flow
- [ ] Test context loading (0, 1, 2 previous chunks)
- [ ] Test token limit enforcement
- [ ] Test job status updates
- [ ] Test error handling (API failures)
- [ ] Test retry logic
- [ ] Mock S3 and DynamoDB calls
- [ ] Mock Gemini client
- [ ] Achieve 90%+ test coverage

## Phase 4: API Integration (2 hours)

### 4.1 Start Translation Endpoint
- [ ] Create Lambda: `backend/functions/jobs/startTranslation.ts`
- [ ] Implement POST /jobs/{jobId}/translate endpoint
- [ ] Request validation:
  - jobId exists
  - Job status is CHUNKED
  - targetLanguage is valid (es, fr, it, de, zh)
  - User owns job
- [ ] Initialize translation:
  - Set translationStatus = IN_PROGRESS
  - Set translationStartedAt
  - Set targetLanguage
- [ ] Trigger first chunk translation (invoke translateChunk Lambda)
- [ ] Return response with estimated completion time
- [ ] Add Cognito authorization

### 4.2 Enhanced Status Endpoint
- [ ] Update `backend/functions/jobs/getJobStatus.ts`
- [ ] Add translation-specific fields:
  - translationStatus
  - chunksTranslated
  - totalChunks
  - estimatedCompletion
  - estimatedCost
  - targetLanguage
- [ ] Calculate progress percentage
- [ ] Include error messages if translation failed

### 4.3 API Gateway Configuration
- [ ] Add POST /jobs/{jobId}/translate route in CDK
- [ ] Configure Lambda integration
- [ ] Add Cognito authorizer
- [ ] Configure CORS for new endpoint
- [ ] Add request/response models
- [ ] Configure error responses (401, 403, 404, 500)

### 4.4 Integration Tests
- [ ] Test start translation with valid job
- [ ] Test start translation with invalid job
- [ ] Test authorization (wrong user)
- [ ] Test status endpoint with translation data
- [ ] Test error scenarios (already translating, not chunked)

## Phase 5: Orchestration and Testing (2-3 hours)

### 5.1 Translation Orchestration
- [ ] Implement sequential chunk processing
- [ ] After each chunk, trigger next chunk translation
- [ ] Handle completion (all chunks translated)
- [ ] Aggregate translated chunks (optional for Phase 6.5)
- [ ] Update job status to COMPLETED when done
- [ ] Send completion notification (CloudWatch event)

### 5.2 Error Recovery
- [ ] Implement retry policy (3 attempts per chunk)
- [ ] Track failed chunks separately
- [ ] Allow resume from last successful chunk
- [ ] Fail job after max retries exceeded
- [ ] Store error details in DynamoDB

### 5.3 Cost Tracking
- [ ] Calculate tokens used per request
- [ ] Estimate cost per translation ($0.075 per 1M input tokens free tier)
- [ ] Track cumulative cost in job record
- [ ] Add CloudWatch metric for daily cost
- [ ] Alert if exceeding budget threshold

### 5.4 End-to-End Testing
- [ ] Test with small document (1K words, ~1 chunk)
- [ ] Test with medium document (10K words, ~3 chunks)
- [ ] Test with real Gemini API (not mocked)
- [ ] Verify translation quality and coherence
- [ ] Test each target language (es, fr, it, de, zh)
- [ ] Test error scenarios:
  - API key invalid
  - Rate limit exceeded
  - Network failure
  - Invalid language code
- [ ] Verify cost tracking accuracy
- [ ] Monitor CloudWatch logs and metrics

### 5.5 Performance Testing
- [ ] Measure translation latency per chunk
- [ ] Verify rate limiting works correctly
- [ ] Test concurrent translation jobs (if applicable)
- [ ] Monitor Lambda cold start impact
- [ ] Optimize context loading if needed

## Phase 6: Infrastructure and Deployment (1-2 hours)

### 6.1 CDK Stack Updates
- [ ] Add translateChunk Lambda to stack
- [ ] Add startTranslation Lambda to stack
- [ ] Configure Lambda environment variables
- [ ] Add Secrets Manager access policy
- [ ] Add API Gateway routes
- [ ] Configure CloudWatch alarms
- [ ] Add cost monitoring dashboard

### 6.2 Deployment
- [ ] Deploy to dev environment
- [ ] Verify all Lambda functions deployed
- [ ] Test API endpoints in dev
- [ ] Monitor initial translations
- [ ] Check CloudWatch logs for errors

### 6.3 Documentation
- [ ] Update README.md with Phase 6 completion
- [ ] Update PROGRESS.md with translation engine status
- [ ] Document API endpoints (OpenAPI spec optional)
- [ ] Add usage examples
- [ ] Document rate limits and cost estimates
- [ ] Update architecture diagrams

## Completion Criteria

- [ ] All tasks above marked complete
- [ ] 90%+ test coverage for new code
- [ ] All unit tests passing (backend: 209+ tests)
- [ ] Integration tests passing
- [ ] End-to-end test successful with real API
- [ ] Deployed to dev environment
- [ ] Documentation updated
- [ ] Code reviewed and approved
- [ ] Merged to main branch

## Blockers and Dependencies

**Current Blockers:**
- [ ] Need Gemini API key from AI Studio
- [ ] Need approval for API cost budget

**Dependencies:**
- Phase 5 (Document Chunking) must be 100% complete ✅
- AWS Secrets Manager available in us-east-1 ✅
- @google/genai package available in npm ✅

## Time Tracking

**Estimated Total:** 12-16 hours
**Actual Time:** TBD

**Phase Breakdown:**
- Phase 1 (Gemini Client): ___ hours
- Phase 2 (Rate Limiting): ___ hours
- Phase 3 (Translation Lambda): ___ hours
- Phase 4 (API Integration): ___ hours
- Phase 5 (Testing): ___ hours
- Phase 6 (Deployment): ___ hours

## Notes

- Start with small documents (1K words) for testing
- Monitor API costs closely during testing
- Free tier limits: 5 RPM, 250K TPM, 25 RPD
- Consider upgrading to paid tier if needed
- Translation quality may vary by language
- Context size (2 chunks) is adjustable based on results
