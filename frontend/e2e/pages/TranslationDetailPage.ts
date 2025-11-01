/**
 * Translation Detail Page Object Model
 *
 * Represents the translation detail page for a single job.
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class TranslationDetailPage extends BasePage {
  // Locators
  private readonly pageHeading = 'h4:has-text("Translation Details")';
  private readonly backButton = 'button:has-text("Back to History")';
  private readonly downloadButton = 'button:has-text("Download Translation")';
  private readonly refreshButton = 'button:has-text("Refresh Status")';
  private readonly retryButton = 'button:has-text("Retry Translation")';
  private readonly startButton = 'button:has-text("Start Translation")';
  private readonly progressSection = 'div:has-text("Translation Progress")';
  private readonly jobIdText = 'text=/Job ID/i';
  private readonly statusChip = '[role="status"]';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to detail page
   */
  async gotoJobDetail(jobId: string) {
    await super.goto(`/translation/${jobId}`);
    await this.waitForPageLoad();
  }

  /**
   * Wait for detail page to load
   */
  async waitForPageLoad() {
    await this.waitForElement(this.pageHeading);
  }

  /**
   * Check if on detail page
   */
  async isOnDetailPage(): Promise<boolean> {
    return await this.isVisible(this.pageHeading);
  }

  /**
   * Click back to history button
   */
  async clickBackToHistory() {
    await this.clickElement(this.backButton);
  }

  /**
   * Click download button
   */
  async clickDownload() {
    await this.clickElement(this.downloadButton);
  }

  /**
   * Click refresh status button
   */
  async clickRefresh() {
    await this.clickElement(this.refreshButton);
  }

  /**
   * Click retry translation button
   */
  async clickRetry() {
    await this.clickElement(this.retryButton);
  }

  /**
   * Click start translation button
   */
  async clickStart() {
    await this.clickElement(this.startButton);
  }

  /**
   * Check if download button is visible
   */
  async hasDownloadButton(): Promise<boolean> {
    return await this.isVisible(this.downloadButton);
  }

  /**
   * Check if progress section is visible
   */
  async hasProgressSection(): Promise<boolean> {
    return await this.isVisible(this.progressSection);
  }

  /**
   * Get job ID from page
   */
  async getJobId(): Promise<string | null> {
    const jobIdElement = this.page.locator(this.jobIdText).locator('..').locator('p').first();
    return await jobIdElement.textContent();
  }

  /**
   * Wait for status to be completed
   */
  async waitForCompleted(timeout: number = 300000) {
    await this.page.waitForSelector('text="COMPLETED"', { timeout });
  }

  /**
   * Get current status
   */
  async getStatus(): Promise<string | null> {
    const statusChip = this.page.locator(this.statusChip).first();
    if (await statusChip.isVisible()) {
      return await statusChip.textContent();
    }
    return null;
  }
}
