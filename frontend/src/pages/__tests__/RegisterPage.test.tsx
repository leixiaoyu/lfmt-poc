/**
 * RegisterPage Integration Tests
 *
 * Tests the full registration flow including:
 * - Page rendering with AuthProvider and Router
 * - Form submission with mock API
 * - Navigation after successful registration
 * - Auto-login after registration (issue #222)
 * - Error handling
 *
 * These tests catch integration issues that unit tests miss,
 * such as JSON parsing errors, navigation bugs, etc.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { http, HttpResponse, delay } from 'msw';
import RegisterPage from '../RegisterPage';
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
function renderWithAppContext(initialRoute = '/register') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/dashboard" element={<MockDashboard />} />
          {/* LoginPage included to test the auto-login fallback redirect */}
          <Route path="/login" element={<LoginPage />} />
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
    it.skip('should successfully register and redirect to dashboard', async () => {
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
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it.skip('should store auth tokens after registration', async () => {
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
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Note: localStorage storage is tested in authService.test.ts
      // This integration test focuses on the navigation flow
    });
  });

  /**
   * Auto-Login After Registration (issue #222)
   *
   * Covers the two outcomes of the silent login attempt that follows a
   * successful POST /auth/register in dev (Cognito auto-confirm enabled):
   *
   *   (a) register success + login success → /dashboard
   *   (b) register success + login failure → /login with friendly message
   */
  describe('Auto-Login After Registration (issue #222)', () => {
    /** Fill and submit the registration form with valid test data. */
    async function fillAndSubmitForm(user: ReturnType<typeof userEvent.setup>) {
      await user.type(screen.getByLabelText(/first name/i), 'Jane');
      await user.type(screen.getByLabelText(/last name/i), 'Demo');
      await user.type(screen.getByLabelText(/email/i), 'jane@example.com');
      await user.type(screen.getByLabelText(/^password/i), 'Secure123!');
      await user.type(screen.getByLabelText(/confirm password/i), 'Secure123!');
      await user.click(screen.getByLabelText(/terms of service/i));
      await user.click(screen.getByLabelText(/privacy policy/i));
      await user.click(screen.getByRole('button', { name: /sign up/i }));
    }

    it('(a) register success → auto-login succeeds → navigates to /dashboard', async () => {
      // Both /auth/register and /auth/login use the default MSW handlers
      // which return a valid user + tokens — mirrors the dev auto-confirm flow.
      const user = userEvent.setup();
      renderWithAppContext();

      await fillAndSubmitForm(user);

      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('(b) register success but auto-login fails → navigates to /login with friendly message', async () => {
      // Override only the login handler to simulate a failure (e.g., prod env
      // where email verification is still required, returning 403).
      server.use(
        http.post(/\/auth\/login$/, () => {
          return HttpResponse.json(
            { message: 'Please verify your email address before logging in.' },
            { status: 403 }
          );
        })
      );

      const user = userEvent.setup();
      renderWithAppContext();

      await fillAndSubmitForm(user);

      // Should redirect to /login (not crash, not stay on /register)
      await waitFor(
        () => {
          expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Friendly message should be visible on the login page
      expect(screen.getByText(/account created/i)).toBeInTheDocument();
    });

    /**
     * Issue #276: surface the ACTUAL auto-login failure cause via
     * `getApiErrorMessage`, not a hardcoded "check your email" hint.
     *
     * Each case below verifies that:
     *   1. The user lands on /login (graceful fallback, no crash).
     *   2. The router-state message starts with "Account created." (preserves
     *      the positive confirmation about the registration leg).
     *   3. The message body matches the cause-specific extractor output —
     *      NOT the old hardcoded email-verification copy.
     */
    describe('Issue #276: error-cause-aware fallback message', () => {
      it('429 rate limit → "Account created." + backend rate-limit message', async () => {
        // Simulates Cognito's TooManyRequestsException tripping on the
        // immediate post-register InitiateAuth call (login.ts:182-194).
        server.use(
          http.post(/\/auth\/login$/, () => {
            return HttpResponse.json(
              { message: 'Too many login attempts. Please try again later.' },
              { status: 429 }
            );
          })
        );

        const user = userEvent.setup();
        renderWithAppContext();

        await fillAndSubmitForm(user);

        // Lands on /login (not on dashboard, not stuck on /register).
        await waitFor(
          () => {
            expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
          },
          { timeout: 3000 }
        );

        // Prefix preserved.
        const alert = await screen.findByText(/account created\./i);
        expect(alert).toBeInTheDocument();
        // Cause-specific message surfaced — NOT the old "check your email"
        // copy. getApiErrorMessage passes the non-generic backend prose
        // through verbatim.
        expect(alert.textContent).toMatch(/too many login attempts/i);
        // Negative assertion: the misleading hardcoded copy from before
        // the #276 fix MUST NOT appear.
        expect(alert.textContent).not.toMatch(/check your email/i);
      });

      it('403 UserNotConfirmedException → "Account created." + backend verification prose', async () => {
        // Production scenario: Cognito requires email confirmation before
        // login. After issue #275 lands, the backend prose passes through
        // the 403 interceptor verbatim; before #275, ERROR_MESSAGES.UNAUTHORIZED
        // is surfaced — both are non-misleading-in-context, the test below
        // accepts either by asserting on the "Account created." prefix and
        // absence of the OLD hardcoded "check your email if verification
        // is required" string.
        server.use(
          http.post(/\/auth\/login$/, () => {
            return HttpResponse.json(
              { message: 'Please verify your email address before logging in.' },
              { status: 403 }
            );
          })
        );

        const user = userEvent.setup();
        renderWithAppContext();

        await fillAndSubmitForm(user);

        await waitFor(
          () => {
            expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
          },
          { timeout: 3000 }
        );

        const alert = await screen.findByText(/account created\./i);
        expect(alert).toBeInTheDocument();
        // The user is NOT shown the misleading conditional phrasing
        // ("check your email IF verification is required") regardless of
        // which side of #275 we're on. They see either the verbatim backend
        // prose ("Please verify your email…") or ERROR_MESSAGES.UNAUTHORIZED
        // ("You do not have permission…"). Both are deterministic.
        expect(alert.textContent).not.toMatch(/check your email if verification is required/i);
      });

      it('network error → "Account created." + NETWORK_MESSAGE-style copy', async () => {
        // Simulates total transport failure between register-success and the
        // login attempt. MSW's `HttpResponse.error()` triggers axios's
        // ERR_NETWORK path (no response object reaches the interceptor).
        server.use(
          http.post(/\/auth\/login$/, () => {
            return HttpResponse.error();
          })
        );

        const user = userEvent.setup();
        renderWithAppContext();

        await fillAndSubmitForm(user);

        await waitFor(
          () => {
            expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
          },
          { timeout: 3000 }
        );

        const alert = await screen.findByText(/account created\./i);
        expect(alert).toBeInTheDocument();
        // Either the api.ts NETWORK_ERROR constant ("Network error. Please
        // check your connection and try again.") OR the
        // translationErrorMessages NETWORK_MESSAGE ("Connection lost — check
        // your internet and try again.") — both pass through the extractor.
        // The unifying invariant for the test is: the message mentions
        // network/connection AND does NOT promote the old email-verification
        // hint.
        expect(alert.textContent).toMatch(/network|connection/i);
        expect(alert.textContent).not.toMatch(/check your email/i);
      });

      it('500 server error → "Account created." + server-error copy', async () => {
        // Simulates the generic 5xx catch-all from login.ts:197-208.
        server.use(
          http.post(/\/auth\/login$/, () => {
            return HttpResponse.json({ message: 'Internal server error' }, { status: 500 });
          })
        );

        const user = userEvent.setup();
        renderWithAppContext();

        await fillAndSubmitForm(user);

        await waitFor(
          () => {
            expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
          },
          { timeout: 3000 }
        );

        const alert = await screen.findByText(/account created\./i);
        expect(alert).toBeInTheDocument();
        // The api.ts 5xx branch overrides the backend message with
        // ERROR_MESSAGES.SERVER_ERROR ("Server error. Please try again
        // later.") — non-generic, passes through the extractor verbatim.
        expect(alert.textContent).toMatch(/server error/i);
        expect(alert.textContent).not.toMatch(/check your email/i);
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading state during registration', async () => {
      // Override the default MSW register handler with a delayed response
      // so the loading state is observable. The default handler resolves
      // synchronously (per spec — VITE_MOCK_SPEED governs simulation
      // ticking, not handler latency), which would race the assertion.
      server.use(
        http.post(/\/auth\/register$/, async () => {
          await delay(100);
          return HttpResponse.json(
            {
              user: {
                id: 'mock-user-loading',
                email: 'loading@test.com',
                firstName: 'Loading',
                lastName: 'Test',
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

      // Fill form with valid data
      await user.type(screen.getByLabelText(/first name/i), 'Loading');
      await user.type(screen.getByLabelText(/last name/i), 'Test');
      await user.type(screen.getByLabelText(/email/i), 'loading@test.com');
      await user.type(screen.getByLabelText(/^password/i), 'Password123!');
      await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');

      // Check legal compliance checkboxes
      const termsCheckbox = screen.getByLabelText(/terms of service/i);
      const privacyCheckbox = screen.getByLabelText(/privacy policy/i);
      await user.click(termsCheckbox);
      await user.click(privacyCheckbox);

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
    it.skip('should not throw JSON parsing errors with form data', async () => {
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
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Should not have any console errors
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('is not valid JSON'));

      consoleError.mockRestore();
    });

    it.skip('should handle special characters in form data', async () => {
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
      await waitFor(
        () => {
          expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Note: Data storage with special characters is tested in mockApi.test.ts
      // This test verifies the full registration flow works with special chars
    });
  });
});
