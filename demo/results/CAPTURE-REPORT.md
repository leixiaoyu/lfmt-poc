# Track B — Real-Metrics Capture Report

**Run date**: 2026-04-25
**Operator**: Track B agent (automated)
**Goal**: Capture real Gemini-anchored metrics for chapter-sized translations against the deployed dev environment, then replace placeholders in `demo/INVESTOR-PITCH-DECK.md`.
**Outcome**: **BLOCKED** — the deployed `lfmt-translate-chunk-LfmtPocDev` Lambda is non-functional and has been since at least 2026-03-19. No real metrics could be captured; no placeholders that depend on translation throughput / token usage / cost were updated.

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

1. **Re-deploy the backend stack** — `cd backend/infrastructure && npx cdk deploy --context environment=dev`. This will rebuild `translate-chunk-LfmtPocDev` from current `main` and almost certainly resolve `i.acquire is not a function`.
2. **Verify Step Functions failure propagation** — confirm that a failed `translateChunk` invocation no longer flips `translationStatus` to `COMPLETED`. If it does, that's a Step Functions / Map retry-policy bug to file separately.
3. **Re-run** `node demo/scripts/capture-chapter-metrics.mjs` (no args) to capture all three chapters in one pass. Expected: 5-7 Gemini requests total, ~60-90s per chapter wall-clock, completes well inside 25 RPD.
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
