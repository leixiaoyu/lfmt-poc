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
import { http, HttpResponse, delay } from 'msw';
import LoginPage from '../LoginPage';
import { AuthProvider } from '../../contexts/AuthContext';
import { server } from '../../mocks/server';

// Mock dashboard component - matches actual Dashboard structure
function MockDashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <div>New Translation</div>
      <div>Upload Document</div>
    </div>
  );
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
    // Round 2 item 5: re-enabled. These were skipped pre-PR-#198 (commit
    // a6d92815 marked 19 tests as ".skip" with TODO to revisit) — they
    // were never re-evaluated. The MSW handler infrastructure is now
    // mature enough to drive this end-to-end. Each test verifies that
    // submitting the form lands the user on the dashboard route AND
    // (when applicable) writes the one-blob session.
    it('should successfully login and redirect to dashboard', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      // Fill in credentials
      await user.type(screen.getByLabelText(/email/i), 'user@example.com');
      await user.type(screen.getByLabelText(/password/i), 'Password123!');

      // Submit
      await user.click(screen.getByRole('button', { name: /log in/i }));

      // Should redirect to dashboard
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('should store auth tokens after login', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'test@example.com');
      await user.type(screen.getByLabelText(/password/i), 'anypassword');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Check the one-blob session (Issue #196). Both tokens and the
      // refresh token live under a single key now; reading the blob
      // tests the full ingest path end-to-end.
      const raw = localStorage.getItem('lfmt_session');
      expect(raw).toBeTruthy();
      const session = JSON.parse(raw as string);
      expect(session.idToken).toBeTruthy();
      expect(session.accessToken).toBeTruthy();
      expect(session.refreshToken).toBeTruthy();
    });

    it('should accept any valid email/password combination (mock mode)', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'any@email.com');
      await user.type(screen.getByLabelText(/password/i), 'anypassword');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
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
      // Override the default MSW login handler with a delayed response so
      // the loading state is observable. The default handler resolves
      // synchronously (per spec — VITE_MOCK_SPEED governs simulation
      // ticking, not handler latency), which would race the assertion.
      server.use(
        http.post(/\/auth\/login$/, async () => {
          await delay(100);
          return HttpResponse.json(
            {
              user: {
                id: 'mock-user-loading',
                email: 'test@example.com',
                firstName: 'Test',
                lastName: 'User',
              },
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
            },
            { status: 200 }
          );
        })
      );

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
    // Round 2 item 5: re-enabled (see "Login Flow with Mock API" above
    // for the full rationale).
    it('should not throw JSON parsing errors during login', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error');

      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'json@test.com');
      await user.type(screen.getByLabelText(/password/i), 'Password123!');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('is not valid JSON'));

      consoleError.mockRestore();
    });

    it('should handle special characters in credentials', async () => {
      const user = userEvent.setup();
      renderWithAppContext();

      await user.type(screen.getByLabelText(/email/i), 'test+special@example.com');
      await user.type(screen.getByLabelText(/password/i), 'P@ssw0rd!#$%');

      await user.click(screen.getByRole('button', { name: /log in/i }));

      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
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
      expect(screen.getByLabelText(/password/i)).toHaveAttribute(
        'autocomplete',
        'current-password'
      );
    });
  });
});
