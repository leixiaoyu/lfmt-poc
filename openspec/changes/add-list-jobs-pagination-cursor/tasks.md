## 1. shared-types

- [x] 1.1 Add `ListJobsEnvelope` interface with `jobs`, `count`, and optional `nextCursor`

## 2. Backend Lambda

- [x] 2.1 `listJobs.ts`: add `encodeCursor` / `decodeCursor` helpers (exported for tests)
- [x] 2.2 `listJobs.ts`: read optional `?cursor` query param and decode to `ExclusiveStartKey`
- [x] 2.3 `listJobs.ts`: validate cursor `userId` matches Cognito claim (cross-user guard)
- [x] 2.4 `listJobs.ts`: pass `ExclusiveStartKey` to `QueryCommand`
- [x] 2.5 `listJobs.ts`: encode `LastEvaluatedKey` as `nextCursor` in response when present
- [x] 2.6 `listJobs.ts`: type response as `ListJobsEnvelope`

## 3. Frontend

- [x] 3.1 `translationService.ts`: import `ListJobsEnvelope` from shared-types
- [x] 3.2 `translationService.ts`: type the API response against `ListJobsEnvelope`
- [x] 3.3 `translationService.ts`: document the first-page-only gap in JSDoc

## 4. Tests

- [x] 4.1 `listJobs.test.ts`: add cursor round-trip unit tests for encode/decode helpers
- [x] 4.2 `listJobs.test.ts`: assert `nextCursor` absent when no `LastEvaluatedKey`
- [x] 4.3 `listJobs.test.ts`: assert `nextCursor` present when `LastEvaluatedKey` returned
- [x] 4.4 `listJobs.test.ts`: assert `ExclusiveStartKey` is passed when cursor provided
- [x] 4.5 `listJobs.test.ts`: assert 400 for malformed cursor
- [x] 4.6 `listJobs.test.ts`: assert 400 for cross-user cursor (userId mismatch)
