/**
 * Translation Upload Page Object Model
 *
 * Represents the multi-step translation upload page.
 *
 * The page is a 4-step wizard:
 *   Step 0: Legal Attestation  → Step 1: Translation Settings
 *   Step 2: Upload Document    → Step 3: Review & Submit
 *
 * Both `completeUploadWorkflow()` (single-call convenience) and the
 * `*ByRole()` granular helpers below drive the same DOM. The granular
 * helpers exist because the production smoke test wraps each wizard
 * step in a `test.step()` block for diagnostic tracing — see
 * `frontend/e2e/tests/smoke/production-smoke.spec.ts`.
 */

import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class TranslationUploadPage extends BasePage {
  // Locators
  private readonly pageHeading = 'h4:has-text("New Translation")';
  private readonly nextButton = 'button:has-text("Next")';
  private readonly backButton = 'button:has-text("Back")';
  private readonly submitButton = 'button:has-text("Submit")';

  // Legal Attestation Step
  private readonly copyrightCheckbox = '[name="acceptCopyrightOwnership"]';
  private readonly translationRightsCheckbox = '[name="acceptTranslationRights"]';
  private readonly liabilityCheckbox = '[name="acceptLiabilityTerms"]';

  // Translation Config Step
  private readonly languageSelect = '#target-language';
  private readonly toneSelect = '#tone';

  // File Upload Step
  private readonly fileInput = 'input[type="file"]';
  private readonly browseButton = 'button:has-text("Browse Files")';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to upload page
   */
  async goto() {
    await super.goto('/translation/upload');
    await this.waitForPageLoad();
  }

  /**
   * Wait for upload page to load
   */
  async waitForPageLoad() {
    await this.waitForElement(this.pageHeading);
  }

  /**
   * Check if on upload page
   */
  async isOnUploadPage(): Promise<boolean> {
    return await this.isVisible(this.pageHeading);
  }

  /**
   * Complete legal attestation step
   */
  async completeLegalAttestation() {
    await this.clickElement(this.copyrightCheckbox);
    await this.clickElement(this.translationRightsCheckbox);
    await this.clickElement(this.liabilityCheckbox);
  }

  /**
   * Complete translation config step
   */
  async completeTranslationConfig(language: string, tone: string) {
    await this.page.locator(this.languageSelect).click();
    await this.page.locator(`li[data-value="${language}"]`).click();

    await this.page.locator(this.toneSelect).click();
    await this.page.locator(`li[data-value="${tone}"]`).click();
  }

  /**
   * Upload file
   */
  async uploadFile(filePath: string) {
    await this.page.locator(this.fileInput).setInputFiles(filePath);
  }

  /**
   * Click next button
   */
  async clickNext() {
    await this.clickElement(this.nextButton);
  }

  /**
   * Click back button
   */
  async clickBack() {
    await this.clickElement(this.backButton);
  }

  /**
   * Click submit button
   */
  async clickSubmit() {
    await this.clickElement(this.submitButton);
  }

  /**
   * Complete full upload workflow
   */
  async completeUploadWorkflow(
    filePath: string,
    language: string = 'es',
    tone: string = 'neutral'
  ) {
    // Step 1: Legal Attestation
    await this.completeLegalAttestation();
    await this.clickNext();

    // Step 2: Translation Config
    await this.completeTranslationConfig(language, tone);
    await this.clickNext();

    // Step 3: File Upload
    await this.uploadFile(filePath);
    await this.clickNext();

    // Step 4: Review & Submit
    await this.clickSubmit();
  }

  /**
   * Wait for navigation to detail page after submit
   */
  async waitForNavigationToDetail() {
    await this.page.waitForURL(/\/translation\/[a-f0-9-]+/, { timeout: 10000 });
  }

  // ---------------------------------------------------------------------
  // Role-based wizard helpers (used by production-smoke.spec.ts)
  //
  // These mirror the steps performed by `completeUploadWorkflow()` but use
  // role-based locators (more resilient against CSS-class churn in deployed
  // environments) and accept timeouts so callers can tune for prod latency.
  // The smoke test calls each helper inside its own `test.step()` block to
  // get per-step traces in CI.
  // ---------------------------------------------------------------------

  /**
   * Tick the three required attestation checkboxes and advance to the
   * Translation Settings step. Returns when the target-language control
   * is visible (handshake that step 1 has rendered).
   *
   * Accessible names are computed from the <FormControlLabel> label text
   * rendered by LegalAttestation.tsx — verified against the unit tests in
   * frontend/src/components/Translation/__tests__/LegalAttestation.test.tsx.
   * The previous patterns (/copyright ownership/, /translation rights/,
   * /liability/) did not appear anywhere in the rendered label strings,
   * causing locator.check to wait the full 180 s timeout on every run.
   */
  async completeLegalAttestationByRole(timeout = 10000) {
    await this.page.getByRole('checkbox', { name: /I confirm that I own the copyright/i }).check();
    await this.page
      .getByRole('checkbox', { name: /I confirm that I have the right to create derivative works/i })
      .check();
    await this.page
      .getByRole('checkbox', { name: /I understand that I am solely responsible/i })
      .check();

    await this.page.getByRole('button', { name: /next/i }).click();
    await expect(this.page.getByLabel(/target.*language/i)).toBeVisible({ timeout });
  }

  /**
   * Configure source (defaults to English when present) + target language,
   * then advance to the Upload Document step. Returns when the file input
   * is attached to the DOM (the input has display:none — `toBeAttached` is
   * the correct gate, not `toBeVisible`).
   */
  async configureLanguagesByRole(
    targetLanguagePattern: RegExp = /spanish|español/i,
    timeout = 10000
  ) {
    const sourceLanguage = this.page.getByLabel(/source.*language/i);
    if (await sourceLanguage.isVisible()) {
      await sourceLanguage.click();
      await this.page.getByRole('option', { name: /english/i }).click();
    }

    const targetLanguage = this.page.getByLabel(/target.*language/i);
    await targetLanguage.click();
    await this.page.getByRole('option', { name: targetLanguagePattern }).click();

    await this.page.getByRole('button', { name: /next/i }).click();
    await expect(this.page.locator('input[type="file"]')).toBeAttached({ timeout });
  }

  /**
   * Upload a file via the hidden `<input type="file">`. Asserts the file
   * name surfaces in the UI (handshake that the wizard accepted the file).
   */
  async uploadFileAndAwaitDisplay(filePath: string, displayName: string, timeout = 10000) {
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    // Filename appears in the upload-step UI once the file is processed.
    await expect(
      this.page.getByText(new RegExp(displayName.replace(/\./g, '\\.'), 'i'))
    ).toBeVisible({ timeout });
  }

  /**
   * Advance from Upload Document to Review & Submit. The review screen
   * re-renders the chosen filename in its summary — assert it shows up
   * before continuing.
   */
  async advanceToReviewByRole(displayName: string, timeout = 10000) {
    await this.page.getByRole('button', { name: /next/i }).click();
    await expect(
      this.page.getByText(new RegExp(displayName.replace(/\./g, '\\.'), 'i'))
    ).toBeVisible({ timeout });
  }

  /**
   * Click the final "Submit & Start Translation" button on the Review step.
   * The regex tolerates copy variants observed in different environments.
   */
  async submitTranslationByRole() {
    const translateButton = this.page.getByRole('button', {
      name: /submit.*translation|translate|start.*translation/i,
    });
    await translateButton.click();
  }
}
