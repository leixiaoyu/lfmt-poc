/**
 * End-to-End User Journey Tests
 * 
 * These tests cover the complete user flow from registration through translation.
 * They verify the integration between frontend, backend API, and AWS services.
 */

import { test, expect } from '@playwright/test';

// Test user credentials - using timestamp for uniqueness
const timestamp = new Date().getTime();
const TEST_USER = {
  email: `e2e-test-${timestamp}@example.com`,
  password: 'SecureTest123!',
  confirmPassword: 'SecureTest123!',
  firstName: 'E2E',
  lastName: 'Tester',
};

test.describe('Complete User Journey', () => {
  test.describe.configure({ mode: 'serial' });

  test('should redirect root to login page', async ({ page }) => {
    await page.goto('/');

    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
    await expect(page).toHaveTitle(/LFMT/i);
    await expect(page.getByRole('heading', { name: /log in/i })).toBeVisible();
  });

  test('should navigate to registration page from login', async ({ page }) => {
    await page.goto('/login');

    // Click register link
    await page.getByRole('link', { name: /sign up/i }).click();

    // Verify on registration page
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole('heading', { name: /register|sign up/i })).toBeVisible();
  });

  test('should register a new user successfully', async ({ page }) => {
    await page.goto('/register');
    
    // Fill registration form
    await page.getByLabel(/email/i).fill(TEST_USER.email);
    await page.getByLabel(/^password$/i).fill(TEST_USER.password);
    await page.getByLabel(/confirm password/i).fill(TEST_USER.confirmPassword);
    await page.getByLabel(/first name/i).fill(TEST_USER.firstName);
    await page.getByLabel(/last name/i).fill(TEST_USER.lastName);
    
    // Accept terms
    await page.getByLabel(/terms/i).check();
    await page.getByLabel(/privacy/i).check();
    
    // Submit form
    await page.getByRole('button', { name: /register|sign up/i }).click();
    
    // Should redirect to dashboard or show success message
    await expect(
      page.getByText(/registration successful|welcome/i)
    ).toBeVisible({ timeout: 10000 });
  });

  test('should login with registered credentials', async ({ page }) => {
    await page.goto('/login');
    
    // Fill login form
    await page.getByLabel(/email/i).fill(TEST_USER.email);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    
    // Submit
    await page.getByRole('button', { name: /login|sign in/i }).click();
    
    // Should redirect to dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
    await expect(page.getByText(/dashboard|welcome/i)).toBeVisible();
  });

  test('should logout successfully', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_USER.email);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    await page.getByRole('button', { name: /login|sign in/i }).click();
    await page.waitForURL(/\/dashboard/);
    
    // Logout
    await page.getByRole('button', { name: /logout|sign out/i }).click();
    
    // Should redirect to home or login
    await expect(page).toHaveURL(/\/(login)?$/);
  });
});

test.describe('Protected Routes', () => {
  test('should redirect to login when accessing protected routes unauthenticated', async ({ page }) => {
    // Try to access dashboard without login
    await page.goto('/dashboard');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/);
  });
});
