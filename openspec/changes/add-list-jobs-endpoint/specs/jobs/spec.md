## ADDED Requirements

### Requirement: List Caller's Translation Jobs

The system SHALL expose `GET /v1/jobs` returning a flat JSON array of all translation jobs owned by the authenticated caller.

Authorization MUST be enforced exclusively via the Cognito JWT claim `sub` supplied by the API Gateway authorizer. The system MUST NOT accept `userId` in any query-string parameter or path component as an authorization override. Any such parameter MUST be silently ignored, and the response MUST reflect only the authenticated caller's jobs.

The endpoint MUST query the `UserJobsIndex` GSI (partition key `userId`) so the DynamoDB scan is bounded to a single user's records and never returns another user's data.

The Lambda execution role MUST grant `dynamodb:Query` scoped to the GSI ARN only, not the full table ARN.

#### Scenario: Authenticated user retrieves their jobs

- **WHEN** a user sends `GET /v1/jobs` with a valid Cognito access token
- **THEN** the response is HTTP 200 with a flat JSON array containing only that user's job records
- **AND** each job record includes at minimum `jobId`, `userId`, `status`, `createdAt`

#### Scenario: IDOR guard — query-string userId override is ignored

- **WHEN** a user sends `GET /v1/jobs?userId=<another-user-sub>` with a valid Cognito access token
- **THEN** the response is HTTP 200 with a flat JSON array containing ONLY the authenticated caller's jobs
- **AND** the response MUST NOT include any jobs owned by the other user referenced in the query string

#### Scenario: Unauthenticated request is rejected

- **WHEN** a request is sent to `GET /v1/jobs` without a valid Authorization header
- **THEN** the API Gateway Cognito authorizer rejects the request with HTTP 401 before the Lambda executes
