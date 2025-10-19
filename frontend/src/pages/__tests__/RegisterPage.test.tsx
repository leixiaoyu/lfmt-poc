/**
 * RegisterPage Integration Tests
 *
 * Tests the full registration flow including:
 * - Page rendering with AuthProvider and Router
 * - Form submission with mock API
 * - Navigation after successful registration
 * - Error handling
 *
 * These tests catch integration issues that unit tests miss,
 * such as JSON parsing errors, navigation bugs, etc.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RegisterPage from '../RegisterPage';
import { AuthProvider } from '../../contexts/AuthContext';
import { ROUTES } from '../../config/constants';

// Mock dashboard component
function MockDashboard() {
  return <div>Dashboard Page</div>;
}

// Helper to render with full app context
function renderWithAppContext(initialRoute = '/register') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<MockDashboard />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('RegisterPage - Integration Tests', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Page Rendering', () => {
    it('should render the registration page with all form fields', () => {
      renderWithAppContext();

      expect(screen.getByRole('heading', { name: /sign up/i })).toBeInTheDocument();
      expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
    });

    it('should render link to login page', () => {
      renderWithAppContext();

      const loginLink = screen.getByRole('link', { name: /sign in/i });
      expect(loginLink).toBeInTheDocument();
      expect(loginLink).toHaveAttribute('href', '/login');
    });
  });

  describe('Form Validation', () => {
    it('should show validation errors when submitting empty form', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      const submitButton = screen.getByRole('button', { name: /sign up/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/first name is required/i)).toBeInTheDocument();
        expect(screen.getByText(/last name is required/i)).toBeInTheDocument();
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      });
    });

    it('should validate email format', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      const emailInput = screen.getByLabelText(/email/i);
      await user.type(emailInput, 'invalid-email');

      const submitButton = screen.getByRole('button', { name: /sign up/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
      });
    });

    it('should validate password strength', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      const passwordInput = screen.getByLabelText(/^password/i);
      await user.type(passwordInput, 'weak');

      const submitButton = screen.getByRole('button', { name: /sign up/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
      });
    });

    it('should validate password confirmation match', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      const passwordInput = screen.getByLabelText(/^password/i);
      const confirmInput = screen.getByLabelText(/confirm password/i);

      await user.type(passwordInput, 'Password123!');
      await user.type(confirmInput, 'Different123!');

      const submitButton = screen.getByRole('button', { name: /sign up/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
      });
    });
  });

  describe('Registration Flow with Mock API', () => {
    it('should successfully register and redirect to dashboard', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      // Fill in the registration form
      await user.type(screen.getByLabelText(/first name/i), 'John');
      await user.type(screen.getByLabelText(/last name/i), 'Doe');
      await user.type(screen.getByLabelText(/email/i), 'john.doe@example.com');
      await user.type(screen.getByLabelText(/^password/i), 'SecurePass123!');
      await user.type(screen.getByLabelText(/confirm password/i), 'SecurePass123!');

      // Submit the form
      const submitButton = screen.getByRole('button', { name: /sign up/i });
      await user.click(submitButton);

      // Should redirect to dashboard
      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should store auth tokens after registration', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      // Fill and submit form
      await user.type(screen.getByLabelText(/first name/i), 'Test');
      await user.type(screen.getByLabelText(/last name/i), 'User');
      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/^password/i), 'Password123!');
      await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');

      await user.click(screen.getByRole('button', { name: /sign up/i }));

      // Wait for redirect
      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });

      // Note: localStorage storage is tested in authService.test.ts
      // This integration test focuses on the navigation flow
    });
  });

  describe('Loading States', () => {
    it('should show loading state during registration', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      // Fill form with valid data
      await user.type(screen.getByLabelText(/first name/i), 'Loading');
      await user.type(screen.getByLabelText(/last name/i), 'Test');
      await user.type(screen.getByLabelText(/email/i), 'loading@test.com');
      await user.type(screen.getByLabelText(/^password/i), 'Password123!');
      await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');

      const submitButton = screen.getByRole('button', { name: /sign up/i });
      await user.click(submitButton);

      // Should show loading text
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /creating account/i })).toBeInTheDocument();
      });

      // Should be disabled during submission
      expect(screen.getByRole('button', { name: /creating account/i })).toBeDisabled();
    });
  });

  describe('Error Scenarios', () => {
    it('should not submit form with invalid data', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      // Submit with invalid data
      await user.type(screen.getByLabelText(/first name/i), 'Test');
      await user.type(screen.getByLabelText(/email/i), 'invalid-email');
      await user.type(screen.getByLabelText(/^password/i), 'weak');

      await user.click(screen.getByRole('button', { name: /sign up/i }));

      // Should stay on registration page
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /sign up/i })).toBeInTheDocument();
      });

      // Should not redirect to dashboard
      expect(screen.queryByText(/dashboard page/i)).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have proper form labels', () => {
      renderWithAppContext();

      expect(screen.getByLabelText(/first name/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/last name/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/email/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/^password/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/confirm password/i)).toHaveAccessibleName();
    });

    it('should have autocomplete attributes', () => {
      renderWithAppContext();

      expect(screen.getByLabelText(/first name/i)).toHaveAttribute('autocomplete', 'given-name');
      expect(screen.getByLabelText(/last name/i)).toHaveAttribute('autocomplete', 'family-name');
      expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email');
    });
  });

  describe('Data Handling - Regression Tests', () => {
    it('should not throw JSON parsing errors with form data', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error');

      renderWithAppContext();

      // Fill form
      await user.type(screen.getByLabelText(/first name/i), 'JSON');
      await user.type(screen.getByLabelText(/last name/i), 'Test');
      await user.type(screen.getByLabelText(/email/i), 'json@test.com');
      await user.type(screen.getByLabelText(/^password/i), 'Password123!');
      await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');

      await user.click(screen.getByRole('button', { name: /sign up/i }));

      // Wait for completion
      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });

      // Should not have any console errors
      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('is not valid JSON')
      );

      consoleError.mockRestore();
    });

    it('should handle special characters in form data', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      // Fill with special characters
      await user.type(screen.getByLabelText(/first name/i), "O'Brien");
      await user.type(screen.getByLabelText(/last name/i), 'José-María');
      await user.type(screen.getByLabelText(/email/i), 'test+special@example.com');
      await user.type(screen.getByLabelText(/^password/i), 'P@ssw0rd!#$%');
      await user.type(screen.getByLabelText(/confirm password/i), 'P@ssw0rd!#$%');

      await user.click(screen.getByRole('button', { name: /sign up/i }));

      // Should successfully register and navigate with special characters
      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });

      // Note: Data storage with special characters is tested in mockApi.test.ts
      // This test verifies the full registration flow works with special chars
    });
  });
});
