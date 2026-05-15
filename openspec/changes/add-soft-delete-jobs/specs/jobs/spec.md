## MODIFIED Requirements

### Requirement: Delete Translation Job

The system SHALL accept `DELETE /jobs/{jobId}` from an authenticated owner and immediately respond with HTTP 200, marking the job as logically deleted without permanently removing the DynamoDB record or S3 objects in the request path.

Authorization MUST use the Cognito JWT claim `sub` exclusively. A request for a job that does not exist OR belongs to a different user MUST return HTTP 404 (privacy-preserving — existence must not be leaked).

On success, the Lambda MUST:

1. Set `status = 'DELETED'` on the DynamoDB job record.
2. Write a `deleteAt` attribute (Unix epoch seconds = now + 30 days) that DynamoDB treats as the TTL attribute.
3. Return HTTP 200 with `{ message, jobId }` — no `warning` field (S3 cleanup is deferred to the scheduled purge).

The system MUST NOT invoke `s3:DeleteObject` in the delete-request path.

#### Scenario: Owner deletes an existing job

- **WHEN** an authenticated user sends `DELETE /jobs/{jobId}` for a job they own
- **THEN** the response is HTTP 200 with `{ message: "Job <jobId> deleted successfully", jobId }`
- **AND** the DynamoDB record has `status = 'DELETED'` and a `deleteAt` attribute set to approximately 30 days in the future
- **AND** no S3 objects are deleted in the request path

#### Scenario: Delete of a non-existent or cross-owned job returns 404

- **WHEN** an authenticated user sends `DELETE /jobs/{jobId}` for a job that does not exist or belongs to another user
- **THEN** the response is HTTP 404
- **AND** the response body MUST NOT reveal whether the job exists under a different owner (OWASP API1:2023)

#### Scenario: Deleted job is invisible to subsequent GET requests

- **WHEN** a job has been soft-deleted (status = 'DELETED')
- **AND** the owner sends `GET /jobs/{jobId}` or `GET /jobs/{jobId}/translation-status`
- **THEN** the response is HTTP 404, consistent with hard-delete behavior

### Requirement: List Translation Jobs Excludes Soft-Deleted Records

The `GET /jobs` endpoint MUST exclude records with `status = 'DELETED'` from all response pages.

A soft-deleted job MUST NOT appear in any `jobs` array returned by `GET /jobs`, regardless of whether the DynamoDB TTL has fired and permanently removed the record.

#### Scenario: Soft-deleted job is absent from job list

- **WHEN** a user has previously deleted a job via `DELETE /jobs/{jobId}`
- **AND** the DynamoDB TTL has not yet expired (record is still present but marked DELETED)
- **AND** the user sends `GET /jobs`
- **THEN** the soft-deleted job MUST NOT appear in the response `jobs` array

#### Scenario: Active jobs are unaffected by soft-delete filter

- **WHEN** a user has both active jobs and a soft-deleted job
- **AND** the user sends `GET /jobs`
- **THEN** all active jobs appear in the response
- **AND** the soft-deleted job does not appear

### Requirement: Scheduled Purge of Soft-Deleted Jobs

The system SHALL run a scheduled Lambda on a daily cron schedule (`cron(0 3 * * ? *)` UTC) that permanently removes all DynamoDB records and associated S3 objects for jobs where `status = 'DELETED'` AND `deleteAt <= now`.

The purge Lambda MUST:

1. Query DynamoDB for all records matching the above predicate (paginated).
2. For each matched record: delete the S3 objects under the `uploads/`, `documents/`, `chunks/`, and `results/` prefixes keyed to that job.
3. Hard-delete the DynamoDB record.
4. Emit a structured CloudWatch log entry per purged job.

S3 deletion failures for an individual job MUST be logged as warnings and MUST NOT prevent the purge of other jobs. The failed job MUST be retried on the next daily run (its DDB record is not hard-deleted until all S3 deletes succeed).

The purge Lambda MUST use an isolated IAM role (`purgeDeletedJobsRole`) with:

- `dynamodb:Query + DeleteItem` scoped to the jobs table.
- `s3:DeleteObject` scoped to the document bucket.
- `CloudWatch Logs` write (via `AWSLambdaBasicExecutionRole`).

#### Scenario: Daily purge removes expired soft-deleted records

- **WHEN** the scheduled purge Lambda runs
- **AND** one or more job records have `status = 'DELETED'` and `deleteAt <= now`
- **THEN** the Lambda deletes the associated S3 objects for each such record
- **AND** hard-deletes each DDB record after its S3 objects are successfully removed
- **AND** emits one structured log entry per purged job

#### Scenario: Purge skips records not yet past retention window

- **WHEN** the scheduled purge Lambda runs
- **AND** a job record has `status = 'DELETED'` but `deleteAt > now`
- **THEN** that record and its S3 objects are NOT deleted
- **AND** the record will be processed on a future run when `deleteAt <= now`

#### Scenario: S3 failure does not abort purge of other jobs

- **WHEN** the scheduled purge Lambda runs
- **AND** S3 deletion fails for one job
- **THEN** the purge continues processing remaining expired records
- **AND** the failed job's DDB record is NOT hard-deleted (retry on next run)
- **AND** a warning log is emitted for the failed job
