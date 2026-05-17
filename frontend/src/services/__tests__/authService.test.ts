/**
 * AuthService Tests
 *
 * Following TDD approach - tests written BEFORE implementation.
 * Tests cover all authentication operations:
 * - User registration
 * - User login
 * - Token refresh
 * - Logout
 * - Error handling
 *
 * Storage model: Issue #196 collapsed the per-token localStorage keys
 * into a single `StoredSession` blob. Assertions read the blob through
 * the canonical `getStoredSession` helper rather than poking at raw
 * localStorage keys, so the test layer survives any future change to
 * the blob's internal shape.
 *
 * Mock policy: only `apiClient` is mocked here — the storage helpers
 * run for real against jsdom's `localStorage`. This means a single
 * end-to-end assertion (read the blob, check the fields) replaces the
 * old "spy on every setter" pattern, and the tests would catch a real
 * regression in the helpers themselves rather than just contract drift.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authService } from '../authService';
import { apiClient, getStoredSession, setStoredSession } from '../../utils/api';
import type { UserProfile } from '@lfmt/shared-types';
import type { AxiosResponse } from 'axios';

// Mock ONLY the apiClient — storage helpers run against real jsdom
// localStorage so the test exercises the same code paths the SPA uses.
vi.mock('../../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../utils/api')>('../../utils/api');
  return {
    ...actual,
    apiClient: {
      post: vi.fn(),
      get: vi.fn(),
    },
  };
});

describe('AuthService - Registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should register new user successfully and NOT store tokens (issue #222)', async () => {
    // The real backend (register.ts) returns HTTP 201 + { message } only —
    // no user object, no tokens. authService.register() must NOT call
    // storeAuthTokens; doing so would write empty/undefined fields into the
    // session blob and corrupt any existing session.
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        message: 'User registered successfully. You can now log in.',
      },
      status: 201,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    const result = await authService.register({
      email: 'test@example.com',
      password: 'SecurePass123!',
      confirmPassword: 'SecurePass123!',
      firstName: 'John',
      lastName: 'Doe',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });

    // Verify API call - includes all fields from RegisterRequest
    expect(apiClient.post).toHaveBeenCalledWith('/auth/register', {
      email: 'test@example.com',
      password: 'SecurePass123!',
      confirmPassword: 'SecurePass123!',
      firstName: 'John',
      lastName: 'Doe',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });

    // Confirm the server message is returned to the caller.
    expect(result.message).toBe('User registered successfully. You can now log in.');

    // The session blob must be untouched — registration does not log the user in.
    // The caller (RegisterPage → AuthContext.login) is responsible for that step.
    const session = getStoredSession();
    expect(session).toBeNull();
  });

  it('should not write tokens to localStorage on registration (regression guard)', async () => {
    // Explicit guard: even if the mock accidentally returns token-shaped data,
    // authService.register() must never call storeAuthTokens. This test will
    // fail if someone re-introduces the storeAuthTokens call in register().
    const mockResponse: Partial<AxiosResponse> = {
      data: { message: 'User registered successfully. You can now log in.' },
      status: 201,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    await authService.register({
      email: 'test@example.com',
      password: 'SecurePass123!',
      confirmPassword: 'SecurePass123!',
      firstName: 'John',
      lastName: 'Doe',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });

    expect(localStorage.getItem('lfmt_session')).toBeNull();
  });

  it('should handle registration errors', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      message: 'Email already exists',
      status: 400,
    });

    await expect(
      authService.register({
        email: 'existing@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        acceptedTerms: true,
        acceptedPrivacy: true,
      })
    ).rejects.toEqual({
      message: 'Email already exists',
      status: 400,
    });

    // Verify no session is created on error
    expect(getStoredSession()).toBeNull();
  });
});

describe('AuthService - Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should login user successfully', async () => {
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        user: {
          userId: 'user-456',
          email: 'login@example.com',
          firstName: 'Jane',
          lastName: 'Smith',
        },
        accessToken: 'login-access-token',
        refreshToken: 'login-refresh-token',
      },
      status: 200,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    const result = await authService.login({
      email: 'login@example.com',
      password: 'MyPassword123!',
    });

    // Verify API call
    expect(apiClient.post).toHaveBeenCalledWith('/auth/login', {
      email: 'login@example.com',
      password: 'MyPassword123!',
    });

    // Without an idToken in the mock response, storeAuthTokens falls back to
    // the accessToken so existing behaviour is preserved.
    const session = getStoredSession();
    expect(session).toEqual({
      idToken: 'login-access-token',
      accessToken: 'login-access-token',
      refreshToken: 'login-refresh-token',
      user: {
        userId: 'user-456',
        email: 'login@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
      },
    });

    // Verify user data is returned
    expect(result.user.email).toBe('login@example.com');
    expect(result.accessToken).toBe('login-access-token');
  });

  it('should use idToken as Bearer credential when present in login response', async () => {
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        user: {
          userId: 'user-456',
          email: 'login@example.com',
          firstName: 'Jane',
          lastName: 'Smith',
        },
        accessToken: 'login-access-token',
        idToken: 'login-id-token',
        refreshToken: 'login-refresh-token',
      },
      status: 200,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    await authService.login({ email: 'login@example.com', password: 'MyPassword123!' });

    // API Gateway CognitoUserPoolsAuthorizer requires the ID token.
    const session = getStoredSession();
    expect(session?.idToken).toBe('login-id-token');
    expect(session?.accessToken).toBe('login-access-token');
  });

  it('should handle invalid credentials', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      message: 'Invalid email or password',
      status: 401,
    });

    await expect(
      authService.login({
        email: 'wrong@example.com',
        password: 'WrongPass',
      })
    ).rejects.toEqual({
      message: 'Invalid email or password',
      status: 401,
    });

    expect(getStoredSession()).toBeNull();
  });

  it('should handle network errors during login', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      message: 'Network error. Please check your connection and try again.',
    });

    await expect(
      authService.login({
        email: 'test@example.com',
        password: 'Password123!',
      })
    ).rejects.toEqual({
      message: 'Network error. Please check your connection and try again.',
    });
  });
});

describe('AuthService - Token Refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should refresh access token successfully (mock without idToken)', async () => {
    // Set up an existing session with a refresh token. authService reads
    // the refresh token via the canonical helper, which sees this blob.
    setStoredSession({
      idToken: 'old-id',
      accessToken: 'old-access',
      refreshToken: 'old-refresh-token',
    });

    const mockResponse: Partial<AxiosResponse> = {
      data: {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      },
      status: 200,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    const result = await authService.refreshToken();

    // Verify API call with refresh token
    expect(apiClient.post).toHaveBeenCalledWith('/auth/refresh', {
      refreshToken: 'old-refresh-token',
    });

    // Without idToken in the mock, the ingest seam falls back to accessToken.
    // The blob is updated atomically; refreshToken is rotated.
    const session = getStoredSession();
    expect(session?.idToken).toBe('new-access-token');
    expect(session?.accessToken).toBe('new-access-token');
    expect(session?.refreshToken).toBe('new-refresh-token');

    // Verify new access token is returned
    expect(result.accessToken).toBe('new-access-token');
  });

  it('should use idToken as Bearer credential when present in refresh response', async () => {
    setStoredSession({
      idToken: 'old-id',
      accessToken: 'old-access',
      refreshToken: 'old-refresh-token',
    });

    const mockResponse: Partial<AxiosResponse> = {
      data: {
        accessToken: 'new-access-token',
        idToken: 'new-id-token',
        // Cognito REFRESH_TOKEN_AUTH does not rotate the refresh token — omitted.
      },
      status: 200,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    await authService.refreshToken();

    // ID token is the correct Bearer credential for API Gateway.
    // The original refresh token MUST survive because the response
    // omitted refreshToken (Cognito REFRESH_TOKEN_AUTH behaviour).
    const session = getStoredSession();
    expect(session?.idToken).toBe('new-id-token');
    expect(session?.accessToken).toBe('new-access-token');
    expect(session?.refreshToken).toBe('old-refresh-token');
  });

  it('should handle missing refresh token', async () => {
    // No session at all → no refresh token to send.
    await expect(authService.refreshToken()).rejects.toEqual({
      message: 'No refresh token available',
      status: 401,
    });

    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('should handle expired refresh token', async () => {
    setStoredSession({
      idToken: 'expired-id',
      accessToken: 'expired-access',
      refreshToken: 'expired-token',
    });

    vi.mocked(apiClient.post).mockRejectedValueOnce({
      message: 'Your session has expired. Please log in again.',
      status: 401,
    });

    await expect(authService.refreshToken()).rejects.toEqual({
      message: 'Your session has expired. Please log in again.',
      status: 401,
    });

    // Should clear the session on expired refresh token.
    expect(getStoredSession()).toBeNull();
  });
});

describe('AuthService - Logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should logout user and clear all tokens', async () => {
    // Set up tokens via the canonical helper.
    setStoredSession({
      idToken: 'id',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      // Minimal object — only tests that clearAuthToken removes the blob.
      user: { userId: 'user-123' } as UserProfile,
    });

    await authService.logout();

    // Verify the session was cleared.
    expect(getStoredSession()).toBeNull();
  });

  it('should logout even if no tokens exist', async () => {
    // No tokens in localStorage. clearAuthToken is idempotent — should
    // not throw.
    await expect(authService.logout()).resolves.toBeUndefined();
    expect(getStoredSession()).toBeNull();
  });
});

describe('AuthService - Get Current User', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should fetch current user profile', async () => {
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        user: {
          userId: 'user-789',
          email: 'current@example.com',
          firstName: 'Current',
          lastName: 'User',
        },
      },
      status: 200,
    };

    vi.mocked(apiClient.get).mockResolvedValueOnce(mockResponse);

    const result = await authService.getCurrentUser();

    // Verify API call
    expect(apiClient.get).toHaveBeenCalledWith('/auth/me');

    // Verify user data is returned
    expect(result).toEqual({
      userId: 'user-789',
      email: 'current@example.com',
      firstName: 'Current',
      lastName: 'User',
    });
  });

  it('should handle unauthorized access', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce({
      message: 'Your session has expired. Please log in again.',
      status: 401,
    });

    await expect(authService.getCurrentUser()).rejects.toEqual({
      message: 'Your session has expired. Please log in again.',
      status: 401,
    });
  });
});

describe('AuthService - Email Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should verify email with valid token', async () => {
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        message: 'Email verified successfully',
      },
      status: 200,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    const result = await authService.verifyEmail('valid-verification-token');

    // Verify API call
    expect(apiClient.post).toHaveBeenCalledWith('/auth/verify-email', {
      token: 'valid-verification-token',
    });

    expect(result.message).toBe('Email verified successfully');
  });

  it('should handle invalid verification token', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      message: 'Invalid or expired verification token',
      status: 400,
    });

    await expect(authService.verifyEmail('invalid-token')).rejects.toEqual({
      message: 'Invalid or expired verification token',
      status: 400,
    });
  });
});

describe('AuthService - Password Reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should request password reset', async () => {
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        message: 'Password reset instructions sent to your email.',
      },
      status: 200,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    const result = await authService.requestPasswordReset('forgot@example.com');

    // Verify API call
    expect(apiClient.post).toHaveBeenCalledWith('/auth/forgot-password', {
      email: 'forgot@example.com',
    });

    expect(result.message).toBe('Password reset instructions sent to your email.');
  });

  it('should reset password with valid token', async () => {
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        message: 'Password reset successfully',
      },
      status: 200,
    };

    vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

    const result = await authService.resetPassword({
      token: 'reset-token-123',
      newPassword: 'NewSecurePass123!',
    });

    // Verify API call
    expect(apiClient.post).toHaveBeenCalledWith('/auth/reset-password', {
      token: 'reset-token-123',
      newPassword: 'NewSecurePass123!',
    });

    expect(result.message).toBe('Password reset successfully');
  });

  it('should handle expired reset token', async () => {
    vi.mocked(apiClient.post).mockRejectedValueOnce({
      message: 'Password reset token has expired',
      status: 400,
    });

    await expect(
      authService.resetPassword({
        token: 'expired-token',
        newPassword: 'NewPass123!',
      })
    ).rejects.toEqual({
      message: 'Password reset token has expired',
      status: 400,
    });
  });
});
