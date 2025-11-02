/**
 * Login Page Object Model
 *
 * Represents the login page and provides methods for interacting with it.
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  // Locators
  private readonly emailInput = '[name="email"]';
  private readonly passwordInput = '[name="password"]';
  private readonly loginButton = 'button[type="submit"]';
  private readonly registerLink = 'a[href="/register"]';
  private readonly pageHeading = 'h4:has-text("Login")';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to login page
   */
  async goto() {
    await super.goto('/login');
    await this.waitForPageLoad();
  }

  /**
   * Wait for login page to fully load
   */
  async waitForPageLoad() {
    await this.waitForElement(this.pageHeading);
    await this.waitForElement(this.emailInput);
    await this.waitForElement(this.passwordInput);
    await this.waitForElement(this.loginButton);
  }

  /**
   * Check if on login page
   */
  async isOnLoginPage(): Promise<boolean> {
    return await this.isVisible(this.pageHeading);
  }

  /**
   * Fill email field
   */
  async fillEmail(email: string) {
    await this.fillInput(this.emailInput, email);
  }

  /**
   * Fill password field
   */
  async fillPassword(password: string) {
    await this.fillInput(this.passwordInput, password);
  }

  /**
   * Click login button
   */
  async clickLogin() {
    await this.clickElement(this.loginButton);
  }

  /**
   * Perform complete login flow
   */
  async login(email: string, password: string) {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.clickLogin();
  }

  /**
   * Click register link to navigate to registration page
   */
  async clickRegisterLink() {
    await this.clickElement(this.registerLink);
  }

  /**
   * Check if login button is disabled
   */
  async isLoginButtonDisabled(): Promise<boolean> {
    return await this.page.locator(this.loginButton).isDisabled();
  }

  /**
   * Get validation error for email field
   */
  async getEmailError(): Promise<string | null> {
    const errorElement = this.page.locator('text=/email/i').first();
    if (await errorElement.isVisible()) {
      return await errorElement.textContent();
    }
    return null;
  }

  /**
   * Get validation error for password field
   */
  async getPasswordError(): Promise<string | null> {
    const errorElement = this.page.locator('text=/password/i').first();
    if (await errorElement.isVisible()) {
      return await errorElement.textContent();
    }
    return null;
  }

  /**
   * Wait for redirect to dashboard after successful login
   */
  async waitForSuccessfulLogin() {
    await this.waitForURL('/dashboard', { timeout: 10000 });
  }
}
