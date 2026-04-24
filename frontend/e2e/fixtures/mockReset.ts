/**
 * Per-test mock-state reset fixture for Playwright.
 *
 * Per design Decision 3, the closure-scoped mock state in
 * `frontend/src/mocks/handlers.ts` survives across tests within the
 * same browser context. We reset two things per test:
 *
 *   1. localStorage — auth tokens / user data from previous tests.
 *   2. The MSW closure-scoped `jobs` and `sessions` maps — via
 *      page reload, which forces the SW to re-evaluate the handlers
 *      module from scratch (clean-slate-per-load contract). This is
 *      simpler than exposing a test-only `/__test/reset` endpoint
 *      and keeps the production-safety surface small.
 *
 * IMPORTANT: `worker.resetHandlers()` does NOT clear closure state
 * — it only re-installs the handler list. The page-reload approach
 * is the documented authoritative reset for browser contexts. See
 * `frontend/LOCAL-TESTING.md`.
 *
 * Usage:
 *
 *   import { test } from '../fixtures/mockReset';
 *
 *   test.beforeEach(async ({ page, resetMockState }) => {
 *     await resetMockState();
 *   });
 */

import { test as base, type Page } from '@playwright/test';

type ResetFn = (options?: { gotoPath?: string }) => Promise<void>;

interface MockResetFixtures {
  resetMockState: ResetFn;
}

async function resetMockState(
  page: Page,
  options: { gotoPath?: string } = {}
): Promise<void> {
  // Step 1: navigate to the app so localStorage / SW are accessible.
  // We use the absolute root URL so the test does not need a baseURL
  // set — Playwright resolves `'/'` against the configured baseURL.
  await page.goto(options.gotoPath ?? '/');
  // Step 2: wipe localStorage in the page context.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  // Step 3: reload to force the SW + handlers module to re-init,
  // which clears the closure-scoped `jobs` and `sessions` maps.
  await page.reload({ waitUntil: 'load' });
}

/**
 * Extended Playwright `test` object that exposes a `resetMockState`
 * fixture. Tests using this fixture get a clean mock environment.
 */
export const test = base.extend<MockResetFixtures>({
  resetMockState: async ({ page }, use) => {
    await use((options) => resetMockState(page, options));
  },
});

export { expect } from '@playwright/test';
