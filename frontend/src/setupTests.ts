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
// `onUnhandledRequest: 'bypass'` is intentional during the transition
// window (Phases 6 and 7): the legacy `mockApi.test.ts` is still
// present and emits requests to `https://api.example.com/api/*` that
// the SW does not handle. Phase 8 deletes `mockApi.ts` AND
// `mockApi.test.ts` atomically and switches this to `'error'`.
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
