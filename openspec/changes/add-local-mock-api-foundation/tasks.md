# Implementation Tasks: Local Mock API Foundation (MSW-Based)

**Change ID**: `add-local-mock-api-foundation`
**Total Estimated Effort**: ~9-11 hours of agent work
**Phases**: 10 phases, sequential

---

## Phase 1: Foundation — MSW Install, Scaffold, Build Guards (1.5 hours)

### 1.1 Install MSW and generate the Service Worker

- [ ] 1.1.1 Add `msw` to `frontend/package.json` `devDependencies`
      (pin exact version).
  - **Estimated Time**: 0.1 hours
- [ ] 1.1.2 Run `npx msw init public/` to generate
      `frontend/public/mockServiceWorker.js`.
  - Commit the generated file (runtime cannot fetch from npm).
  - **Estimated Time**: 0.1 hours
- [ ] 1.1.3 Add `postinstall` npm script that re-runs `msw init` so
      the SW file stays in sync when the MSW package updates.
  - **Estimated Time**: 0.1 hours
- **Files Modified**: `frontend/package.json`
- **Files Created**: `frontend/public/mockServiceWorker.js`
- **Success Criteria**: `npm install` regenerates the SW file; file is
  committed to git.

### 1.2 Scaffold `src/mocks/` directory

- [ ] 1.2.1 Create `frontend/src/mocks/handlers.ts` (empty handler array,
      state-store skeleton, and `resetState()` named export).
  - **Estimated Time**: 0.2 hours
- [ ] 1.2.2 Create `frontend/src/mocks/browser.ts` — calls
      `setupWorker(...handlers)`.
  - **Estimated Time**: 0.1 hours
- [ ] 1.2.3 Create `frontend/src/mocks/server.ts` — calls
      `setupServer(...handlers)` (Node-side, for Vitest).
  - **Estimated Time**: 0.1 hours
- **Files Created**: `frontend/src/mocks/{handlers,browser,server}.ts`
- **Success Criteria**: `tsc --noEmit` passes for the new files.

### 1.3 `main.tsx` async refactor (SW startup race fix)

- [ ] 1.3.1 Refactor `frontend/src/main.tsx` so that, when
      `import.meta.env.VITE_MOCK_API === 'true'`:
  - `await import('./mocks/browser').then(({ worker }) => worker.start())`
  - `await import('./App')` — dynamic, **after** `worker.start()` resolves
  - Then `ReactDOM.createRoot(...).render(<App />)`
  - Otherwise: synchronous import + render path (today's behavior).
  - **Estimated Time**: 0.3 hours
- **Files Modified**: `frontend/src/main.tsx`
- **Success Criteria**: With `VITE_MOCK_API=true npm run dev`, browser
  console shows "MSW worker started" BEFORE the first apiClient request
  appears in the Network tab.

### 1.4 Mock-mode UI banner

- [ ] 1.4.1 Create `frontend/src/components/common/MockModeBanner.tsx`:
  - Renders only when `import.meta.env.VITE_MOCK_API === 'true'`.
  - Non-dismissible (no close button).
  - `z-index: 2147483647` inline style.
  - `role="status"` `aria-live="polite"`.
  - High-contrast colors (yellow/black) that survive dark mode.
  - Text: "MOCK API MODE — DO NOT DEMO TO USERS".
  - **Estimated Time**: 0.2 hours
- [ ] 1.4.2 Mount the banner in `App.tsx` at top-level.
  - **Estimated Time**: 0.1 hours
- **Files Created**: `frontend/src/components/common/MockModeBanner.tsx`
- **Files Modified**: `frontend/src/App.tsx`
- **Success Criteria**: Banner visible on every route in mock mode;
  invisible in normal mode.

### 1.5 Vite build-time guard + `closeBundle` SW cleanup

- [ ] 1.5.1 Add a Vite plugin in `frontend/vite.config.ts` that throws
      with a clear error when `process.env.VITE_MOCK_API === 'true'` and
      `command === 'build'` (regardless of mode).
  - **Estimated Time**: 0.15 hours
- [ ] 1.5.2 Add a `closeBundle` hook that deletes
      `dist/mockServiceWorker.js` after every prod build.
  - **Estimated Time**: 0.1 hours
- **Files Modified**: `frontend/vite.config.ts`
- **Success Criteria**:
  - `VITE_MOCK_API=true npm run build` exits non-zero with the guard
    error.
  - After `npm run build`, `dist/mockServiceWorker.js` does NOT exist.

---

## Phase 2: Auth Handler Migration (1.5 hours)

Port the 6 handlers from `frontend/src/utils/mockApi.ts` to MSW HTTP
handlers, plus add the 2 NEW ones. All responses MUST type-check
against `@lfmt/shared-types`.

### 2.1 Port existing 6 auth handlers

- [ ] 2.1.1 `POST /auth/register` — port from
      `frontend/src/utils/mockApi.ts`. Same validation rules, same response
      shape.
  - **Estimated Time**: 0.15 hours
- [ ] 2.1.2 `POST /auth/login` — port; reuse the same in-memory user
      store as register.
  - **Estimated Time**: 0.15 hours
- [ ] 2.1.3 `POST /auth/refresh` — port; emit shape that satisfies
      `frontend/src/utils/api.ts:230-236` error contract on failures.
  - **Estimated Time**: 0.15 hours
- [ ] 2.1.4 `POST /auth/logout` — port; clears the mock session.
  - **Estimated Time**: 0.1 hours
- [ ] 2.1.5 `GET /auth/me` — port; reads from token-derived mock user.
  - **Estimated Time**: 0.15 hours
- [ ] 2.1.6 `POST /auth/forgot-password` — port; returns success even
      for unknown emails (mirrors real backend).
  - **Estimated Time**: 0.1 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 2.2 Add 2 NEW auth handlers (currently unmocked)

- [ ] 2.2.1 `POST /auth/verify-email` — accept token, return success.
  - **Estimated Time**: 0.15 hours
- [ ] 2.2.2 `POST /auth/reset-password` — accept token + new password,
      return success.
  - **Estimated Time**: 0.15 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 2.3 Wire & smoke-test

- [ ] 2.3.1 Manual smoke: `VITE_MOCK_API=true npm run dev` →
      register → login → see `/auth/me` succeed in DevTools Network tab.
  - **Estimated Time**: 0.4 hours
- **Success Criteria**: All 8 auth endpoints return correct shapes;
  full register → login → me flow works in-browser with no real
  backend running.

---

## Phase 3: Translation-Pipeline Handlers + S3 PUT Mock (2 hours)

### 3.1 `POST /jobs/upload` — presigned URL handler

- [ ] 3.1.1 Accept both request shapes used today:
  - `translationService.uploadDocument`
    (`frontend/src/services/translationService.ts:20-38`)
  - `uploadService` upload init (`frontend/src/services/uploadService.ts:59,81`)
  - **Estimated Time**: 0.3 hours
- [ ] 3.1.2 Return a presigned URL pointing at same-origin
      `http://localhost:3000/__mock-s3/<jobId>` so the SW can intercept
      the subsequent PUT.
  - **Estimated Time**: 0.1 hours
- [ ] 3.1.3 Create the `JobState` entry in the in-memory store with
      `status: 'uploaded'`.
  - **Estimated Time**: 0.1 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 3.2 `PUT /__mock-s3/:jobId` — S3 PUT interceptor

- [ ] 3.2.1 Capture the request body (bytes), return 200 with empty
      body and `ETag` header (matches real S3).
  - **Estimated Time**: 0.3 hours
- [ ] 3.2.2 Verify it intercepts all three transports:
  - Raw `XMLHttpRequest` (used for upload progress)
  - Raw `axios.put` (used by `uploadService`)
  - `fetch` (used by other paths)
  - Spike-validated, but re-verify post-implementation.
  - **Estimated Time**: 0.2 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 3.3 `POST /jobs/:jobId/translate`

- [ ] 3.3.1 Transition job state to `'translating'`; record start
      timestamp for wall-clock simulation.
  - **Estimated Time**: 0.2 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 3.4 `GET /jobs/:jobId/translation-status`

- [ ] 3.4.1 Compute progress on-demand per the simulation policy in
      Phase 4. NO `setInterval`/`setTimeout` in the handler.
  - **Estimated Time**: 0.3 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 3.5 `GET /jobs` — history

- [ ] 3.5.1 Return all `JobState` entries from the in-memory map.
  - **Estimated Time**: 0.15 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 3.6 `GET /translation/:jobId/download`

- [ ] 3.6.1 Return simulated translated text (e.g., uploaded text +
      marker `\n\n[MOCK TRANSLATION COMPLETE]`).
  - **Estimated Time**: 0.15 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 3.7 Manual smoke

- [ ] 3.7.1 `VITE_MOCK_API=true npm run dev` → upload a small file →
      click translate → see progress tick → download.
  - **Estimated Time**: 0.3 hours
- **Success Criteria**: Full pipeline flows in-browser with all
  responses against `localhost:3000` only.

---

## Phase 4: State Store + On-Demand Simulation + `VITE_MOCK_SPEED` (2 hours)

### 4.1 `JobState` schema and closure-scoped store

- [ ] 4.1.1 Define the `JobState` type:
      `{ jobId, status, totalChunks, completedChunks, failedChunks,
fileName, sourceLang, targetLang, createdAt, completedAt? }`.
  - **Estimated Time**: 0.2 hours
- [ ] 4.1.2 Closure-scoped `Map<jobId, JobState>` inside
      `handlers.ts`. NOT a module-level export; only `resetState()` is
      exported.
  - **Estimated Time**: 0.2 hours
- [ ] 4.1.3 `export function resetState(): void` — clears the map.
  - **Estimated Time**: 0.1 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 4.2 `VITE_MOCK_SPEED` branching

- [ ] 4.2.1 Read `import.meta.env.VITE_MOCK_SPEED` once at module load:
  - `'instant'` (default for tests / Vitest)
  - `'realistic'` (default for `npm run dev`)
  - `'slow'` (demo rehearsal)
  - **Estimated Time**: 0.2 hours
- [ ] 4.2.2 Implement the three progression policies:
  - **instant**: status handler advances `completedChunks` by 25% per
    call → 4 polls to 100%. No wall-clock dependency.
  - **realistic**: `min(1, (now - startTs)/10s)` × `totalChunks`.
  - **slow**: `min(1, (now - startTs)/60s)` × `totalChunks`. Also
    triggered by reserved filename `__lfmt_mock_slow__.txt`.
  - **Estimated Time**: 0.7 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 4.3 Unit tests for state store + simulation

- [ ] 4.3.1 Vitest: `instant` mode → 4 polls reach 100%.
  - **Estimated Time**: 0.2 hours
- [ ] 4.3.2 Vitest: `realistic` mode with mocked `Date.now()` → 10s
      yields 100%.
  - **Estimated Time**: 0.2 hours
- [ ] 4.3.3 Vitest: `resetState()` clears all jobs.
  - **Estimated Time**: 0.2 hours
- **Files Created**: `frontend/src/mocks/__tests__/handlers.test.ts`
- **Success Criteria**: All 3 simulation tests pass; coverage on
  `handlers.ts` ≥ 85%.

---

## Phase 5: Error Injection (Reserved Filename Pattern) (0.5 hours)

### 5.1 Reserved filename matcher

- [ ] 5.1.1 In `POST /jobs/upload`, `POST /jobs/:jobId/translate`,
      `GET /jobs/:jobId/translation-status`, check the file name (or job's
      stored file name) against the regex
      `/^__lfmt_mock_(error_(403|413|429|500|network)|slow)__\.txt$/`.
  - Match is recomputed per request — no sticky state. Re-uploading a
    "clean" file recovers normally.
  - **Estimated Time**: 0.2 hours
- [ ] 5.1.2 Map matches to responses:
  - `__lfmt_mock_error_403__.txt` → upload returns 403
  - `__lfmt_mock_error_413__.txt` → upload returns 413
  - `__lfmt_mock_error_429__.txt` → translate returns 429
  - `__lfmt_mock_error_500__.txt` → status returns 500
  - `__lfmt_mock_error_network__.txt` → `HttpResponse.error()` (axios
    sees `!error.response`)
  - `__lfmt_mock_slow__.txt` → forces 60s wall-clock simulation.
  - **Estimated Time**: 0.15 hours
- **Files Modified**: `frontend/src/mocks/handlers.ts`

### 5.2 Tests

- [ ] 5.2.1 Vitest: each error code triggers correctly; especially
      assert that `network` error matches axios `!error.response` shape
      per `frontend/src/utils/api.ts:230-236`.
  - **Estimated Time**: 0.15 hours
- **Files Modified**: `frontend/src/mocks/__tests__/handlers.test.ts`
- **Success Criteria**: All error-injection tests pass.

---

## Phase 6: Test Infrastructure (Vitest + Playwright) (1 hour)

### 6.1 Vitest `setupTests.ts` updates

- [ ] 6.1.1 In `frontend/setupTests.ts` (or equivalent), import
      `server` from `src/mocks/server.ts`. Wire:
  - `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))`
  - `afterEach(() => { server.resetHandlers(); resetState() })`
  - `afterAll(() => server.close())`
  - **Estimated Time**: 0.3 hours
- **Files Modified**: `frontend/setupTests.ts` (or `vitest.config.ts`)
- **Success Criteria**: Existing Vitest suite passes against `msw/node`
  with no behavior change.

### 6.2 Playwright global setup

- [ ] 6.2.1 In `frontend/playwright.config.ts` `webServer`, set
      `VITE_MOCK_API=true VITE_MOCK_SPEED=instant` for the dev server.
  - **Estimated Time**: 0.2 hours
- [ ] 6.2.2 Add a helper in `frontend/e2e/utils/`:
      `apiCall(page, path, init)` → wraps
      `page.evaluate(({ p, i }) => fetch(p, i).then(r => r.json()), ...)`.
  - Document why we don't use `page.request.*` (it bypasses the SW).
  - **Estimated Time**: 0.3 hours
- **Files Modified**: `frontend/playwright.config.ts`
- **Files Created**: `frontend/e2e/utils/apiCall.ts`
- **Success Criteria**: Helper available; existing E2E suite still
  passes.

### 6.3 `beforeEach` reset hook

- [ ] 6.3.1 Add `test.beforeEach(async ({ page }) => { await
page.evaluate(() => { localStorage.clear(); }); /* and call
resetState via test endpoint or reload */ })` pattern in a shared
      fixture.
  - **Estimated Time**: 0.2 hours
- **Files Created**: `frontend/e2e/fixtures/mockReset.ts`

---

## Phase 7: Full-Flow Playwright Spec (0.5 hours)

### 7.1 New spec — register → login → upload → translate → download

- [ ] 7.1.1 Create `frontend/e2e/tests/local/full-flow-mock.spec.ts`:
  - Navigate to `/register`.
  - Register a new mock user.
  - Auto-login (or login if needed).
  - Upload a small in-memory text file.
  - Tick legal attestation.
  - Click translate.
  - Wait for status to reach 100% (instant mode → ≤1s).
  - Verify history shows the job.
  - Click download; verify the response body contains the
    `[MOCK TRANSLATION COMPLETE]` marker.
  - **Estimated Time**: 0.5 hours
- **Files Created**: `frontend/e2e/tests/local/full-flow-mock.spec.ts`
- **Success Criteria**: Spec passes in <30s wall-clock; Network tab
  shows zero non-localhost requests.

---

## Phase 8: Coordinated `mockApi.ts` Deletion (0.5 hours)

**ATOMIC**: All edits in this phase land in a single commit so there
is no broken intermediate state.

### 8.1 Delete legacy mock + remove imports

- [ ] 8.1.1 Delete `frontend/src/utils/mockApi.ts` (329 LOC).
  - **Estimated Time**: 0.05 hours
- [ ] 8.1.2 Edit `frontend/src/utils/api.ts:15` — remove
      `import { installMockApi, isMockApiEnabled } from './mockApi'`.
  - **Estimated Time**: 0.1 hours
- [ ] 8.1.3 Edit `frontend/src/utils/api.ts:286-289` — remove the
      conditional `installMockApi()` call block.
  - **Estimated Time**: 0.1 hours
- [ ] 8.1.4 Delete the dead `vi.stubEnv('VITE_MOCK_API', 'false')`
      at `frontend/src/utils/__tests__/api.refresh.test.ts:42` (PR #135's
      axios-mock-adapter rewrite already obviates it).
  - **Estimated Time**: 0.05 hours
- [ ] 8.1.5 Run `tsc --noEmit` and Vitest suite — both must pass with
      zero changes to source.
  - **Estimated Time**: 0.2 hours
- **Files Deleted**: `frontend/src/utils/mockApi.ts`
- **Files Modified**: `frontend/src/utils/api.ts`,
  `frontend/src/utils/__tests__/api.refresh.test.ts`
- **Success Criteria**: Type-check passes; all tests pass; no dangling
  references to `mockApi`.

---

## Phase 9: Documentation (1 hour)

### 9.1 `frontend/LOCAL-TESTING.md` (NEW)

- [ ] 9.1.1 Create `frontend/LOCAL-TESTING.md` covering:
  - Quick start: `VITE_MOCK_API=true npm run dev`.
  - `VITE_MOCK_SPEED` matrix (`instant` / `realistic` / `slow`).
  - Reserved filename pattern for error injection.
  - Three-layer mock strategy table (Unit / Component / E2E).
  - Known footguns: SW cache, multi-tab `resetState`, hard refresh,
    `page.request.*` bypassing the SW.
  - **Estimated Time**: 0.5 hours
- **Files Created**: `frontend/LOCAL-TESTING.md`

### 9.2 Update root `CLAUDE.md`

- [ ] 9.2.1 Add a "Local Testing" subsection that summarizes the
      three-layer matrix and links to `frontend/LOCAL-TESTING.md`.
  - **Estimated Time**: 0.2 hours
- **Files Modified**: `CLAUDE.md`

### 9.3 Update legacy DEPLOYMENT docs

- [ ] 9.3.1 `docs/DEPLOYMENT.md` — replace any `mockApi.ts` reference
      with the MSW pointer.
  - **Estimated Time**: 0.15 hours
- [ ] 9.3.2 `docs/FRONTEND-DEPLOYMENT.md` — same.
  - **Estimated Time**: 0.15 hours
- **Files Modified**: `docs/DEPLOYMENT.md`, `docs/FRONTEND-DEPLOYMENT.md`

---

## Phase 10: OMC Review + Ultra QA + PR Submission (1.5 hours)

### 10.1 Coverage exclusion + verification

- [ ] 10.1.1 Add `'src/mocks/**'` to `vite.config.ts` coverage
      `exclude` array. Mirror the inline-comment pattern next to the
      existing `e2e/**` exclusion.
  - **Estimated Time**: 0.1 hours
- [ ] 10.1.2 Run `npm run test:coverage` and verify global ≥ 95%.
  - **Estimated Time**: 0.2 hours
- **Files Modified**: `frontend/vite.config.ts`

### 10.2 OMC review iteration cycles (4 specialists)

- [ ] 10.2.1 **code-reviewer** — request review.
  - **Estimated Time**: 0.25 hours
- [ ] 10.2.2 **architect-reviewer** — request review.
  - **Estimated Time**: 0.25 hours
- [ ] 10.2.3 **test-coverage** (test-automator) — request review.
  - **Estimated Time**: 0.25 hours
- [ ] 10.2.4 **security-auditor** — request review (current
      `mockApi.ts:88-207` logs PII to `console`; same anti-pattern would
      propagate to MSW handlers without explicit security audit).
  - **Estimated Time**: 0.25 hours

### 10.3 Ultra QA + Playwright MCP testing

- [ ] 10.3.1 Drive the full demo flow via Playwright MCP against
      `VITE_MOCK_API=true npm run dev`. Confirm Network tab is
      100% localhost.
  - **Estimated Time**: 0.2 hours

### 10.4 Final acceptance checks

- [ ] 10.4.1 `VITE_MOCK_API=true vite build` exits non-zero with the
      guard error.
  - **Estimated Time**: 0.05 hours
- [ ] 10.4.2 After `npm run build`, `dist/mockServiceWorker.js` is
      absent.
  - **Estimated Time**: 0.05 hours
- [ ] 10.4.3 Banner visible on every route in mock mode; invisible
      in normal mode.
  - **Estimated Time**: 0.05 hours
- [ ] 10.4.4 `frontend/e2e/tests/local/full-flow-mock.spec.ts`
      passes in <30s.
  - **Estimated Time**: 0.05 hours

### 10.5 Implementation PR submission

- [ ] 10.5.1 Open implementation PR (separate from this spec PR).
      Link to this spec PR in the body.
  - **Estimated Time**: 0.1 hours

---

## Validation & Sign-off

### Validation Checklist

- [ ] `tsc --noEmit` passes in `frontend/`
- [ ] `npm run test` passes (Vitest with `msw/node`)
- [ ] `npm run test:coverage` shows global ≥ 95%
- [ ] `frontend/e2e/tests/local/full-flow-mock.spec.ts` passes in <30s
- [ ] `VITE_MOCK_API=true vite build` exits non-zero
- [ ] `dist/mockServiceWorker.js` absent after prod build
- [ ] Banner visible in mock mode, absent in normal mode
- [ ] `mockApi.ts` deleted; no dangling imports

### Acceptance Criteria

1. **Local E2E**: Full demo flow runs in-browser with no real backend.
2. **Test parity**: Vitest unit tests reuse the same MSW handlers via
   `msw/node` (handlers shared between browser + node).
3. **Build safety**: Mock mode cannot ship to production (3 layers of
   defense).
4. **Docs**: Three-layer mock strategy documented in
   `frontend/LOCAL-TESTING.md` and `CLAUDE.md`.

### Sign-off

- [ ] Project Owner approval (this spec PR)
- [ ] OMC review (4 specialists, on the implementation PR)
- [ ] Ultra QA + Playwright MCP testing
- [ ] Implementation PR merged

---

## Notes

### Out-of-Scope (for clarity)

- Real Gemini translation
- Real document chunking algorithm
- LocalStack / AWS service emulator
- Production use of mock
- Backend code changes
- Refactoring real backend code

### Rollback Plan

If the implementation PR introduces regressions:

1. Revert the implementation PR (single revert restores `mockApi.ts`).
2. Re-run Vitest + E2E against `main` to confirm restoration.
3. Investigate; resubmit with fix.
