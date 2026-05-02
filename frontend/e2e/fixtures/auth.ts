/**
 * Authentication Helpers for E2E Tests
 *
 * Provides utilities for authentication flows in E2E tests.
 */

import { APIRequestContext, Page } from '@playwright/test';

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
 * Register a user via the backend API (bypassing the UI).
 *
 * Many E2E specs need a known authenticated user but want to skip the
 * registration UI flow. They previously called `page.request.post` inline
 * with a partial payload (`{firstName, lastName, email, password}`), which
 * silently 400'd against the live API because the registerRequestSchema
 * requires `confirmPassword`, `acceptedTerms`, and `acceptedPrivacy` (see
 * shared-types/src/auth.ts:85). This helper centralizes the correct payload
 * shape so the contract can't drift again.
 *
 * Returns the raw Playwright APIResponse so callers can choose their own
 * assertion (most just check `response.ok()`; some treat 409 "already exists"
 * as success on retries).
 */
export async function registerViaApi(
  request: APIRequestContext,
  user: ReturnType<typeof generateTestUser>,
  apiBaseUrl?: string
) {
  const baseUrl = apiBaseUrl || process.env.API_BASE_URL || 'http://localhost:3000';
  // Strip trailing slash to avoid `//v1/auth/register`.
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return request.post(`${normalized}/v1/auth/register`, {
    data: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      password: user.password,
      confirmPassword: user.password,
      acceptedTerms: true,
      acceptedPrivacy: true,
    },
    failOnStatusCode: false,
  });
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
