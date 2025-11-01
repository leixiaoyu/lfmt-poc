/**
 * LoginPage Integration Tests
 *
 * Tests the full login flow including:
 * - Page rendering with AuthProvider and Router
 * - Form submission with mock API
 * - Navigation after successful login
 * - Error handling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LoginPage from '../LoginPage';
import { AuthProvider } from '../../contexts/AuthContext';

// Mock dashboard component
function MockDashboard() {
  return <div>Dashboard Page</div>;
}

// Helper to render with full app context
function renderWithAppContext(initialRoute = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/dashboard" element={<MockDashboard />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('LoginPage - Integration Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Page Rendering', () => {
    it('should render login page with form fields', () => {
      renderWithAppContext();

      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
    });

    it('should render navigation links', () => {
      renderWithAppContext();

      const forgotPasswordLink = screen.getByRole('link', { name: /forgot password/i });
      expect(forgotPasswordLink).toHaveAttribute('href', '/forgot-password');

      const signUpLink = screen.getByRole('link', { name: /sign up/i });
      expect(signUpLink).toHaveAttribute('href', '/register');
    });
  });

  describe('Login Flow with Mock API', () => {
    it('should successfully login and redirect to dashboard', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      // Fill in credentials
      await user.type(screen.getByLabelText(/email/i), 'user@example.com');
      await user.type(screen.getByLabelText(/password/i), 'Password123!');

      // Submit
      await user.click(screen.getByRole('button', { name: /log in/i }));

      // Should redirect to dashboard
      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should store auth tokens after login', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'anypassword');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });

      // Check tokens
      expect(localStorage.getItem('lfmt_access_token')).toBeTruthy();
      expect(localStorage.getItem('lfmt_refresh_token')).toBeTruthy();
    });

    it('should accept any valid email/password combination (mock mode)', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'any@email.com');
      await user.type(screen.getByLabelText(/password/i), 'anypassword');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });
  });

  describe('Form Validation', () => {
    it('should validate required fields', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/email is required/i)).toBeInTheDocument();
        expect(screen.getByText(/password is required/i)).toBeInTheDocument();
      });
    });

    it('should validate email format', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'invalid-email');
      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading state during login', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'password');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      // Should show loading text
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /logging in/i })).toBeInTheDocument();
      });
    });
  });

  describe('Data Handling - Regression Tests', () => {
    it('should not throw JSON parsing errors during login', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error');

      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'json@test.com');
      await user.type(screen.getByLabelText(/password/i), 'Password123!');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });

      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('is not valid JSON')
      );

      consoleError.mockRestore();
    });

    it('should handle special characters in credentials', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'test+special@example.com');
      await user.type(screen.getByLabelText(/password/i), 'P@ssw0rd!#$%');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(() => {
        expect(screen.getByText(/dashboard page/i)).toBeInTheDocument();
      }, { timeout: 3000 });
    });
  });

  describe('Accessibility', () => {
    it('should have proper form labels', () => {
      renderWithAppContext();

      expect(screen.getByLabelText(/email/i)).toHaveAccessibleName();
      expect(screen.getByLabelText(/password/i)).toHaveAccessibleName();
    });

    it('should have autocomplete attributes', () => {
      renderWithAppContext();

      expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email');
      expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
    });
  });
});
