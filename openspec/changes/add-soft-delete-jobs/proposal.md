## Why

The current `DELETE /jobs/{jobId}` implementation hard-deletes the DynamoDB record and best-effort deletes associated S3 objects immediately. The OMC security-auditor (PR #208 Round 2, item #7) flagged that hard-delete creates two risks for a copyright-attested service: (1) if the S3 cascade fails after the DDB delete, orphaned source documents exist with no owning job record; (2) once deleted, the job's legal attestation linkage is permanently severed — recovery from a premature or buggy deletion is impossible. A soft-delete model with a configurable retention window and a scheduled S3+DDB purge closes both gaps while preserving the user-visible "delete" intent.

Implementation is deferred pending owner design approval. This change is a **proposal only** — no code will be written until the proposal is approved. See Issue #209.

## What Changes

- **`DELETE /jobs/{jobId}` response contract** (**MODIFIED**): the endpoint continues to return HTTP 200 immediately, but instead of hard-deleting the record it sets `status = 'DELETED'` and writes a DynamoDB TTL attribute (`deleteAt = now + 30d`). The `warning` field is removed from the success response (S3 cleanup no longer runs in the request path).
- **DynamoDB schema** (**MODIFIED**): `DynamoDBJob` gains two optional fields: `deleteAt` (number — Unix epoch seconds, used as the DDB TTL attribute) and a `status` value `'DELETED'` added to the existing status union.
- **`GET /jobs` filter** (**MODIFIED**): `listJobs` MUST exclude records with `status = 'DELETED'` so soft-deleted jobs are invisible to users.
- **`GET /jobs/{jobId}` and `GET /jobs/{jobId}/translation-status`** (**MODIFIED**): both endpoints MUST return 404 for soft-deleted jobs, consistent with hard-delete behaviour.
- **Scheduled purge Lambda** (**ADDED**): a new EventBridge-triggered Lambda runs daily. It scans DynamoDB for records with `status = 'DELETED'` and `deleteAt <= now`, deletes the associated S3 objects (uploads/, documents/, chunks/, results/ prefixes), then hard-deletes the DDB record. Failures are logged and retried on the next daily run — the purge is eventually consistent, not transactional.
- **Shared types** (**MODIFIED**): `DynamoDBJob.status` union gains `'DELETED'`; `DeleteJobApiResponse` drops the `warning` field; new `PurgeJobResult` type added.
- **IAM** (**MODIFIED**): `deleteJobRole` loses `s3:DeleteObject` (moved to purge Lambda role). Purge Lambda gets a new isolated role with `dynamodb:Query + DeleteItem` on `JobsTable` and `s3:DeleteObject` on `documentBucket/*`.

**BREAKING**: `warning` field removed from `DELETE /jobs/{jobId}` success response. Callers that inspect this field must be updated.

## Impact

- Affected specs: `specs/jobs` (modified capability — delete, list, get-by-id, get-status)
- Affected code:
  - `backend/functions/jobs/deleteJob.ts` — replace hard-delete with UpdateItem (status + TTL)
  - `backend/functions/jobs/listJobs.ts` — add `FilterExpression status <> :deleted`
  - `backend/functions/jobs/getJob.ts` — return 404 if `status = 'DELETED'`
  - `backend/functions/jobs/getTranslationStatus.ts` — return 404 if `status = 'DELETED'`
  - `backend/functions/jobs/purgeDeletedJobs.ts` — new Lambda
  - `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` — DDB TTL attribute, EventBridge rule, purge Lambda + role
  - `shared-types/src/jobs.ts` — DynamoDBJob, DeleteJobApiResponse, new PurgeJobResult
  - `backend/functions/jobs/deleteJob.test.ts` — replace delete tests with update-item tests
  - `backend/functions/jobs/listJobs.test.ts` — add soft-deleted-record exclusion test
  - `backend/functions/__tests__/integration/list-jobs.integration.test.ts` — soft-delete integration test
