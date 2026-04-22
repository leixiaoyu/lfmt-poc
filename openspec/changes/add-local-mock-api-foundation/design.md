# Technical Design: Local Mock API Foundation (MSW-Based)

**Change ID**: `add-local-mock-api-foundation`
**Author**: Raymond Lei
**Created**: 2026-04-18
**Status**: Proposed

---

## Context

LFMT's frontend currently has **partial** local mocking via a custom axios
interceptor (`frontend/src/utils/mockApi.ts`, 329 LOC) that covers six
auth endpoints. The translation pipeline — the actual demo surface — is
not mocked. Any work on upload, attestation, progress polling, history,
or download requires a deployed dev stack (~3-5 min/iteration) and burns
Gemini free-tier RPD.

Phase 10B (demo prep) is gated on a fast iteration loop where UI/UX
bugs can be reproduced and fixed inside a single browser refresh. This
change introduces an **MSW (Mock Service Worker)**-based foundation that
covers the full pipeline.

The plan went through two reviewer rounds (v1 → spike → v2 → v3) and a
45-minute MSW spike. The spike confirmed MSW intercepts all three
transports the codebase uses today: raw `XMLHttpRequest`, raw
`axios.put` to S3, and `fetch`. The v1 custom-axios extension cannot
intercept the S3 PUT (it bypasses the configured axios instance), so
any future expansion of `mockApi.ts` would still leave upload broken
locally.

**Constraints**:

- Frontend-only change. No backend modifications.
- Must coexist with PR #135's `axios-mock-adapter` (different layer,
  no conflict).
- Must NOT regress global coverage below 95%.
- Must NOT ship a mock-mode bundle to CloudFront.
- Single-person team (Raymond Lei) — simplicity > sophistication.

---

## Goals / Non-Goals

### Goals

1. Provide a local-only E2E loop that exercises the full translation
   pipeline (upload → translate → progress → download) without AWS.
2. Share handlers between Vitest (`msw/node`) and the browser SW so
   contracts cannot drift between layers.
3. Make it impossible (in three independent ways) for the mock to
   ship to production.
4. Keep the POC's existing test conventions intact (closure-scoped
   in-memory state; clean-slate per page load; no flaky timers).
5. Document the three mocking primitives the codebase now uses
   (axios-mock-adapter / msw-node / msw-browser) so future contributors
   pick the right tool per layer.

### Non-Goals

1. Mocking real Gemini translation logic — the mock returns fake text.
2. Implementing real chunking — `totalChunks` is a function of file
   size only.
3. AWS service emulation (LocalStack, Moto, etc.) — MSW only.
4. Multi-tab synchronization — clean-slate per page load is the
   contract.
5. Production use — see safety rails (Decision 5).

---

## Decisions

### Decision 1: MSW Over Extending the Custom Axios Interceptor

**Reviewer #1 finding**: The v1 plan to extend `mockApi.ts` had three
defects: wrong endpoint URLs, S3 PUT cannot be intercepted by an axios
interceptor (it uses raw axios on a different base URL), and the custom
approach does not give us same-handler-shared-with-Node-tests parity.

**Spike result**: 45-minute MSW spike intercepted all three transports
the codebase uses today (raw XHR, raw `axios.put`, `fetch`). Strong
GO.

**Rationale**:

- **Transport-agnostic**: MSW intercepts at the network layer (Service
  Worker for browser, request interception for Node), so it doesn't
  care which HTTP client emits the request.
- **Handler reuse**: Same handler module imported by both
  `setupWorker(handlers)` (browser) and `setupServer(handlers)` (Node
  / Vitest). Single source of truth.
- **Industry standard**: MSW is the de facto standard for React, Vite,
  and Vitest projects in 2026; well-maintained, large community.

**Alternatives considered**:

- **Extend `mockApi.ts`**: REJECTED by reviewer #1 — cannot intercept
  S3 PUT.
- **`axios-mock-adapter` for everything**: REJECTED — does not work in
  browser without bundling test code; cannot intercept non-axios
  transports.
- **LocalStack**: REJECTED — overkill for POC scale; adds Docker
  dependency to local dev.

**Risks**:

- **Risk**: MSW v2 API differs from v1 (breaking changes around
  `HttpResponse.error()`).
- **Mitigation**: Pin exact MSW version; unit-test the network-error
  shape against `frontend/src/utils/api.ts:230-236` expectations.

---

### Decision 2: Three-Layer Mock Strategy

The codebase will deliberately use **three** mocking primitives — one
per test layer. Documenting this is non-negotiable to prevent future
contributors from re-litigating tool choice.

| Layer                           | Environment | Tool                                   | Why                                                                                                        |
| ------------------------------- | ----------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Unit tests (jsdom)              | Vitest      | `axios-mock-adapter` (PR #135 pattern) | Tests the axios interceptor's internal behavior — needs to mock at the axios layer, not the network layer. |
| Component / integration (jsdom) | Vitest      | `msw/node`                             | Tests real `apiClient` flow against full network stack — same handlers as browser.                         |
| E2E (browser)                   | Playwright  | MSW Service Worker                     | Full-stack browser flow including the SW path.                                                             |

**Rationale for keeping `axios-mock-adapter`**: PR #135 already rewrote
the refresh-token tests on `axios-mock-adapter`. Those tests
**explicitly target axios interceptor internals** — they need to mock
at the axios layer to assert which interceptor handler runs first. MSW
intercepts at the network layer (after interceptors run), so it cannot
test interceptor ordering. Different tool, different layer.

**Documentation**: Both `frontend/LOCAL-TESTING.md` (new) and root
`CLAUDE.md` will carry the matrix.

---

### Decision 3: Closure-Scoped In-Memory State, Reset via Named Export

**State store**:

```ts
// inside src/mocks/handlers.ts (closure-scoped — NOT exported)
const jobs = new Map<string, JobState>();

// the only public escape hatch:
export function resetState(): void {
  jobs.clear();
}
```

**Why closure-scoped (not module-level export)?**

- Prevents tests from poking the map directly and creating coupling
  between tests and internal mock structure.
- Forces all mutations through handlers — same path the real code
  takes.

**Why `resetState()` and NOT `worker.resetHandlers()`?**

- `worker.resetHandlers()` only re-installs the original handler list;
  it does NOT clear closure state inside those handlers.
- This is a well-known MSW footgun. Reviewer #2 specifically called
  it out.
- Per-test reset hook calls `resetState()` AND `localStorage.clear()`.

**Why no localStorage / sessionStorage?**

- Clean-slate per page load matches existing unit-test conventions
  (Vitest jsdom environment is fresh per test).
- Avoids tab-coordination bugs documented in the "Known footguns"
  section of `LOCAL-TESTING.md`.

**Risks**:

- **Risk**: Multi-tab `resetState()` from one tab nukes another tab's
  state.
- **Mitigation**: Documented as a known footgun. Mock mode is for
  development; multi-tab is not a supported workflow.

---

### Decision 4: On-Demand Ticking, NO Background Timers, `VITE_MOCK_SPEED` Branching

The progress simulation MUST advance state **only inside the status
handler**, not on a `setInterval`. Background timers leak across:

- Vitest tests (timer fires after `afterEach` resets state → flaky)
- Playwright workers (workers run in parallel; one worker's timer
  affects another's state)
- Browser tabs (timer ticks even on hidden tabs → wastes CPU)

**Three speed profiles** (selected by `import.meta.env.VITE_MOCK_SPEED`
at module load):

| Profile     | Default for    | Policy                                                                                                                                 |
| ----------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `instant`   | Vitest         | Request-count: status handler advances `completedChunks` by 25% per call → 4 polls to 100%. Deterministic; no `Date.now()` dependency. |
| `realistic` | `npm run dev`  | Wall-clock: `progress = min(1, (Date.now() - startTs) / 10_000)`. ~10s end-to-end.                                                     |
| `slow`      | Demo rehearsal | Wall-clock, ~60s. Also force-triggered by reserved filename `__lfmt_mock_slow__.txt`.                                                  |

**Why `instant` for tests?**

- Eliminates wall-clock dependency → no `vi.useFakeTimers()` boilerplate.
- 4 polls × ~50ms request time = ~200ms total → `<30s` E2E spec target
  is comfortably met.

---

### Decision 5: Defense-in-Depth Production Safety (Three Layers)

The mock MUST NEVER reach production. Three independent layers:

#### Layer 1 — Visual: Non-Dismissible UI Banner

- Renders only when `import.meta.env.VITE_MOCK_API === 'true'`.
- Non-dismissible (no close button — anything dismissible WILL be
  dismissed by accident).
- `z-index: 2147483647` (MAX_SAFE_INTEGER for 32-bit) — survives any
  z-index war from MUI/Modal/Dialog overlays.
- `role="status"` `aria-live="polite"` — screen readers announce it.
- High-contrast colors (yellow background, black text) that survive a
  future dark-mode flag.

#### Layer 2 — Build-Time: Vite Plugin Failure

- Vite plugin throws with a clear error when both
  `process.env.VITE_MOCK_API === 'true'` AND `command === 'build'`.
- Regardless of `mode` — covers `npm run build`, `npm run build:dev`,
  `npm run build:prod`, etc.
- Error message points the user at `frontend/LOCAL-TESTING.md`.

#### Layer 3 — Post-Build: `closeBundle` Hook Deletes the SW

- Even if a developer somehow bypasses Layer 2, the
  `mockServiceWorker.js` file in `dist/` is the only way the SW can
  register at runtime.
- Vite plugin `closeBundle` hook deletes
  `dist/mockServiceWorker.js` after every prod build.
- Acceptance test: `ls dist/mockServiceWorker.js` returns "no such
  file" after `npm run build`.

**Why three layers?** Reviewer #2: "If a demo team runs the mock in
front of investors once, the project is done. One layer is one
mistake."

---

### Decision 6: SW Startup Race Fix — Dynamic Import of `App` After `worker.start()`

**Problem**: `apiClient` (`frontend/src/utils/api.ts`) is module-loaded
when `App.tsx` is imported. If the SW is still starting up, the first
few requests bypass the SW and hit the real network.

**Solution**: In `frontend/src/main.tsx`, when `VITE_MOCK_API === 'true'`:

```ts
// frontend/src/main.tsx (sketch)
async function bootstrap() {
  if (import.meta.env.VITE_MOCK_API === 'true') {
    const { worker } = await import('./mocks/browser');
    await worker.start();
  }
  const { App } = await import('./App'); // <-- dynamic, AFTER worker.start()
  ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
}
bootstrap();
```

**Why dynamic import (not just `await` before render)?**

- A static `import { App } from './App'` is hoisted by the bundler;
  `App.tsx` (and transitively `apiClient`) executes at module-load
  time, BEFORE the `await worker.start()` line runs.
- Dynamic `import('./App')` defers `App.tsx` evaluation until after
  the await resolves.

**Risks**:

- **Risk**: Dynamic import adds a network round-trip in dev (HMR).
- **Mitigation**: Vite's dev server pre-warms; cost is ~10ms,
  imperceptible.

---

### Decision 7: Error Injection via Reserved Filename Pattern

**Problem**: Per-test API plumbing for error simulation (e.g., a
`/api/__test/inject-error?code=429` endpoint) leaks test-only surface
into the mock contract.

**Solution**: Reserved filename pattern. The user uploads a file named
`__lfmt_mock_error_429__.txt` and the mock recognizes the pattern at
request time, returning 429.

**Why request-time matching (not sticky state)?**

- Sticky state (e.g., "next translate call returns 429") is global —
  parallel tests cross-contaminate.
- Request-time match is purely functional: same input → same output.
  Re-uploading a clean file recovers normally.

**Reserved patterns** (regex
`/^__lfmt_mock_(error_(403|413|429|500|network)|slow)__\.txt$/`):

- `__lfmt_mock_error_403__.txt` → upload returns 403
- `__lfmt_mock_error_413__.txt` → upload returns 413 (file too large)
- `__lfmt_mock_error_429__.txt` → translate returns 429 (rate limit)
- `__lfmt_mock_error_500__.txt` → status returns 500
- `__lfmt_mock_error_network__.txt` → `HttpResponse.error()` (axios
  sees `!error.response`, matching `frontend/src/utils/api.ts:230-236`)
- `__lfmt_mock_slow__.txt` → forces 60s wall-clock simulation

**Risks**:

- **Risk**: Real users upload a file matching the pattern.
- **Mitigation**: Pattern is intentionally absurd
  (`__lfmt_mock_*__.txt`); collision probability ~0. Pattern is only
  active when `VITE_MOCK_API === 'true'`.

---

### Decision 8: Coverage Carve-Out for `src/mocks/**`

**Problem (per reviewer #2)**: Adding ~400 LOC of mock handlers to a
codebase at 95% global coverage drops the new global to ~94.25% (math:
existing 95% × 19000 LOC + new 0% × 400 LOC ≈ 94.25%). CI breaks on
the same PR that introduces the foundation.

**Solution**: Add `src/mocks/**` to `vite.config.ts` coverage `exclude`
array, with an inline comment explaining the carve-out.

**Why is this acceptable?**

- The existing `e2e/**` exclusion sets the precedent: dev-test-infra
  is not "product code" and should not skew coverage math.
- The mock handlers are themselves tested (Phase 4.3 and 5.2 tests),
  but the test coverage is local to the mocks subtree, not part of
  the global gate.
- The implementation will set a **local** coverage floor of 85% on
  `src/mocks/**` files (informational, not gated) to guard against
  un-tested handler regressions.

**Inline comment**:

```ts
// vite.config.ts (sketch)
coverage: {
  exclude: [
    // ... existing entries
    'e2e/**',     // E2E test infra; not product code.
    'src/mocks/**', // MSW handlers; dev-test-infra (mirrors e2e/**).
                   // Local coverage floor: 85% (informational).
  ],
}
```

---

### Decision 9: Coordinated `mockApi.ts` Deletion (Atomic, Same PR)

**Problem**: A two-PR sequence (add MSW, then delete `mockApi.ts`)
produces a window where both mocks are wired and behaviors fight.

**Solution**: One implementation PR. All four edits in a single commit:

1. Delete `frontend/src/utils/mockApi.ts` (329 LOC).
2. Edit `frontend/src/utils/api.ts:15` — remove
   `import { installMockApi, isMockApiEnabled } from './mockApi'`.
3. Edit `frontend/src/utils/api.ts:286-289` — remove the conditional
   `installMockApi()` block.
4. Delete the dead `vi.stubEnv('VITE_MOCK_API', 'false')` at
   `frontend/src/utils/__tests__/api.refresh.test.ts:42`.

**Why is the `api.refresh.test.ts` line dead?** PR #135 rewrote that
file on `axios-mock-adapter`. The `vi.stubEnv` call was a guard against
the legacy `installMockApi()` running during the test; with
`installMockApi` removed, the stub is dead code.

---

### Decision 10: `mockServiceWorker.js` Lifecycle (Commit + `postinstall`)

**Problem**: `npx msw init public/` generates a Service Worker file
that the runtime must fetch from the server origin. This file cannot
be loaded from `node_modules` at runtime.

**Solution**:

- Commit `frontend/public/mockServiceWorker.js` to git.
- Add an `npm postinstall` script that re-runs `npx msw init public/`
  so the file stays in sync when the MSW package updates (otherwise it
  would silently fall behind on minor SW protocol changes).

**Risks**:

- **Risk**: `postinstall` adds time to `npm install`.
- **Mitigation**: `msw init` runs in <1s; trivial.

---

### Decision 11: OMC Review Slate — 4 Specialists (Skip Performance)

**4 specialists** for the implementation PR:

- **code-reviewer**
- **architect-reviewer**
- **test-coverage** (test-automator)
- **security-auditor** (added per reviewer #2 — see below)

**Skip**: **performance-engineer**. Confirmed N/A: the in-memory
`Map<jobId, JobState>` grows monotonically until page reload (clean-
slate per load). Worst case ~100 KB across a long-running session is
not a performance concern.

**Why security-auditor?** The current `mockApi.ts:88-207` logs PII
(emails, mock passwords) to `console.log`. Without an explicit security
audit on the MSW implementation, that anti-pattern would propagate to
the new handlers — and any future logging added "for debugging" could
also leak PII to the browser console.

---

## Technical Architecture

### Repository Layout (post-implementation)

```
frontend/
├── public/
│   └── mockServiceWorker.js          # NEW (auto-gen, committed)
├── src/
│   ├── main.tsx                      # MODIFIED (async dynamic import)
│   ├── App.tsx                       # MODIFIED (mounts MockModeBanner)
│   ├── components/
│   │   └── common/
│   │       └── MockModeBanner.tsx    # NEW
│   ├── mocks/                        # NEW
│   │   ├── handlers.ts               # All MSW handlers + state store + resetState()
│   │   ├── browser.ts                # setupWorker(handlers) for browser
│   │   ├── server.ts                 # setupServer(handlers) for msw/node
│   │   └── __tests__/
│   │       └── handlers.test.ts      # Unit tests for handlers + simulation
│   └── utils/
│       ├── api.ts                    # MODIFIED (remove mockApi imports)
│       ├── mockApi.ts                # DELETED
│       └── __tests__/
│           └── api.refresh.test.ts   # MODIFIED (remove dead stubEnv)
├── e2e/
│   ├── tests/
│   │   └── local/
│   │       └── full-flow-mock.spec.ts  # NEW
│   ├── utils/
│   │   └── apiCall.ts                # NEW (page.evaluate fetch helper)
│   └── fixtures/
│       └── mockReset.ts              # NEW (beforeEach reset hook)
├── vite.config.ts                    # MODIFIED (build guard, closeBundle, coverage exclude)
├── playwright.config.ts              # MODIFIED (VITE_MOCK_API=true webServer env)
├── setupTests.ts                     # MODIFIED (msw/node server lifecycle)
├── package.json                      # MODIFIED (msw devDep, postinstall)
└── LOCAL-TESTING.md                  # NEW
```

### State Machine (Job Lifecycle)

```
                          ┌────────────────┐
                          │   no entry     │
                          └────────┬───────┘
                                   │ POST /jobs/upload
                                   ▼
                          ┌────────────────┐
                          │   uploaded     │
                          └────────┬───────┘
                                   │ PUT /__mock-s3/:jobId
                                   │ POST /jobs/:jobId/translate
                                   ▼
                          ┌────────────────┐
                          │  translating   │◀──┐
                          └────────┬───────┘   │
                                   │           │ GET status
                                   │           │ (advances completedChunks
                                   │           │  per VITE_MOCK_SPEED policy)
                                   │ progress  │
                                   │  reaches  │
                                   │   100%    │
                                   ▼           │
                          ┌────────────────┐   │
                          │   completed    │───┘ (subsequent polls return same state)
                          └────────────────┘
                                   │ GET /translation/:jobId/download
                                   ▼
                            (returns text)
```

`failed` is reachable only via reserved-filename error injection
(`__lfmt_mock_error_500__.txt` etc.).

### Build Pipeline Guards (Defense in Depth)

```
                      ┌──────────────────────────────┐
                      │  Developer runs `vite build` │
                      └──────────────┬───────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │ Layer 2: Vite plugin checks env     │
                  │ VITE_MOCK_API === 'true'?           │
                  └──────────────────┬──────────────────┘
                                     │
                          yes ───────┼─────── no
                          │                   │
                          ▼                   ▼
                ┌───────────────┐   ┌─────────────────────┐
                │ THROW with    │   │ Continue build      │
                │ clear error   │   └──────────┬──────────┘
                └───────────────┘              │
                                               ▼
                                  ┌─────────────────────────┐
                                  │ Vite emits dist/        │
                                  │ (incl. mockServiceWorker│
                                  │  .js if present in      │
                                  │  public/)               │
                                  └────────────┬────────────┘
                                               │
                                               ▼
                                  ┌─────────────────────────┐
                                  │ Layer 3: closeBundle    │
                                  │ hook deletes            │
                                  │ dist/mockServiceWorker  │
                                  │ .js                     │
                                  └────────────┬────────────┘
                                               │
                                               ▼
                                          (clean dist/)
```

(Layer 1 — UI banner — is runtime, not build-time; it operates
independently in the dev server.)

---

## Risks / Trade-offs

### Risk 1: MSW v2 Network Error Shape Mismatch

**Impact**: High — refresh-flow tests that depend on `!error.response`
would silently break.
**Probability**: Low (MSW v2 is mature).
**Trade-off**: Modern MSW API vs. backward compat with v1.
**Mitigation**: Unit test in `handlers.test.ts` asserts that the
`__lfmt_mock_error_network__.txt` path produces an axios error
satisfying `!error.response` — matching the contract at
`frontend/src/utils/api.ts:230-236`.

### Risk 2: Playwright `page.request.*` Bypassing the SW

**Impact**: Medium — silent test failures or accidental real-network
hits.
**Probability**: Medium (idiomatic Playwright code uses
`page.request.*`).
**Mitigation**: `frontend/e2e/utils/apiCall.ts` helper wraps
`page.evaluate(() => fetch(...))`. `LOCAL-TESTING.md` documents the
footgun explicitly.

### Risk 3: Coverage Exclusion Becomes a Hiding Place

**Impact**: Low — un-tested handlers regress silently.
**Probability**: Low (per-PR review catches new handler files).
**Mitigation**: Local-floor convention (85%) on `src/mocks/**` —
informational, not gated, but visible in coverage reports. Documented
in `LOCAL-TESTING.md`.

### Risk 4: `mockServiceWorker.js` Drift After MSW Package Bump

**Impact**: Medium — silent SW protocol mismatch, mock requests fail
intermittently.
**Probability**: Low (MSW updates are infrequent).
**Mitigation**: `npm postinstall` re-runs `msw init` so the committed
file stays in sync. The file is human-reviewable in PRs.

### Risk 5: Multi-Tab `resetState()` Cross-Pollution

**Impact**: Low — confusing dev experience, not a bug.
**Probability**: Low (mock mode is single-developer use).
**Mitigation**: Documented as "Known footgun" in `LOCAL-TESTING.md`.

---

## Migration Plan

### Phase 1: Spec PR (this PR)

- Open this spec PR for team review.
- Two reviewer rounds already complete (v1 → v2 → v3).
- Approval required before any implementation.

### Phase 2: Implementation PR (separate, post-approval)

- Single PR; phases 1-10 from `tasks.md` execute sequentially.
- OMC review (4 specialists) iterates on the implementation.
- Ultra QA + Playwright MCP testing on the demo flow.
- Merge after all gates green.

### Phase 3: Adoption (post-merge)

- Update Phase 10B demo-prep tickets to reference the new local loop.
- Frontend contributors stop deploying for UI-only iteration.

### Rollback

- Single revert restores `frontend/src/utils/mockApi.ts` and the
  legacy `installMockApi()` wiring.
- Vitest + E2E suites should pass against the reverted state with no
  further work (the implementation PR is the only consumer of the
  new mocks).

---

## Open Questions

None — the v3 plan resolved all 9 reviewer findings. The only items
left for the implementation PR are mechanical (port handlers, write
tests, write docs).

---

## References

### Source Files (with line citations)

- **`frontend/src/utils/mockApi.ts`** — current 329 LOC custom axios
  interceptor (auth-only); to be deleted.
  - Lines `88-207`: PII logging anti-pattern (motivates security-
    auditor in OMC slate).
- **`frontend/src/utils/api.ts`**
  - Line `15`: `import { installMockApi, isMockApiEnabled } from './mockApi'`
    — to be removed.
  - Lines `230-236`: error-shape contract that MSW network-error mock
    must satisfy.
  - Lines `286-289`: conditional `installMockApi()` install — to be
    removed.
  - Line `304`: end-of-file marker (for context).
- **`frontend/src/main.tsx`** — needs async dynamic-import refactor
  for SW startup ordering.
- **`frontend/vite.config.ts`**
  - Lines `78-89`: existing coverage configuration; add `src/mocks/**`
    to `exclude` array.
  - Line `181`: end-of-file marker; add Vite plugin (build guard +
    `closeBundle` hook).
- **`frontend/src/services/translationService.ts`**
  - Lines `20-38`: upload request shape #1.
  - Lines `119, 170, 186, 201, 214`: other endpoint call sites the
    mock must serve.
- **`frontend/src/services/uploadService.ts`**
  - Lines `59, 81`: alternative upload request shape; mock must
    handle both.
- **`frontend/src/utils/__tests__/api.refresh.test.ts`**
  - Line `42`: dead `vi.stubEnv('VITE_MOCK_API', 'false')` — to be
    deleted.

### Related PRs

- **PR #135** — `axios-mock-adapter` for unit refresh tests (merged).
  Coexists with this change; different layer.
- **PR #134** — Phase 10B demo-prep plan (merged). This change is a
  prerequisite for the fast-iteration loop Phase 10B requires.

### Industry References

- **MSW Documentation** — https://mswjs.io/docs/
  - Service Worker startup: https://mswjs.io/docs/api/setup-worker/start
  - `msw/node` for tests: https://mswjs.io/docs/api/setup-server
- **Vite Plugin Hooks** — `closeBundle` for post-build cleanup.
- **WCAG 2.1** — `role="status"` `aria-live="polite"` for the mock-
  mode banner accessibility.

---

**Status**: Proposed — Awaiting Team Approval
**Next Steps**: Team review → Approve → Open implementation PR
