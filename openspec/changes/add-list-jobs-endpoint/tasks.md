## 1. OpenSpec

- [x] 1.1 Scaffold proposal.md, tasks.md, specs/jobs/spec.md
- [x] 1.2 Run `openspec validate add-list-jobs-endpoint --strict` and fix issues

## 2. Shared Types

- [x] 2.1 Add `ListJobsApiResponse` DTO to `shared-types/src/jobs.ts`

## 3. Lambda

- [x] 3.1 Create `backend/functions/jobs/listJobs.ts`
- [x] 3.2 Read userId exclusively from `event.requestContext.authorizer.claims.sub`
- [x] 3.3 Query `UserJobsIndex` GSI with userId as partition key
- [x] 3.4 Return flat array response via `createFlatResponse`
- [x] 3.5 Create unit test `backend/functions/jobs/listJobs.test.ts`

## 4. Infrastructure

- [x] 4.1 Declare `listJobsFunction` Lambda in `createLambdaFunctions()`
- [x] 4.2 Create `ListJobsLambdaRole` with `dynamodb:Query` scoped to `UserJobsIndex` GSI ARN only
- [x] 4.3 Add `GET /jobs` route in `createApiEndpoints()` with Cognito authorizer
- [x] 4.4 Declare `listJobsRole` and `listJobsFunction` class members

## 5. Integration Test

- [x] 5.1 Create `backend/functions/__tests__/integration/list-jobs.integration.test.ts`
- [x] 5.2 Test: two users each own one job; each `GET /jobs` returns only caller's job
- [x] 5.3 Test: `?userId=<other>` query-string override is silently ignored (IDOR guard)

## 6. Frontend

- [x] 6.1 Remove `KNOWN-LIMITATION` comment from `translationService.getTranslationJobs`
- [x] 6.2 Create unit test asserting flat array projection
