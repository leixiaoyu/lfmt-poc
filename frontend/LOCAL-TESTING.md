# Local Testing Guide — MSW Mock API Foundation

This guide covers the local mock API loop introduced by
`add-local-mock-api-foundation` (spec PR #139). It is the day-to-day
developer reference for running, testing, and debugging the LFMT
frontend without an AWS backend.

For the full technical rationale see
`openspec/changes/add-local-mock-api-foundation/{proposal,design,tasks}.md`
and the spec at
`openspec/changes/add-local-mock-api-foundation/specs/local-dev-tooling/spec.md`.

---

## Quick Start

```bash
# Start the dev server with the MSW mock layer enabled.
cd frontend
VITE_MOCK_API=true npm run dev
```

You should see:

- A non-dismissible **yellow banner** at the top of every route
  reading `MOCK API MODE — DO NOT DEMO TO USERS`.
- The browser console shows `[MSW] Mocking enabled.`.
- The Network tab shows zero requests to AWS hosts. Every request
  is served by the in-browser Service Worker.

You can now register, log in, upload a small text file, click
translate, watch the progress bar tick to 100%, see the job in
history, and download the simulated translated output — entirely
in-browser.

---

## Three-Layer Mock Strategy

LFMT's frontend deliberately uses three different mocking primitives,
each appropriate for a different test layer. Pick the right tool for
the layer you are working at:

| Layer                           | Environment | Tool                                   | When to use                                                                            |
| ------------------------------- | ----------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Unit (jsdom)                    | Vitest      | `axios-mock-adapter` (PR #135 pattern) | Tests of axios interceptor internals (e.g., refresh-flow ordering, queueing).          |
| Component / integration (jsdom) | Vitest      | `msw/node` (shared handlers)           | Real `apiClient` flow against the same handlers the browser SW uses.                   |
| E2E (browser)                   | Playwright  | MSW Service Worker                     | Full-stack browser flow including the SW path. The closest thing to "production-like". |

The handler module at `frontend/src/mocks/handlers.ts` is the
**single source of truth** — it is imported by both
`src/mocks/browser.ts` (`setupWorker`) and `src/mocks/server.ts`
(`setupServer`). Mock and real backend cannot drift on the wire
shape because both implementations are typed against
`@lfmt/shared-types`.

### Why keep `axios-mock-adapter` after MSW?

PR #135 rewrote the refresh-token tests on `axios-mock-adapter`.
Those tests **explicitly target axios interceptor internals** — they
need to mock at the axios layer to assert which interceptor handler
runs first. MSW intercepts at the network layer (after interceptors
run), so it cannot test interceptor ordering. Different tool,
different layer. See `src/utils/__tests__/api.refresh.test.ts`.

---

## Mock-Mode Speed Profiles (`VITE_MOCK_SPEED`)

The translation simulation cadence is governed by `VITE_MOCK_SPEED`.
The handlers themselves respond synchronously (the speed profile
controls only the simulated chunk-progress ticking inside
`GET /jobs/:jobId/translation-status`).

| Profile     | Default for     | Behavior                                                                                                                       |
| ----------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `instant`   | Vitest          | Request-count-driven. Status handler advances `completedChunks` by 25% per call → 4 polls reach 100%. No wall-clock dependency. |
| `realistic` | `npm run dev`   | Wall-clock. `progress = min(1, (now - startTs) / 10s)`. ~10s end-to-end.                                                       |
| `slow`      | Demo rehearsal  | Wall-clock, ~60s end-to-end. Also force-triggered by uploading `__lfmt_mock_slow__.txt`.                                       |

Set the profile at startup:

```bash
VITE_MOCK_API=true VITE_MOCK_SPEED=slow npm run dev
```

Vitest defaults to `instant` (via the `VITEST` env it sets), so unit
and component tests are deterministic and fast.

---

## Error Injection — Reserved Filename Pattern

To exercise error paths without per-test API plumbing, upload a file
whose name matches the reserved pattern. The match is recomputed at
request time — there is no sticky state, so re-uploading a
normally-named file recovers immediately.

| Filename                              | Effect                                                  |
| ------------------------------------- | ------------------------------------------------------- |
| `__lfmt_mock_error_403__.txt`         | upload returns `403 Forbidden`                          |
| `__lfmt_mock_error_413__.txt`         | upload returns `413 Payload Too Large`                  |
| `__lfmt_mock_error_429__.txt`         | translate returns `429 Too Many Requests`               |
| `__lfmt_mock_error_500__.txt`         | status returns `500 Internal Server Error`              |
| `__lfmt_mock_error_network__.txt`     | network error (`HttpResponse.error()`) — axios sees `!error.response` |
| `__lfmt_mock_slow__.txt`              | forces 60s wall-clock simulation regardless of `VITE_MOCK_SPEED` |

The pattern (`/^__lfmt_mock_(error_(403\|413\|429\|500\|network)\|slow)__\.txt$/`)
is intentionally absurd; collision probability with real user
uploads is ~0. Handlers are not registered in production, so the
pattern is inert in deployed environments.

---

## State Store — Closure-Scoped, Clean-Slate per Page Load

The mock job lifecycle lives in a closure-scoped
`Map<jobId, JobState>` inside `src/mocks/handlers.ts`. The map is
**not** exported — all mutations flow through handlers, the same
path the real code takes.

The only public escape hatch is the `resetState()` named export.
**Critical**: `worker.resetHandlers()` only re-installs the original
handler list — it does NOT clear closure state. Tests must call
`resetState()` explicitly:

```ts
// frontend/src/setupTests.ts (Vitest)
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetState(); // <-- MUST call this
});
```

```ts
// frontend/e2e/fixtures/mockReset.ts (Playwright)
test.beforeEach(async ({ page }) => {
  await page.evaluate(() => localStorage.clear());
  // resetState reached via test endpoint or full reload
});
```

There is **no `localStorage` / `sessionStorage`** backing — page
reload = clean slate. This matches existing unit-test conventions
(Vitest jsdom is fresh per test) and avoids tab-coordination bugs.

---

## Service Worker Lifecycle

The browser-side mock relies on `frontend/public/mockServiceWorker.js`,
which is auto-generated by `npx msw init public/`. The file is
committed to git because the runtime cannot fetch it from
`node_modules`. A `postinstall` script re-runs `msw init` so the
file stays in sync after `npm install` (e.g., when the MSW package
updates).

### SW Cache & Hard Refresh

Browsers aggressively cache Service Workers. After modifying any
handler, **hard-refresh** the page (Cmd-Shift-R / Ctrl-Shift-R) so
the SW picks up the new code. If you still see stale behavior,
unregister the SW from DevTools → Application → Service Workers.

The dev workflow uses Vite HMR for app code, but the SW itself does
not hot-reload. Convention: append `?v=<n>` to the SW URL when
debugging cache issues.

---

## Playwright + MSW

Playwright tests run against `npm run dev` with the MSW SW already
started (configured in `frontend/playwright.config.ts`'s `webServer`
block: `VITE_MOCK_API=true VITE_MOCK_SPEED=instant`).

### `page.evaluate(() => fetch(...))` — NOT `page.request.*`

**Footgun**: `page.request.*` is a Playwright API that bypasses the
browser context entirely. It opens its own HTTP client, which means
**MSW does not see those requests** — they will silently hit the
real network (or fail with DNS errors, depending on the URL).

For any in-test API call, use the wrapper at
`frontend/e2e/utils/apiCall.ts`:

```ts
import { apiCall } from '../utils/apiCall';

const me = await apiCall(page, '/auth/me');
```

The helper is a thin wrapper around
`page.evaluate(({ p, i }) => fetch(p, i).then(r => r.json()), {...})`
— this dispatches the request from inside the page, so the SW
intercepts it.

### Reset Fixture

Use the shared fixture at `frontend/e2e/fixtures/mockReset.ts` for
per-test reset:

```ts
import { test } from '../fixtures/mockReset';

test('my test', async ({ page }) => {
  // page already has fresh localStorage and reset mock state
});
```

---

## Vitest + msw/node

Vitest tests share the same handler module via `msw/node`. The
lifecycle is wired in `src/setupTests.ts`:

```ts
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetState();
});
afterAll(() => server.close());
```

**Why `'bypass'` and not `'error'`?** The unit-test layer still uses
`axios-mock-adapter` for some tests (`api.refresh.test.ts`).
MockAdapter intercepts at the axios layer, before MSW would see the
request. Strict `'error'` would noisily reject benign axios-only
requests in those tests. The `'bypass'` mode keeps both worlds
co-existing. Component / integration tests still get the full MSW
handler surface.

### Per-Test Handler Overrides

To exercise an alternate response for a single test, install a
one-shot override with `server.use()`. The override is cleared
automatically by the `afterEach(server.resetHandlers())` hook:

```ts
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../mocks/server';

it('shows loading state', async () => {
  server.use(
    http.post(/\/auth\/login$/, async () => {
      await delay(100);
      return HttpResponse.json({ /* ... */ }, { status: 200 });
    })
  );
  // ... test runs against the slowed handler ...
});
```

This pattern is used by the `Loading States` tests in
`LoginPage.test.tsx` and `RegisterPage.test.tsx`: the default
handlers respond synchronously, so the loading button text would
not be observable without an artificial delay.

---

## Three Production-Safety Layers

The mock **must never reach production**. Three independent layers
defend against this:

1. **UI banner** (`src/components/common/MockModeBanner.tsx`).
   Non-dismissible, `z-index: 2147483647`, high-contrast
   yellow/black so it survives any future dark-mode flag. Visible
   on every route whenever `VITE_MOCK_API === 'true'`.
2. **Vite build-time guard** (`vite.config.ts`,
   `mockApiBuildGuard`). Throws synchronously inside Vite's `config`
   hook if `VITE_MOCK_API=true` AND `command === 'build'`, regardless
   of mode. Covers `npm run build`, `build:dev`, etc.
3. **Vite `closeBundle` SW cleanup** (`vite.config.ts`,
   `mockServiceWorkerCleanup`). Deletes `dist/mockServiceWorker.js`
   after every prod build, even if Layer 2 is somehow bypassed —
   without the SW file, the runtime cannot register the mock.

### Verification

```bash
# Layer 2: build guard
VITE_MOCK_API=true CI=true npm run build
# → exits non-zero with "BUILD BLOCKED" error

# Layer 3: SW cleanup
CI=true npm run build
ls dist/mockServiceWorker.js
# → "ls: dist/mockServiceWorker.js: No such file or directory"
```

---

## Coverage Carve-Out

`src/mocks/**` is excluded from the global coverage gate (per
`vite.config.ts`). The carve-out matches the precedent set by the
existing `e2e/**` exclusion: dev-test infrastructure is not
"product code" and should not skew coverage math. The local
informational floor for `src/mocks/**` is 85% (not gated), enforced
by per-file scrutiny in PR review and the
`src/mocks/__tests__/handlers.test.ts` suite.

---

## Known Footguns

- **Multi-tab `resetState()`**: One tab calling `resetState()` (or
  hard-refreshing) **nukes the state in any other open tab** —
  they share the same handler-module closure inside the same SW.
  Mock mode is single-tab development; multi-tab is not a supported
  workflow.
- **HMR + cached SW**: The app code hot-reloads, but the SW does
  not. Hard-refresh after any handler change.
- **`page.request.*` bypasses the SW** (see Playwright section
  above). Always use the `apiCall` helper.
- **Module-load-time `apiClient`**: `src/main.tsx` uses an async
  dynamic `import('./App')` AFTER `await worker.start()` so the
  first `apiClient` requests cannot race the SW startup. Do not
  refactor this back to a static import.
- **Reserved-filename collision**: The pattern is absurd-by-design.
  If a real user manages to upload `__lfmt_mock_error_403__.txt` in
  production, the handler is not registered there — so the file is
  treated normally. The risk is theoretical only.
- **`vi.stubEnv` removal**: PR #135 + Phase 8 of this change removed
  the legacy `vi.stubEnv('VITE_MOCK_API', 'false')` from
  `api.refresh.test.ts`. If you re-add it, you are likely confused
  about which mock layer you are testing — see the three-layer
  table above.

---

## Adding a New Handler

1. Add the handler to `frontend/src/mocks/handlers.ts` (matching the
   existing `buildPath()` wildcard convention).
2. Type the response against `@lfmt/shared-types` so the mock
   cannot drift from the real backend wire shape.
3. **Do NOT** log raw request bodies, emails, passwords, tokens, or
   other PII to the console. The legacy `mockApi.ts` violated this
   (lines 88-207, removed by Phase 8). If you need debugging
   output, log only non-PII shape information (e.g., body keys).
4. Add a unit test in `src/mocks/__tests__/handlers.test.ts`.
5. Hard-refresh the dev server to pick up the new handler.

---

## Related References

- `openspec/changes/add-local-mock-api-foundation/proposal.md` —
  the change proposal (the "what" and "why").
- `openspec/changes/add-local-mock-api-foundation/design.md` — the
  technical design (12 decisions with rationale).
- `openspec/changes/add-local-mock-api-foundation/tasks.md` — the
  10-phase implementation plan.
- `openspec/changes/add-local-mock-api-foundation/specs/local-dev-tooling/spec.md`
  — the formal spec.
- `frontend/src/mocks/handlers.ts` — handler source (closure store,
  simulation, error injection, all here).
- `frontend/src/mocks/__tests__/handlers.test.ts` — handler tests.
- `frontend/e2e/tests/local/full-flow-mock.spec.ts` — the
  end-to-end demo flow, in-browser, against MSW.
- `frontend/e2e/utils/apiCall.ts` — Playwright `page.evaluate`
  fetch wrapper.
- `frontend/e2e/fixtures/mockReset.ts` — Playwright per-test reset
  fixture.
