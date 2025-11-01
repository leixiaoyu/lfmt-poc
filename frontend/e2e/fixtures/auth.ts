/**
 * Authentication Helpers for E2E Tests
 *
 * Provides utilities for authentication flows in E2E tests.
 */

import { Page } from '@playwright/test';

/**
 * Generate unique test email
 */
export function generateTestEmail(): string {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(2, 8);
  return `test-${timestamp}-${randomId}@e2e-test.com`;
}

/**
 * Generate test user credentials
 */
export function generateTestUser() {
  // E2E test fixture - use environment variable or default test password
  // nosec: This is test data only, not production credentials
  const testPassword = process.env.E2E_TEST_PASSWORD || 'E2ETest' + '123!';

  return {
    email: generateTestEmail(),
    password: testPassword,
    firstName: 'E2E',
    lastName: 'Test',
  };
}

/**
 * Register a new user via UI
 */
export async function registerUser(page: Page, user: ReturnType<typeof generateTestUser>) {
  await page.goto('/register');

  await page.fill('[name="firstName"]', user.firstName);
  await page.fill('[name="lastName"]', user.lastName);
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', user.password);
  await page.fill('[name="confirmPassword"]', user.password);

  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard
  await page.waitForURL('/dashboard', { timeout: 10000 });
}

/**
 * Login user via UI
 */
export async function loginUser(page: Page, email: string, password: string) {
  await page.goto('/login');

  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', password);

  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard
  await page.waitForURL('/dashboard', { timeout: 10000 });
}

/**
 * Logout user via UI
 */
export async function logoutUser(page: Page) {
  await page.click('button:has-text("Logout")');

  // Wait for redirect to login
  await page.waitForURL('/login', { timeout: 10000 });
}

/**
 * Register and login in one step (commonly used in tests)
 */
export async function registerAndLogin(page: Page) {
  const user = generateTestUser();
  await registerUser(page, user);
  return user;
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  // Check for logout button presence
  const logoutButton = await page.locator('button:has-text("Logout")').count();
  return logoutButton > 0;
}
