/**
 * Translation History Page Object Model
 *
 * Represents the translation history page with job list.
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class TranslationHistoryPage extends BasePage {
  // Locators
  private readonly pageHeading = 'h4:has-text("Translation History")';
  private readonly newTranslationButton = 'button:has-text("New Translation")';
  private readonly searchInput = 'input[placeholder*="Search"]';
  private readonly statusFilter = 'div:has-text("Status") select';
  private readonly jobsTable = 'table';
  private readonly jobRow = 'tbody tr';
  private readonly viewButton = 'button[aria-label="View Details"]';
  private readonly downloadButton = 'button[aria-label="Download"]';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to history page
   */
  async goto() {
    await super.goto('/translation/history');
    await this.waitForPageLoad();
  }

  /**
   * Wait for history page to load
   */
  async waitForPageLoad() {
    await this.waitForElement(this.pageHeading);
  }

  /**
   * Check if on history page
   */
  async isOnHistoryPage(): Promise<boolean> {
    return await this.isVisible(this.pageHeading);
  }

  /**
   * Click new translation button
   */
  async clickNewTranslation() {
    await this.clickElement(this.newTranslationButton);
  }

  /**
   * Search for job
   */
  async searchJobs(query: string) {
    await this.fillInput(this.searchInput, query);
  }

  /**
   * Filter by status
   */
  async filterByStatus(status: string) {
    await this.page.locator(this.statusFilter).selectOption(status);
  }

  /**
   * Get number of jobs displayed
   */
  async getJobCount(): Promise<number> {
    return await this.page.locator(this.jobRow).count();
  }

  /**
   * Click view details for first job
   */
  async viewFirstJob() {
    await this.page.locator(this.viewButton).first().click();
  }

  /**
   * Get job filename by index
   */
  async getJobFilename(index: number = 0): Promise<string | null> {
    return await this.page.locator(this.jobRow).nth(index).locator('td').first().textContent();
  }

  /**
   * Check if table has no jobs message
   */
  async hasNoJobsMessage(): Promise<boolean> {
    return await this.isVisible('text="No translations yet"');
  }

  /**
   * Wait for jobs table to appear
   */
  async waitForJobsTable() {
    await this.waitForElement(this.jobsTable);
  }
}
