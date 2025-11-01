/**
 * Translation Upload Page Object Model
 *
 * Represents the multi-step translation upload page.
 */

import { Page } from '@playwright/test';
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
  async completeUploadWorkflow(filePath: string, language: string = 'es', tone: string = 'neutral') {
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
}
