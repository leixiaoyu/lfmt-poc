# Proposal: Local Mock API Foundation (MSW-Based)

**Change ID**: `add-local-mock-api-foundation`
**Status**: Proposed
**Priority**: P1 - Demo-Prep Prerequisite (blocks Phase 10B fast-iteration loop)
**Owner**: Raymond Lei (Project Owner)
**Created**: 2026-04-18
**Target Completion**: 2026-04-20 (~2 days from approval, sequencing into Phase 10B)

---

## Why

Phase 10B (demo prep) requires a tight UI/UX iteration loop where bugs in the
translation workflow can be reproduced, fixed, and verified inside a single
browser refresh — without round-tripping through AWS deploys (~3-5 min each)
or burning Gemini free-tier quota. Today, that loop does not exist:

- **`frontend/src/utils/mockApi.ts`** is a 329-line custom axios interceptor
  that mocks **auth endpoints only** (register/login/refresh/logout/me/forgot-
  password). The translation pipeline — the actual product surface area we
  need to polish for demo — has zero local mocking. Touching upload, the
  attestation flow, progress polling, history, or download requires a
  deployed dev stack.
- An MSW (Mock Service Worker) spike (45 min, recorded) proved MSW intercepts
  all three transports the codebase uses today: raw `XMLHttpRequest` (upload
  progress), raw `axios.put` to S3 presigned URLs, and `fetch`. The custom-
  axios approach cannot intercept the S3 PUT (it bypasses the axios
  instance), so any future expansion of `mockApi.ts` would still leave the
  upload step broken locally.
- Two independent reviewer rounds (v1 → spike → v2 → v3) converged on MSW
  as the right primitive and produced 9 concrete blockers/should-adds that
  this v3 proposal incorporates.

**Business risk if we skip this**:

- Phase 10B UI polish PRs cannot be reviewed end-to-end without a deploy,
  multiplying cycle time by ~10x.
- Demo-day reproductions of investor-facing bugs depend on Gemini free-tier
  RPD (25/day) and a healthy dev stack.
- New frontend contributors cannot run the product locally — onboarding
  requires AWS credentials.

This change establishes the **minimum local-E2E foundation** required for the
demo-prep workstream and for sustainable frontend iteration thereafter.

---

## What Changes

This change is **dev-tooling infrastructure**. It introduces no product
capability; it does not modify the deployed contract. There are no spec
deltas (see "Impact" below).

### 1. Migrate Existing Auth Handlers to MSW (8 handlers, including 2 NEW)

Port the six handlers currently in `frontend/src/utils/mockApi.ts` to MSW
HTTP handlers, and add two that the current mock does not implement:

- `POST /auth/register` — port from current mockApi
- `POST /auth/login` — port from current mockApi
- `POST /auth/refresh` — port from current mockApi
- `POST /auth/logout` — port from current mockApi
- `GET /auth/me` — port from current mockApi
- `POST /auth/forgot-password` — port from current mockApi
- `POST /auth/verify-email` — **NEW** (currently unmocked)
- `POST /auth/reset-password` — **NEW** (currently unmocked)

All handlers SHALL emit responses that conform to `@lfmt/shared-types` so
the mock and the real backend cannot drift on the wire shape.

### 2. Add Translation-Pipeline Handlers (6 handlers, including S3 PUT)

The translation pipeline is the demo surface. These handlers close the
gap between auth-only mocking and full E2E:

- `POST /jobs/upload` — returns a presigned URL pointing at the **same-
  origin** path `http://localhost:3000/__mock-s3/<jobId>` (so the browser
  treats it as same-origin and the SW intercepts it). Handles both
  request shapes used today: `translationService.uploadDocument`
  (`frontend/src/services/translationService.ts:20-38`) and
  `uploadService` (`frontend/src/services/uploadService.ts:59,81`).
- `PUT /__mock-s3/:jobId` — intercepts the S3 PUT, captures the bytes,
  returns 200. Spike-validated to work for raw `XMLHttpRequest`, raw
  `axios.put`, and `fetch`.
- `POST /jobs/:jobId/translate` — kicks off translation in mock state.
- `GET /jobs/:jobId/translation-status` — returns ticking progress
  0% → 100% per the simulation policy in §4.
- `GET /jobs` — returns job history.
- `GET /translation/:jobId/download` — returns the simulated translated
  text.

### 3. In-Memory Mock State Store (Closure-Scoped, Clean-Slate per Load)

A single closure-scoped `Map<jobId, JobState>` lives inside
`src/mocks/handlers.ts` and is the source of truth for job lifecycle:

```ts
type JobState = {
  jobId: string;
  status: 'uploaded' | 'translating' | 'completed' | 'failed';
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  fileName: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  completedAt?: string;
};
```

- **No localStorage** — page reload = clean slate (matches existing
  unit-test conventions; avoids tab-coordination bugs).
- **No background timers** — state machine ticks **on-demand** inside the
  status handler. This is critical: `setInterval`-based simulations leak
  across Vitest tests and Playwright workers.
- **Reset only via named export**: `export function resetState(): void` —
  consumed by Playwright `beforeEach` hooks. NOT `worker.resetHandlers()`,
  which only re-installs handlers but does not clear closure state.

### 4. State Machine Timing — `VITE_MOCK_SPEED` Branching

Three speed profiles, selected by env var at startup:

- **`VITE_MOCK_SPEED=instant`** (default for Vitest): request-count-driven.
  Status handler advances `completedChunks` by 25% per call → 4 polls to
  100%. Deterministic; no wall-clock dependency.
- **`VITE_MOCK_SPEED=realistic`** (default for `npm run dev`): wall-clock,
  ~10s end-to-end. Uses the timestamp captured at translate-start; status
  handler computes `min(1, (now - start)/10s)`.
- **`VITE_MOCK_SPEED=slow`** (demo rehearsal): wall-clock, ~60s — used
  when rehearsing the live demo cadence.

### 5. Error Injection via Reserved Filename Pattern

To exercise error paths without per-test API plumbing, file names matching
the reserved pattern trigger specific simulated errors at request time
(no sticky state — match is recomputed per request, so re-uploading a
"clean" file recovers normally):

- `__lfmt_mock_error_403__.txt` → upload returns 403
- `__lfmt_mock_error_413__.txt` → upload returns 413 (file too large)
- `__lfmt_mock_error_429__.txt` → translate returns 429 (rate-limited)
- `__lfmt_mock_error_500__.txt` → status returns 500
- `__lfmt_mock_error_network__.txt` → network error (axios `!error.response`)
- `__lfmt_mock_slow__.txt` → forces 60s wall-clock simulation regardless
  of `VITE_MOCK_SPEED`

### 6. Test Infrastructure (Vitest + Playwright)

- **Vitest `setupTests.ts`** uses `msw/node` to start a Node-side server
  with the **same handlers** as the browser. ~20 LOC. Handlers live in
  `src/mocks/handlers.ts` and are imported by both contexts.
- **Playwright global setup** launches the dev server with
  `VITE_MOCK_API=true`. Standardize on
  `await page.evaluate(() => fetch('/api/...').then(r => r.json()))`
  for any in-test API call — `page.request.*` bypasses the SW and will
  silently hit the real network (or fail). Document this footgun in
  `LOCAL-TESTING.md`.
- **New spec**: `frontend/e2e/tests/local/full-flow-mock.spec.ts`
  exercises register → login → upload → attestation → translate → 100%
  → history → download — entirely in-browser. Target: <30s wall-clock.

### 7. Safety Rails (Defense in Depth — Mock Must Never Reach Production)

- **UI banner**: visible whenever `VITE_MOCK_API=true`.
  - Non-dismissible (no close button).
  - `z-index: 2147483647` (MAX_SAFE_INTEGER) — survives any z-index war.
  - `role="status"` `aria-live="polite"` — accessible.
  - High-contrast colors that survive a future dark-mode flag.
- **Vite plugin (build-time error)**: if
  `VITE_MOCK_API=true && command === 'build'` (regardless of mode), Vite
  fails the build with a clear error. Prevents shipping a mock-mode bundle
  to CloudFront.
- **Vite `closeBundle` hook**: deletes `dist/mockServiceWorker.js` after
  every prod build. Without this, the SW infrastructure file ships to S3
  and could be activated by a future page registering it.

### 8. Coverage Carve-Out — `src/mocks/**`

Add `src/mocks/**` to `vite.config.ts` coverage `exclude` list (mirrors
the existing `e2e/**` exclusion, same dev-test-infra rationale). Inline
comment SHALL document why.

Without this, the math (per reviewer #2) puts the new global at 94.25%,
which is below the 95% gate and would break CI on the same PR that
introduces the foundation.

### 9. Coordinated `mockApi.ts` Deletion (Atomic, Same PR)

The implementation PR (separate from this spec PR) MUST do all of the
following in a single commit so there is no broken intermediate state:

- Delete `frontend/src/utils/mockApi.ts` (329 LOC).
- Edit `frontend/src/utils/api.ts:15` — remove
  `import { installMockApi, isMockApiEnabled } from './mockApi'`.
- Edit `frontend/src/utils/api.ts:286-289` — remove the conditional
  `installMockApi()` call.
- Delete the dead `vi.stubEnv('VITE_MOCK_API', 'false')` at
  `frontend/src/utils/__tests__/api.refresh.test.ts:42` (PR #135's
  axios-mock-adapter rewrite already obviates it).

### 10. Documented Three-Layer Mock Strategy

The codebase uses three different mocking primitives — each appropriate for
a different test layer. Both `frontend/LOCAL-TESTING.md` (new file) and
the root `CLAUDE.md` SHALL document the matrix:

| Layer                           | Environment | Tool                                   | Purpose                                |
| ------------------------------- | ----------- | -------------------------------------- | -------------------------------------- |
| Unit (jsdom)                    | Vitest      | `axios-mock-adapter` (PR #135 pattern) | Axios interceptor internals            |
| Component / integration (jsdom) | Vitest      | `msw/node`                             | Real `apiClient` flow against handlers |
| E2E (browser)                   | Playwright  | MSW Service Worker                     | Full-stack browser flow                |

### 11. `mockServiceWorker.js` Lifecycle

`public/mockServiceWorker.js` is auto-generated by `npx msw init public/`.
It SHALL be committed to git (it is the SW MSW registers; runtime cannot
fetch it from npm). A `postinstall` npm script SHALL re-run `msw init`
so the file stays in sync when the MSW package updates.

### 12. Documentation Updates

- **NEW**: `frontend/LOCAL-TESTING.md` (sibling of existing
  `frontend/DEPLOYMENT.md`, `TESTING_STRATEGY.md`, `VERIFICATION.md`).
- **UPDATE**: root `CLAUDE.md` — add a "Local Testing" pointer + the
  three-layer matrix summary.
- **UPDATE**: `docs/DEPLOYMENT.md` and `docs/FRONTEND-DEPLOYMENT.md` —
  both currently reference the legacy `mockApi.ts`.

---

## Out of Scope

- **Real Gemini translation** — mock returns simulated translated text.
- **Real document chunking** — mock fakes `totalChunks` based on file size.
- **LocalStack or any AWS service emulator** — MSW only.
- **Production use of mock** — mock SHALL NEVER ship to a deployed env.
  See §7 safety rails.
- **Backend code changes** — this is a frontend-only change.
- **Refactoring existing real backend handlers** — mock contracts mirror
  current backend; backend is unchanged.

---

## Success Criteria

### Quantitative

1. **Local E2E demo flow** runs entirely in-browser with
   `VITE_MOCK_API=true npm run dev`: register → login → upload →
   attestation → translate → progress → history → download. Browser
   Network tab shows all responses are 200 against `localhost:3000`
   only — zero requests to the real API.
2. **`e2e/tests/local/full-flow-mock.spec.ts`** passes against
   `npm run dev` in <30s wall-clock.
3. **Vitest unit tests** consume the same MSW handlers via `msw/node`
   (handlers shared between browser + node contexts — no duplication).
4. **`VITE_MOCK_API=true vite build`** fails with a clear error message.
5. **Coverage** on new MSW handler files ≥ 85% (per existing local
   convention); global stays ≥ 95% (verified via the `src/mocks/**`
   exclusion).
6. **Production bundle size diff vs current main**: ≤ 0 KB.
7. **`dist/mockServiceWorker.js`** does NOT exist after `vite build`.

### Qualitative

8. **UI banner** visible whenever mock mode is on; non-dismissible;
   survives dark mode.
9. **Three-layer mock strategy** documented in both
   `frontend/LOCAL-TESTING.md` and root `CLAUDE.md`.
10. **Network tab** during local demo shows zero AWS hosts.

### Acceptance Tests

1. **Build guard**: `VITE_MOCK_API=true npm run build` exits non-zero
   with a clear error.
2. **SW cleanup**: After `npm run build`, `ls dist/mockServiceWorker.js`
   returns "no such file".
3. **Banner visibility**: `VITE_MOCK_API=true npm run dev` → banner
   visible on every route.
4. **Error injection**: Upload `__lfmt_mock_error_429__.txt` → translate
   step shows the rate-limit error path.
5. **State reset**: Playwright `beforeEach` calls `resetState()` →
   subsequent test starts with empty job list.

---

## Risks & Mitigation

| Risk                                                                                                              | Mitigation                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mock + real backend drift on response shapes                                                                      | All handlers type-check against `@lfmt/shared-types`; types lead the contract.                                                                                                                                 |
| Playwright `APIRequestContext` (`page.request.*`) bypasses the SW                                                 | Standardize on `await page.evaluate(() => fetch(...))` helper. Document the footgun in `LOCAL-TESTING.md`.                                                                                                     |
| Coverage cliff from new code drags global below 95%                                                               | `src/mocks/**` excluded from coverage (matches `e2e/**` precedent — same dev-test-infra rationale, inline comment explains).                                                                                   |
| Demo team accidentally runs mock in front of investors                                                            | Defense in depth: (a) non-dismissible UI banner; (b) Vite build-time prod-mode failure; (c) `closeBundle` hook deletes `mockServiceWorker.js` from `dist/`.                                                    |
| Drift between current `mockApi.ts` behavior and new MSW handlers during transition                                | Implementation PR atomically commits MSW handlers AND deletes `mockApi.ts` AND removes its imports — no broken intermediate state. PR #135's axios-mock-adapter test rewrite already de-couples refresh tests. |
| Concurrent Playwright workers + shared in-memory state cause flaky tests                                          | Per-test `resetState()` named export — NOT `worker.resetHandlers()`, which only clears the handler list, not closure state. Also `localStorage.clear()` in `beforeEach`.                                       |
| MSW v2 `HttpResponse.error()` doesn't match axios's expected error shape                                          | Unit test asserting `!error.response` matches `frontend/src/utils/api.ts:230-236` expectations.                                                                                                                |
| Multi-tab `resetState()` nukes another tab's state                                                                | Documented in `LOCAL-TESTING.md` "Known footguns" section.                                                                                                                                                     |
| HMR + cached SW handlers cause stale behavior                                                                     | Document hard-refresh requirement; `?v=` query param convention for SW cache busting.                                                                                                                          |
| `mockServiceWorker.js` regenerates inconsistently when MSW package updates                                        | `postinstall` npm script re-runs `msw init`; the generated file is committed to git.                                                                                                                           |
| SW startup race: module-load `apiClient` fires before `worker.start()` resolves → first requests hit real network | `frontend/src/main.tsx` uses `await import('./App')` AFTER `await worker.start()` — guaranteed-after ordering, not "best-effort".                                                                              |

---

## Dependencies

### External

- **MSW (`msw` npm package)** — version pinned in `package.json`. Adds
  ~30 KB dev-dep, 0 KB production.

### Internal

- **Blocked by**: nothing — this is foundational dev-tooling.
- **Blocks**: Phase 10B (demo prep) UI polish PRs that depend on a
  fast local iteration loop.
- **Coexists with**: PR #135 (`axios-mock-adapter` for unit refresh
  tests) — different tool for a different layer; no conflict.

### Workflow Gates

```
this PR (plan) → plan review (team) → develop with scaffold checkpoint
  → OMC review (4 specialists: code, architect, test, security)
  → ultra QA + Playwright MCP testing → implementation PR
  → team review → merge
```

### OMC Review Slate (Implementation PR)

**4 specialists** (not the default 5):

- **code-reviewer**
- **architect-reviewer**
- **test-coverage** (test-automator)
- **security-auditor** — added per reviewer #2: current `mockApi.ts`
  logs PII to `console` at `frontend/src/utils/mockApi.ts:88-207`. The
  same anti-pattern would propagate to MSW handlers without an explicit
  security audit.

**Skip**: **performance-engineer** — confirmed N/A. The in-memory `Map`
of jobs grows monotonically until page reload (clean-slate per load).
Worst case ~100 KB across a long-running session is not a concern.

---

## Impact

### Affected Specs

**None.** This change introduces dev-tooling only — no product capability
changes. Per `openspec/AGENTS.md`, dev-tooling-only changes do not require
spec deltas.

### Affected Code

- **NEW**: `frontend/src/mocks/` directory (handlers, browser SW init,
  node server init).
- **NEW**: `frontend/public/mockServiceWorker.js` (auto-generated, committed).
- **NEW**: `frontend/e2e/tests/local/full-flow-mock.spec.ts`.
- **NEW**: `frontend/LOCAL-TESTING.md`.
- **MODIFIED**: `frontend/src/main.tsx:1-9` — async dynamic import of
  `App` after `worker.start()`.
- **MODIFIED**: `frontend/vite.config.ts:78-89,181` — coverage exclusion;
  build-time mock guard plugin; `closeBundle` hook.
- **MODIFIED**: `frontend/package.json` — add `msw` dev dep, `postinstall`
  hook, `setupTests` updates.
- **DELETED**: `frontend/src/utils/mockApi.ts` (329 LOC).
- **MODIFIED**: `frontend/src/utils/api.ts:15,286-289` — remove
  `mockApi.ts` import and conditional install.
- **MODIFIED**: `frontend/src/utils/__tests__/api.refresh.test.ts:42` —
  remove dead `vi.stubEnv('VITE_MOCK_API', 'false')`.
- **MODIFIED**: root `CLAUDE.md` — add three-layer mock matrix +
  pointer to `frontend/LOCAL-TESTING.md`.
- **MODIFIED**: `docs/DEPLOYMENT.md`, `docs/FRONTEND-DEPLOYMENT.md` —
  update legacy `mockApi.ts` references.

### Breaking Changes

**NONE for users.** The deployed product is unaffected. For developers,
the workflow improves: `VITE_MOCK_API=true npm run dev` now exercises
the whole product, not just auth.

---

## Effort Estimate

**~9-11 hours of agent work end-to-end** (implementation, not this spec):

- Phase 1 (1.5h): MSW install, scaffold, `main.tsx` async refactor,
  UI banner, Vite build guards, `closeBundle` hook.
- Phase 2 (1.5h): Auth handler port (8 handlers, including 2 NEW).
- Phase 3 (2h): Translation handlers + S3 PUT mock (6 handlers).
- Phase 4 (2h): In-memory state store + on-demand ticking simulation +
  `VITE_MOCK_SPEED` branching.
- Phase 5 (0.5h): Error injection (reserved filename pattern).
- Phase 6 (1h): Vitest `setupServer` + Playwright global setup +
  `page.evaluate` helper.
- Phase 7 (0.5h): New full-flow Playwright spec + smoke verification.
- Phase 8 (0.5h): Coordinated `mockApi.ts` deletion + `api.ts` edits.
- Phase 9 (1h): `LOCAL-TESTING.md` + `CLAUDE.md` update + DEPLOYMENT
  docs updates.
- Phase 10 (1.5h): OMC review iteration cycles + ultra QA + PR
  submission.

---

## Plan History

- **v1** (custom axios extension) — REWORK NEEDED per reviewer #1: wrong
  endpoint URLs, S3 PUT bypass not addressed, MSW recommended.
- **45-min MSW spike** — STRONG GO MSW: proven all three transports
  intercepted (XHR, raw `axios.put`, `fetch`).
- **v2** (MSW-based) — REWORK NEEDED per reviewer #2: 6 blockers + 3
  should-adds (coverage cliff, prod SW leak, `mockApi.ts` import cleanup,
  state-machine timing, reset semantics, SW startup race, reserved-
  filename collision risk, security-auditor scope, three-layer mock
  strategy docs).
- **v3** (this proposal) — all 9 reviewer findings incorporated.

---

## Approval Gate

**Do not start implementation until this proposal is reviewed and
approved by the team.** The spec PR is ready for review immediately —
v3 has already been through 2 review rounds.

Implementation will land via a **separate** PR after approval.

---

## References

- **`frontend/src/utils/mockApi.ts`** — current 329 LOC custom axios
  interceptor (auth-only) being replaced.
- **`frontend/src/utils/api.ts:15,230-236,286-289`** — import + error-
  shape contract + conditional install to remove.
- **`frontend/src/main.tsx`** — needs async dynamic import refactor for
  SW startup ordering.
- **`frontend/vite.config.ts:78-89,181`** — coverage exclusion + build
  guard + `closeBundle` hook.
- **`frontend/src/services/translationService.ts:20-38,119,170,186,201,214`** —
  request shape consumed by `POST /jobs/upload` mock.
- **`frontend/src/services/uploadService.ts:59,81`** — alternative
  upload request shape; mock SHALL handle both.
- **`frontend/src/utils/__tests__/api.refresh.test.ts:42`** — dead
  `vi.stubEnv` to delete.
- **PR #135** — `axios-mock-adapter` for unit refresh tests; coexists.
- **PR #134** — Phase 10B demo-prep plan that depends on this foundation.

---

**Status**: Proposed — Awaiting Team Approval
**Next Steps**: Team review → Approve → Open implementation PR
