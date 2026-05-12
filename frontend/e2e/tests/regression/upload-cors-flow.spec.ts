/**
 * Upload CORS Flow - E2E Regression Tests
 *
 * End-to-end tests covering all issues encountered:
 * - CORS errors from CloudFront
 * - Wrong API paths
 * - Authentication token handling
 * - Presigned URL upload flow
 *
 * NOTE: These tests run against the MSW-mocked dev server (VITE_MOCK_API=true)
 * configured in playwright.config.ts webServer. They do not require AWS credentials
 * and use the mock API handlers in src/mocks/handlers.ts.
 *
 * Issue #243 boy-scout: updated stale page-object API calls (navigate → goto,
 * acceptLegalTerms → completeLegalAttestation, selectLanguage+selectTone →
 * completeTranslationConfig, submitUpload → clickSubmit, uploadFile(name,buf)
 * → uploadFile(path)). The stale calls were pre-existing but invisible before
 * tsconfig.json included e2e/ in tsc --noEmit.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { TranslationUploadPage } from '../../pages/TranslationUploadPage';

// ---------------------------------------------------------------------------
// Helper: write a temp file and return its path. Playwright's setInputFiles
// requires an actual file path on disk, not an in-memory Buffer.
//
// Issue #249: each `mkdtempSync` creates a NEW directory in OS temp. On
// long-running CI runners (or local dev loops) these accumulate. We track
// every created temp dir in `createdTempDirs` and remove them in an
// `afterAll` hook below — keeps the OS temp dir clean and lets `process`
// snapshot tools (e.g. Playwright trace inspection) actually find a temp
// dir that's not buried under hundreds of stale lfmt-e2e-* siblings.
// ---------------------------------------------------------------------------
const createdTempDirs: string[] = [];

function writeTempFile(name: string, content: string): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfmt-e2e-'));
  createdTempDirs.push(tmpDir);
  const filePath = path.join(tmpDir, name);
  fs.writeFileSync(filePath, content);
  return filePath;
}

test.afterAll(() => {
  for (const dir of createdTempDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; OS reclaims temp dirs on reboot regardless.
    }
  }
  createdTempDirs.length = 0;
});

test.describe('Upload Flow - CORS and Authentication Regression', () => {
  let loginPage: LoginPage;
  let uploadPage: TranslationUploadPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    uploadPage = new TranslationUploadPage(page);

    // Navigate and login
    await loginPage.goto();
    await loginPage.login('test@test.io', process.env.TEST_PASSWORD || 'TestPassword123!');
    await page.waitForURL('**/dashboard');
  });

  test('should not encounter CORS errors when uploading from CloudFront', async ({ page }) => {
    // Monitor for CORS errors
    const corsErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('CORS')) {
        corsErrors.push(msg.text());
      }
    });

    // Navigate to upload page
    await uploadPage.goto();

    // Complete legal attestation
    await uploadPage.completeLegalAttestation();

    // Select language and tone
    await uploadPage.completeTranslationConfig('es', 'formal');

    // Upload file
    const testFilePath = writeTempFile(
      'test-document.txt',
      'This is a test document for translation.'
    );
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();

    // Submit
    await uploadPage.clickSubmit();

    // Wait for upload to complete
    await page.waitForTimeout(3000);

    // Verify no CORS errors occurred
    expect(corsErrors).toHaveLength(0);
  });

  test('should use correct API endpoints (not /translation/*)', async ({ page }) => {
    // Intercept network requests
    const apiRequests: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (url.includes('execute-api')) {
        apiRequests.push(url);
      }
    });

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.completeTranslationConfig('es', 'formal');

    const testFilePath = writeTempFile('test.txt', 'Test content');
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    await page.waitForTimeout(2000);

    // Verify correct endpoints were called
    const uploadRequest = apiRequests.find((url) => url.includes('/jobs/upload'));
    expect(uploadRequest).toBeDefined();

    // Verify WRONG endpoints were NOT called
    const wrongEndpoint = apiRequests.find((url) => url.includes('/translation/upload'));
    expect(wrongEndpoint).toBeUndefined();
  });

  test('should send JSON (not multipart/form-data) to /jobs/upload', async ({ page }) => {
    let uploadRequestContentType: string | null = null;

    page.on('request', (request) => {
      if (request.url().includes('/jobs/upload') && request.method() === 'POST') {
        uploadRequestContentType = request.headers()['content-type'] || null;
      }
    });

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.completeTranslationConfig('fr', 'neutral');

    const testFilePath = writeTempFile('document.txt', 'Test document content');
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    await page.waitForTimeout(2000);

    // Verify Content-Type is application/json, NOT multipart/form-data
    expect(uploadRequestContentType).toContain('application/json');
    expect(uploadRequestContentType).not.toContain('multipart/form-data');
  });

  test('should include Authorization header with Bearer token', async ({ page }) => {
    let authHeader: string | undefined;

    page.on('request', (request) => {
      if (request.url().includes('/jobs/upload') && request.method() === 'POST') {
        authHeader = request.headers()['authorization'];
      }
    });

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.completeTranslationConfig('de', 'neutral');

    const testFilePath = writeTempFile('test.txt', 'Test content');
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    await page.waitForTimeout(2000);

    // Verify Authorization header exists and has Bearer format
    expect(authHeader).toBeDefined();
    expect(authHeader).toMatch(/^Bearer /);
  });

  test('should follow presigned URL flow (2 requests: API then S3)', async ({ page }) => {
    const requests: Array<{ url: string; method: string }> = [];

    page.on('request', (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
      });
    });

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.completeTranslationConfig('zh', 'formal');

    const testFilePath = writeTempFile('test.txt', 'Test translation content');
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    await page.waitForTimeout(3000);

    // Step 1: POST to /jobs/upload (get presigned URL)
    const apiRequest = requests.find((r) => r.url.includes('/jobs/upload') && r.method === 'POST');
    expect(apiRequest).toBeDefined();

    // Step 2: PUT to S3 (upload file)
    const s3Request = requests.find(
      (r) => r.url.includes('s3.amazonaws.com') && r.method === 'PUT'
    );
    expect(s3Request).toBeDefined();

    // Verify file was NOT sent to API Gateway
    const apiRequestWithFile = requests.find(
      (r) => r.url.includes('/jobs/upload') && r.method === 'PUT'
    );
    expect(apiRequestWithFile).toBeUndefined();
  });

  test('should handle expired token with redirect to login', async ({ page }) => {
    // Simulate expired token
    await page.evaluate(() => {
      const expiredToken = btoa(
        JSON.stringify({
          sub: 'test-user',
          exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        })
      );
      localStorage.setItem('accessToken', `header.${expiredToken}.signature`);
    });

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.completeTranslationConfig('es', 'formal');

    const testFilePath = writeTempFile('test.txt', 'Test');
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    // Should redirect to login or show error
    await page.waitForTimeout(2000);

    // Check for either login redirect or 401 error message
    const currentUrl = page.url();
    const errorMessage = await page.locator('text=/unauthorized|expired|login/i').count();

    expect(currentUrl.includes('/login') || errorMessage > 0).toBe(true);
  });

  test('should display CORS error only if actual CORS issue occurs', async ({ page }) => {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.completeTranslationConfig('it', 'neutral');

    const testFilePath = writeTempFile('test.txt', 'Test content');
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    await page.waitForTimeout(3000);

    // Filter for CORS-related errors
    const corsErrors = consoleErrors.filter(
      (err) =>
        err.toLowerCase().includes('cors') ||
        err.toLowerCase().includes('access-control-allow-origin')
    );

    // Should be zero CORS errors
    expect(corsErrors).toHaveLength(0);
  });

  test('should retry upload on network error', async ({ page, context }) => {
    // Simulate network interruption
    await context.route('**/jobs/upload', (route) => {
      const attempt = route.request().headers()['x-retry-attempt'] || '0';
      if (attempt === '0') {
        // Fail first attempt
        route.abort();
      } else {
        // Succeed on retry
        route.continue();
      }
    });

    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.completeTranslationConfig('fr', 'formal');

    const testFilePath = writeTempFile('test.txt', 'Test content');
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();
    await uploadPage.clickSubmit();

    // Should eventually succeed after retry
    await page.waitForTimeout(5000);

    // Check for success message or navigation to status page
    const successMessage = await page
      .locator('text=/upload.*success|translation.*started/i')
      .count();
    expect(successMessage).toBeGreaterThan(0);
  });
});

test.describe('Authentication Token Scenarios', () => {
  test('should maintain token across page navigation', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('test@test.io', process.env.TEST_PASSWORD || 'TestPassword123!');

    // Get initial token
    const initialToken = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(initialToken).toBeTruthy();

    // Navigate to different pages
    await page.goto('/dashboard');
    await page.goto('/translation/history');
    await page.goto('/translation/upload');

    // Token should still be the same
    const currentToken = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(currentToken).toBe(initialToken);
  });

  test('should clear tokens on logout', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login('test@test.io', process.env.TEST_PASSWORD || 'TestPassword123!');

    // Verify token exists
    let token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token).toBeTruthy();

    // Logout
    await page.click('text=/log out/i');
    await page.waitForURL('**/login');

    // Token should be cleared
    token = await page.evaluate(() => localStorage.getItem('accessToken'));
    expect(token).toBeNull();
  });
});
