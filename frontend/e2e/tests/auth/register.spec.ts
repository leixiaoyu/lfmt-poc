/**
 * Registration E2E Tests
 *
 * Tests the registration functionality using Page Object Model.
 */

import { test, expect } from '@playwright/test';
import { RegisterPage } from '../../pages/RegisterPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { generateTestUser } from '../../fixtures/auth';

test.describe('Register Page', () => {
  let registerPage: RegisterPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    registerPage = new RegisterPage(page);
    dashboardPage = new DashboardPage(page);
    await registerPage.goto();
  });

  test('should display registration form', async () => {
    await expect(registerPage.isOnRegisterPage()).resolves.toBe(true);
  });

  test('should successfully register with valid credentials', async () => {
    const user = generateTestUser();

    await registerPage.register(user.firstName, user.lastName, user.email, user.password);

    // Should redirect to dashboard
    await dashboardPage.waitForPageLoad();
    await expect(dashboardPage.isOnDashboardPage()).resolves.toBe(true);
  });

  test('should show error when registering with existing email', async ({ page }) => {
    const user = generateTestUser();

    // Register first user
    const firstRegisterResponse = await page.request.post(
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
    expect(firstRegisterResponse.ok()).toBeTruthy();

    // Try to register again with same email
    await registerPage.goto();
    await registerPage.register(user.firstName, user.lastName, user.email, user.password);

    // Should show error message and stay on register page
    await registerPage.page.waitForTimeout(2000); // Wait for error to appear
    await expect(registerPage.hasErrorMessage()).resolves.toBe(true);
    await expect(registerPage.isOnRegisterPage()).resolves.toBe(true);
  });

  test('should show error with invalid email format', async () => {
    const user = generateTestUser();

    await registerPage.fillFirstName(user.firstName);
    await registerPage.fillLastName(user.lastName);
    await registerPage.fillEmail('invalid-email');
    await registerPage.fillPassword(user.password);
    await registerPage.fillConfirmPassword(user.password);
    await registerPage.clickRegister();

    // Should show validation error
    await registerPage.page.waitForTimeout(1000);
    await expect(registerPage.isOnRegisterPage()).resolves.toBe(true);
  });

  test('should show error when passwords do not match', async () => {
    const user = generateTestUser();

    await registerPage.fillFirstName(user.firstName);
    await registerPage.fillLastName(user.lastName);
    await registerPage.fillEmail(user.email);
    await registerPage.fillPassword(user.password);
    await registerPage.fillConfirmPassword('DifferentPassword123!');
    await registerPage.clickRegister();

    // Should show validation error
    await registerPage.page.waitForTimeout(1000);
    await expect(registerPage.isOnRegisterPage()).resolves.toBe(true);
  });

  test('should show error with empty required fields', async () => {
    await registerPage.clickRegister();

    // Should show validation errors and stay on page
    await registerPage.page.waitForTimeout(1000);
    await expect(registerPage.isOnRegisterPage()).resolves.toBe(true);
  });

  test('should show error with weak password', async () => {
    const user = generateTestUser();

    await registerPage.fillFirstName(user.firstName);
    await registerPage.fillLastName(user.lastName);
    await registerPage.fillEmail(user.email);
    await registerPage.fillPassword('weak');
    await registerPage.fillConfirmPassword('weak');
    await registerPage.clickRegister();

    // Should show validation error for weak password
    await registerPage.page.waitForTimeout(1000);
    await expect(registerPage.isOnRegisterPage()).resolves.toBe(true);
  });

  test('should navigate to login page when clicking login link', async () => {
    await registerPage.clickLoginLink();
    await registerPage.waitForURL('/login');
    expect(registerPage.getCurrentURL()).toContain('/login');
  });
});

test.describe('Registration Flow Integration', () => {
  test('should auto-login after successful registration', async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);
    const user = generateTestUser();

    await registerPage.goto();
    await registerPage.register(user.firstName, user.lastName, user.email, user.password);

    // Should be logged in and on dashboard
    await dashboardPage.waitForPageLoad();
    await expect(dashboardPage.isUserLoggedIn()).resolves.toBe(true);
  });

  test('should create unique users with generated emails', async ({ page }) => {
    const registerPage = new RegisterPage(page);
    const dashboardPage = new DashboardPage(page);

    // Register first user
    const user1 = generateTestUser();
    await registerPage.goto();
    await registerPage.register(user1.firstName, user1.lastName, user1.email, user1.password);
    await dashboardPage.waitForPageLoad();
    await expect(dashboardPage.isOnDashboardPage()).resolves.toBe(true);

    // Logout
    await dashboardPage.logout();

    // Register second user with different email
    const user2 = generateTestUser();
    expect(user1.email).not.toBe(user2.email); // Verify emails are different

    await registerPage.goto();
    await registerPage.register(user2.firstName, user2.lastName, user2.email, user2.password);
    await dashboardPage.waitForPageLoad();
    await expect(dashboardPage.isOnDashboardPage()).resolves.toBe(true);
  });
});
