/**
 * Register Page Object Model
 *
 * Represents the registration page and provides methods for interacting with it.
 */

import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class RegisterPage extends BasePage {
  // Locators
  private readonly firstNameInput = '[name="firstName"]';
  private readonly lastNameInput = '[name="lastName"]';
  private readonly emailInput = '[name="email"]';
  private readonly passwordInput = '[name="password"]';
  private readonly confirmPasswordInput = '[name="confirmPassword"]';
  private readonly registerButton = 'button[type="submit"]';
  private readonly loginLink = 'a[href="/login"]';
  private readonly pageHeading = 'h4:has-text("Register")';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to register page
   */
  async goto() {
    await super.goto('/register');
    await this.waitForPageLoad();
  }

  /**
   * Wait for register page to fully load
   */
  async waitForPageLoad() {
    await this.waitForElement(this.pageHeading);
    await this.waitForElement(this.firstNameInput);
    await this.waitForElement(this.lastNameInput);
    await this.waitForElement(this.emailInput);
    await this.waitForElement(this.passwordInput);
    await this.waitForElement(this.confirmPasswordInput);
    await this.waitForElement(this.registerButton);
  }

  /**
   * Check if on register page
   */
  async isOnRegisterPage(): Promise<boolean> {
    return await this.isVisible(this.pageHeading);
  }

  /**
   * Fill first name field
   */
  async fillFirstName(firstName: string) {
    await this.fillInput(this.firstNameInput, firstName);
  }

  /**
   * Fill last name field
   */
  async fillLastName(lastName: string) {
    await this.fillInput(this.lastNameInput, lastName);
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
   * Fill confirm password field
   */
  async fillConfirmPassword(password: string) {
    await this.fillInput(this.confirmPasswordInput, password);
  }

  /**
   * Click register button
   */
  async clickRegister() {
    await this.clickElement(this.registerButton);
  }

  /**
   * Perform complete registration flow
   */
  async register(firstName: string, lastName: string, email: string, password: string) {
    await this.fillFirstName(firstName);
    await this.fillLastName(lastName);
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.fillConfirmPassword(password);
    await this.clickRegister();
  }

  /**
   * Click login link to navigate to login page
   */
  async clickLoginLink() {
    await this.clickElement(this.loginLink);
  }

  /**
   * Check if register button is disabled
   */
  async isRegisterButtonDisabled(): Promise<boolean> {
    return await this.page.locator(this.registerButton).isDisabled();
  }

  /**
   * Get validation error for first name field
   */
  async getFirstNameError(): Promise<string | null> {
    const errorElement = this.page.locator('text=/first name/i').first();
    if (await errorElement.isVisible()) {
      return await errorElement.textContent();
    }
    return null;
  }

  /**
   * Get validation error for last name field
   */
  async getLastNameError(): Promise<string | null> {
    const errorElement = this.page.locator('text=/last name/i').first();
    if (await errorElement.isVisible()) {
      return await errorElement.textContent();
    }
    return null;
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
    const errorElement = this.page.locator('text=/password.*required/i').first();
    if (await errorElement.isVisible()) {
      return await errorElement.textContent();
    }
    return null;
  }

  /**
   * Get validation error for confirm password field
   */
  async getConfirmPasswordError(): Promise<string | null> {
    const errorElement = this.page.locator('text=/passwords.*match/i').first();
    if (await errorElement.isVisible()) {
      return await errorElement.textContent();
    }
    return null;
  }

  /**
   * Wait for redirect to dashboard after successful registration
   */
  async waitForSuccessfulRegistration() {
    await this.waitForURL('/dashboard', { timeout: 10000 });
  }
}
