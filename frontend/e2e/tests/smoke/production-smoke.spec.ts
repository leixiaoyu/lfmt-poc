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
  const testEmail = process.env.SMOKE_TEST_EMAIL || 'smoke-test@example.com';
  const testPassword = process.env.SMOKE_TEST_PASSWORD;

  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto(baseURL);
  });

  test('Critical User Journey: Login → Upload → Translate → Complete', async ({ page }) => {
    // Verify environment variables
    if (!testPassword) {
      throw new Error('SMOKE_TEST_PASSWORD environment variable is required');
    }

    // Step 1: Login
    await test.step('User can login', async () => {
      // Click login button if on home page
      const loginButton = page.getByRole('button', { name: /log in|sign in/i });
      if (await loginButton.isVisible()) {
        await loginButton.click();
      }

      // Fill in login form
      await page.getByLabel(/email/i).fill(testEmail);
      await page.getByLabel(/password/i).fill(testPassword);
      await page.getByRole('button', { name: /log in|sign in/i }).click();

      // Wait for successful login
      await expect(page).toHaveURL(/dashboard|translate|upload/i, { timeout: 15000 });
    });

    // Step 2: Navigate to upload page
    await test.step('User can navigate to upload page', async () => {
      // Look for upload button or link
      const uploadButton = page.getByRole('button', { name: /upload|new translation/i });
      const uploadLink = page.getByRole('link', { name: /upload|new translation/i });

      if (await uploadButton.isVisible()) {
        await uploadButton.click();
      } else if (await uploadLink.isVisible()) {
        await uploadLink.click();
      }

      // Verify we're on the upload page
      await expect(page.getByText(/upload|select.*file|drag.*drop/i).first()).toBeVisible({
        timeout: 10000,
      });
    });

    // Step 3: Upload document
    await test.step('User can upload a document', async () => {
      // Upload the shared minimal smoke-test fixture (see
      // frontend/e2e/fixtures/smoke-test-minimal.txt). Using a committed
      // ~1 KB file avoids allocating large documents inside the test and
      // keeps translation time well under the 3-minute test timeout.
      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(SMOKE_FIXTURE_PATH);

      // Wait for file to be processed
      await expect(page.getByText(/smoke-test-minimal\.txt/i)).toBeVisible({
        timeout: 10000,
      });
    });

    // Step 4: Configure translation settings
    await test.step('User can configure translation settings', async () => {
      // Select source language (if not already English)
      const sourceLanguage = page.getByLabel(/source.*language/i);
      if (await sourceLanguage.isVisible()) {
        await sourceLanguage.click();
        await page.getByRole('option', { name: /english/i }).click();
      }

      // Select target language (Spanish)
      const targetLanguage = page.getByLabel(/target.*language/i);
      await targetLanguage.click();
      await page.getByRole('option', { name: /spanish|español/i }).click();
    });

    // Step 5: Start translation
    await test.step('User can start translation', async () => {
      // Click translate button
      const translateButton = page.getByRole('button', { name: /translate|start.*translation/i });
      await translateButton.click();

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
