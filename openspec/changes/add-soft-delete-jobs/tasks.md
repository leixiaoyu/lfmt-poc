## 0. Proposal (this PR — do not implement further without owner approval)

- [x] 0.1 Scaffold proposal.md, design.md, tasks.md, specs/jobs/spec.md
- [x] 0.2 Run `openspec validate add-soft-delete-jobs --strict` and resolve issues

## 1. Shared Types

- [ ] 1.1 Add `'DELETED'` to the `DynamoDBJob.status` union in `shared-types/src/jobs.ts`
- [ ] 1.2 Add `deleteAt?: number` to `DynamoDBJob` (Unix epoch seconds — DDB TTL)
- [ ] 1.3 Remove `warning?: string` from `DeleteJobApiResponse` (breaking change)
- [ ] 1.4 Add `PurgeJobResult` interface: `{ jobId, purgedAt, s3KeysDeleted: string[], ddbDeleted: boolean }`
- [ ] 1.5 Run `cd shared-types && npm run build` and verify clean

## 2. DynamoDB Infrastructure

- [ ] 2.1 Enable DynamoDB TTL on JobsTable in `lfmt-infrastructure-stack.ts` (`TimeToLiveSpecification { AttributeName: 'deleteAt', Enabled: true }`)
- [ ] 2.2 Verify CDK synth does not recreate the table (TTL changes are in-place)

## 3. deleteJob Lambda (soft-delete)

- [ ] 3.1 Replace `DeleteItemCommand` with `UpdateItemCommand` setting `status = 'DELETED'` and `deleteAt = now + 30*24*60*60`
- [ ] 3.2 Remove `deleteS3Objects` call and `s3:DeleteObject` import from `deleteJob.ts`
- [ ] 3.3 Remove `warning` field from response body construction
- [ ] 3.4 Remove `s3:DeleteObject` from `DeleteJobPolicy` in CDK
- [ ] 3.5 Remove `S3Client` import and instantiation from `deleteJob.ts`
- [ ] 3.6 Update `deleteJob.test.ts`: replace `DeleteItemCommand` mocks with `UpdateItemCommand` mocks; assert `status = 'DELETED'` and `deleteAt` in captured write; assert no S3 calls; remove `warning` assertions
- [ ] 3.7 Run `npm test -- --testPathPattern="deleteJob"` and verify all tests pass

## 4. listJobs Lambda (exclude soft-deleted)

- [ ] 4.1 Add `FilterExpression: 'attribute_not_exists(#s) OR #s <> :deleted'` with `ExpressionAttributeNames` and `ExpressionAttributeValues` to the DDB `QueryCommand` in `listJobs.ts`
- [ ] 4.2 Add unit test to `listJobs.test.ts`: DDB returns a mix of active and DELETED records; assert DELETED record is absent from response `jobs` array
- [ ] 4.3 Run `npm test -- --testPathPattern="listJobs"` and verify all tests pass

## 5. getJob + getTranslationStatus (404 on soft-deleted)

- [ ] 5.1 In `getJob.ts`: after loading the job, add `if (job.status === 'DELETED') return createErrorResponse(404, ...)` before building the response
- [ ] 5.2 In `getTranslationStatus.ts`: same guard after `loadJob`
- [ ] 5.3 Add unit tests for both handlers: mock a DELETED-status job; assert HTTP 404

## 6. purgeDeletedJobs Lambda (new)

- [ ] 6.1 Create `backend/functions/jobs/purgeDeletedJobs.ts`
  - Query DDB for `status = 'DELETED'` AND `deleteAt <= now` (paginated via LastEvaluatedKey)
  - For each record: delete S3 keys (`uploads/`, `documents/`, `chunks/`, `results/` prefixes)
  - On S3 success: hard-delete DDB record
  - On S3 failure: log warning, skip DDB delete (retry next run)
  - Emit structured log per purged/failed job
- [ ] 6.2 Create `backend/functions/jobs/purgeDeletedJobs.test.ts` with:
  - Happy path: two expired records purged, two non-expired skipped
  - S3 failure: failed job's DDB record not deleted; other records still purged
  - Empty result: no records matching predicate → no-op, returns 0 purged

## 7. Infrastructure (purge Lambda + EventBridge)

- [ ] 7.1 Declare `purgeDeletedJobsRole` (new isolated IAM role) in CDK with:
  - `dynamodb:Query + DeleteItem` on JobsTable ARN
  - `s3:DeleteObject` on `documentBucket/*`
  - `AWSLambdaBasicExecutionRole` managed policy
- [ ] 7.2 Declare `purgeDeletedJobsFunction` Lambda: entry `purgeDeletedJobs.ts`, 5-min timeout, 256MB memory, `purgeDeletedJobsRole`
- [ ] 7.3 Add EventBridge Scheduler rule: `cron(0 3 * * ? *)` UTC, target `purgeDeletedJobsFunction`
- [ ] 7.4 Run `npx cdk synth --context environment=dev` and verify no errors

## 8. Integration Tests

- [ ] 8.1 In `list-jobs.integration.test.ts`: add test — delete a job, then assert it does not appear in `GET /jobs` response
- [ ] 8.2 In `list-jobs.integration.test.ts`: assert `GET /jobs/{jobId}` returns 404 after soft-delete

## 9. Full Test Suite

- [ ] 9.1 `cd backend/functions && npm run build && npm run lint && npm run format:check && npm test`
- [ ] 9.2 `cd backend/infrastructure && npm run build && npm test && npx cdk synth --context environment=dev`
- [ ] 9.3 `cd shared-types && npm run build`
