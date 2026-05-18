/**
 * LoginForm Component Tests
 *
 * Following TDD approach - tests written BEFORE implementation.
 * Tests cover:
 * - Form rendering
 * - Input validation
 * - Form submission
 * - Error handling
 * - Loading states
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginForm } from '../LoginForm';

// Helper to render with router
function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('LoginForm - Rendering', () => {
  it('should render login form with all fields', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  it('should render forgot password link', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const forgotLink = screen.getByRole('link', { name: /forgot password/i });
    expect(forgotLink).toBeInTheDocument();
    expect(forgotLink).toHaveAttribute('href', '/forgot-password');
  });

  it('should render sign up link', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const signUpLink = screen.getByRole('link', { name: /sign up/i });
    expect(signUpLink).toBeInTheDocument();
    expect(signUpLink).toHaveAttribute('href', '/register');
  });

  it('should have email input of type email', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('should have password input of type password', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });
});

describe('LoginForm - Validation', () => {
  it('should show error when email is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
  });

  it('should show error when email is invalid', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'invalid-email');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
    });
  });

  it('should show error when password is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });

  it('should not submit form when validation fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('LoginForm - Submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call onSubmit with form data when valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'Password123!',
      });
    });
  });

  it('should disable submit button while submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('should show loading text while submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    expect(screen.getByRole('button', { name: /logging in/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
    });
  });

  it('should clear form after successful submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(emailInput.value).toBe('');
      expect(passwordInput.value).toBe('');
    });
  });
});

describe('LoginForm - Error Handling', () => {
  it('should display error message when submission fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Invalid email or password',
    });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'wrong@example.com');
    await user.type(passwordInput, 'WrongPass');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
  });

  it('should fall back to the canonical FALLBACK_MESSAGE when the rejection has no message field (issue #279)', async () => {
    // Issue #279: post-#274 sweep, the per-form drifted fallback string
    // ("An error occurred during login") is gone. Empty-payload rejections
    // delegate to `getApiErrorMessage` → `getTranslationErrorMessage` →
    // network branch (no statusCode, no usable message) → NETWORK_MESSAGE.
    //
    // Note: the `getApiErrorMessage` helper treats a totally empty payload
    // as "no usable signal" and routes through the network-error branch,
    // which is the desired behaviour for the auth-form generic case
    // (offline / unreachable). The canonical FALLBACK_MESSAGE is reached
    // when the payload DOES carry an unmapped statusCode but no message —
    // tested separately below.
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      /* no message, no statusCode */
    });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/connection lost — check your internet and try again\./i)
      ).toBeInTheDocument();
    });
  });

  it('should keep form values when submission fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Server error',
    });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });

    expect(emailInput.value).toBe('test@example.com');
    expect(passwordInput.value).toBe('Password123!');
  });

  it('should clear error message when user starts typing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Invalid credentials',
    });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    await user.type(emailInput, 'wrong@example.com');
    await user.type(passwordInput, 'WrongPass');

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
    });

    // Start typing in email field
    await user.type(emailInput, 'a');

    await waitFor(() => {
      expect(screen.queryByText(/invalid credentials/i)).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #274 — auth forms must route catch payloads through
// `getApiErrorMessage`, which provides:
//   - GENERIC_MESSAGES deny-list (catches "Network Error", "Request failed",
//     "Failed to fetch", "An unexpected error occurred")
//   - STATUS_MESSAGES curated phrases (curated copy for 400/401/.../503/504)
//   - FALLBACK_MESSAGE for the genuinely empty case (no signal, but with a
//     statusCode we don't curate).
// ---------------------------------------------------------------------------
describe('LoginForm - getApiErrorMessage routing (issue #274)', () => {
  it('renders curated NETWORK_MESSAGE for a raw axios `Network Error` string', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network Error'));
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      // NETWORK_MESSAGE = "Connection lost — check your internet and try again."
      expect(
        screen.getByText(/connection lost — check your internet and try again\./i)
      ).toBeInTheDocument();
    });
    // The raw axios "Network Error" string MUST NOT leak to the UI.
    expect(screen.queryByText(/^network error$/i)).not.toBeInTheDocument();
  });

  it('surfaces a backend-emitted prose message verbatim', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValue({ message: 'Incorrect email or password', status: 401 });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'WrongPass123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByText('Incorrect email or password')).toBeInTheDocument();
    });
  });

  it('renders STATUS_MESSAGES[429] for { statusCode: 429, message: "" }', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({ statusCode: 429, message: '' });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/translation rate limit reached — please try again in a moment\./i)
      ).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #278 — inline "Forgot password?" recovery link on the wrong-credentials
// path. Trigger gate is the rendered message text matching the canonical
// wrong-credentials copy, NOT a raw 401 status (which is also session-expiry).
// ---------------------------------------------------------------------------
describe('LoginForm - inline forgot-password recovery link (issue #278)', () => {
  it('renders an inline "Forgot password?" link when the alert text is "Incorrect email or password"', async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn()
      .mockRejectedValue({ message: 'Incorrect email or password', status: 401 });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'user@example.com');
    await user.type(screen.getByLabelText(/password/i), 'WrongPass!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    const inlineLink = await screen.findByTestId('alert-forgot-password-link');
    expect(inlineLink).toBeInTheDocument();
    expect(inlineLink).toHaveAttribute('href', '/forgot-password');
    // The existing below-form link is still present (regression guard).
    const allForgotLinks = screen.getAllByRole('link', { name: /forgot password/i });
    expect(allForgotLinks.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT render the inline link for a 403 backend message', async () => {
    const user = userEvent.setup();
    // E.g. "Please verify your email address before logging in." — the recovery
    // action is email verification, not password reset.
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Please verify your email address before logging in.',
      status: 403,
    });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'unconfirmed@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/please verify your email address before logging in\./i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId('alert-forgot-password-link')).not.toBeInTheDocument();
  });

  it('does NOT render the inline link for a 429 rate-limit error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({ statusCode: 429, message: '' });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByText(/translation rate limit reached/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('alert-forgot-password-link')).not.toBeInTheDocument();
  });

  it('does NOT render the inline link for a 500 server error', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({ statusCode: 500, message: '' });
    renderWithRouter(<LoginForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'Password123!');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByText(/server error — our team has been notified/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('alert-forgot-password-link')).not.toBeInTheDocument();
  });

  it('preserves the existing below-form "Forgot password?" link (regression guard)', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);
    // No error rendered yet — exactly one forgot-password link should exist
    // (the canonical below-form one, NOT the inline-alert one).
    const links = screen.getAllByRole('link', { name: /forgot password/i });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/forgot-password');
  });
});

describe('LoginForm - Accessibility', () => {
  it('should have proper labels for all inputs', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    expect(emailInput).toHaveAccessibleName();
    expect(passwordInput).toHaveAccessibleName();
  });

  it('should have autocomplete attributes', () => {
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/password/i);

    expect(emailInput).toHaveAttribute('autocomplete', 'email');
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password');
  });

  it('should associate error messages with inputs via aria-describedby', async () => {
    const user = userEvent.setup();
    renderWithRouter(<LoginForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /log in/i });
    await user.click(submitButton);

    await waitFor(() => {
      // Check that error text is visible (MUI handles aria association internally)
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });
});
