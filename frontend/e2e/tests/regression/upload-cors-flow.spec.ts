/**
 * Upload CORS Flow - E2E Regression Tests
 *
 * End-to-end tests covering all issues encountered:
 * - CORS errors from CloudFront
 * - Wrong API paths
 * - Authentication token handling
 * - Presigned URL upload flow
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { TranslationUploadPage } from '../../pages/TranslationUploadPage';

test.describe('Upload Flow - CORS and Authentication Regression', () => {
  let loginPage: LoginPage;
  let uploadPage: TranslationUploadPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    uploadPage = new TranslationUploadPage(page);

    // Navigate and login
    await loginPage.navigate();
    await loginPage.login('test@test.io', process.env.TEST_PASSWORD || 'TestPassword123!');
    await page.waitForURL('**/dashboard');
  });

  test('should not encounter CORS errors when uploading from CloudFront', async ({ page, context }) => {
    // Monitor for CORS errors
    const corsErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && msg.text().includes('CORS')) {
        corsErrors.push(msg.text());
      }
    });

    // Navigate to upload page
    await uploadPage.navigate();

    // Complete legal attestation
    await uploadPage.acceptLegalTerms();

    // Select language and tone
    await uploadPage.selectLanguage('Spanish');
    await uploadPage.selectTone('Formal');

    // Upload file
    const testFile = Buffer.from('This is a test document for translation.');
    await uploadPage.uploadFile('test-document.txt', testFile);

    // Submit
    await uploadPage.submitUpload();

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

    await uploadPage.navigate();
    await uploadPage.acceptLegalTerms();
    await uploadPage.selectLanguage('Spanish');
    await uploadPage.selectTone('Formal');

    const testFile = Buffer.from('Test content');
    await uploadPage.uploadFile('test.txt', testFile);
    await uploadPage.submitUpload();

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

    await uploadPage.navigate();
    await uploadPage.acceptLegalTerms();
    await uploadPage.selectLanguage('French');
    await uploadPage.selectTone('Neutral');

    const testFile = Buffer.from('Test document content');
    await uploadPage.uploadFile('document.txt', testFile);
    await uploadPage.submitUpload();

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

    await uploadPage.navigate();
    await uploadPage.acceptLegalTerms();
    await uploadPage.selectLanguage('German');
    await uploadPage.selectTone('Informal');

    const testFile = Buffer.from('Test content');
    await uploadPage.uploadFile('test.txt', testFile);
    await uploadPage.submitUpload();

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

    await uploadPage.navigate();
    await uploadPage.acceptLegalTerms();
    await uploadPage.selectLanguage('Chinese');
    await uploadPage.selectTone('Formal');

    const testFile = Buffer.from('Test translation content');
    await uploadPage.uploadFile('test.txt', testFile);
    await uploadPage.submitUpload();

    await page.waitForTimeout(3000);

    // Step 1: POST to /jobs/upload (get presigned URL)
    const apiRequest = requests.find(
      (r) => r.url.includes('/jobs/upload') && r.method === 'POST'
    );
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
      const expiredToken = btoa(JSON.stringify({
        sub: 'test-user',
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      }));
      localStorage.setItem('accessToken', `header.${expiredToken}.signature`);
    });

    await uploadPage.navigate();
    await uploadPage.acceptLegalTerms();
    await uploadPage.selectLanguage('Spanish');
    await uploadPage.selectTone('Formal');

    const testFile = Buffer.from('Test');
    await uploadPage.uploadFile('test.txt', testFile);
    await uploadPage.submitUpload();

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

    await uploadPage.navigate();
    await uploadPage.acceptLegalTerms();
    await uploadPage.selectLanguage('Italian');
    await uploadPage.selectTone('Neutral');

    const testFile = Buffer.from('Test content');
    await uploadPage.uploadFile('test.txt', testFile);
    await uploadPage.submitUpload();

    await page.waitForTimeout(3000);

    // Filter for CORS-related errors
    const corsErrors = consoleErrors.filter((err) =>
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

    await uploadPage.navigate();
    await uploadPage.acceptLegalTerms();
    await uploadPage.selectLanguage('French');
    await uploadPage.selectTone('Formal');

    const testFile = Buffer.from('Test content');
    await uploadPage.uploadFile('test.txt', testFile);
    await uploadPage.submitUpload();

    // Should eventually succeed after retry
    await page.waitForTimeout(5000);

    // Check for success message or navigation to status page
    const successMessage = await page.locator('text=/upload.*success|translation.*started/i').count();
    expect(successMessage).toBeGreaterThan(0);
  });
});

test.describe('Authentication Token Scenarios', () => {
  test('should maintain token across page navigation', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.navigate();
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
    await loginPage.navigate();
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
