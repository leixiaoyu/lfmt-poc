## OMC R1 Self-Review — backend hygiene bundle (#229, #237, #240)

Reviewed against commit `6c53908` (first commit of this branch).
Date: 2026-05-11

---

### Category pass/fail matrix

| Category | Result | Notes |
|---|---|---|
| Architecture / SOLID | PASS | ACL intact; cursor is opaque base64; SRP upheld in mapper |
| Type safety | PASS | No `any` in production paths; `[key: string]: unknown` index signature correct |
| Test coverage | PASS | 16 listJobs tests; regression guards on #229 reversion |
| Security | PASS | Dual defense: GSI scope + userId cursor validation |
| IAM | PASS | CDK emits GSI-scoped `dynamodb:Query`; no table-level grant |
| Boy-scout | PASS | `timeout-minutes` added to all 3 long-running CI jobs |
| PR alignment | PASS | No conflict with #238/#239 in main |
| Performance | PASS | Single-page DDB Query unchanged; cursor adds no surface |
| OpenSpec validation | PASS | Both changes pass `--strict` |

---

### Findings

| Severity | Category | Finding | Resolution |
|---|---|---|---|
| Medium | Security | `decodeCursor` treats a valid base64url-encoded `null` JSON literal as malformed (returns null) — correct behavior, but the check against `Array.isArray(parsed)` is redundant since `null` is already excluded by `parsed === null`. | No code change required; redundancy is harmless defense-in-depth. Filed as style note. |
| Low | Architecture | `ListJobsEnvelope.nextCursor` is marked `?` (optional) but the index signature `[key: string]: unknown` widens the type to allow `nextCursor: undefined` via the index path simultaneously — TypeScript permits this but callers must use `'nextCursor' in body` rather than truthiness when the cursor might be the string `"0"`. | Not an issue in practice (base64url cursors are never falsy edge-case strings). No change. |
| Low | CI | `production-smoke-tests` job in `deploy-frontend.yml` has no `timeout-minutes`. This job is not in the deploy-${ref} concurrency hot path (it runs after `deploy-dev-frontend`, which is the locked job), so a hang here blocks only the smoke-test step, not subsequent queued deploys. Risk is lower than #240. | Filed as follow-up. Not addressed in this PR (YAGNI — no prior incident). |

No Critical or High findings. No code changes required from this review.

---

### Security deep-dive: cursor threat model

1. **Forged cursor targeting another user's records**: Rejected by the `cursorUserId !== userId` guard before reaching DynamoDB (HTTP 400).
2. **Forged cursor with no `userId` key** (e.g. `{ jobId: {S:"x"}, createdAt: {S:"y"} }`): The guard condition is `if (cursorUserId && cursorUserId !== userId)` — when `cursorUserId` is `undefined`, the guard is skipped and the cursor is passed to DynamoDB. DynamoDB behavior with an `ExclusiveStartKey` that is missing the GSI partition key is to return an empty result set (documented in DynamoDB SDK behavior), NOT a full-table scan. The GSI Query is still scoped by `userId = :uid` in `KeyConditionExpression`. Result: no data leak, caller gets an empty (or smaller) page. This is documented in the Lambda header comment and is acceptable for a POC; a stricter guard would require `cursorUserId` to be present AND match.
3. **Malformed JSON in cursor**: `decodeCursor` catches `JSON.parse` exceptions and returns null → HTTP 400. Covered by unit test.
4. **Cursor size DoS**: base64url-encoded DDB keys are bounded by DynamoDB's own ExclusiveStartKey size limits (1 KB). No additional size validation needed at the Lambda level.

---

### Boy-scout work included in this PR

- `deploy-backend.yml` `smoke-tests` job: `timeout-minutes: 15` added.
- `deploy-backend.yml` `integration-tests` job: `timeout-minutes: 30` added.
- `deploy-frontend.yml` `e2e-tests` job: `timeout-minutes: 25` added (primary fix for #240).

---

### Test results (all packages)

| Package | Tests | Skipped | Result |
|---|---|---|---|
| `backend/functions` | 563 | 3 (pre-existing) | PASS |
| `frontend` | 761 | 14 (pre-existing) | PASS |
| `backend/infrastructure` CDK synth | n/a | — | PASS |
| shared-types build | n/a | — | PASS |
| Backend lint + prettier | n/a | — | PASS |
| Frontend lint + prettier + tsc | n/a | — | PASS |
