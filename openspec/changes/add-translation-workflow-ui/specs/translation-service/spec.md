# Translation Service - Specification Delta

## ADDED Requirements

### Requirement: Job Status Retrieval
The translation service SHALL provide a method to fetch the current status of a translation job by job ID.

#### Scenario: Successful job status retrieval
- **WHEN** `getJobStatus(jobId)` is called with a valid job ID
- **THEN** the service returns a JobStatus object containing: jobId, userId, status, fileName, fileSize, contentType, totalChunks, createdAt, updatedAt
- **AND** the response matches the `/jobs/:jobId` API contract

#### Scenario: Job not found
- **WHEN** `getJobStatus(jobId)` is called with a non-existent job ID
- **THEN** the service throws an error with status 404
- **AND** the error message indicates the job was not found

#### Scenario: Unauthorized access
- **WHEN** `getJobStatus(jobId)` is called without valid authentication
- **THEN** the service throws an error with status 401
- **AND** the error message indicates authentication is required

### Requirement: Translation Initiation
The translation service SHALL provide a method to start translation for a chunked document.

#### Scenario: Successful translation start
- **WHEN** `startTranslation(jobId, targetLanguage, tone)` is called with valid parameters
- **THEN** the service sends a POST request to `/jobs/:jobId/translate`
- **AND** the request includes targetLanguage (one of: es, fr, de, it, zh)
- **AND** the request includes tone (one of: formal, informal, neutral)
- **AND** the service returns successfully without errors

#### Scenario: Invalid target language
- **WHEN** `startTranslation()` is called with an unsupported language code
- **THEN** the service throws a validation error
- **AND** the error message indicates the language is not supported

#### Scenario: Job not in CHUNKED status
- **WHEN** `startTranslation()` is called for a job not in CHUNKED status
- **THEN** the backend returns an error
- **AND** the service propagates the error to the caller

### Requirement: Translation Progress Tracking
The translation service SHALL provide a method to fetch detailed translation progress and metrics.

#### Scenario: Successful progress retrieval
- **WHEN** `getTranslationStatus(jobId)` is called with a valid job ID
- **THEN** the service returns a TranslationStatus object containing: jobId, translationStatus, targetLanguage, tone, totalChunks, chunksTranslated, progressPercentage, tokensUsed, estimatedCost
- **AND** the response matches the `/jobs/:jobId/translation-status` API contract

#### Scenario: Translation in progress
- **WHEN** `getTranslationStatus()` is called for an in-progress translation
- **THEN** the returned status is "IN_PROGRESS"
- **AND** progressPercentage reflects actual completion (0-100)
- **AND** chunksTranslated is less than totalChunks

#### Scenario: Translation completed
- **WHEN** `getTranslationStatus()` is called for a completed translation
- **THEN** the returned status is "COMPLETED"
- **AND** progressPercentage is 100
- **AND** chunksTranslated equals totalChunks
- **AND** tokensUsed and estimatedCost are populated

### Requirement: Translation Download
The translation service SHALL provide a method to download completed translations.

#### Scenario: Successful download
- **WHEN** `downloadTranslation(jobId)` is called for a COMPLETED job
- **THEN** the service fetches the translated document
- **AND** returns the document content as a Blob
- **AND** includes the original filename in the response

#### Scenario: Download before completion
- **WHEN** `downloadTranslation()` is called for a job not yet COMPLETED
- **THEN** the service throws an error
- **AND** the error message indicates translation is not yet complete

### Requirement: Error Handling and Retry Logic
The translation service SHALL implement exponential backoff for retryable errors.

#### Scenario: Network error with retry
- **WHEN** a network error occurs during an API call
- **THEN** the service retries the request up to 3 times
- **AND** uses exponential backoff (1s, 2s, 4s)
- **AND** throws an error if all retries fail

#### Scenario: Non-retryable error
- **WHEN** a 400 or 404 error occurs
- **THEN** the service does not retry
- **AND** immediately throws the error to the caller

#### Scenario: Authentication error
- **WHEN** a 401 error occurs
- **THEN** the service triggers token refresh (via existing auth interceptor)
- **AND** retries the request with the new token
- **AND** throws an error if token refresh fails
