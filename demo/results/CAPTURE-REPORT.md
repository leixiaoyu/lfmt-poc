<!--
  This report documents the FIRST attempt + its remediation history.
  Future runs should write per-run reports under
  `demo/results/<run-timestamp>/REPORT.md` rather than appending here, so
  this file stays a stable historical artifact instead of growing forever.
-->
# Track B — Real-Metrics Capture Report

**Run date**: 2026-04-25
**Operator**: Track B agent (automated)
**Goal**: Capture real Gemini-anchored metrics for chapter-sized translations against the deployed dev environment, then replace placeholders in `demo/INVESTOR-PITCH-DECK.md`.
**Outcome**: **BLOCKED** — the deployed `lfmt-translate-chunk-LfmtPocDev` Lambda is non-functional and has been since at least 2026-03-19. No real metrics could be captured; no placeholders that depend on translation throughput / token usage / cost were updated.

---

## ⚠️ 2026-04-30 status update (post-rebase)

This report's diagnosis on 2026-04-25 was partially wrong, and the recommended remediation (#1 below) has since been disproven. Updated state:

- The deploy pipeline has since been unblocked (PRs #149, #152, #154, #159, #164, #166 — all merged). The `lfmt-translate-chunk-LfmtPocDev` Lambda **was** redeployed on 2026-04-27 at 23:26:14Z (verified via `aws lambda get-function`). **The TypeError persisted on every invocation** — most recent occurrence 2026-04-30T13:47:59Z. The "stale build" hypothesis below is therefore wrong; the bug existed in current `main` source. Root cause traced (Issue #150 → PR #167): the `translateChunk` handler signature accepted `_rateLimiter?: DistributedRateLimiter` as a second argument for test DI, but AWS Lambda passes `context` as the second runtime argument, silently overwriting the rate-limiter on every production invocation — `context.acquire(...)` then threw the observed `TypeError: i.acquire is not a function`. PR #167 removes the parameter from the handler signature and replaces the test-DI path with a dedicated `setRateLimiterForTesting()` export (regression-tested with `handler.length === 1` plus a full inject-use-teardown cycle).
- The Step-Functions silent-COMPLETED bug noted in this report's "side-effect" section was filed as Issue #151 and **resolved by PR #165** (merged 2026-04-29). The Map state's Catch handler now routes failures to a real DDB writer that records `translationStatus = 'TRANSLATION_FAILED'`, so the script will no longer be fooled by phantom-success state.

The capture script + chapter fixtures in this PR are unchanged and ready to run as soon as #150's source fix lands. The recommended-next-steps section below is preserved as-written for historical context but should be read alongside this update.

---

## Free-tier compliance

- **Gemini requests sent (chargeable to free tier)**: **0** of 25 RPD ceiling.
- The single chunk attempt (Pride & Prejudice Ch 1, 1 chunk) reached `translateChunk` Lambda but threw before issuing a Gemini API call, so no Gemini quota was consumed.
- Two `/auth/login` and one `/auth/register` calls hit Cognito. None of these count against Gemini quotas.

The brief's safety rail "stay under 20 requests of 25 RPD" was respected by a wide margin.

---

## What was attempted

1. **Auth bootstrap** — registered fresh test account `claude-track-b-2026-04-25@lfmt-poc.dev` via `POST /v1/auth/register`. Auto-confirm fired (per dev-env policy), then `POST /v1/auth/login` returned a valid JWT. Auth flow works as documented.
2. **Upload** — `POST /v1/jobs/upload` issued a presigned URL after persisting the legal attestation (PR #138 path). S3 PUT of the chapter file (~5KB) succeeded in ~1.3s. Chunking Lambda fired, produced `chunks/<userId>/<fileId>/chunk-0000-of-0001-*.json`, and DynamoDB job status flipped from `PENDING_UPLOAD` → `CHUNKED` within ~6s. Upload + chunking pipeline is healthy.
3. **Start translation** — `POST /v1/jobs/{jobId}/translate` returned 200 with `totalChunks=1`. Step Functions execution was created. **Translate-chunk Lambda then crashed before contacting Gemini.**

---

## The blocker

CloudWatch log group `/aws/lambda/lfmt-translate-chunk-LfmtPocDev` shows every invocation in the past 30+ days failing with the same error:

```
TypeError: i.acquire is not a function
    at Runtime.vO [as handler] (/var/task/index.js:3358:11662)
```

Source files referenced (`backend/functions/translation/translateChunk.ts`,
`backend/functions/shared/distributedRateLimiter.ts`) DO export an `.acquire()`
method, so the source is correct. The minified `i` symbol in the bundled
`index.js` is bound to something other than `DistributedRateLimiter` —
strongly suggesting a stale build is deployed. `aws lambda get-function`
confirms `LastModified: 2026-04-05T21:30:59Z`, while several relevant PRs
(#125, #126, #127, #128) have merged after that date but apparently never
re-deployed the translate-chunk function.

A second deployment-bug surfaced as a side-effect:

- **Step Functions / Map state silently treats translateChunk failures as success.** The
  job's outer `status` is set to `TRANSLATION_FAILED` (correct) but
  `translationStatus` flips to `COMPLETED` and `progressPercentage` to 100 with
  `chunksTranslated="1"` — the same data shape a real success would emit.
  The capture script's first run actually believed the translation had
  succeeded; it only realized otherwise after CloudWatch inspection. This
  contradicts the integration-test fix described in the latest PROGRESS.md
  ("Fixed Step Functions progress tracking — translatedChunks update").

Both of these are pre-existing defects in dev, not artifacts of the capture
script. They are out of scope for Track B (no backend code changes), but they
must be fixed before Week 2 capture can be retried.

---

## Files captured

- `demo/test-documents/chapters/sherlock-ch1.txt` — 8526 words (5036 chars per `wc -c`; "A Scandal in Bohemia" full chapter, lines 54-1133 of `sherlock-holmes.txt`)
- `demo/test-documents/chapters/pride-ch1.txt` — 885 words (5036 bytes; Chapter 1, lines 675-811 of `pride-and-prejudice.txt`)
- `demo/test-documents/chapters/wp-bk1-ch1.txt` — 2020 words (12010 bytes; Book 1 Chapter 1, lines 828-1068 of `war-and-peace.txt`)

Total ~11.4K words across all three chapters; comfortably within free-tier ceiling once the Lambda is fixed.

The capture script `demo/scripts/capture-chapter-metrics.mjs` is checked in
and is ready to re-run end-to-end (with no edits) once `translate-chunk` is
re-deployed.

---

## What this means for the pitch deck

The script is parked. **No placeholder replacement was performed in this run** for any number that depends on real translation throughput, token usage, cost, or quality. Replacing them with anything but real captured values would amount to fabrication, which the brief explicitly forbids.

The few placeholders that CAN be honestly tightened from the prep work alone (chapter word counts, chapter-vs-full-book scope clarification) are unaffected by the translation outage and have been left alone here so that all pitch-deck edits land in a single, clean PR after the dev-env is fixed.

---

## Recommended next steps (out of scope for Track B)

> **2026-04-30 update**: Steps 1 and 2 below are revised given the post-rebase findings at the top of this report. Strikethrough preserved for traceability — see Issue #150 / PR #165 for the actual remediation.

1. ~~**Re-deploy the backend stack** — `cd backend/infrastructure && npx cdk deploy --context environment=dev`. This will rebuild `translate-chunk-LfmtPocDev` from current `main` and almost certainly resolve `i.acquire is not a function`.~~ **Disproven 2026-04-27**: redeploy executed cleanly, Lambda `LastModified` updated, but the TypeError persists. The defect lives in `main` source; awaiting Issue #150 root-cause fix (call-site + bundle inspection in flight).
2. ~~**Verify Step Functions failure propagation** — confirm that a failed `translateChunk` invocation no longer flips `translationStatus` to `COMPLETED`. If it does, that's a Step Functions / Map retry-policy bug to file separately.~~ **Resolved 2026-04-29 by PR #165 (Issue #151)**: Map-level Catch handler added; failed iterations now write `translationStatus = 'TRANSLATION_FAILED'` to DynamoDB and terminate the execution as `Failed`.
3. **Re-run** `TEST_PASSWORD='...' node demo/scripts/capture-chapter-metrics.mjs` (no args) to capture all three chapters in one pass. Expected: **~15-17 Gemini requests total** at the deployed 3,500-token chunk size (Sherlock alone is ~12 chunks; Pride ~1; War & Peace ~3), ~60-90s per chapter wall-clock — comfortably under 25 RPD for a single run, but a same-day re-run after a partial failure WILL bust the ceiling. The script now warns at startup if a recent prior run is detected. The original projection of 5-7 requests was wrong (corrected during OMC review follow-up). **Blocked on Issue #150's source fix.**
4. **After capture succeeds**, edit the pitch-deck placeholders in a follow-up PR, citing the JSON files in `demo/results/`.

---

## Free-tier accounting (final)

| Counter | Used | Ceiling |
| --- | --- | --- |
| Gemini requests (chargeable to free tier) | **0** | 25 RPD |
| Cognito register | 1 | n/a |
| Cognito login | 2 | n/a |
| API Gateway calls (auth/upload/status/translate combined) | ~30 | n/a |

No paid-tier usage. No quota burned. Safe to re-run the script tomorrow once the deployment is fixed.

---

## Addendum 2026-04-28 — OMC review remediation

A multi-agent (5 specialists) code review of PR #146 surfaced one Critical finding directly relevant to this report's "Recommended next steps":

- **Per-run Gemini request projection corrected from 5-7 → ~15-17.** At the deployed 3,500-token chunk size, Sherlock alone produces ~12 chunks; Pride ~1; War & Peace ~3. A single full run still fits under the 20-of-25 RPD safety rail, but two same-day full runs WILL bust 25 RPD. The capture script now logs a warning at startup if `demo/results/capture-summary.json` from a recent prior run is detected (24h window).

The capture script (`demo/scripts/capture-chapter-metrics.mjs`) was hardened in the same review pass:

- bounded `discoverJobId` (DDB Query against UserJobsIndex GSI vs. unbounded Scan)
- API-first metric source with DDB fallback (post PR #166 wire-shape catch-up)
- partial-translation reporting instead of silent total discard
- 30s timeout on every AWS CLI call
- terminal-state short-circuit in the poll loop (post PR #165)
- mandatory `TEST_PASSWORD` env var (burned default removed)
- `aws s3 cp --recursive` for chunk download (1 call instead of 2N)
- `schemaVersion: "1.0.0"` on every emitted metrics file
- `capture-summary.json` no longer writes the test-account email to git

See PR #146 commit history for line-level changes.
