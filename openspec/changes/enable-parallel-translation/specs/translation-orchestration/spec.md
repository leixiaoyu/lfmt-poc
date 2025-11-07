# Translation Orchestration Capability

## MODIFIED Requirements

### Requirement: Parallel Chunk Processing
The translation orchestration system MUST support concurrent processing of multiple document chunks to improve translation throughput.

**Rationale**: Sequential processing creates a performance bottleneck. Documents with 60 chunks (400K words) currently take 600 seconds to translate sequentially. Parallel processing can reduce this to 60-90 seconds, achieving 6-10x speedup.

#### Scenario: Translate 10-chunk document with parallel processing
- **GIVEN** A document has been chunked into 10 chunks with pre-calculated context windows
- **WHEN** The Step Functions workflow processes the chunks
- **THEN** All 10 chunks SHALL be translated concurrently (up to maxConcurrency limit)
- **AND** Each chunk SHALL use its pre-calculated `previousContext` from chunk metadata
- **AND** Translation SHALL complete in <20 seconds (vs ~100s sequential)
- **AND** All translated chunks SHALL be stored in S3 with correct indices
- **AND** Job status SHALL be updated to COMPLETED when all chunks finish

#### Scenario: Respect maxConcurrency limit during parallel processing
- **GIVEN** The Step Functions Map state is configured with `maxConcurrency: 10`
- **WHEN** A 60-chunk document is being translated
- **THEN** A maximum of 10 chunks SHALL be processed simultaneously
- **AND** As each chunk completes, the next chunk SHALL start processing
- **AND** The system SHALL NOT exceed the configured concurrency limit
- **AND** All 60 chunks SHALL eventually be processed

#### Scenario: Handle parallel translation with rate limiting
- **GIVEN** Multiple chunks are being translated concurrently
- **WHEN** The Gemini API rate limit is approached
- **THEN** The distributed rate limiter SHALL coordinate token allocation across all concurrent chunks
- **AND** Chunks SHALL wait if insufficient tokens are available
- **AND** No chunk SHALL violate the API rate limits (5 RPM, 250K TPM)
- **AND** Failed acquisitions SHALL trigger exponential backoff retry

#### Scenario: Maintain translation context continuity in parallel mode
- **GIVEN** Chunks are processed in parallel (not sequential order)
- **WHEN** Chunk N completes before chunk N-1
- **THEN** Chunk N SHALL still have access to its pre-calculated context from chunk N-1
- **AND** Translation quality SHALL match sequential processing quality
- **AND** Context windows SHALL remain consistent (250-token overlap)
- **AND** Final translated document SHALL maintain coherence

### Requirement: Configuration Parameters
The translation orchestration system MUST provide configurable concurrency limits to balance performance and API constraints.

#### Scenario: Configure maximum concurrency for translation jobs
- **GIVEN** The system administrator wants to tune performance
- **WHEN** The `maxConcurrency` parameter is set in the Step Functions Map state
- **THEN** The value SHALL be between 1 (sequential) and 20 (maximum parallel)
- **AND** The default value SHALL be 10 (balanced performance)
- **AND** The value SHALL be enforceable in CloudFormation/CDK configuration
- **AND** Changing the value SHALL require infrastructure deployment

#### Scenario: Override concurrency for specific job types
- **GIVEN** A large document (400K words, 60 chunks) is being processed
- **WHEN** The job is submitted with custom configuration
- **THEN** The system SHALL use the configured maxConcurrency value
- **AND** Performance metrics SHALL be tracked separately for different concurrency levels
- **AND** The system SHALL NOT exceed Gemini API limits regardless of concurrency

## ADDED Requirements

### Requirement: Distributed Coordination
The translation orchestration system MUST coordinate parallel chunk processing across multiple Lambda instances to prevent API rate limit violations.

**Rationale**: Each Lambda instance processing a chunk needs to coordinate with other concurrent instances to ensure the aggregate API usage stays within Gemini's limits (5 RPM, 250K TPM, 25 RPD).

#### Scenario: Coordinate token usage across concurrent Lambda instances
- **GIVEN** 10 chunks are being translated concurrently by 10 different Lambda instances
- **WHEN** Each Lambda instance requests tokens from the distributed rate limiter
- **THEN** Token allocation SHALL be atomic and race-condition-free
- **AND** The total allocated tokens SHALL NOT exceed the per-minute limit
- **AND** Each instance SHALL receive a fair share of available tokens
- **AND** DynamoDB conditional writes SHALL prevent double-allocation

#### Scenario: Handle DynamoDB unavailability during parallel translation
- **GIVEN** The distributed rate limiter cannot connect to DynamoDB
- **WHEN** A Lambda instance attempts to acquire tokens
- **THEN** The Lambda SHALL fall back to per-instance rate limiting
- **AND** Translation SHALL continue with reduced concurrency
- **AND** An error metric SHALL be emitted to CloudWatch
- **AND** The job SHALL NOT fail due to rate limiter unavailability

### Requirement: Error Handling
The translation orchestration system MUST handle partial failures in parallel processing without losing translated chunks or corrupting job state.

#### Scenario: Handle individual chunk failure in parallel batch
- **GIVEN** 10 chunks are being processed in parallel
- **WHEN** Chunk 5 fails due to a transient API error
- **THEN** The failed chunk SHALL retry with exponential backoff (2s, 4s, 8s)
- **AND** Other chunks SHALL continue processing unaffected
- **AND** If retries are exhausted, the entire job SHALL be marked as FAILED
- **AND** Successfully translated chunks SHALL be preserved in S3
- **AND** The job status SHALL indicate which chunk failed

#### Scenario: Handle rate limit violation during parallel processing
- **GIVEN** Multiple chunks are processed faster than rate limits allow
- **WHEN** A chunk receives a 429 (Rate Limit) error from Gemini API
- **THEN** The Step Functions workflow SHALL retry with exponential backoff
- **AND** The distributed rate limiter SHALL throttle new requests
- **AND** Other in-flight chunks SHALL complete normally
- **AND** The job SHALL eventually succeed once rate limits reset
- **AND** A CloudWatch alarm SHALL fire for rate limit violations

### Requirement: Performance Monitoring
The translation orchestration system MUST provide metrics for parallel processing performance and bottleneck identification.

#### Scenario: Track parallel translation performance metrics
- **GIVEN** A translation job is being processed with parallel chunks
- **WHEN** Chunks are being translated
- **THEN** CloudWatch SHALL record the number of concurrent chunks
- **AND** CloudWatch SHALL track the average chunk translation time
- **AND** CloudWatch SHALL measure job completion time (start to finish)
- **AND** Metrics SHALL be broken down by concurrency level
- **AND** Performance SHALL be compared against sequential baseline

#### Scenario: Detect performance degradation
- **GIVEN** Historical data shows 65K word documents complete in 18 seconds
- **WHEN** A 65K word document takes >30 seconds to complete
- **THEN** A CloudWatch alarm SHALL trigger
- **AND** The alarm SHALL identify the source of delay (API, rate limiting, DynamoDB)
- **AND** Metrics SHALL show which phase is slow (chunk processing vs orchestration)
- **AND** The alarm SHALL notify operators via SNS

---

**Change ID**: enable-parallel-translation
**Capability**: translation-orchestration
**Priority**: P1 - HIGH
