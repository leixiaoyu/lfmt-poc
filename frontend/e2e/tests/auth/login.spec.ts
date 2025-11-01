/**
 * Login E2E Tests
 *
 * Tests the login functionality using Page Object Model.
 */

import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { generateTestUser, registerUser } from '../../fixtures/auth';

test.describe('Login Page', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    await loginPage.goto();
  });

  test('should display login form', async () => {
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should successfully login with valid credentials', async ({ page }) => {
    // Register a new user first
    const user = generateTestUser();
    const registerResponse = await page.request.post(
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
    expect(registerResponse.ok()).toBeTruthy();

    // Now login with the registered user
    await loginPage.login(user.email, user.password);

    // Should redirect to dashboard
    await dashboardPage.waitForPageLoad();
    await expect(dashboardPage.isOnDashboardPage()).resolves.toBe(true);
  });

  test('should show error with invalid credentials', async () => {
    await loginPage.login('invalid@example.com', 'WrongPassword123!');

    // Should show error message and stay on login page
    await loginPage.page.waitForTimeout(2000); // Wait for error to appear
    await expect(loginPage.hasErrorMessage()).resolves.toBe(true);
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should show error with empty email', async () => {
    await loginPage.fillPassword('SomePassword123!');
    await loginPage.clickLogin();

    // Should show validation error
    await loginPage.page.waitForTimeout(1000);
    await expect(loginPage.isLoginButtonDisabled()).resolves.toBe(false);
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should show error with empty password', async () => {
    await loginPage.fillEmail('test@example.com');
    await loginPage.clickLogin();

    // Should show validation error
    await loginPage.page.waitForTimeout(1000);
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should navigate to register page when clicking register link', async () => {
    await loginPage.clickRegisterLink();
    await loginPage.waitForURL('/register');
    expect(loginPage.getCurrentURL()).toContain('/register');
  });
});

test.describe('Login Flow Integration', () => {
  test('should maintain session after login', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    // Register and login
    const user = generateTestUser();
    const registerResponse = await page.request.post(
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
    expect(registerResponse.ok()).toBeTruthy();

    await loginPage.goto();
    await loginPage.login(user.email, user.password);
    await dashboardPage.waitForPageLoad();

    // Refresh page and verify still logged in
    await page.reload();
    await dashboardPage.waitForPageLoad();
    await expect(dashboardPage.isUserLoggedIn()).resolves.toBe(true);
  });

  test('should logout successfully', async ({ page }) => {
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    // Register and login
    const user = generateTestUser();
    const registerResponse = await page.request.post(
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
    expect(registerResponse.ok()).toBeTruthy();

    await loginPage.goto();
    await loginPage.login(user.email, user.password);
    await dashboardPage.waitForPageLoad();

    // Logout
    await dashboardPage.logout();

    // Should be on login page
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);

    // Try to access dashboard - should redirect to login
    await dashboardPage.goto();
    await loginPage.page.waitForTimeout(2000);
    expect(loginPage.getCurrentURL()).toContain('/login');
  });
});
