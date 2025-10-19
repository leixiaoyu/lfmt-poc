/**
 * ForgotPasswordForm Component Tests
 *
 * Following TDD approach - tests written BEFORE implementation.
 * Tests cover:
 * - Form rendering
 * - Email validation
 * - Form submission
 * - Success state handling
 * - Error handling
 * - Loading states
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ForgotPasswordForm } from '../ForgotPasswordForm';

// Helper to render with router
function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('ForgotPasswordForm - Rendering', () => {
  it('should render forgot password form with email field', () => {
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('should render back to login link', () => {
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    const loginLink = screen.getByRole('link', { name: /back to login/i });
    expect(loginLink).toBeInTheDocument();
    expect(loginLink).toHaveAttribute('href', '/login');
  });

  it('should have email input of type email', () => {
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('should display helpful instructions', () => {
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    expect(screen.getByText(/enter your email address/i)).toBeInTheDocument();
    expect(screen.getByText(/we'll send you a link/i)).toBeInTheDocument();
  });
});

describe('ForgotPasswordForm - Validation', () => {
  it('should show error when email is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
  });

  it('should show error when email is invalid', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'invalid-email');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
    });
  });

  it('should not submit form when validation fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ForgotPasswordForm - Submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call onSubmit with email when valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('test@example.com');
    });
  });

  it('should disable submit button while submitting', async () => {
    const user = userEvent.setup();
    let resolveSubmit: () => void;
    const onSubmit = vi.fn(() => new Promise<void>(resolve => {
      resolveSubmit = resolve;
    }));
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    // Button should be disabled while submitting
    expect(submitButton).toBeDisabled();

    // Resolve the promise to complete submission
    resolveSubmit!();

    // After completion, success state should be shown
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });

  it('should show loading text while submitting', async () => {
    const user = userEvent.setup();
    let resolveSubmit: () => void;
    const onSubmit = vi.fn(() => new Promise<void>(resolve => {
      resolveSubmit = resolve;
    }));
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    // Should show loading text while submitting
    expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();

    // Resolve the promise
    resolveSubmit!();

    // After completion, success state should be shown
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });

  it('should not clear form after successful submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalled();
    });

    // Email should remain (user might want to try again)
    expect(emailInput.value).toBe('test@example.com');
  });
});

describe('ForgotPasswordForm - Success State', () => {
  it('should show success message after successful submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
      expect(screen.getByText(/we've sent password reset instructions/i)).toBeInTheDocument();
    });
  });

  it('should hide form after successful submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });

    // Form should be hidden
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /send reset link/i })).not.toBeInTheDocument();
  });

  it('should show back to login link in success state', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });

    const loginLink = screen.getByRole('link', { name: /back to login/i });
    expect(loginLink).toBeInTheDocument();
    expect(loginLink).toHaveAttribute('href', '/login');
  });
});

describe('ForgotPasswordForm - Error Handling', () => {
  it('should display error message when submission fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Email not found',
    });
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'nonexistent@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email not found/i)).toBeInTheDocument();
    });
  });

  it('should keep form visible when submission fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Server error',
    });
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });

    // Form should still be visible
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument();
  });

  it('should keep email value when submission fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Server error',
    });
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i) as HTMLInputElement;
    await user.type(emailInput, 'test@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });

    expect(emailInput.value).toBe('test@example.com');
  });

  it('should clear error message when user starts typing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Email not found',
    });
    renderWithRouter(<ForgotPasswordForm onSubmit={onSubmit} />);

    const emailInput = screen.getByLabelText(/email/i);
    await user.type(emailInput, 'wrong@example.com');

    const submitButton = screen.getByRole('button', { name: /send reset link/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email not found/i)).toBeInTheDocument();
    });

    // Start typing in email field
    await user.type(emailInput, 'a');

    expect(screen.queryByText(/email not found/i)).not.toBeInTheDocument();
  });
});

describe('ForgotPasswordForm - Accessibility', () => {
  it('should have proper label for email input', () => {
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAccessibleName();
  });

  it('should have autocomplete attribute', () => {
    renderWithRouter(<ForgotPasswordForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/email/i);
    expect(emailInput).toHaveAttribute('autocomplete', 'email');
  });
});
