# Proposal: Add Gemini Translation Engine

**Change ID:** `add-gemini-translation-engine`
**Status:** Draft
**Created:** 2025-10-29
**Author:** Raymond Lei
**Type:** Feature Addition

## Overview

Implement Phase 6 of the LFMT POC project by integrating Google Gemini API (AI Studio) as the translation engine. This enables actual document translation after chunks are created, completing the core value proposition of the service.

## Problem Statement

**Current State:**
- ✅ Documents can be uploaded (Phase 4 complete)
- ✅ Documents are automatically chunked with 3,500 tokens + 250 overlap (Phase 5 complete @ 70%)
- ❌ No translation capability - chunks sit in S3 unused
- ❌ No API integration to perform actual translations
- ❌ Users cannot get translated output

**Impact:**
- Core value proposition (long-form document translation) is not functional
- Cannot validate translation quality or coherence across chunks
- Cannot test end-to-end user workflow
- Project stuck at ~35% completion

## Proposed Solution

Integrate Google Gemini API (AI Studio) with the following architecture:

### Translation Service Components

1. **Gemini Client Wrapper** (`backend/functions/translation/geminiClient.ts`)
   - Google Gen AI SDK (@google/genai v1.27.0+)
   - API key authentication via AWS Secrets Manager
   - Request/response handling with TypeScript types
   - Error handling and retries with exponential backoff

2. **Rate Limiting Service** (`backend/functions/translation/rateLimiter.ts`)
   - Token bucket algorithm for rate control
   - Track: RPM (requests/minute), TPM (tokens/minute), RPD (requests/day)
   - Queue management for concurrent translation jobs
   - Respect Gemini free tier limits: 5 RPM, 250K TPM

3. **Translation Lambda** (`backend/functions/translation/translateChunk.ts`)
   - Read chunks from S3 (chunks/{userId}/{fileId}/{chunkId}.json)
   - Call Gemini API with:
     - Current chunk content
     - Previous 1-2 chunks for context continuity
     - Target language specification
     - Translation instructions (maintain formatting, tone, etc.)
   - Store translated chunks in S3 (translations/{userId}/{fileId}/{chunkId}.json)
   - Update job status in DynamoDB
   - Handle errors gracefully (retry, fail job, notify user)

4. **Translation Orchestration**
   - Sequential processing of chunks (maintains order)
   - Context management (sliding window: previous chunks inform next translation)
   - Progress tracking (chunks completed / total chunks)
   - Error recovery (retry failed chunks, skip and continue)

### API Endpoints

**New Endpoint:** `POST /jobs/{jobId}/translate`
- Initiates translation for a chunked document
- Parameters:
  - `jobId`: The job ID from upload/chunking
  - `targetLanguage`: Target language code (es, fr, it, de, zh)
  - `options`: Translation preferences (formal/informal, preserve formatting, etc.)
- Returns: Job status with translationId

**Enhanced Endpoint:** `GET /jobs/{jobId}/status`
- Add translation progress fields:
  - `translationStatus`: NOT_STARTED | IN_PROGRESS | COMPLETED | FAILED
  - `chunksTranslated`: Number of chunks completed
  - `totalChunks`: Total chunks to translate
  - `estimatedCompletion`: Time estimate based on rate limits

### Data Models

**Translation Job Record** (DynamoDB - Jobs table):
```typescript
{
  jobId: string;
  userId: string;
  translationStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  targetLanguage: string;
  translationStartedAt?: string;
  translationCompletedAt?: string;
  chunksTranslated: number;
  totalChunks: number;
  estimatedTokensUsed: number;
  estimatedCost: number;
  errorMessage?: string;
}
```

**Translated Chunk** (S3 - translations/ prefix):
```typescript
{
  chunkId: string;
  chunkIndex: number;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  tokenCount: number;
  translatedAt: string;
  contextChunks: string[]; // IDs of chunks used for context
}
```

## Technical Decisions

### 1. Gemini API vs Claude API

**Decision:** Use Gemini API (AI Studio)
**Rationale:**
- User requested Gemini over Claude
- Free tier: 5 RPM, 250K TPM (sufficient for POC)
- Official TypeScript SDK available (@google/genai)
- Simpler authentication (API key vs AWS Bedrock)
- Cost-effective for testing phase

### 2. AI Studio vs Vertex AI

**Decision:** Google AI Studio
**Rationale:**
- Faster setup (<3 minutes for API key)
- No Google Cloud project setup required
- Sufficient for POC scale
- Can migrate to Vertex AI later if needed

### 3. Sequential vs Parallel Translation

**Decision:** Sequential processing with context
**Rationale:**
- Maintains translation coherence across chunks
- Previous chunks provide context for next translation
- Respects rate limits (5 RPM)
- Simpler error recovery

### 4. Rate Limiting Strategy

**Decision:** Token bucket algorithm
**Rationale:**
- Industry standard for API rate limiting
- Handles burst traffic gracefully
- Easy to implement and test
- Supports multiple limit dimensions (RPM, TPM, RPD)

### 5. Context Management

**Decision:** Sliding window with 2 previous chunks
**Rationale:**
- Balance between context and token usage
- 2 chunks × 3,750 tokens = 7,500 tokens context
- Leaves ~242,500 tokens for current chunk translation
- Maintains narrative continuity

## Implementation Plan

### Phase 1: Gemini Client Setup (3-4 hours)
1. Install @google/genai SDK
2. Create Gemini client wrapper
3. Set up API key in AWS Secrets Manager
4. Implement request/response handling
5. Add error handling and retries
6. Unit tests for client

### Phase 2: Rate Limiting (2-3 hours)
1. Implement token bucket algorithm
2. Track RPM, TPM, RPD metrics
3. Add queue management
4. Test rate limit enforcement
5. Add CloudWatch metrics

### Phase 3: Translation Lambda (3-4 hours)
1. Create translateChunk Lambda function
2. Implement chunk retrieval from S3
3. Call Gemini API with context
4. Store translated chunks
5. Update job status
6. Handle errors

### Phase 4: API Integration (2 hours)
1. Add POST /jobs/{jobId}/translate endpoint
2. Update GET /jobs/{jobId}/status endpoint
3. Add Cognito authorization
4. API Gateway configuration

### Phase 5: Testing (2-3 hours)
1. Unit tests for all components
2. Integration tests with mock Gemini API
3. End-to-end test with real Gemini API
4. Cost monitoring and alerts
5. Performance testing

**Total Estimated Time:** 12-16 hours

## Success Criteria

**Functional Requirements:**
- [ ] Can translate small document (1K-10K words) end-to-end
- [ ] Translation maintains coherence across chunks
- [ ] Target languages supported: Spanish, French, Italian, German, Chinese
- [ ] Job status accurately reflects translation progress
- [ ] Errors handled gracefully with retry logic

**Performance Requirements:**
- [ ] Translation respects rate limits (5 RPM, 250K TPM)
- [ ] No dropped chunks or out-of-order translation
- [ ] Progress updates every 30 seconds
- [ ] Cost tracking accurate within 5%

**Quality Requirements:**
- [ ] 90%+ test coverage for new code
- [ ] All unit tests passing
- [ ] Integration tests with mocked API
- [ ] End-to-end test with real API successful
- [ ] Error scenarios documented and tested

## Risks and Mitigation

### Risk 1: Rate Limit Throttling
**Probability:** High
**Impact:** Medium
**Mitigation:**
- Implement robust token bucket with queue
- Add retry logic with exponential backoff
- Monitor rate limit headers from API
- Alert user if job will take excessive time

### Risk 2: API Cost Overruns
**Probability:** Medium
**Impact:** High
**Mitigation:**
- Track token usage per request
- Estimate cost before starting translation
- Set CloudWatch alarms at 80% budget
- Abort job if exceeds cost threshold

### Risk 3: Translation Quality Issues
**Probability:** Medium
**Impact:** High
**Mitigation:**
- Include context from previous chunks
- Provide clear translation instructions to model
- Test with various document types
- Allow user feedback on quality

### Risk 4: Context Window Exceeded
**Probability:** Low
**Impact:** Medium
**Mitigation:**
- Validate chunk + context < 250K tokens
- Dynamically adjust context size if needed
- Log warnings when approaching limit

## Out of Scope

- Legal attestation system (defer to Phase 7)
- Chunk reassembly into single document (defer to Phase 6.5)
- Multiple translation engines (only Gemini for now)
- Translation memory / glossary support
- User-customizable translation prompts
- Batch translation of multiple documents
- Real-time progress via WebSocket (use polling)

## Dependencies

**External:**
- Google Gemini API access (AI Studio API key)
- @google/genai npm package
- AWS Secrets Manager for API key storage

**Internal:**
- Phase 5 (Document Chunking) must be 100% complete
- Chunks must be stored correctly in S3
- Job status tracking in DynamoDB functional

## Questions for Review

1. **API Key Storage:** Should we use AWS Secrets Manager or Parameter Store?
   - **Recommendation:** Secrets Manager (better for API keys, automatic rotation)

2. **Error Recovery:** Retry failed chunks N times or fail entire job?
   - **Recommendation:** Retry 3 times, then fail job (user can restart)

3. **Context Size:** 2 previous chunks sufficient or adjust dynamically?
   - **Recommendation:** Start with 2, adjust based on testing

4. **Cost Estimation:** Show estimate before starting translation?
   - **Recommendation:** Yes - prevent surprises, allow user approval

5. **Language Detection:** Auto-detect source language or require user input?
   - **Recommendation:** Auto-detect (Gemini can handle this)

## Approval

**Reviewers:**
- [ ] Raymond Lei (Product Owner)
- [ ] Claude Code (Implementation)

**Approval Criteria:**
- Proposal addresses Phase 6 requirements
- Technical decisions documented and justified
- Risks identified with mitigation plans
- Implementation plan is realistic
- OpenSpec validation passes

---

**Next Steps After Approval:**
1. Review and approve this proposal
2. Obtain Gemini API key from AI Studio
3. Create tasks.md with detailed implementation checklist
4. Begin Phase 1: Gemini Client Setup
5. Regular progress updates in PROGRESS.md
