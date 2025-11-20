/**
 * Legal Attestation E2E Tests
 *
 * Tests the legal attestation enforcement including:
 * - All checkboxes must be checked before proceeding
 * - Cannot bypass attestation
 * - IP address is captured
 * - Timestamp is recorded
 * - Attestation data is sent to backend
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { TranslationUploadPage } from '../../pages/TranslationUploadPage';
import { generateTestUser } from '../../fixtures/auth';
import { TEST_DOCUMENTS } from '../../fixtures/test-documents';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test.describe('Legal Attestation Enforcement', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;
  let uploadPage: TranslationUploadPage;

  const testFilePath = path.join(__dirname, '../../fixtures/legal-test.txt');

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

    // Setup: Register and login
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
    await uploadPage.goto();
  });

  test('should display all three required checkboxes', async ({ page }) => {
    // Verify all checkboxes exist
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    const rightsCheckbox = page.locator('[name="acceptTranslationRights"]');
    const liabilityCheckbox = page.locator('[name="acceptLiabilityTerms"]');

    await expect(copyrightCheckbox).toBeVisible();
    await expect(rightsCheckbox).toBeVisible();
    await expect(liabilityCheckbox).toBeVisible();

    // Verify labels are descriptive
    await expect(page.locator('text=/copyright ownership/i')).toBeVisible();
    await expect(page.locator('text=/translation rights/i')).toBeVisible();
    await expect(page.locator('text=/liability/i')).toBeVisible();
  });

  test('should have all checkboxes unchecked by default', async ({ page }) => {
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    const rightsCheckbox = page.locator('[name="acceptTranslationRights"]');
    const liabilityCheckbox = page.locator('[name="acceptLiabilityTerms"]');

    await expect(copyrightCheckbox).not.toBeChecked();
    await expect(rightsCheckbox).not.toBeChecked();
    await expect(liabilityCheckbox).not.toBeChecked();
  });

  test('should disable Next button until all checkboxes are checked', async ({ page }) => {
    const nextButton = page.locator('button:has-text("Next")');
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    const rightsCheckbox = page.locator('[name="acceptTranslationRights"]');
    const liabilityCheckbox = page.locator('[name="acceptLiabilityTerms"]');

    // Initially disabled
    await expect(nextButton).toBeDisabled();

    // Check first checkbox - still disabled
    await copyrightCheckbox.click();
    await expect(nextButton).toBeDisabled();

    // Check second checkbox - still disabled
    await rightsCheckbox.click();
    await expect(nextButton).toBeDisabled();

    // Check third checkbox - now enabled
    await liabilityCheckbox.click();
    await expect(nextButton).toBeEnabled();
  });

  test('should re-disable Next button if any checkbox is unchecked', async ({ page }) => {
    const nextButton = page.locator('button:has-text("Next")');
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    const rightsCheckbox = page.locator('[name="acceptTranslationRights"]');
    const liabilityCheckbox = page.locator('[name="acceptLiabilityTerms"]');

    // Check all boxes
    await copyrightCheckbox.click();
    await rightsCheckbox.click();
    await liabilityCheckbox.click();
    await expect(nextButton).toBeEnabled();

    // Uncheck one box
    await copyrightCheckbox.click();
    await expect(nextButton).toBeDisabled();
  });

  test('should allow checking and unchecking multiple times', async ({ page }) => {
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');

    // Check
    await copyrightCheckbox.click();
    await expect(copyrightCheckbox).toBeChecked();

    // Uncheck
    await copyrightCheckbox.click();
    await expect(copyrightCheckbox).not.toBeChecked();

    // Check again
    await copyrightCheckbox.click();
    await expect(copyrightCheckbox).toBeChecked();
  });

  test('should proceed to next step after checking all boxes and clicking Next', async ({ page }) => {
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    const rightsCheckbox = page.locator('[name="acceptTranslationRights"]');
    const liabilityCheckbox = page.locator('[name="acceptLiabilityTerms"]');
    const nextButton = page.locator('button:has-text("Next")');

    // Complete attestation
    await copyrightCheckbox.click();
    await rightsCheckbox.click();
    await liabilityCheckbox.click();
    await nextButton.click();

    // Verify we're on the translation config step
    await expect(page.locator('#target-language')).toBeVisible();
    await expect(page.locator('#tone')).toBeVisible();
  });

  test('should store attestation data in backend', async ({ page }) => {
    // Complete full upload workflow
    await uploadPage.completeUploadWorkflow(testFilePath, 'es', 'neutral');
    await uploadPage.waitForNavigationToDetail();

    // Extract jobId from URL
    const currentUrl = page.url();
    const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
    expect(jobIdMatch).not.toBeNull();
    const jobId = jobIdMatch![1];

    // Fetch job via API
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
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

    // Verify attestation was stored
    expect(job.legalAttestation).toBeTruthy();
    expect(job.legalAttestation.acceptCopyrightOwnership).toBe(true);
    expect(job.legalAttestation.acceptTranslationRights).toBe(true);
    expect(job.legalAttestation.acceptLiabilityTerms).toBe(true);
  });

  test('should capture IP address in attestation', async ({ page }) => {
    // Complete upload
    await uploadPage.completeUploadWorkflow(testFilePath, 'es', 'neutral');
    await uploadPage.waitForNavigationToDetail();

    // Extract jobId
    const currentUrl = page.url();
    const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
    const jobId = jobIdMatch![1];

    // Fetch job
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
    const jobResponse = await page.request.get(
      `${process.env.API_BASE_URL || 'http://localhost:3000'}/v1/translation/jobs/${jobId}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      }
    );

    const job = await jobResponse.json();

    // Verify IP address was captured
    expect(job.legalAttestation.ipAddress).toBeTruthy();
    expect(typeof job.legalAttestation.ipAddress).toBe('string');

    // IP should be a valid format (IPv4 or IPv6)
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;
    const isValidIp = ipv4Regex.test(job.legalAttestation.ipAddress) ||
                      ipv6Regex.test(job.legalAttestation.ipAddress);
    expect(isValidIp).toBe(true);
  });

  test('should capture timestamp in attestation', async ({ page }) => {
    // Complete upload
    await uploadPage.completeUploadWorkflow(testFilePath, 'es', 'neutral');
    await uploadPage.waitForNavigationToDetail();

    // Extract jobId
    const currentUrl = page.url();
    const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
    const jobId = jobIdMatch![1];

    // Fetch job
    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
    const jobResponse = await page.request.get(
      `${process.env.API_BASE_URL || 'http://localhost:3000'}/v1/translation/jobs/${jobId}`,
      {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      }
    );

    const job = await jobResponse.json();

    // Verify timestamp was captured
    expect(job.legalAttestation.timestamp).toBeTruthy();

    // Timestamp should be a valid ISO 8601 date
    const attestationDate = new Date(job.legalAttestation.timestamp);
    expect(attestationDate.toString()).not.toBe('Invalid Date');

    // Timestamp should be recent (within last 5 minutes)
    const now = new Date();
    const timeDiff = now.getTime() - attestationDate.getTime();
    expect(timeDiff).toBeLessThan(5 * 60 * 1000); // 5 minutes in ms
  });

  test('should not allow bypassing attestation via direct URL navigation', async ({ page }) => {
    // Try to navigate directly to step 2 (translation config)
    await page.goto(`${page.url()}?step=2`);

    // Should still show legal attestation step
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    await expect(copyrightCheckbox).toBeVisible();
  });

  test('should preserve attestation choices when navigating back', async ({ page }) => {
    const copyrightCheckbox = page.locator('[name="acceptCopyrightOwnership"]');
    const rightsCheckbox = page.locator('[name="acceptTranslationRights"]');
    const liabilityCheckbox = page.locator('[name="acceptLiabilityTerms"]');
    const nextButton = page.locator('button:has-text("Next")');

    // Check all boxes and proceed
    await copyrightCheckbox.click();
    await rightsCheckbox.click();
    await liabilityCheckbox.click();
    await nextButton.click();

    // Wait for next step
    await expect(page.locator('#target-language')).toBeVisible();

    // Go back
    const backButton = page.locator('button:has-text("Back")');
    await backButton.click();

    // Verify checkboxes are still checked
    await expect(copyrightCheckbox).toBeChecked();
    await expect(rightsCheckbox).toBeChecked();
    await expect(liabilityCheckbox).toBeChecked();
  });

  test('should display legal text with important terms highlighted', async ({ page }) => {
    // Verify key legal terms are visible
    await expect(page.locator('text=/I certify that I am the copyright owner/i')).toBeVisible();
    await expect(page.locator('text=/I have the legal right to create translations/i')).toBeVisible();
    await expect(page.locator('text=/I accept full liability/i')).toBeVisible();
  });
});
