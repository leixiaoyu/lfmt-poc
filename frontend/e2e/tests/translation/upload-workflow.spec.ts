/**
 * Translation Upload Workflow E2E Tests
 *
 * Tests the complete happy path for uploading and translating a document.
 * This is a P0 critical test covering the core user journey.
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

test.describe('Translation Upload Workflow - Happy Path', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;
  let uploadPage: TranslationUploadPage;
  let detailPage: TranslationDetailPage;

  // Test file path
  const testFilePath = path.join(__dirname, '../../fixtures/minimal-test.txt');

  test.beforeAll(() => {
    // Create test document file on disk for Playwright upload
    const testDoc = TEST_DOCUMENTS.MINIMAL;
    const fixturesDir = path.join(__dirname, '../../fixtures');

    // Ensure fixtures directory exists
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }

    // Write test document to file
    fs.writeFileSync(testFilePath, testDoc.content, 'utf8');
  });

  test.afterAll(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    uploadPage = new TranslationUploadPage(page);
    detailPage = new TranslationDetailPage(page);
  });

  test('should complete full translation upload workflow from login to job creation', async ({ page }) => {
    // ===== STEP 1: Register and Login =====
    const user = generateTestUser();

    // Register user via API
    const registerResponse = await page.request.post(
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
    expect(registerResponse.ok()).toBeTruthy();

    // Login via UI
    await loginPage.goto();
    await loginPage.login(user.email, user.password);

    // Verify dashboard loaded
    await dashboardPage.waitForPageLoad();
    await expect(dashboardPage.isOnDashboardPage()).resolves.toBe(true);

    // ===== STEP 2: Navigate to Upload Page =====
    await uploadPage.goto();
    await expect(uploadPage.isOnUploadPage()).resolves.toBe(true);

    // ===== STEP 3: Complete Upload Workflow =====
    // Use the built-in workflow method from page object
    await uploadPage.completeUploadWorkflow(
      testFilePath,
      'es', // Spanish
      'neutral' // Neutral tone
    );

    // ===== STEP 4: Verify Navigation to Detail Page =====
    // Should navigate to /translation/{jobId}
    await uploadPage.waitForNavigationToDetail();

    // Extract jobId from URL
    const currentUrl = page.url();
    const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
    expect(jobIdMatch).not.toBeNull();
    const jobId = jobIdMatch![1];

    // ===== STEP 5: Verify Detail Page Shows Job Info =====
    await detailPage.waitForPageLoad();
    await expect(detailPage.isOnDetailPage()).resolves.toBe(true);

    // Verify job details are displayed
    const jobInfo = await detailPage.getJobInfo();
    expect(jobInfo.fileName).toContain('minimal-test.txt');
    expect(jobInfo.targetLanguage).toBe('es');

    // Verify job status is visible (could be PENDING, CHUNKING, etc.)
    const status = await detailPage.getJobStatus();
    expect(status).toBeTruthy();
    expect(['PENDING', 'CHUNKING', 'CHUNKED', 'IN_PROGRESS']).toContain(status);

    // ===== STEP 6: Verify API Created Job Correctly =====
    // Fetch job via API to verify backend state
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
    expect(authToken).toBeTruthy();

    const jobResponse = await page.request.get(
      `${process.env.API_BASE_URL || 'http://localhost:3000'}/v1/translation/jobs/${jobId}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      }
    );
    expect(jobResponse.ok()).toBeTruthy();

    const job = await jobResponse.json();
    expect(job.jobId).toBe(jobId);
    expect(job.userId).toBeTruthy();
    expect(job.fileName).toContain('minimal-test.txt');
    expect(job.targetLanguage).toBe('es');
    expect(job.tone).toBe('neutral');
    expect(job.sourceLanguage).toBe('en'); // Auto-detected
    expect(job.legalAttestation).toBeTruthy();
    expect(job.legalAttestation.acceptCopyrightOwnership).toBe(true);
    expect(job.legalAttestation.acceptTranslationRights).toBe(true);
    expect(job.legalAttestation.acceptLiabilityTerms).toBe(true);
  });

  test('should display legal attestation checkboxes correctly', async ({ page }) => {
    // Setup: Login
    const user = generateTestUser();
    const registerResponse = await page.request.post(
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
    expect(registerResponse.ok()).toBeTruthy();

    await loginPage.goto();
    await loginPage.login(user.email, user.password);
    await dashboardPage.waitForPageLoad();

    // Navigate to upload page
    await uploadPage.goto();

    // Verify all legal attestation checkboxes are visible
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    const rightsCheckbox = page.locator('[name="acceptTranslationRights"]');
    const liabilityCheckbox = page.locator('[name="acceptLiabilityTerms"]');

    await expect(copyrightCheckbox).toBeVisible();
    await expect(rightsCheckbox).toBeVisible();
    await expect(liabilityCheckbox).toBeVisible();

    // Verify checkboxes start unchecked
    await expect(copyrightCheckbox).not.toBeChecked();
    await expect(rightsCheckbox).not.toBeChecked();
    await expect(liabilityCheckbox).not.toBeChecked();

    // Verify Next button is disabled until all are checked
    const nextButton = page.locator('button:has-text("Next")');
    await expect(nextButton).toBeDisabled();

    // Check all boxes
    await copyrightCheckbox.click();
    await rightsCheckbox.click();
    await liabilityCheckbox.click();

    // Now Next should be enabled
    await expect(nextButton).toBeEnabled();
  });

  test('should validate file upload requirements', async ({ page }) => {
    // Setup: Login and navigate to upload
    const user = generateTestUser();
    const registerResponse = await page.request.post(
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
    expect(registerResponse.ok()).toBeTruthy();

    await loginPage.goto();
    await loginPage.login(user.email, user.password);
    await dashboardPage.waitForPageLoad();
    await uploadPage.goto();

    // Complete first two steps
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('es', 'neutral');
    await uploadPage.clickNext();

    // Now on file upload step
    // Verify file input accepts correct formats
    const fileInput = page.locator('input[type="file"]');
    const acceptAttr = await fileInput.getAttribute('accept');
    expect(acceptAttr).toContain('.txt');
    expect(acceptAttr).toContain('.doc');
    expect(acceptAttr).toContain('.docx');
    expect(acceptAttr).toContain('.pdf');
  });
});
