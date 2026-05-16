# LFMT POC - Current Progress

**Last Updated**: 2026-05-14
**Project**: Long-Form Translation Service POC
**Repository**: https://github.com/leixiaoyu/lfmt-poc
**Owner**: Raymond Lei (leixiaoyu@github)

---

## Executive Summary

The LFMT POC has completed **Phases 1-9** (foundation through translation UI
deployment) and the end-to-end translation workflow (upload → chunk →
Gemini 2.5 Flash → reassemble → download) has been deployed and operating
in the dev environment since late 2025. The work since late April 2026 has
been a focused **tech-debt cleanup pass** organised into Waves 1 and 2,
landing in six large multi-issue PRs between 2026-05-12 and 2026-05-14.
**26 individual tech-debt / hygiene issues** were resolved in that window.

### Current Status

- **Completed Phases**: 1-9 (see [archive](docs/archive/PROGRESS-PHASES-1-9.md))
- **Current Phase**: Wave 2 tech-debt cleanup (in progress / largely landed)
- **Phase 10 (Investor Demo)**: Aspirational — core workflow functional but
  the polish/demo-prep stream has been paused while cleanup waves shipped.
  See [Deferred Phase 10 Items](#deferred-phase-10-items) below.
- **Overall Progress**: Core workflow operational end-to-end; hardening,
  type-safety, CI hygiene, and security work has substantially advanced.

### Recent Wave Summary (2026-05-12 → 2026-05-14)

| PR                                                     | Wave / Track   | Issues closed                                                                                      | Theme                                                          |
| ------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [#250](https://github.com/leixiaoyu/lfmt-poc/pull/250) | Wave 1 Track A | 8 primary + 3 folded follow-ups (#153, #156, #160, #163, #186, #187, #211, #243, #247, #248, #249) | CI/CD pipeline hygiene                                         |
| [#251](https://github.com/leixiaoyu/lfmt-poc/pull/251) | Wave 1 Track C | #215, #217, #200 (3 closed; #199 deferred to 2026-06-04)                                           | Frontend type-safety + sentinel hygiene                        |
| [#252](https://github.com/leixiaoyu/lfmt-poc/pull/252) | Wave 1 Track E | #171, #183 (2)                                                                                     | Test-infra + per-day test email                                |
| [#256](https://github.com/leixiaoyu/lfmt-poc/pull/256) | Wave 2 Track B | #180, #178, #246, #210, #188, #209 (6)                                                             | Auth hardening + cursor + StopExecution + typed returns        |
| [#257](https://github.com/leixiaoyu/lfmt-poc/pull/257) | Wave 2 Track D | #216, #201, #219 (3); #197 split → #254 + #255                                                     | CSP refactor + violation telemetry + live contract guard       |
| [#258](https://github.com/leixiaoyu/lfmt-poc/pull/258) | Wave 2 Track F | #253 (1); #260 follow-up filed                                                                     | Deploy-pipeline parity sweep (bootstrap guard + observability) |

**Total**: 26 issues resolved across 6 PRs; 3 new follow-ups filed (#254, #255, #260).

---

## Recent Updates (Last 7 Days)

### 2026-05-14: ePub + PDF download formats (PR for #28) — OPEN

**Concern class**: feature — casual-reader output formats (issue #28).

- **#28** — Backend now produces ePub + PDF on demand alongside the legacy Markdown download. New `?format=` query parameter on `GET /jobs/{jobId}/download`; ePub/PDF responses return a JSON envelope with a 15-min presigned S3 URL (markdown stays inline). Three independent download buttons on the translation-detail page.
- Library choices: `@lesjoursfr/html-to-epub@^6.1.0` (active fork; `epub-gen` dead since 2019), `pdfkit@^0.18.0` (lighter than `@react-pdf/renderer` — no React in the Lambda bundle), `markdown-it@^14.1.1`.
- Lazy on-demand generation + cache-by-S3-key (HeadObject probe before regeneration). Lambda timeout bumped 60s → 120s and memory 512 MB → 1 GB. New IAM grant scoped to a fresh `translated-output/*` prefix; existing `translated/*` chunk store stays read-only.
- Boy-scout: `shared-types/.eslintrc.cjs` + `backend/infrastructure/.eslintrc.cjs` added (husky pre-commit hook needs configs in those packages); `@smithy/util-stream` promoted from hoisted transitive to explicit devDep.
- Sample sizes (18K-word source): PDF 40 KB, ePub 14 KB — both well under the API Gateway 10 MB cap and Lambda 6 MB direct-response limit.
- Tests: 17 new backend (10 converter + 7 handler) + 8 new frontend (3 service + 5 page). All pre-existing tests still pass (619 backend, 784 frontend).

### 2026-05-14: Wave 2 Track F — Deploy-pipeline parity sweep (PR #258) — MERGED

**Concern class**: CI/CD pipeline architecture + operational correctness for fresh staging environments.

- **#253 Gap 1 — staging missing `cdk bootstrap` guard**: Added the same idempotent `CDKToolkit describe-stacks` check that already wraps `deploy-dev` and `deploy-prod`. First-ever deploy of staging against a fresh account/region no longer fails with the "must be deployed to the environment" error.
- **#253 Gap 2 — `cdk diff` short-circuit asymmetry**: Decided to keep staging/prod unconditional (Option A). Justification documented inline in the workflow: staging/prod deploys are `workflow_dispatch`-only with explicit operator intent, so a no-changes early-exit would create deploy-UX ambiguity; the existing `cdk diff || true` audit step on prod already produces the change-set log without gating the deploy.
- **Folded-in parity gaps** (timeout-minutes on all 3 deploy jobs, `Verify AWS identity` on staging, post-deploy API health check on staging + prod) — all surfaced during the OMC R1 review and the owner asked for them in-PR.
- **New follow-up issue #260** filed: post-deploy smoke + integration tests on staging/prod. Deliberately deferred — needs `STAGING_USER_POOL_ID` / `PROD_USER_POOL_ID` secret routing, OIDC role broadening, and a test-user-isolation policy. Genuine architectural work, not hygiene.

### 2026-05-13: Wave 2 Track D — CSP refactor + violation telemetry + live contract guard (PR #257) — MERGED

**Concern class**: security architecture + live contract verification.

- **#216** — CSP builder evolved to typed `Partial<Record<CspDirective, string[]>>` shape; extracted into standalone `backend/infrastructure/lib/csp.ts`. Preserves H-3 reportUri sanitization and adds a CDK-token escape hatch with defense-in-depth checks (protocol/char checks run BEFORE token detection).
- **#201** — New `POST /csp-report` Lambda (`backend/functions/security/cspReport.ts`) with strict input sanitization: Content-Type allowlist, 64 KB body cap, field allowlist on log emission, 2 KB per-field truncation, 204-on-success, dedicated minimal IAM role.
- **#219** — Live-backend API envelope contract guard. New Playwright spec at `frontend/e2e/tests/contract/api-envelope-live.spec.ts` plus new scheduled workflow `.github/workflows/e2e-contract-nightly.yml` — **not** a per-PR gate.
- **#197 split** — Style-src nonces moved to new **#254** (requires Lambda@Edge — different operational layer); httpOnly cookies moved to new **#255** (requires custom domain ACM/Route53 + owner design decisions on CSRF + SameSite).

New CI workflows added by this PR:

- `.github/workflows/e2e-contract-nightly.yml` — nightly live-backend envelope guard.
- `.github/workflows/cognito-test-user-cleanup.yml` — weekly Cognito test-user GC.

### 2026-05-13: Wave 2 Track B — auth + cursor + StopExecution + typed returns (PR #256) — MERGED

**Concern class**: backend correctness + auth hardening + Step Functions hygiene.

- **#180** — `/auth/login` now returns 400 on malformed JSON body instead of 500; same fix applied to `register.ts` (boy-scout, same file).
- **#178** — Removed redundant `AdminConfirmSignUp` call and the elevated `cognito-idp:AdminConfirmSignUp` IAM grant from the register Lambda. Cognito pre-sign-up trigger already auto-confirms in dev.
- **#246** — Tightened `decodeCursor` to reject empty-object decode results (the previous guard caught `null`/`undefined` but accepted `{}`). 5 malformed-cursor integration test variants added; mutation test confirms the guard is load-bearing.
- **#210** — `StopExecution` on Step Functions when a job `DELETE` arrives while translation is in progress. Prevents orphaned executions burning Gemini quota. IAM grant scoped to the state machine ARN.
- **#188** — Typed-return audit on critical auth handlers (`login`, `register`, `refreshToken`, `getCurrentUser`). Response bodies now use `satisfies` checks against shared-types so field-removal regressions fail at `tsc --noEmit`.
- **#209** — Soft-delete OpenSpec proposal scaffolded at `openspec/changes/add-soft-delete-jobs/`. **Proposal only — no implementation.** `openspec validate add-soft-delete-jobs --strict` passes. Awaits owner approval.

### 2026-05-13: Wave 1 Track C — frontend type-safety + sentinel hygiene (PR #251) — MERGED

**Concern class**: frontend type-safety + bundle-size hygiene.

- **#215** — Replaced `S3_UPLOAD_BLOCKED_MESSAGE` sentinel string with typed `TranslationErrorCode` union discriminator. `getTranslationErrorMessage` now dispatches via a `COPY_BY_CODE` lookup table. Surfaced and fixed a latent bug: inline mock `TranslationServiceError` constructors in `TranslationDetail.test.tsx` and `TranslationHistory.test.tsx` had wrong 2-arg signature causing `statusCode` to receive string values.
- **#200** — Unified frontend `User` with shared `UserProfile`. `narrowStoredUser()` bridges legacy (`id`) and canonical (`userId`) shapes with normalization.
- **#217** — `vite.config.ts` `manualChunks` splits `translationService` + `uploadService` + `headerFilters` into their own chunk. **App-\*.js gzip reduced -28.6% (180 kB → 131 kB)**.
- **#199** — **Deferred**, not closed. `StoredSession` migration code cannot be removed yet — Cognito refresh token lifetime is 30 days, PR #198 deployed 2026-05-04, so guaranteed roll-over date is **2026-06-04**. Documentation + safe-removal-date marker added in `constants.ts` and `api.ts`. Issue stays open with the new pinned removal date; close via a code-removal follow-up PR on/after 2026-06-04.

### 2026-05-13: Wave 1 Track E — test-infra + per-day test email (PR #252) — MERGED

- **#171** — `LFMT_TEST_EMAIL` default in `demo/scripts/capture-chapter-metrics.mjs` was hardcoded to a date string despite docstring claiming "fresh per-day". Replaced with `new Date().toISOString().slice(0, 10)` so the default regenerates daily. CI uses the distinct `SMOKE_TEST_EMAIL` variable — confirmed no CI impact.
- **#183** — Added HTTP-boundary contract test rule to `docs/CDK-BEST-PRACTICES.md`: Lambda response bodies with typed shared-types counterparts MUST be statically constrained via generic and round-trip tested.

### 2026-05-12: Wave 1 Track A — CI/CD pipeline hygiene (PR #250) — MERGED

**Concern class**: CI/CD pipeline architecture. 8 primary issues + 3 follow-ups folded inline.

- **#153** — Jest coverage thresholds raised from 35/68/70/70 to 70/75/82/84 to match documented >90% target.
- **#243** — `frontend/e2e/` now covered by `tsc --noEmit`. Fixed pre-existing stale page-object API calls.
- **#160** — Added `github.ref == 'refs/heads/main'` guard to staging and prod deploy jobs (was only on dev).
- **#163** — Skip `cdk deploy` + S3 sync + CF invalidation when `cdk diff` is empty; replaced `sleep 30` with `aws cloudfront wait`. **Saves ~10 min per no-op deploy.**
- **#187** — Extracted `.github/actions/rebuild-frontend/action.yml` composite action used by 4 deploy paths.
- **#186** — Auto-discover `deploy-*.yml` workflows in gated-job parity check (replaces hardcoded list).
- **#156** — Added programmatic `ci.yml ↔ deploy-backend.yml` step-list parity check.
- **#211** — Smoke test policy: **Option B (suppression-with-rationale)** documented via PR template checkbox.
- **#247 / #248 / #249** — Folded inline: cache-dependency-path on staging/prod Setup Node.js (~60s/deploy savings), removal of 4 redundant alias steps in deploy-dev, and writeTempFile temp-dir cleanup in `upload-cors-flow.spec.ts`.

### Earlier in May 2026 (already in `main` before Wave 1)

These PRs landed between 2026-05-05 and 2026-05-12 and shipped the cleanup
that immediately preceded Wave 1. Listed for completeness; see commit log
for detail.

- **#241** (2026-05-12) — Four frontend hygiene fixes (#230, #231, #235, #236): uploadDocument SRP, URL normalization, AuthContext StrictMode, setTimeout in useEffect.
- **#242** (2026-05-12) — `translatedChunks` wire rename, listJobs cursor pagination, CI timeout (#229, #237, #240).
- **#239** (2026-05-10) — `GET /jobs` endpoint + IDOR guard + `chunksTranslated` wire type fix (#226, #227, #220).
- **#238** (2026-05-10) — Auto-poll TranslationDetail on mount + auth hydration race (#225, #228).

---

## Aspirational Goals

### Deferred Phase 10 Items

The original "Phase 10 — Investor Demo & Production Readiness" stream
remains aspirationally relevant. The core translation workflow is
operational and the recent cleanup waves have materially improved the
codebase's readiness for a demo. The polish stream below has been
de-prioritised in favour of the tech-debt cleanup waves; pick these up
when stakeholder timing requires.

- **Demo content preparation** — demo account, 3-5 pre-translated sample
  documents (varying lengths: 65K, 100K, 400K words), quality metrics
  capture.
- **UI/UX polish** — improved loading states, error messages, first-run
  tooltips, optional demo-mode toggle.
- **Performance validation** — measure parallel translation throughput
  against targets (<20s for 65K words, <90s for 400K words). Already
  uses Step Functions Map with `maxConcurrency: 10`.
- **Demo documentation** — pitch deck, demo script, FAQ.
- **Monitoring & observability** — CloudFront dashboard, alert
  configuration, log aggregation, cost tracking.

### Roadmap Issues (Not Currently Active)

- **#64** — P3-ARCH: nested-stacks refactor of the monolithic CDK stack.
- **#29** — FEAT-PRO: post-translation review and editing interface.
- **#28** — FEAT-CORE: additional output formats (ePub / PDF).

---

## Open Risks & Active Issues

### Open Issues (8 as of 2026-05-14)

| #                                                        | Title                                                                 | Notes                                                                                                                                                                                                                          |
| -------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#260](https://github.com/leixiaoyu/lfmt-poc/issues/260) | ci(deploy): add post-deploy smoke + integration tests to staging/prod | Filed 2026-05-13 from PR #258's deferred list. Requires per-env secret routing (`STAGING_USER_POOL_ID` / `PROD_USER_POOL_ID`), OIDC role broadening, and a test-user-isolation policy — architectural work, not a hygiene fix. |
| [#254](https://github.com/leixiaoyu/lfmt-poc/issues/254) | security: CSP style-src nonces via Lambda@Edge                        | Split from #197 by PR #257. Different operational layer (Lambda@Edge); needs deploy-sync architecture decision.                                                                                                                |
| [#255](https://github.com/leixiaoyu/lfmt-poc/issues/255) | security: migrate auth tokens from localStorage to httpOnly cookies   | Split from #197 by PR #257. Cross-domain blocker (cloudfront.net → execute-api); needs custom-domain ACM/Route53 + CSRF/SameSite design decisions.                                                                             |
| [#199](https://github.com/leixiaoyu/lfmt-poc/issues/199) | tech-debt: remove StoredSession migration code                        | **Date-pinned removal: 2026-06-04** (30d after PR #198 deploy on 2026-05-04 = guaranteed Cognito refresh-token roll-over). Documentation marker landed in PR #251.                                                             |
| [#197](https://github.com/leixiaoyu/lfmt-poc/issues/197) | security: deferred CSP/auth hardening (parent)                        | Parent of #254/#255. Considered effectively closed by PR #257's split; housekeeping-close pending.                                                                                                                             |
| [#64](https://github.com/leixiaoyu/lfmt-poc/issues/64)   | P3-ARCH: nested stacks refactor                                       | Backlog.                                                                                                                                                                                                                       |
| [#29](https://github.com/leixiaoyu/lfmt-poc/issues/29)   | FEAT-PRO: post-translation review and editing interface               | Backlog.                                                                                                                                                                                                                       |
| [#28](https://github.com/leixiaoyu/lfmt-poc/issues/28)   | FEAT-CORE: additional output formats (ePub / PDF)                     | Backlog.                                                                                                                                                                                                                       |

### Active In-Flight Spec

- **`openspec/changes/add-soft-delete-jobs/`** — proposal-only soft-delete
  model for `DELETE /jobs/{jobId}` (DDB TTL + scheduled purge Lambda).
  Awaits owner design approval. Referenced by Issue #209 (closed by
  PR #256) which scaffolded the proposal. Implementation deferred until
  approved.

### Active Risks

**LOW Risk**: Gemini API rate limiting

- **Impact**: Could delay large-document translations.
- **Mitigation**: Distributed rate limiter (5 RPM / 250K TPM / 25 RPD)
  already in place; CloudWatch monitoring active.
- **Status**: No incidents observed in recent runs.

**LOW Risk**: Deferred security follow-ups (#254, #255)

- **Impact**: Style-src CSP currently uses `'unsafe-inline'`; auth tokens
  in localStorage are XSS-reachable.
- **Mitigation**: PR #257 landed CSP violation telemetry (`POST /csp-report`)
  so we will see in-the-wild XSS attempts. Strict-input sanitization on
  the report endpoint prevents log poisoning.
- **Status**: Tracked as #254 (nonces) and #255 (httpOnly cookies). Both
  blocked on owner design decisions documented in the issue bodies.

### Resolved Risks (current cleanup window)

- Cursor pagination resilience against malformed input (#246).
- Orphaned Step Functions executions on job DELETE (#210).
- Login/register 500-on-malformed-JSON instead of 400 (#180).
- AdminConfirmSignUp race condition + over-privileged IAM grant (#178).
- CI/CD parity drift between dev / staging / prod (#160, #163, #186, #187, #156).
- Frontend bundle bloat in App chunk (#217: -28.6% gzip).
- Latent type-safety gap in translation error sentinel handling (#215).

---

## Project Metrics

### Test Suite Totals (verified 2026-05-13)

Counts taken from running `npm test` (and `npx vitest --run` for frontend)
in each package on `main` at commit `939a5ca`.

| Package                  | Tests            | Skipped | Suites/Files |
| ------------------------ | ---------------- | ------- | ------------ |
| `backend/functions`      | **602 passed**   | 3       | 28 suites    |
| `backend/infrastructure` | **90 passed**    | 0       | 1 suite      |
| `frontend` (Vitest)      | **776 passed**   | 14      | 37 files     |
| **Total (jsdom/node)**   | **1,468 passed** | 17      | 66           |

E2E (Playwright) suites exist in `frontend/e2e/` and the new live-backend
contract suite in `frontend/e2e/tests/contract/api-envelope-live.spec.ts`
is exercised nightly via `e2e-contract-nightly.yml`. E2E run counts are
not included in the totals above.

> Note: Test totals are a point-in-time snapshot. For the authoritative
> count, run `npm test` in each package (`backend/functions`,
> `backend/infrastructure`, `frontend`).

### Code Quality

- **TypeScript Coverage**: 100% (strict mode, no `any` types in production code).
- **ESLint Errors**: 0.
- **Jest Coverage Floors**: branches 70 / functions 75 / lines 82 / statements 84 — raised from branches 35 / functions 68 / lines 70 / statements 70 in PR #250. (Order reflects the actual key order in `backend/functions/jest.config.js`.)
- **Build Status**: All pipelines passing on `main`.

### Cost (AWS + Gemini)

- **Development Environment**: ~$10/month AWS.
- **Gemini API**: Free tier (5 RPM, 250K TPM, 25 RPD).
- **Current Spend**: Minimal (<$15/month).
- **Well Within Budget**: <$50/month target achieved.

---

## Technology Stack

### Core Technologies

- **Frontend**: React 18 + TypeScript + Material-UI + Vite
- **Backend**: Node.js 22 (AWS Lambda) + API Gateway + DynamoDB
- **Hosting**: CloudFront + S3 (CDK-managed)
- **Translation**: Gemini 2.5 Flash (Google AI)
- **Orchestration**: AWS Step Functions
- **Auth**: AWS Cognito (JWT tokens; storage migration in progress — see #199, #255)

### DevOps

- **Infrastructure**: AWS CDK v2 (TypeScript)
- **CI/CD**: GitHub Actions
  - `ci.yml` — PR gate (lint / type-check / unit + integration tests / synth)
  - `deploy-backend.yml` — backend deploy pipeline (dev / staging / prod)
  - `deploy-frontend.yml` — frontend deploy pipeline
  - `e2e-contract-nightly.yml` — nightly live-backend API envelope contract guard (added by PR #257)
  - `cognito-test-user-cleanup.yml` — weekly Cognito test-user GC (added by PR #257)
- **Testing**: Vitest, React Testing Library, Playwright, Jest (backend)
- **Code Quality**: ESLint, Prettier, Husky pre-commit hooks

---

## Quick Links

- **Frontend URL**: https://d39xcun7144jgl.cloudfront.net
- **API Endpoint**: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
- **GitHub Repo**: https://github.com/leixiaoyu/lfmt-poc
- **Main Branch**: `main`
- **AWS Region**: us-east-1
- **Environment**: Development (LfmtPocDev stack)

---

## Historical Progress

For detailed information on completed Phases 1-9, bug fixes, and
architectural decisions, see:

- **Phases 1-9 Archive**: [`docs/archive/PROGRESS-PHASES-1-9.md`](docs/archive/PROGRESS-PHASES-1-9.md)
- **Architecture Docs**: `docs/` directory (CloudFront, CORS, Translation UI, etc.)
- **OpenSpec Changes**: `openspec/changes/` for feature implementation specs

For the deeper translation-workflow operational history (Gemini 2.5 Flash
migration, Step Functions userId fix, S3 ListBucket grant, DynamoDB
reserved-keyword handling) the archive remains the canonical reference.

---

_This progress report focuses on current work and recent updates. For
historical milestones, see the archive._
