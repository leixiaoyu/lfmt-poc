## MODIFIED Requirements

### Requirement: List Caller's Translation Jobs

The system SHALL expose `GET /v1/jobs` returning a JSON object with the shape
`{ jobs: ListJobsItem[], count: number, nextCursor?: string }`. The `jobs` array
contains translation jobs owned by the authenticated caller, up to 100 per page.

Authorization MUST be enforced exclusively via the Cognito JWT claim `sub`
supplied by the API Gateway authorizer. The system MUST NOT accept `userId` in
any query-string parameter or path component as an authorization override. Any
such parameter MUST be silently ignored, and the response MUST reflect only the
authenticated caller's jobs.

The endpoint MUST query the `UserJobsIndex` GSI (partition key `userId`) so the
DynamoDB scan is bounded to a single user's records and never returns another
user's data.

The Lambda execution role MUST grant `dynamodb:Query` scoped to the GSI ARN only,
not the full table ARN.

**Pagination**: when DynamoDB returns a `LastEvaluatedKey` (indicating more
results exist), the response MUST include `nextCursor` as an opaque base64url-
encoded string. When no more results exist, `nextCursor` MUST be absent (not
null). Callers request the next page by passing `?cursor=<nextCursor>` on a
subsequent request. The server MUST validate that the cursor's embedded `userId`
matches the caller's Cognito sub; a mismatch MUST return HTTP 400. A cursor that
cannot be decoded as valid JSON MUST also return HTTP 400.

#### Scenario: Authenticated user retrieves their jobs

- **WHEN** a user sends `GET /v1/jobs` with a valid Cognito access token
- **THEN** the response is HTTP 200 with `{ jobs: [...], count: N }` containing only that user's job records
- **AND** each job record includes at minimum `jobId`, `userId`, `status`, `createdAt`

#### Scenario: IDOR guard — query-string userId override is ignored

- **WHEN** a user sends `GET /v1/jobs?userId=<another-user-sub>` with a valid Cognito access token
- **THEN** the response is HTTP 200 containing ONLY the authenticated caller's jobs
- **AND** the response MUST NOT include any jobs owned by the other user

#### Scenario: Unauthenticated request is rejected

- **WHEN** a request is sent to `GET /v1/jobs` without a valid Authorization header
- **THEN** the API Gateway Cognito authorizer rejects the request with HTTP 401

#### Scenario: Pagination cursor returned when more jobs exist

- **WHEN** a user with more than 100 jobs sends `GET /v1/jobs`
- **THEN** the response includes a non-null `nextCursor` string
- **AND** the caller can retrieve the next page by sending `GET /v1/jobs?cursor=<nextCursor>`

#### Scenario: No nextCursor when all jobs fit on one page

- **WHEN** a user with 100 or fewer jobs sends `GET /v1/jobs`
- **THEN** the response does NOT include a `nextCursor` field

#### Scenario: Malformed cursor returns 400

- **WHEN** a caller sends `GET /v1/jobs?cursor=<invalid-base64url>`
- **THEN** the response is HTTP 400 with a descriptive error message

#### Scenario: Cross-user cursor is rejected

- **WHEN** a caller sends `GET /v1/jobs?cursor=<cursor-containing-different-userId>`
- **THEN** the response is HTTP 400 (cursor userId mismatch)
