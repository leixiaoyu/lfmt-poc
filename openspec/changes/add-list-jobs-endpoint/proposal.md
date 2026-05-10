## Why

The frontend History page calls `GET /v1/jobs` via `translationService.getTranslationJobs`, but the deployed API Gateway only exposes `GET /jobs/{jobId}` and `GET /jobs/{jobId}/translation-status`. The missing route causes the page to silently return an empty list, cascades into a CORS preflight failure, and then triggers token-refresh attempts that kick the Cognito session. This is also the capability tracked in issue #220 (OWASP API1:2023 — Broken Object Level Authorization): any query-string `userId` override must be silently ignored and the result scoped exclusively to the Cognito-claim identity.

## What Changes

- New Lambda `backend/functions/jobs/listJobs.ts` implementing `GET /jobs`.
- Authorization reads `userId` from `event.requestContext.authorizer.claims.sub` only — never from query string or path parameters.
- DynamoDB `Query` on the `UserJobsIndex` GSI (partition key `userId`) so the result set is bounded to the authenticated caller's jobs.
- Dedicated IAM role `ListJobsLambdaRole` with `dynamodb:Query` scoped to the GSI ARN only (not the table ARN wildcard).
- API Gateway: `GET /jobs` route added with `CognitoUserPoolsAuthorizer`.
- Integration test: registers two users, seeds one job per user, asserts each user's `GET /jobs` returns only their own job; also asserts that a `?userId=<other>` query-string override is ignored.
- Frontend: remove `KNOWN-LIMITATION` comment from `getTranslationJobs`; add a unit test asserting the service correctly projects the flat array response.
- Resolves issue #220 (IDOR guard) and issue #226 (missing route) in the same change.

## Impact

- Affected specs: `specs/jobs` (new capability)
- Affected code:
  - `backend/functions/jobs/listJobs.ts` (new file)
  - `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (Lambda, IAM role, API route)
  - `shared-types/src/jobs.ts` (new `ListJobsApiResponse` DTO)
  - `frontend/src/services/translationService.ts` (remove KNOWN-LIMITATION comment)
  - `backend/functions/__tests__/integration/list-jobs.integration.test.ts` (new file)
  - `frontend/src/services/__tests__/translationService.listJobs.test.ts` (new file)
