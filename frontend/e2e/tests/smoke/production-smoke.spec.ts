/**
 * Production Smoke Test Suite
 *
 * This test suite runs critical user paths against the production environment
 * after every deployment to catch deployment failures before they reach users.
 *
 * Issue: #57 - Implement Production Smoke Test Suite
 *
 * Critical User Path:
 * 1. Login with existing test user
 * 2. Upload a small test document
 * 3. Start translation
 * 4. Wait for translation to complete
 * 5. Verify translation success
 *
 * Tagged with @smoke for selective execution in CI/CD
 */

import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { TranslationUploadPage } from '../../pages/TranslationUploadPage';
import { resolveApiUrl } from '../../fixtures/url';

// Smoke tests use a longer timeout because they run against production.
// 3 minutes is sufficient when we use the ~1 KB smoke-test-minimal.txt
// fixture (one chunk, deterministic translation time).
test.setTimeout(180000); // 3 minutes

// __dirname is not defined in ES module scope (Node ESM). Compute it from
// import.meta.url instead. Without this, the test file fails to load with
// `ReferenceError: __dirname is not defined in ES module scope` and every
// post-deploy verification job that imports it (Production Smoke Tests,
// E2E Tests) crashes before running a single assertion.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Path to the tiny fixture we upload during the smoke test. Keeping this
// ~1 KB guarantees the test completes inside the timeout regardless of
// upstream translation-provider latency on a given day.
const SMOKE_FIXTURE_PATH = path.resolve(__dirname, '../../fixtures/smoke-test-minimal.txt');

test.describe('Production Smoke Tests @smoke', () => {
  // Test configuration from environment
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'https://d39xcun7144jgl.cloudfront.net';
  // The frontend smoke test used to require pre-shared `SMOKE_TEST_EMAIL` /
  // `SMOKE_TEST_PASSWORD` repo secrets to log in to a known account. Those
  // secrets were never configured, so every post-deploy run threw
  // "SMOKE_TEST_PASSWORD environment variable is required" before the test
  // body executed. Mirroring the backend smoke fix from PR #177, we now
  // register a fresh user per run — no operational dependency, no shared
  // password rotation risk. The test still respects `SMOKE_TEST_EMAIL` /
  // `SMOKE_TEST_PASSWORD` if they happen to be set (back-compat for anyone
  // who ever does configure them), but does not require them.
  const apiBaseURL =
    process.env.API_BASE_URL ||
    process.env.VITE_API_URL ||
    'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/';

  // Generate a unique test user. Cognito policy requires upper + lower + digit
  // + symbol and >=8 chars; this fits in one literal so the password remains
  // deterministic per run while still satisfying the policy.
  const generateSmokeTestUser = () => {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    return {
      email: `prod-smoke-${ts}-${rand}@e2e-test.lfmt.com`,
      password: `Smoke${ts}${rand}!Aa1`,
      firstName: 'ProdSmoke',
      lastName: 'Test',
    };
  };

  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto(baseURL);
  });

  test('Critical User Journey: Login → Upload → Translate → Complete', async ({ page }) => {
    // Use pre-shared credentials only if BOTH envs are set; otherwise register
    // a fresh user. This keeps the test runnable in any environment without
    // operational ceremony.
    const presharedEmail = process.env.SMOKE_TEST_EMAIL;
    const presharedPassword = process.env.SMOKE_TEST_PASSWORD;
    const user =
      presharedEmail && presharedPassword
        ? {
            email: presharedEmail,
            password: presharedPassword,
            firstName: 'Smoke',
            lastName: 'Test',
          }
        : generateSmokeTestUser();

    // If we need to register, do it via the API up front. The /v1/auth/register
    // endpoint requires confirmPassword + acceptedTerms + acceptedPrivacy on
    // top of the basic credential fields (see shared-types/src/auth.ts:85).
    if (!presharedEmail || !presharedPassword) {
      const registerResponse = await page.request.post(
        `${resolveApiUrl(apiBaseURL)}/auth/register`,
        {
          data: {
            email: user.email,
            password: user.password,
            confirmPassword: user.password,
            firstName: user.firstName,
            lastName: user.lastName,
            acceptedTerms: true,
            acceptedPrivacy: true,
          },
          failOnStatusCode: false,
        }
      );
      // 201 = created, 409 = already exists (acceptable on retries)
      const registerStatus = registerResponse.status();
      if (registerStatus !== 201 && registerStatus !== 409) {
        const body = await registerResponse.text();
        throw new Error(
          `Pre-test registration failed: ${registerStatus} - ${body.substring(0, 200)}`
        );
      }
    }

    const testEmail = user.email;
    const testPassword = user.password;

    // Step 1: Login
    //
    // Previous approach: `if (await loginButton.isVisible())` to decide
    // whether to click the "Log In" button before filling the form. This
    // is the same racy `isVisible()` anti-pattern that caused Bug #1 in
    // Step 2 (see PR #193).  If the home page hasn't finished mounting
    // the button isn't visible yet, so the click is silently skipped and
    // the subsequent `getByLabel(/email/i)` targets the wrong page.
    //
    // Fix: navigate directly to /login (deterministic, no race), then
    // fill and submit the form. This mirrors how the auth E2E tests in
    // `e2e/tests/auth/login.spec.ts` approach the login flow.
    await test.step('User can login', async () => {
      await page.goto(`${baseURL}/login`);

      // Fill in login form
      await page.getByLabel(/email/i).fill(testEmail);
      await page.getByLabel(/password/i).fill(testPassword);
      await page.getByRole('button', { name: /log in|sign in/i }).click();

      // Wait for successful login
      await expect(page).toHaveURL(/dashboard|translate|upload/i, { timeout: 15000 });
    });

    // Step 2: Navigate to upload page
    //
    // Previous approach: click a button/link whose label matched
    // /upload|new translation/i. Two failure modes were observed in CI
    // (Playwright run 25293703129):
    //
    //   a) Race condition — `isVisible()` returned false before the dashboard
    //      finished mounting, so neither branch fired and the page stayed on
    //      the dashboard.
    //
    //   b) False-positive assertion — the dashboard itself contains the text
    //      "Upload" (the "Upload Document" card button), so the post-step
    //      `getByText(/upload|.../i)` check passed even though the wizard
    //      never opened, causing the next step's `getByRole('checkbox', ...)`
    //      to time out 180 s later.
    //
    // Fix: navigate directly to /translation/upload (the same deterministic
    // approach used by every other E2E spec — see complete-workflow.spec.ts,
    // translation-progress.spec.ts).  We then assert the URL and wait for the
    // wizard heading ("New Translation") which is unique to that route.
    await test.step('User can navigate to upload page', async () => {
      await uploadPage.goto();
      await expect(page).toHaveURL(/translation\/upload/i, { timeout: 10000 });
      await expect(page.getByRole('heading', { name: /new translation/i })).toBeVisible({
        timeout: 10000,
      });
    });

    // Step 3: Complete the multi-step wizard to reach the file upload step.
    //
    // The upload page is a 4-step wizard:
    //   Step 0: Legal Attestation  → Step 1: Translation Settings
    //   Step 2: Upload Document    → Step 3: Review & Submit
    //
    // The file input only exists in the DOM on step 2. Calling setInputFiles
    // before the wizard advances past step 1 causes a 3-minute timeout because
    // the locator never resolves (the element isn't mounted yet).
    //
    // Each step is delegated to TranslationUploadPage's role-based helpers
    // (PR #184 review follow-up) so wizard navigation lives in exactly one
    // place. The smoke test still owns its `test.step()` framing and its
    // post-submit translation-completion polling.
    const uploadPage = new TranslationUploadPage(page);

    // Step 3a: Complete legal attestation (wizard step 0)
    await test.step('Complete legal attestation step', async () => {
      await uploadPage.completeLegalAttestationByRole();
    });

    // Step 3b: Configure translation settings (wizard step 1)
    await test.step('User can configure translation settings', async () => {
      await uploadPage.configureTranslationSettingsByRole();
    });

    // Step 3c: Upload document (wizard step 2)
    await test.step('User can upload a document', async () => {
      // Upload the shared minimal smoke-test fixture (see
      // frontend/e2e/fixtures/smoke-test-minimal.txt). Using a committed
      // ~1 KB file avoids allocating large documents inside the test and
      // keeps translation time well under the 3-minute test timeout.
      await uploadPage.uploadFileAndAwaitDisplay(SMOKE_FIXTURE_PATH, 'smoke-test-minimal.txt');
    });

    // Step 4 (wizard step 3): Advance to review and submit
    await test.step('Advance to review step', async () => {
      await uploadPage.advanceToReviewByRole('smoke-test-minimal.txt');
    });

    // Step 5: Start translation
    await test.step('User can start translation', async () => {
      await uploadPage.submitTranslationByRole();

      // Wait for translation to start
      await expect(
        page.getByText(/translation.*started|translating|processing/i).first()
      ).toBeVisible({ timeout: 15000 });

      // If the URL exposes a job id, surface it in the trace to aid debugging
      // when the smoke test fails in CI. We don't need to branch on it.
      const url = page.url();
      const jobIdMatch = url.match(/job[=/]([a-f0-9-]+)/i);
      if (jobIdMatch) {
        test.info().annotations.push({ type: 'jobId', description: jobIdMatch[1] });
      }
    });

    // Step 6: Wait for translation to complete
    await test.step('Translation completes successfully', async () => {
      // Wait for completion indicator (with generous timeout for production)
      await expect(
        page.getByText(/translation.*complete|completed|finished|success/i).first()
      ).toBeVisible({ timeout: 120000 }); // 2 minute timeout

      // Verify no error messages
      const errorIndicators = page.getByText(/error|failed|failure/i);
      await expect(errorIndicators).not.toBeVisible();
    });

    // Step 7: Verify translation can be downloaded/viewed
    await test.step('User can access translated document', async () => {
      // Look for download button or view button
      const downloadButton = page.getByRole('button', { name: /download/i });
      const viewButton = page.getByRole('button', { name: /view|open/i });

      // At least one action should be available
      const hasDownload = await downloadButton.isVisible();
      const hasView = await viewButton.isVisible();

      expect(hasDownload || hasView).toBeTruthy();
    });
  });

  test('Health Check: Frontend loads correctly', async ({ page }) => {
    await test.step('Homepage loads without errors', async () => {
      await page.goto(baseURL);

      // Check for critical elements
      await expect(page).toHaveTitle(/lfmt|translation/i, { timeout: 10000 });

      // Verify no JavaScript errors
      const errors: string[] = [];
      page.on('pageerror', (error) => {
        errors.push(error.message);
      });

      // Wait a moment for any errors to appear
      await page.waitForTimeout(2000);

      expect(errors).toHaveLength(0);
    });
  });

  test('Health Check: API is reachable', async ({ page }) => {
    await test.step('API responds to health check', async () => {
      const apiUrl = process.env.API_BASE_URL || process.env.VITE_API_URL;

      if (!apiUrl) {
        test.skip(true, 'API_BASE_URL not configured');
        return;
      }

      // Make a direct API health check request
      const response = await page.request.get(`${apiUrl}auth`, {
        failOnStatusCode: false,
      });

      // API should respond (even if with 401 Unauthorized for unauth'd requests)
      expect(response.status()).toBeLessThan(500);
    });
  });

  test('Security Check: HTTPS is enforced', async ({ page }) => {
    await test.step('Site uses HTTPS', async () => {
      await page.goto(baseURL);
      expect(page.url()).toMatch(/^https:/);
    });
  });

  test('Security Check: Security headers are present', async ({ page }) => {
    await test.step('Security headers are set', async () => {
      const response = await page.goto(baseURL);
      const headers = response?.headers();

      if (!headers) {
        throw new Error('No headers received');
      }

      // Check for critical security headers
      expect(headers['strict-transport-security']).toBeTruthy();
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['x-frame-options']).toBeTruthy();
      expect(headers['content-security-policy']).toBeTruthy();
    });
  });
});
