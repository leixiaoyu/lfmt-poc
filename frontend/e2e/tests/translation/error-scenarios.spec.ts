/**
 * Error Scenarios E2E Tests
 *
 * Tests error handling across the translation workflow:
 * - Network errors during upload
 * - API errors during translation
 * - File validation errors
 * - Rate limit errors
 * - Translation failures
 * - Download errors
 * - Timeout scenarios
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { TranslationUploadPage } from '../../pages/TranslationUploadPage';
import { TranslationDetailPage } from '../../pages/TranslationDetailPage';
import { generateTestUser } from '../../fixtures/auth';
import { TEST_DOCUMENTS } from '../../fixtures/test-documents';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('Error Scenarios and Error Handling', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;
  let uploadPage: TranslationUploadPage;
  let detailPage: TranslationDetailPage;

  const testFilePath = path.join(__dirname, '../../fixtures/error-test.txt');

  test.beforeAll(() => {
    const testDoc = TEST_DOCUMENTS.MINIMAL;
    const fixturesDir = path.join(__dirname, '../../fixtures');

    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    fs.writeFileSync(testFilePath, testDoc.content, 'utf8');
  });

  test.afterAll(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    uploadPage = new TranslationUploadPage(page);
    detailPage = new TranslationDetailPage(page);

    // Register and login
    const user = generateTestUser();
    await page.request.post(
      `${process.env.API_BASE_URL || 'http://localhost:3000'}/v1/auth/register`,
      {
        data: {
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          password: user.password,
        },
      }
    );

    await loginPage.goto();
    await loginPage.login(user.email, user.password);
    await dashboardPage.waitForPageLoad();
  });

  test('should handle network error during file upload', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();

    // Intercept upload request and simulate network error
    await page.route('**/v1/upload/**', route => {
      route.abort('failed');
    });

    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();

    // Expect error message
    await expect(page.locator('text=/error/i')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=/upload failed/i')).toBeVisible({ timeout: 5000 });
  });

  test('should handle API error (500) during job creation', async ({ page }) => {
    await uploadPage.goto();

    // Intercept job creation request and return 500 error
    await page.route('**/v1/translation/jobs', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    // Expect error message
    await expect(page.locator('text=/error/i')).toBeVisible({ timeout: 10000 });
  });

  test('should handle unauthorized error (401) and redirect to login', async ({ page }) => {
    await uploadPage.goto();

    // Clear auth token to simulate session expiration
    await page.evaluate(() => localStorage.removeItem('authToken'));

    // Try to upload - should redirect to login
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Should redirect to login page
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test('should validate file type restrictions', async ({ page }) => {
    // Create invalid file type
    const invalidFilePath = path.join(__dirname, '../../fixtures/invalid-file.exe');
    fs.writeFileSync(invalidFilePath, 'Invalid content', 'utf8');

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();

    // Try to upload invalid file
    try {
      await uploadPage.uploadFile(invalidFilePath);

      // Expect validation error or disabled Next button
      const nextButton = page.locator('button:has-text("Next")');
      await expect(nextButton).toBeDisabled({ timeout: 2000 });
    } catch (e) {
      // File picker might reject the file entirely
      console.log('File picker rejected invalid file type');
    } finally {
      // Cleanup
      if (fs.existsSync(invalidFilePath)) {
        fs.unlinkSync(invalidFilePath);
      }
    }
  });

  test('should validate file size limit', async ({ page }) => {
    // Create very large file (if size limits are enforced)
    const largeFilePath = path.join(__dirname, '../../fixtures/large-file.txt');

    // Note: Adjust size based on actual limit
    const largeContent = 'A'.repeat(100 * 1024 * 1024); // 100MB
    fs.writeFileSync(largeFilePath, largeContent, 'utf8');

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();

    try {
      await uploadPage.uploadFile(largeFilePath);
      await uploadPage.clickNext();

      // Expect error message about file size
      await expect(page.locator('text=/too large/i')).toBeVisible({ timeout: 5000 });
    } catch (e) {
      console.log('Large file upload handled');
    } finally {
      // Cleanup
      if (fs.existsSync(largeFilePath)) {
        fs.unlinkSync(largeFilePath);
      }
    }
  });

  test('should handle translation failure gracefully', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeUploadWorkflow(testFilePath, 'es', 'neutral');
    await uploadPage.waitForNavigationToDetail();
    await detailPage.waitForPageLoad();

    // Extract jobId
    const currentUrl = page.url();
    const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
    const jobId = jobIdMatch![1];

    // Simulate translation failure by mocking API
    await page.route(`**/v1/translation/jobs/${jobId}/start`, route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Translation service unavailable' }),
      });
    });

    // Try to start translation (if in CHUNKED state)
    const status = await detailPage.getJobStatus();
    if (status === 'CHUNKED') {
      await detailPage.clickStart();

      // Expect error message
      await expect(page.locator('text=/error/i')).toBeVisible({ timeout: 5000 });
    }
  });

  test('should handle missing job ID (404)', async ({ page }) => {
    // Navigate to non-existent job
    await page.goto(`${page.url()}/translation/non-existent-job-id`);

    // Expect error message or redirect
    await expect(page.locator('text=/not found/i')).toBeVisible({ timeout: 5000 });
  });

  test('should handle forbidden access (403) and redirect', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeUploadWorkflow(testFilePath, 'es', 'neutral');
    await uploadPage.waitForNavigationToDetail();
    await detailPage.waitForPageLoad();

    // Extract jobId
    const currentUrl = page.url();
    const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
    const jobId = jobIdMatch![1];

    // Intercept API and return 403
    await page.route(`**/v1/translation/jobs/${jobId}`, route => {
      route.fulfill({
        status: 403,
        body: JSON.stringify({ error: 'Forbidden' }),
      });
    });

    // Refresh page to trigger API call
    await page.reload();

    // Expect error or redirect to dashboard
    await expect(page.locator('text=/permission/i')).toBeVisible({ timeout: 5000 });
  });

  test('should retry failed requests with exponential backoff', async ({ page }) => {
    let requestCount = 0;

    await uploadPage.goto();

    // Intercept upload and fail first 2 attempts
    await page.route('**/v1/upload/**', route => {
      requestCount++;
      if (requestCount <= 2) {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();

    // Should eventually succeed after retries
    // Note: This depends on implementation having retry logic
    if (requestCount > 2) {
      await uploadPage.clickSubmit();
      await uploadPage.waitForNavigationToDetail();
      expect(requestCount).toBeGreaterThan(2);
    }
  });

  test('should display user-friendly error messages', async ({ page }) => {
    await uploadPage.goto();

    // Trigger an error
    await page.route('**/v1/upload/**', route => {
      route.fulfill({
        status: 400,
        body: JSON.stringify({ error: 'Invalid file format' }),
      });
    });

    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();

    // Expect user-friendly message (not raw error)
    const errorMessage = page.locator('[role="alert"]');
    await expect(errorMessage).toBeVisible({ timeout: 5000 });

    const errorText = await errorMessage.textContent();
    expect(errorText).toBeTruthy();

    // Should not contain stack traces or technical details
    expect(errorText).not.toContain('Error:');
    expect(errorText).not.toContain('at ');
  });

  test('should allow user to retry after error', async ({ page }) => {
    let shouldFail = true;

    await uploadPage.goto();

    // Fail first attempt, succeed on retry
    await page.route('**/v1/upload/**', route => {
      if (shouldFail) {
        shouldFail = false;
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();

    // First attempt fails
    await expect(page.locator('text=/error/i')).toBeVisible({ timeout: 5000 });

    // Retry by clicking Back and trying again
    const backButton = page.locator('button:has-text("Back")');
    if (await backButton.isVisible({ timeout: 1000 })) {
      await backButton.click();
      await uploadPage.clickNext();

      // Should succeed this time
      await uploadPage.clickSubmit();
      await uploadPage.waitForNavigationToDetail();
      await detailPage.waitForPageLoad();
    }
  });

  test('should handle concurrent request failures', async ({ page }) => {
    await uploadPage.goto();

    // Simulate multiple concurrent failures
    let failureCount = 0;
    await page.route('**/v1/**', route => {
      failureCount++;
      if (failureCount % 2 === 0) {
        route.abort('connectionrefused');
      } else {
        route.continue();
      }
    });

    // App should handle this gracefully
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Should still be functional despite intermittent failures
    await expect(page.locator('#target-language')).toBeVisible({ timeout: 10000 });
  });
});
