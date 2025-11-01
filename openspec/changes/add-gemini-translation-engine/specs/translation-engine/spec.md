# Translation Engine Specification

**Capability:** translation-engine
**Status:** Draft
**Created:** 2025-10-29

## ADDED Requirements

### Requirement: Gemini API Client Integration

The system SHALL integrate with Google Gemini API (AI Studio) to enable document translation capabilities.

#### Scenario: Initialize Gemini client with API key

**Given** the system has access to Gemini API key from AWS Secrets Manager
**When** the GeminiClient is initialized
**Then** it SHALL successfully authenticate with the Gemini API
**And** it SHALL be ready to accept translation requests

#### Scenario: Translate text with target language

**Given** a GeminiClient is initialized
**And** a text chunk of 3,500 tokens
**And** a target language code (e.g., "es" for Spanish)
**When** the translate() method is called
**Then** it SHALL send a request to Gemini API
**And** it SHALL return translated text in the target language
**And** it SHALL track token usage for cost monitoring

#### Scenario: Handle API authentication failure

**Given** an invalid or expired API key
**When** the GeminiClient attempts to make a request
**Then** it SHALL receive a 401 Unauthorized error
**And** it SHALL log the authentication failure
**And** it SHALL throw a descriptive error message
**And** it SHALL NOT retry authentication errors

### Requirement: Rate Limiting Enforcement

The system SHALL enforce Gemini API free tier rate limits to prevent quota exhaustion and API blocking.

#### Scenario: Enforce requests per minute limit

**Given** the Gemini API free tier allows 5 requests per minute
**And** 5 requests have been made in the current minute
**When** a 6th request is attempted
**Then** the RateLimiter SHALL deny the request
**And** it SHALL queue the request for processing
**And** it SHALL process the queued request after the minute resets

#### Scenario: Enforce tokens per minute limit

**Given** the Gemini API free tier allows 250,000 tokens per minute
**And** 245,000 tokens have been used in the current minute
**When** a request requiring 10,000 tokens is attempted
**Then** the RateLimiter SHALL deny the request
**And** it SHALL queue the request
**And** it SHALL process the request when sufficient tokens are available

#### Scenario: Track daily request quota

**Given** the Gemini API free tier allows 25 requests per day
**And** 25 requests have been made today
**When** another request is attempted
**Then** the RateLimiter SHALL deny the request
**And** it SHALL return an error indicating daily quota exceeded
**And** it SHALL reset the counter at midnight Pacific time

### Requirement: Translation Lambda Function

The system SHALL provide a Lambda function that translates document chunks using the Gemini API with context awareness.

#### Scenario: Translate first chunk without context

**Given** a document has been chunked
**And** the first chunk is ready for translation
**And** there are no previous chunks
**When** the translateChunk Lambda is invoked
**Then** it SHALL load the first chunk from S3
**And** it SHALL call Gemini API with only the chunk content
**And** it SHALL store the translated chunk in S3
**And** it SHALL update the job status to show 1 chunk translated

#### Scenario: Translate middle chunk with context

**Given** a document with 10 chunks
**And** chunks 1-4 have been translated
**And** chunk 5 is ready for translation
**When** the translateChunk Lambda is invoked for chunk 5
**Then** it SHALL load chunk 5 from S3
**And** it SHALL load chunks 3-4 as context (previous 2 chunks)
**And** it SHALL call Gemini API with context + current chunk
**And** it SHALL store the translated chunk 5 in S3
**And** it SHALL update the job to show 5 chunks translated

#### Scenario: Handle translation API error with retry

**Given** a chunk is being translated
**And** the Gemini API returns a 500 Internal Server Error
**When** the translateChunk Lambda processes the error
**Then** it SHALL retry the request after exponential backoff
**And** it SHALL retry up to 3 times
**And** if all retries fail, it SHALL mark the job as FAILED
**And** it SHALL log the error details for debugging

### Requirement: Translation API Endpoints

The system SHALL provide REST API endpoints to initiate and monitor translation jobs.

#### Scenario: Start translation for chunked document

**Given** a user has uploaded and chunked a document
**And** the job status is CHUNKED
**And** the user is authenticated
**When** the user sends POST /jobs/{jobId}/translate with targetLanguage="es"
**Then** the system SHALL validate the jobId exists
**And** it SHALL validate the user owns the job
**And** it SHALL set translationStatus to IN_PROGRESS
**And** it SHALL trigger the first chunk translation
**And** it SHALL return estimated completion time

#### Scenario: Reject translation for non-chunked document

**Given** a document that has not been chunked
**And** the job status is PENDING_UPLOAD
**When** the user sends POST /jobs/{jobId}/translate
**Then** the system SHALL return 400 Bad Request
**And** the error message SHALL indicate "Document must be chunked before translation"

#### Scenario: Get translation progress

**Given** a translation is in progress
**And** 5 of 10 chunks have been translated
**When** the user sends GET /jobs/{jobId}/status
**Then** the response SHALL include translationStatus: "IN_PROGRESS"
**And** it SHALL include chunksTranslated: 5
**And** it SHALL include totalChunks: 10
**And** it SHALL include progress percentage: 50%
**And** it SHALL include estimatedCompletion timestamp

### Requirement: Context Management for Translation Continuity

The system SHALL maintain translation context across chunks to ensure coherent narrative flow.

#### Scenario: Include previous chunks as context

**Given** a document is being translated sequentially
**And** chunk N is ready for translation
**And** chunks N-2 and N-1 have been translated
**When** the system translates chunk N
**Then** it SHALL include translated chunks N-2 and N-1 as context
**And** the context SHALL be prepended to the current chunk
**And** the total token count (context + chunk) SHALL NOT exceed 250,000 tokens

#### Scenario: Reduce context when approaching token limit

**Given** chunk N is 200,000 tokens
**And** previous 2 chunks total 60,000 tokens
**And** the Gemini API limit is 250,000 tokens
**When** the system prepares the translation request
**Then** it SHALL detect the token limit would be exceeded
**And** it SHALL reduce context to only 1 previous chunk
**And** if still exceeding, it SHALL translate without context
**And** it SHALL log a warning about context reduction

### Requirement: Cost Tracking and Monitoring

The system SHALL track token usage and estimated costs for translation operations.

#### Scenario: Calculate cost for translation request

**Given** a translation request uses 10,000 input tokens
**And** the Gemini API pricing is $0.075 per 1M input tokens (free tier)
**When** the translation completes
**Then** the system SHALL calculate cost as (10,000 / 1,000,000) * $0.075 = $0.00075
**And** it SHALL add this cost to the job's estimatedCost field
**And** it SHALL emit a CloudWatch metric with the cost

#### Scenario: Alert when approaching budget limit

**Given** the monthly budget is $50
**And** the current month's usage is $45
**When** a new translation is requested that would cost $6
**Then** the system SHALL emit a CloudWatch alarm
**And** the alarm SHALL notify administrators
**And** the system SHALL still allow the translation (not block)
**And** it SHALL log a warning about budget threshold

### Requirement: Error Handling and Recovery

The system SHALL gracefully handle translation failures and provide recovery mechanisms.

#### Scenario: Retry transient API failures

**Given** a chunk translation fails with a 429 Rate Limit error
**When** the system processes the error
**Then** it SHALL wait for the rate limit window to reset
**And** it SHALL retry the request
**And** it SHALL NOT mark the job as failed
**And** it SHALL log the retry attempt

#### Scenario: Fail job on permanent errors

**Given** a chunk translation fails with a 400 Bad Request error
**And** the error indicates invalid input format
**When** the system retries 3 times with the same error
**Then** it SHALL mark the job status as TRANSLATION_FAILED
**And** it SHALL store the error message in the job record
**And** it SHALL NOT attempt further retries
**And** it SHALL notify the user of the failure

#### Scenario: Resume translation from last successful chunk

**Given** a translation job failed after translating 7 of 10 chunks
**And** the error was transient (network timeout)
**When** the user retries the translation
**Then** the system SHALL resume from chunk 8
**And** it SHALL NOT re-translate chunks 1-7
**And** it SHALL use chunk 7 as context for chunk 8

### Requirement: Multi-Language Support

The system SHALL support translation to multiple target languages.

#### Scenario: Translate to Spanish

**Given** a document in English
**And** the user selects target language "es" (Spanish)
**When** the translation is performed
**Then** the Gemini API SHALL receive targetLanguage: "es"
**And** the output SHALL be in Spanish
**And** the job record SHALL show targetLanguage: "es"

#### Scenario: Validate supported languages

**Given** the system supports [es, fr, it, de, zh]
**When** the user requests translation with targetLanguage: "ja" (Japanese)
**Then** the system SHALL return 400 Bad Request
**And** the error SHALL list supported languages
**And** the error SHALL indicate Japanese is not supported

#### Scenario: Auto-detect source language

**Given** a document is uploaded without specifying source language
**When** the translation begins
**Then** the Gemini API SHALL automatically detect the source language
**And** the system SHALL NOT require explicit source language input
**And** the detected language SHALL be logged for reference

## Design Notes

### Token Bucket Algorithm for Rate Limiting

```typescript
interface TokenBucket {
  capacity: number;        // Maximum tokens (e.g., 5 for RPM)
  tokens: number;          // Available tokens
  refillRate: number;      // Tokens per second
  lastRefill: number;      // Timestamp of last refill
}

function checkLimit(bucket: TokenBucket, required: number): boolean {
  refillTokens(bucket);
  return bucket.tokens >= required;
}

function refillTokens(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000; // seconds
  const tokensToAdd = elapsed * bucket.refillRate;
  bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
  bucket.lastRefill = now;
}
```

### Context Management Strategy

```typescript
interface TranslationContext {
  currentChunk: string;
  previousChunks: string[];
  totalTokens: number;
  maxTokens: number;
}

function prepareContext(
  currentChunk: string,
  previousChunks: string[],
  maxTokens: number
): TranslationContext {
  let totalTokens = countTokens(currentChunk);
  const contextChunks: string[] = [];

  // Add previous chunks until we hit token limit
  for (let i = previousChunks.length - 1; i >= 0 && contextChunks.length < 2; i--) {
    const chunkTokens = countTokens(previousChunks[i]);
    if (totalTokens + chunkTokens < maxTokens) {
      contextChunks.unshift(previousChunks[i]);
      totalTokens += chunkTokens;
    } else {
      break; // Stop adding context
    }
  }

  return {
    currentChunk,
    previousChunks: contextChunks,
    totalTokens,
    maxTokens
  };
}
```

## Implementation Priority

1. **P0 (Must Have):** Gemini API client, rate limiting, translation Lambda
2. **P1 (Should Have):** Context management, cost tracking, error recovery
3. **P2 (Nice to Have):** Multi-language validation, auto-detect source language

## Testing Strategy

- **Unit Tests:** Mock Gemini API responses, test rate limiter logic
- **Integration Tests:** Use test API key with small documents
- **E2E Tests:** Full workflow with real API and monitoring costs
- **Performance Tests:** Verify rate limits enforced correctly

## Open Questions

1. Should we support custom translation prompts? (Answer: No, defer to later)
2. Should we aggregate translated chunks into one file? (Answer: Phase 6.5)
3. Should we cache translations? (Answer: No, not needed for POC)
