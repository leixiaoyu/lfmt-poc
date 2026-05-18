/**
 * RegisterForm Component Tests
 *
 * Following TDD approach - tests written BEFORE implementation.
 * Tests cover:
 * - Form rendering
 * - Input validation (email, password strength, name fields)
 * - Form submission
 * - Error handling
 * - Loading states
 * - Password confirmation matching
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RegisterForm } from '../RegisterForm';

// Helper to render with router
function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('RegisterForm - Rendering', () => {
  it('should render registration form with all fields', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/first name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/last name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  it('should render sign in link', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const signInLink = screen.getByRole('link', { name: /sign in/i });
    expect(signInLink).toBeInTheDocument();
    expect(signInLink).toHaveAttribute('href', '/login');
  });

  it('should have email input of type email', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/^email/i);
    expect(emailInput).toHaveAttribute('type', 'email');
  });

  it('should have password inputs of type password', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(confirmInput).toHaveAttribute('type', 'password');
  });
});

describe('RegisterForm - Validation - Required Fields', () => {
  it('should show error when first name is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/first name is required/i)).toBeInTheDocument();
    });
  });

  it('should show error when last name is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/last name is required/i)).toBeInTheDocument();
    });
  });

  it('should show error when email is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email is required/i)).toBeInTheDocument();
    });
  });

  it('should show error when password is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password is required/i)).toBeInTheDocument();
    });
  });

  it('should show error when confirm password is empty', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/please confirm your password/i)).toBeInTheDocument();
    });
  });
});

describe('RegisterForm - Validation - Email Format', () => {
  it('should show error when email is invalid', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const emailInput = screen.getByLabelText(/^email/i);
    await user.type(emailInput, 'invalid-email');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/invalid email address/i)).toBeInTheDocument();
    });
  });
});

describe('RegisterForm - Validation - Password Strength', () => {
  it('should show error when password is too short', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password/i);
    await user.type(passwordInput, 'short');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password must be at least 8 characters/i)).toBeInTheDocument();
    });
  });

  it('should show error when password lacks uppercase letter', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password/i);
    await user.type(passwordInput, 'lowercase123!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/password must contain at least one uppercase letter/i)
      ).toBeInTheDocument();
    });
  });

  it('should show error when password lacks lowercase letter', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password/i);
    await user.type(passwordInput, 'UPPERCASE123!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/password must contain at least one lowercase letter/i)
      ).toBeInTheDocument();
    });
  });

  it('should show error when password lacks number', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password/i);
    await user.type(passwordInput, 'PasswordOnly!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/password must contain at least one number/i)).toBeInTheDocument();
    });
  });

  it('should show error when password lacks special character', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password/i);
    await user.type(passwordInput, 'Password123');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/password must contain at least one special character/i)
      ).toBeInTheDocument();
    });
  });
});

describe('RegisterForm - Validation - Password Confirmation', () => {
  it('should show error when passwords do not match', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    await user.type(passwordInput, 'SecurePass123!');
    await user.type(confirmInput, 'DifferentPass123!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
  });

  it('should not show error when passwords match', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'John');
    await user.type(lastNameInput, 'Doe');
    await user.type(emailInput, 'john@example.com');
    await user.type(passwordInput, 'SecurePass123!');
    await user.type(confirmInput, 'SecurePass123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.queryByText(/passwords do not match/i)).not.toBeInTheDocument();
    });
  });
});

describe('RegisterForm - Submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call onSubmit with form data when valid', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Jane');
    await user.type(lastNameInput, 'Smith');
    await user.type(emailInput, 'jane@example.com');
    await user.type(passwordInput, 'SecurePass123!');
    await user.type(confirmInput, 'SecurePass123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
    });
  });

  it('should include confirmPassword in submission data for backend validation', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const callArgs = onSubmit.mock.calls[0][0];
      // confirmPassword is included for backend validation
      expect(callArgs).toHaveProperty('confirmPassword', 'Password123!');
    });
  });

  it('should disable submit button while submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    expect(submitButton).toBeDisabled();

    await waitFor(() => {
      expect(submitButton).not.toBeDisabled();
    });
  });

  it('should show loading text while submitting', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 100)));
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');

    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    expect(screen.getByRole('button', { name: /creating account/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
    });
  });

  it('should clear form after successful submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i) as HTMLInputElement;
    const lastNameInput = screen.getByLabelText(/last name/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/^email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password/i) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(/confirm password/i) as HTMLInputElement;
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(firstNameInput.value).toBe('');
      expect(lastNameInput.value).toBe('');
      expect(emailInput.value).toBe('');
      expect(passwordInput.value).toBe('');
      expect(confirmInput.value).toBe('');
    });
  });
});

describe('RegisterForm - Error Handling', () => {
  it('should display error message when submission fails', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Email already exists',
    });
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'existing@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');

    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/email already exists/i)).toBeInTheDocument();
    });
  });

  it('should fall back to NETWORK_MESSAGE when the rejection has no message and no statusCode (issue #279)', async () => {
    // Issue #279: after the #274 sweep, the per-form drifted fallback string
    // ("An error occurred during registration") is gone. Empty-payload
    // rejections delegate to `getApiErrorMessage` → `getTranslationErrorMessage`
    // → network branch (no statusCode, no usable message) → NETWORK_MESSAGE.
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      /* no message, no statusCode */
    });
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/first name/i), 'Test');
    await user.type(screen.getByLabelText(/last name/i), 'User');
    await user.type(screen.getByLabelText(/^email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');
    await user.click(screen.getByLabelText(/terms of service/i));
    await user.click(screen.getByLabelText(/privacy policy/i));
    await user.click(screen.getByRole('button', { name: /sign up/i }));

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
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i) as HTMLInputElement;
    const lastNameInput = screen.getByLabelText(/last name/i) as HTMLInputElement;
    const emailInput = screen.getByLabelText(/^email/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/^password/i) as HTMLInputElement;
    const confirmInput = screen.getByLabelText(/confirm password/i) as HTMLInputElement;
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/server error/i)).toBeInTheDocument();
    });

    expect(firstNameInput.value).toBe('Test');
    expect(lastNameInput.value).toBe('User');
    expect(emailInput.value).toBe('test@example.com');
    expect(passwordInput.value).toBe('Password123!');
    expect(confirmInput.value).toBe('Password123!');
  });

  it('should clear error message when user starts typing', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockRejectedValue({
      message: 'Registration failed',
    });
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');

    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);
    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText(/registration failed/i)).toBeInTheDocument();
    });

    // Start typing in email field
    await user.type(emailInput, 'a');

    await waitFor(() => {
      expect(screen.queryByText(/registration failed/i)).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Issue #274 — RegisterForm must route catch payloads through
// `getApiErrorMessage`. Same matrix as LoginForm tests above.
// ---------------------------------------------------------------------------
describe('RegisterForm - getApiErrorMessage routing (issue #274)', () => {
  async function fillValidForm() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/first name/i), 'Test');
    await user.type(screen.getByLabelText(/last name/i), 'User');
    await user.type(screen.getByLabelText(/^email/i), 'test@example.com');
    await user.type(screen.getByLabelText(/^password/i), 'Password123!');
    await user.type(screen.getByLabelText(/confirm password/i), 'Password123!');
    await user.click(screen.getByLabelText(/terms of service/i));
    await user.click(screen.getByLabelText(/privacy policy/i));
    await user.click(screen.getByRole('button', { name: /sign up/i }));
  }

  it('renders curated NETWORK_MESSAGE for a raw axios `Network Error` string', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Network Error'));
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    await fillValidForm();

    await waitFor(() => {
      expect(
        screen.getByText(/connection lost — check your internet and try again\./i)
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/^network error$/i)).not.toBeInTheDocument();
  });

  it('surfaces a backend-emitted prose message verbatim', async () => {
    const onSubmit = vi.fn().mockRejectedValue({ message: 'Email already exists', status: 400 });
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    await fillValidForm();

    await waitFor(() => {
      expect(screen.getByText('Email already exists')).toBeInTheDocument();
    });
  });

  it('renders STATUS_MESSAGES[429] for { statusCode: 429, message: "" }', async () => {
    const onSubmit = vi.fn().mockRejectedValue({ statusCode: 429, message: '' });
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    await fillValidForm();

    await waitFor(() => {
      expect(
        screen.getByText(/translation rate limit reached — please try again in a moment\./i)
      ).toBeInTheDocument();
    });
  });
});

describe('RegisterForm - Legal Compliance Checkboxes', () => {
  it('should render terms of service checkbox', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    expect(termsCheckbox).toBeInTheDocument();
    expect(termsCheckbox).not.toBeChecked();
  });

  it('should render privacy policy checkbox', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);
    expect(privacyCheckbox).toBeInTheDocument();
    expect(privacyCheckbox).not.toBeChecked();
  });

  it('should show error when terms checkbox is not checked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/you must accept the terms of service to register/i)
      ).toBeInTheDocument();
    });
  });

  it('should show error when privacy checkbox is not checked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(
        screen.getByText(/you must accept the privacy policy to register/i)
      ).toBeInTheDocument();
    });
  });

  it('should allow submission when both checkboxes are checked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Test');
    await user.type(lastNameInput, 'User');
    await user.type(emailInput, 'test@example.com');
    await user.type(passwordInput, 'Password123!');
    await user.type(confirmInput, 'Password123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
    });
  });

  it('should include checkbox values in form submission', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithRouter(<RegisterForm onSubmit={onSubmit} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);
    const termsCheckbox = screen.getByLabelText(/terms of service/i);
    const privacyCheckbox = screen.getByLabelText(/privacy policy/i);

    await user.type(firstNameInput, 'Jane');
    await user.type(lastNameInput, 'Doe');
    await user.type(emailInput, 'jane@example.com');
    await user.type(passwordInput, 'SecurePass123!');
    await user.type(confirmInput, 'SecurePass123!');
    await user.click(termsCheckbox);
    await user.click(privacyCheckbox);

    const submitButton = screen.getByRole('button', { name: /sign up/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const callArgs = onSubmit.mock.calls[0][0];
      expect(callArgs).toHaveProperty('acceptedTerms', true);
      expect(callArgs).toHaveProperty('acceptedPrivacy', true);
    });
  });
});

describe('RegisterForm - Accessibility', () => {
  it('should have proper labels for all inputs', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/first name/i)).toHaveAccessibleName();
    expect(screen.getByLabelText(/last name/i)).toHaveAccessibleName();
    expect(screen.getByLabelText(/^email/i)).toHaveAccessibleName();
    expect(screen.getByLabelText(/^password/i)).toHaveAccessibleName();
    expect(screen.getByLabelText(/confirm password/i)).toHaveAccessibleName();
  });

  it('should have autocomplete attributes', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const firstNameInput = screen.getByLabelText(/first name/i);
    const lastNameInput = screen.getByLabelText(/last name/i);
    const emailInput = screen.getByLabelText(/^email/i);
    const passwordInput = screen.getByLabelText(/^password/i);
    const confirmInput = screen.getByLabelText(/confirm password/i);

    expect(firstNameInput).toHaveAttribute('autocomplete', 'given-name');
    expect(lastNameInput).toHaveAttribute('autocomplete', 'family-name');
    expect(emailInput).toHaveAttribute('autocomplete', 'email');
    expect(passwordInput).toHaveAttribute('autocomplete', 'new-password');
    expect(confirmInput).toHaveAttribute('autocomplete', 'new-password');
  });

  it('should have accessible labels for checkboxes', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    expect(screen.getByLabelText(/terms of service/i)).toHaveAccessibleName();
    expect(screen.getByLabelText(/privacy policy/i)).toHaveAccessibleName();
  });
});

describe('RegisterForm - Legal Links (issue #223)', () => {
  it('should render "Terms of Service" as a link with the correct href', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const link = screen.getByRole('link', { name: /terms of service/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/legal/terms');
  });

  it('should render "Privacy Policy" as a link with the correct href', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const link = screen.getByRole('link', { name: /privacy policy/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/legal/privacy');
  });

  it('Terms of Service link calls stopPropagation — click does not bubble to the label', () => {
    // Verify the stopPropagation mechanism directly by spying on the method
    // via the React synthetic event system (fireEvent fires React handlers
    // synchronously in the capture/bubble chain, so we can check cancelBubble
    // after the fact).
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const link = screen.getByRole('link', { name: /terms of service/i });
    const stopPropSpy = vi.spyOn(Event.prototype, 'stopPropagation');

    fireEvent.click(link);

    expect(stopPropSpy).toHaveBeenCalled();

    stopPropSpy.mockRestore();
  });

  it('Privacy Policy link calls stopPropagation — click does not bubble to the label', () => {
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const link = screen.getByRole('link', { name: /privacy policy/i });
    const stopPropSpy = vi.spyOn(Event.prototype, 'stopPropagation');

    fireEvent.click(link);

    expect(stopPropSpy).toHaveBeenCalled();

    stopPropSpy.mockRestore();
  });

  it('clicking the checkbox itself still toggles the checkbox state', async () => {
    const user = userEvent.setup();
    renderWithRouter(<RegisterForm onSubmit={vi.fn()} />);

    const checkbox = screen.getByLabelText(/terms of service/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    // Click the checkbox itself (not the link)
    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });
});
