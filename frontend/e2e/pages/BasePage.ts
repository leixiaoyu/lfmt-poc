/**
 * Base Page Object Model
 *
 * Provides common functionality for all page objects.
 */

import { Page, Locator } from '@playwright/test';

export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Navigate to a specific path
   */
  async goto(path: string) {
    await this.page.goto(path);
  }

  /**
   * Get page title
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  /**
   * Wait for URL to match pattern
   */
  async waitForURL(urlPattern: string | RegExp, options?: { timeout?: number }) {
    await this.page.waitForURL(urlPattern, options);
  }

  /**
   * Get current URL
   */
  getCurrentURL(): string {
    return this.page.url();
  }

  /**
   * Check if element is visible
   */
  async isVisible(selector: string): Promise<boolean> {
    return await this.page.locator(selector).isVisible();
  }

  /**
   * Wait for element to be visible
   */
  async waitForElement(selector: string, options?: { timeout?: number }) {
    await this.page.locator(selector).waitFor({ state: 'visible', ...options });
  }

  /**
   * Click element with better error handling
   */
  async clickElement(selector: string) {
    await this.page.locator(selector).click();
  }

  /**
   * Fill input field with better error handling
   */
  async fillInput(selector: string, value: string) {
    await this.page.locator(selector).fill(value);
  }

  /**
   * Get text content of element
   */
  async getTextContent(selector: string): Promise<string | null> {
    return await this.page.locator(selector).textContent();
  }

  /**
   * Check if error message is displayed
   */
  async hasErrorMessage(message?: string): Promise<boolean> {
    if (message) {
      return await this.page.locator(`text=${message}`).isVisible();
    }
    // Check for any error message (MUI Alert with error severity)
    return await this.page.locator('[role="alert"]').isVisible();
  }

  /**
   * Get error message text
   */
  async getErrorMessage(): Promise<string | null> {
    const errorAlert = this.page.locator('[role="alert"]').first();
    if (await errorAlert.isVisible()) {
      return await errorAlert.textContent();
    }
    return null;
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Take screenshot
   */
  async screenshot(options?: { path?: string; fullPage?: boolean }) {
    return await this.page.screenshot(options);
  }
}
