# Spec Delta: Local Dev Tooling

This is a new capability being added to the LFMT frontend dev tooling. It
formalizes the requirements for the MSW-based local mock API foundation
that enables fully-local end-to-end testing of the translation pipeline
without depending on deployed AWS infrastructure.

## ADDED Requirements

### Requirement: Local Mock API Service Worker

The system SHALL provide a Mock Service Worker (MSW) infrastructure that
intercepts network requests in the browser when `VITE_MOCK_API=true`,
covering both authentication and the full translation pipeline so that a
developer can run the demo flow end-to-end against `npm run dev` with
zero AWS dependency.

#### Scenario: Mock mode enabled via environment variable

- **GIVEN** the frontend dev server is started with `VITE_MOCK_API=true npm run dev`
- **WHEN** the browser loads the application
- **THEN** the MSW Service Worker SHALL register before the React app renders
- **AND** all subsequent network requests to `/auth/*`, `/jobs/*`,
  `/translation/*`, and the same-origin `/__mock-s3/*` path SHALL be
  intercepted by the MSW handlers
- **AND** the browser Network tab SHALL show only `localhost:3000`
  responses (zero AWS hosts)

#### Scenario: Mock mode disabled in normal dev/prod

- **GIVEN** the frontend is started without `VITE_MOCK_API=true` (or the
  variable is unset / set to any other value)
- **WHEN** the browser loads the application
- **THEN** the MSW Service Worker SHALL NOT register
- **AND** all network requests SHALL hit the real API endpoints as today

#### Scenario: Service Worker startup race is prevented

- **GIVEN** mock mode is enabled (`VITE_MOCK_API=true`)
- **WHEN** the application bootstraps
- **THEN** `frontend/src/main.tsx` SHALL `await worker.start()` BEFORE
  dynamically importing `App.tsx`
- **AND** `apiClient` (which is module-loaded via `App.tsx`) SHALL NOT
  emit any request before the Service Worker is ready
- **AND** the first request observed in the Network tab SHALL be served
  by the SW, not by the real network

### Requirement: Coverage of Auth and Translation Pipeline Endpoints

The mock SHALL cover all endpoints exercised by the demo flow so that
the full register → login → upload → attestation → translate →
progress → history → download path runs in-browser.

#### Scenario: All auth endpoints respond with shared-types-conformant shapes

- **GIVEN** mock mode is enabled
- **WHEN** the frontend calls any of `POST /auth/register`,
  `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`,
  `GET /auth/me`, `POST /auth/forgot-password`,
  `POST /auth/verify-email`, or `POST /auth/reset-password`
- **THEN** the MSW handler SHALL return a response whose shape conforms
  to `@lfmt/shared-types`
- **AND** mock and real backend SHALL NOT drift on response shape

#### Scenario: Upload presigned URL is same-origin and SW-interceptable

- **GIVEN** mock mode is enabled
- **WHEN** the frontend calls `POST /jobs/upload`
- **THEN** the response SHALL include a presigned URL of the form
  `http://localhost:3000/__mock-s3/<jobId>`
- **AND** the subsequent S3 PUT request to that URL SHALL be intercepted
  by the MSW handler regardless of transport (raw `XMLHttpRequest`,
  `axios.put`, or `fetch`)
- **AND** the handler SHALL return HTTP 200 with an `ETag` header

#### Scenario: Translation pipeline endpoints are covered

- **GIVEN** mock mode is enabled
- **WHEN** the frontend calls `POST /jobs/:jobId/translate`,
  `GET /jobs/:jobId/translation-status`, `GET /jobs`, or
  `GET /translation/:jobId/download`
- **THEN** each endpoint SHALL be served by an MSW handler that updates
  / reads the in-memory `JobState` store

### Requirement: In-Memory State Store With Per-Test Reset

The mock SHALL maintain an in-memory job-state store that is closure-
scoped (not exported), reset only via a named `resetState()` export,
and clean-slate per page load (no persistence).

#### Scenario: State persists within a page load

- **GIVEN** mock mode is enabled and a job has been uploaded
- **WHEN** the frontend polls the status endpoint
- **THEN** the same `JobState` SHALL be returned across polls within
  the same page load

#### Scenario: State is cleared on page reload

- **GIVEN** mock mode is enabled and one or more jobs exist
- **WHEN** the user reloads the page
- **THEN** the in-memory `JobState` map SHALL be empty
- **AND** `GET /jobs` SHALL return an empty list

#### Scenario: Tests can reset state via the named export

- **GIVEN** Vitest or Playwright is running with mock mode enabled
- **WHEN** a test imports and calls `resetState()` from
  `src/mocks/handlers.ts`
- **THEN** the in-memory `JobState` map SHALL be cleared
- **AND** subsequent test starts with a fresh state

#### Scenario: `worker.resetHandlers()` does NOT clear closure state

- **GIVEN** the MSW worker is running
- **WHEN** a test calls `worker.resetHandlers()` instead of `resetState()`
- **THEN** the handler list SHALL be reset
- **AND** the closure-scoped `JobState` map SHALL retain its entries
- **AND** documentation SHALL warn about this footgun in
  `frontend/LOCAL-TESTING.md`

### Requirement: Configurable Simulation Speed

The mock SHALL support three progression policies for the translation
status simulation, selected via `VITE_MOCK_SPEED`, with NO background
timers (state advances on-demand inside the status handler).

#### Scenario: `instant` mode advances per request

- **GIVEN** the dev server or Vitest is started with `VITE_MOCK_SPEED=instant`
- **WHEN** the status endpoint is polled four times in a row
- **THEN** `completedChunks` SHALL advance by 25% per call
- **AND** the fourth poll SHALL return `completedChunks === totalChunks`
  (status `completed`)
- **AND** the simulation SHALL NOT depend on `Date.now()`

#### Scenario: `realistic` mode reaches 100% in approximately 10 seconds

- **GIVEN** the dev server is started with `VITE_MOCK_SPEED=realistic`
- **WHEN** translation starts at time `t0`
- **THEN** `progress` at time `t` SHALL equal `min(1, (t - t0) / 10000)`
- **AND** the status endpoint SHALL return `completed` once `t - t0 >= 10000`

#### Scenario: `slow` mode reaches 100% in approximately 60 seconds

- **GIVEN** the dev server is started with `VITE_MOCK_SPEED=slow`
- **WHEN** translation starts at time `t0`
- **THEN** `progress` at time `t` SHALL equal `min(1, (t - t0) / 60000)`

### Requirement: Error Injection via Reserved Filename Pattern

The mock SHALL recognize a reserved filename pattern at request time
to trigger simulated error paths, with no sticky state (re-uploading
a clean file recovers normally).

#### Scenario: HTTP error codes triggered by filename

- **GIVEN** mock mode is enabled
- **WHEN** the user uploads a file whose name matches the regex
  `/^__lfmt_mock_error_(403|413|429|500)__\.txt$/`
- **THEN** the corresponding endpoint SHALL return that HTTP status
  (403 → upload, 413 → upload, 429 → translate, 500 → status)

#### Scenario: Network error simulated to match axios contract

- **GIVEN** mock mode is enabled
- **WHEN** the user uploads `__lfmt_mock_error_network__.txt`
- **THEN** the relevant handler SHALL return `HttpResponse.error()`
- **AND** axios SHALL surface the failure with `!error.response` (matching
  the contract at `frontend/src/utils/api.ts:230-236`)

#### Scenario: Slow simulation triggered by filename

- **GIVEN** mock mode is enabled
- **WHEN** the user uploads `__lfmt_mock_slow__.txt`
- **THEN** the simulation SHALL use the 60-second wall-clock policy
  regardless of `VITE_MOCK_SPEED`

#### Scenario: Re-uploading a clean file recovers

- **GIVEN** the previous upload triggered an error via reserved filename
- **WHEN** the user uploads a normally-named file
- **THEN** the upload SHALL succeed
- **AND** the previous error SHALL NOT affect subsequent requests
  (no sticky state)

### Requirement: Production Safety Rails (Defense in Depth)

The mock SHALL be impossible to ship to production via three independent
mechanisms: a non-dismissible UI banner, a build-time Vite plugin
failure, and a `closeBundle` hook that deletes the SW from `dist/`.

#### Scenario: Non-dismissible UI banner is visible in mock mode

- **GIVEN** the application is running with `VITE_MOCK_API=true`
- **WHEN** the user navigates to any route
- **THEN** a banner SHALL be rendered that:
  - Has `z-index: 2147483647`
  - Has `role="status"` and `aria-live="polite"`
  - Has high-contrast colors that survive a future dark-mode flag
  - Has no close button (cannot be dismissed)
- **AND** the banner text SHALL clearly indicate mock mode is active

#### Scenario: Mock mode build-time guard blocks production builds

- **GIVEN** the developer attempts `VITE_MOCK_API=true npm run build`
- **WHEN** Vite runs the configured plugin
- **THEN** the build SHALL exit with a non-zero status code
- **AND** the error message SHALL clearly explain that mock mode cannot
  be built and SHALL point to `frontend/LOCAL-TESTING.md`

#### Scenario: `mockServiceWorker.js` is removed from `dist/` after build

- **GIVEN** a normal production build (`npm run build`, mock mode off)
- **WHEN** Vite's `closeBundle` hook runs
- **THEN** `dist/mockServiceWorker.js` SHALL be deleted if it exists
- **AND** verifying the file's absence (`ls dist/mockServiceWorker.js`)
  SHALL fail with "no such file"

### Requirement: Shared Handlers Across Vitest and Browser Contexts

The mock handler module SHALL be the single source of truth, consumed
by both `setupServer` (Node-side, for Vitest) and `setupWorker`
(browser-side, for dev server and Playwright), so the contract cannot
drift between test layers.

#### Scenario: Vitest unit tests use the same handlers as the browser

- **GIVEN** the Vitest setup file imports `server` from `src/mocks/server.ts`
- **WHEN** the test suite runs
- **THEN** `server.listen({ onUnhandledRequest: 'error' })` SHALL run
  in `beforeAll`
- **AND** every handler invoked in tests SHALL be the exact same module
  imported by `src/mocks/browser.ts`
- **AND** `server.resetHandlers()` AND `resetState()` SHALL run in
  `afterEach`
- **AND** `server.close()` SHALL run in `afterAll`

#### Scenario: Playwright fixtures reset state per test

- **GIVEN** the Playwright suite is configured with `VITE_MOCK_API=true`
- **WHEN** a test starts
- **THEN** the per-test fixture SHALL clear `localStorage`
- **AND** the fixture SHALL invoke `resetState()` so the next test
  starts with a fresh job map

### Requirement: Three-Layer Mock Strategy Documentation

The repository SHALL document the three-tool mock strategy (axios-mock-
adapter for unit, msw/node for component/integration, MSW Service Worker
for E2E) so that future contributors choose the correct primitive per
layer.

#### Scenario: `frontend/LOCAL-TESTING.md` exists and documents the matrix

- **GIVEN** a developer is reading project documentation
- **WHEN** they consult `frontend/LOCAL-TESTING.md`
- **THEN** the document SHALL include a table mapping each test layer
  (unit / component / E2E) to its mocking tool with rationale
- **AND** the document SHALL include known footguns
  (`page.request.*` bypassing the SW, multi-tab `resetState`,
  HMR + cached SW)

#### Scenario: Root `CLAUDE.md` summarizes the strategy

- **GIVEN** an AI assistant reads `CLAUDE.md`
- **WHEN** it encounters the "Local Testing" section
- **THEN** the section SHALL summarize the three-layer matrix
- **AND** the section SHALL link to `frontend/LOCAL-TESTING.md` for
  the full reference

## MODIFIED Requirements

None — this is a new capability.

## REMOVED Requirements

None — this is a new capability. The legacy `frontend/src/utils/mockApi.ts`
is deleted as part of the implementation, but it was never formalized as
a spec requirement, so there is nothing to mark REMOVED here.

## RENAMED Requirements

None — this is a new capability.
