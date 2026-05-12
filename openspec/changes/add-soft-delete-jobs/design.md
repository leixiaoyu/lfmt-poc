## Context

LFMT translates copyright-attested documents. The current hard-delete implementation (PR #208) permanently removes the DynamoDB job record and S3 objects in the request path. The OMC security-auditor raised two concerns: (1) if the S3 delete step fails after the DDB record is gone, orphaned objects exist with no owning record; (2) a premature or accidental deletion cannot be recovered. A soft-delete pattern is standard for audit-trail-bearing services and addresses both risks.

Stakeholders: Raymond Lei (owner), OMC security-auditor (raised #209).
Constraint: POC budget — no DynamoDB Streams, no SQS, no multi-region replication.

## Goals / Non-Goals

Goals:
- User-initiated delete immediately hides the job from all list/get endpoints (user intent honored).
- S3 objects are guaranteed to be deleted eventually (within ≤32 days: 30d TTL + 2d DynamoDB TTL SLA).
- Audit trail (DDB record) survives for the retention window.
- No new read-path latency for `GET /jobs` or `GET /jobs/{jobId}`.

Non-Goals:
- GDPR right-to-erasure within 30 days without a dedicated sweep: DynamoDB TTL SLA is 48h past the TTL timestamp, so the scheduled Lambda must sweep explicitly (not rely on TTL alone) if the 30-day window is a hard contractual requirement. This proposal treats the window as advisory for POC.
- Undo/restore endpoint — out of scope for POC.
- Streaming delete events via DynamoDB Streams or EventBridge Pipes — unnecessary complexity for daily batch.

## Decisions

**Decision: UpdateItem (status + TTL) in the request path; S3 delete deferred to scheduled Lambda.**
- Keeps the delete request fast (one DDB write, no S3 calls).
- Eliminates the `warning` field from the API response (the source of the current S3-cleanup UX ambiguity).
- Scheduled Lambda retries on failure — no partial-state problem.

Alternatives considered:
- Hard-delete + DDB Streams → SQS → purge worker: operationally complex for POC. Adds DDB Streams cost and SQS queue management.
- Hard-delete + synchronous S3 cleanup (current): no audit trail; orphan risk on S3 failure.
- TTL-only (no scheduled Lambda): DynamoDB TTL SLA is ≤48h past expiry, not instant. S3 keys are not cleaned by TTL. Rejected.

**Decision: `FilterExpression status <> :deleted` in listJobs instead of a secondary GSI.**
- GSI for `status` would require a GSI partition key with acceptable cardinality. `'DELETED'` is a sparse value — a GSI on status would not be evenly distributed. FilterExpression post-scan is acceptable given `MAX_ITEMS = 100` and the expectation that deleted-but-not-yet-purged records are rare.
- Rejected: sparse-GSI approach.

**Decision: Purge Lambda triggered by EventBridge Scheduler (daily cron), not TTL Streams.**
- DynamoDB TTL stream events are not guaranteed to fire within the 48h SLA and require DynamoDB Streams to be enabled (added cost). A daily cron is deterministic and auditable.
- Scheduling: `cron(0 3 * * ? *)` UTC — 3 AM daily, low-traffic window.

## Risks / Trade-offs

- **DDB FilterExpression scan cost**: listJobs now scans up to 100 items and filters out DELETED ones. If many jobs are soft-deleted and not yet purged, consumed read capacity increases. Mitigation: the purge Lambda runs daily and clears records promptly, keeping the DELETED set small in practice.
- **DynamoDB TTL SLA**: records may persist up to 48h past `deleteAt`. The purge Lambda runs daily and will clean them regardless, so actual S3 object lifetime is `deleteAt + ≤24h` (next daily run). This is acceptable for POC.
- **`deleteJobRole` IAM simplification**: removing `s3:DeleteObject` from `deleteJobRole` reduces the attack surface of that role. The purge Lambda role carries the S3 delete permission instead — isolated, scheduled, no user-triggerable path.

## Migration Plan

1. CDK deploy: add `deleteAt` TTL attribute to JobsTable (`TimeToLiveSpecification`). This is backwards-compatible — existing records without `deleteAt` are unaffected.
2. Deploy new `deleteJob` Lambda (UpdateItem) and `purgeDeletedJobs` Lambda + EventBridge rule.
3. No DDB migration needed — existing records remain hard-deleted (nothing to re-create). Future deletes use the new soft-delete path.
4. Rollback: redeploy old `deleteJob` Lambda (DeleteItem). Soft-deleted records will be cleaned by the purge Lambda on its next run regardless.

## Open Questions

1. **Retention window**: is 30 days the right default, or should it be configurable per environment (e.g., 7 days in dev, 30 in prod)?
2. **GDPR hard requirement**: if the 30-day erasure window is contractually required, the purge Lambda must run more frequently (e.g., hourly) or the TTL must be shorter (e.g., 29 days) to account for the DynamoDB TTL SLA. Confirm with owner.
3. **Restore endpoint**: out of scope for POC, but should the DDB record be tombstoned in a way that makes a future restore endpoint feasible (e.g., store original status in a separate attribute)?
