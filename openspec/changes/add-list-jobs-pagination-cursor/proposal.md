## Why

`GET /v1/jobs` caps results at 100 via DynamoDB `Limit: 100` but returns no
pagination token. Accounts with more than 100 jobs silently lose data — callers
have no way to retrieve items beyond the first page. This was deferred from PR #239
(YAGNI for the demo, where no user has 100+ jobs) and tracked as issue #237.

## What Changes

- `backend/functions/jobs/listJobs.ts`: accepts optional `?cursor=<base64url>`
  query param; passes decoded value as `ExclusiveStartKey` to DynamoDB Query;
  encodes `LastEvaluatedKey` as `nextCursor` in the response.
- `shared-types/src/jobs.ts`: adds `ListJobsEnvelope` interface with optional
  `nextCursor?: string` field.
- `frontend/src/services/translationService.ts`: typed against `ListJobsEnvelope`;
  ignores `nextCursor` for the POC (first-page only; gap documented in JSDoc).
- Unit tests: cursor round-trip, cross-user guard, malformed cursor → 400.

## Security note

The cursor is an opaque base64url-encoded DynamoDB `LastEvaluatedKey`. Defense-
in-depth: the server validates that the decoded key's `userId` matches the caller's
Cognito sub before passing it to DynamoDB. Even without that check, the GSI Query
is scoped by `userId`, so a mismatched cursor would yield an empty result — not a
data leak. Both defenses are documented in the Lambda.

## Impact

- Affected specs: `jobs` (list-jobs response envelope)
- Affected code: listJobs.ts, shared-types, translationService.ts, listJobs.test.ts
- Non-breaking: `nextCursor` is optional; existing callers that ignore it continue
  to work. The `cursor` query param is opt-in.
- POC limitation: History page renders first page only until a paginator UI ships.
