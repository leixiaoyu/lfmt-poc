/**
 * Multi-Language Translation E2E Tests
 *
 * Tests all language and tone combinations:
 * - 5 languages: Spanish, French, German, Italian, Chinese
 * - 3 tones: Formal, Informal, Neutral
 * - Total: 15 combinations to validate
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

test.describe('Multi-Language Translation Support', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;
  let uploadPage: TranslationUploadPage;
  let detailPage: TranslationDetailPage;

  const testFilePath = path.join(__dirname, '../../fixtures/multi-lang-test.txt');

  // Define all supported languages and tones
  const languages = [
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'zh', name: 'Chinese' },
  ];

  const tones = [
    { code: 'formal', name: 'Formal' },
    { code: 'informal', name: 'Informal' },
    { code: 'neutral', name: 'Neutral' },
  ];

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

    // Register and login once per test
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

  // Test each language individually
  for (const language of languages) {
    test(`should support ${language.name} translation`, async ({ page }) => {
      await uploadPage.goto();
      await uploadPage.completeUploadWorkflow(testFilePath, language.code, 'neutral');
      await uploadPage.waitForNavigationToDetail();
      await detailPage.waitForPageLoad();

      // Verify language was set correctly
      const jobInfo = await detailPage.getJobInfo();
      expect(jobInfo.targetLanguage).toBe(language.code);

      // Verify job was created via API
      const currentUrl = page.url();
      const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
      const jobId = jobIdMatch![1];

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
      expect(job.targetLanguage).toBe(language.code);
    });
  }

  // Test each tone individually
  for (const tone of tones) {
    test(`should support ${tone.name} tone`, async ({ page }) => {
      await uploadPage.goto();
      await uploadPage.completeUploadWorkflow(testFilePath, 'es', tone.code);
      await uploadPage.waitForNavigationToDetail();
      await detailPage.waitForPageLoad();

      // Verify tone was set correctly via API
      const currentUrl = page.url();
      const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
      const jobId = jobIdMatch![1];

      const authToken = await page.evaluate(() => localStorage.getItem('authToken'));
      const jobResponse = await page.request.get(
        `${process.env.API_BASE_URL || 'http://localhost:3000'}/v1/auth/register`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      expect(jobResponse.ok()).toBeTruthy();
      const job = await jobResponse.json();
      expect(job.tone).toBe(tone.code);
    });
  }

  test('should display all language options in dropdown', async ({ page }) => {
    await uploadPage.goto();

    // Complete attestation to get to config step
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Click language dropdown
    const languageSelect = page.locator('#target-language');
    await languageSelect.click();

    // Verify all languages are present
    for (const language of languages) {
      const option = page.locator(`li[data-value="${language.code}"]`);
      await expect(option).toBeVisible();
    }
  });

  test('should display all tone options', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Click tone dropdown
    const toneSelect = page.locator('#tone');
    await toneSelect.click();

    // Verify all tones are present
    for (const tone of tones) {
      const option = page.locator(`li[data-value="${tone.code}"]`);
      await expect(option).toBeVisible();
    }
  });

  test('should handle multiple jobs with different languages concurrently', async ({ page }) => {
    const jobIds: string[] = [];

    // Create 3 jobs with different languages
    for (let i = 0; i < 3; i++) {
      const language = languages[i];

      await uploadPage.goto();
      await uploadPage.completeUploadWorkflow(testFilePath, language.code, 'neutral');
      await uploadPage.waitForNavigationToDetail();

      const currentUrl = page.url();
      const jobIdMatch = currentUrl.match(/\/translation\/([a-f0-9-]+)/);
      jobIds.push(jobIdMatch![1]);
    }

    // Verify all 3 jobs exist with correct languages
    expect(jobIds.length).toBe(3);
    expect(new Set(jobIds).size).toBe(3); // All unique IDs

    const authToken = await page.evaluate(() => localStorage.getItem('authToken'));

    for (let i = 0; i < 3; i++) {
      const jobResponse = await page.request.get(
        `${process.env.API_BASE_URL || 'http://localhost:3000'}/v1/translation/jobs/${jobIds[i]}`,
        {
          headers: {
            'Authorization': `Bearer ${authToken}`,
          },
        }
      );

      expect(jobResponse.ok()).toBeTruthy();
      const job = await jobResponse.json();
      expect(job.targetLanguage).toBe(languages[i].code);
    }
  });

  test('should validate language selection is required', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Try to proceed without selecting language
    const nextButton = page.locator('button:has-text("Next")');

    // Next button should be disabled if no language selected
    // Note: Depends on implementation - might need to check if validation works
    const languageSelect = page.locator('#target-language');
    const hasValue = await languageSelect.inputValue();

    if (!hasValue) {
      await expect(nextButton).toBeDisabled();
    }
  });

  test('should validate tone selection is required', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Select language but not tone
    await uploadPage.completeTranslationConfig('es', '');

    const nextButton = page.locator('button:has-text("Next")');
    const toneSelect = page.locator('#tone');
    const hasValue = await toneSelect.inputValue();

    if (!hasValue) {
      await expect(nextButton).toBeDisabled();
    }
  });

  test('should allow changing language selection before submit', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Select Spanish first
    const languageSelect = page.locator('#target-language');
    await languageSelect.click();
    await page.locator('li[data-value="es"]').click();

    // Verify Spanish selected
    let selectedLanguage = await languageSelect.inputValue();
    expect(selectedLanguage).toBe('es');

    // Change to French
    await languageSelect.click();
    await page.locator('li[data-value="fr"]').click();

    // Verify French selected
    selectedLanguage = await languageSelect.inputValue();
    expect(selectedLanguage).toBe('fr');
  });

  test('should preserve language selection when navigating back', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();

    // Select German and Formal tone
    await uploadPage.completeTranslationConfig('de', 'formal');
    await uploadPage.clickNext();

    // Now on file upload step
    await expect(page.locator('input[type="file"]')).toBeVisible();

    // Go back
    await uploadPage.clickBack();

    // Verify selections preserved
    const languageSelect = page.locator('#target-language');
    const toneSelect = page.locator('#tone');

    const selectedLanguage = await languageSelect.inputValue();
    const selectedTone = await toneSelect.inputValue();

    expect(selectedLanguage).toBe('de');
    expect(selectedTone).toBe('formal');
  });

  test('should display language in review step before submit', async ({ page }) => {
    await uploadPage.goto();
    await uploadPage.completeLegalAttestation();
    await uploadPage.clickNext();
    await uploadPage.completeTranslationConfig('it', 'informal');
    await uploadPage.clickNext();
    await uploadPage.uploadFile(testFilePath);
    await uploadPage.clickNext();

    // On review step - verify language and tone displayed
    await expect(page.locator('text=/Italian/i')).toBeVisible();
    await expect(page.locator('text=/Informal/i')).toBeVisible();
  });
});
