/**
 * Dashboard Page Object Model
 *
 * Represents the dashboard page and provides methods for interacting with it.
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class DashboardPage extends BasePage {
  // Locators
  private readonly pageHeading = 'h4:has-text("Dashboard")';
  private readonly welcomeMessage = 'text=/Welcome/i';
  private readonly logoutButton = 'button:has-text("Logout")';
  private readonly userMenu = '[data-testid="user-menu"]';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to dashboard page
   */
  async goto() {
    await super.goto('/dashboard');
    await this.waitForPageLoad();
  }

  /**
   * Wait for dashboard page to fully load
   */
  async waitForPageLoad() {
    await this.waitForElement(this.pageHeading, { timeout: 10000 });
  }

  /**
   * Check if on dashboard page
   */
  async isOnDashboardPage(): Promise<boolean> {
    return await this.isVisible(this.pageHeading);
  }

  /**
   * Check if welcome message is displayed
   */
  async hasWelcomeMessage(): Promise<boolean> {
    return await this.isVisible(this.welcomeMessage);
  }

  /**
   * Get welcome message text
   */
  async getWelcomeMessage(): Promise<string | null> {
    return await this.getTextContent(this.welcomeMessage);
  }

  /**
   * Check if logout button is visible
   */
  async hasLogoutButton(): Promise<boolean> {
    return await this.isVisible(this.logoutButton);
  }

  /**
   * Click logout button
   */
  async clickLogout() {
    await this.clickElement(this.logoutButton);
  }

  /**
   * Perform logout and wait for redirect to login page
   */
  async logout() {
    await this.clickLogout();
    await this.waitForURL('/login', { timeout: 10000 });
  }

  /**
   * Check if user is logged in by verifying dashboard elements
   */
  async isUserLoggedIn(): Promise<boolean> {
    return (await this.isOnDashboardPage()) && (await this.hasLogoutButton());
  }
}
