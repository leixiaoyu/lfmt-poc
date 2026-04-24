import '@testing-library/jest-dom';
import { expect, afterEach, beforeAll, afterAll } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { server } from './mocks/server';
import { resetState } from './mocks/handlers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

// MSW (msw/node) lifecycle — per design Decision 2 (three-layer mock
// strategy), Vitest unit / component / integration tests share the
// same handler module the browser SW uses. The contract cannot drift.
//
// `onUnhandledRequest: 'bypass'` lets the existing axios-mock-adapter
// unit tests (e.g., src/utils/__tests__/api.refresh.test.ts — PR #135
// pattern) coexist: MockAdapter installs directly on the axios
// instance/adapter and short-circuits before MSW can see the request,
// but residual non-MSW requests in unit tests must not throw — strict
// `'error'` would break tests that mix transports. Component and
// integration tests that exercise the MSW-covered surface still get
// the full handler set from src/mocks/handlers.ts; behavior is
// unchanged from Phase 6 wiring.
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));

// Cleanup after each test:
//   - DOM cleanup (testing-library)
//   - Reset any one-shot handler overrides (server.resetHandlers)
//   - Clear closure-scoped mock state (resetState — handlers' `jobs`
//     and `sessions` maps).
//
// IMPORTANT: `worker.resetHandlers()` only re-installs the original
// handler list — it does NOT clear closure state. Per spec Decision 3
// the named `resetState()` export is the sole authoritative reset.
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetState();
});

afterAll(() => server.close());
