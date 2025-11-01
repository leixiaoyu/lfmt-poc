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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { authService } from '../authService';
import { apiClient, setAuthToken, clearAuthToken } from '../../utils/api';
import type { AxiosResponse } from 'axios';

// Mock the API client
vi.mock('../../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../../utils/api')>('../../utils/api');
  return {
    ...actual,
    apiClient: {
      post: vi.fn(),
      get: vi.fn(),
    },
    setAuthToken: vi.fn(),
    clearAuthToken: vi.fn(),
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

  it('should register new user successfully', async () => {
    const mockResponse: Partial<AxiosResponse> = {
      data: {
        user: {
          id: 'user-123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
        },
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
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

    // Verify API call
    expect(apiClient.post).toHaveBeenCalledWith('/auth/register', {
      email: 'test@example.com',
      password: 'SecurePass123!',
      firstName: 'John',
      lastName: 'Doe',
    });

    // Verify tokens are stored
    expect(setAuthToken).toHaveBeenCalledWith('mock-access-token');

    // Verify user data is returned
    expect(result.user).toEqual({
      id: 'user-123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
    });

    expect(result.accessToken).toBe('mock-access-token');
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

    // Verify no tokens are stored on error
    expect(setAuthToken).not.toHaveBeenCalled();
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
          id: 'user-456',
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

    // Verify tokens are stored
    expect(setAuthToken).toHaveBeenCalledWith('login-access-token');

    // Verify user data is returned
    expect(result.user.email).toBe('login@example.com');
    expect(result.accessToken).toBe('login-access-token');
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

    expect(setAuthToken).not.toHaveBeenCalled();
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

  it('should refresh access token successfully', async () => {
    // Set up initial refresh token
    localStorage.setItem('lfmt_refresh_token', 'old-refresh-token');

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

    // Verify new tokens are stored
    expect(setAuthToken).toHaveBeenCalledWith('new-access-token');

    // Verify new access token is returned
    expect(result.accessToken).toBe('new-access-token');
  });

  it('should handle missing refresh token', async () => {
    // No refresh token in localStorage
    await expect(authService.refreshToken()).rejects.toEqual({
      message: 'No refresh token available',
      status: 401,
    });

    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('should handle expired refresh token', async () => {
    localStorage.setItem('lfmt_refresh_token', 'expired-token');

    vi.mocked(apiClient.post).mockRejectedValueOnce({
      message: 'Your session has expired. Please log in again.',
      status: 401,
    });

    await expect(authService.refreshToken()).rejects.toEqual({
      message: 'Your session has expired. Please log in again.',
      status: 401,
    });

    // Should clear tokens on expired refresh token
    expect(clearAuthToken).toHaveBeenCalled();
  });
});

describe('AuthService - Logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should logout user and clear all tokens', async () => {
    // Set up tokens
    localStorage.setItem('lfmt_access_token', 'test-access-token');
    localStorage.setItem('lfmt_refresh_token', 'test-refresh-token');
    localStorage.setItem('lfmt_user', JSON.stringify({ id: 'user-123' }));

    await authService.logout();

    // Verify all tokens are cleared
    expect(clearAuthToken).toHaveBeenCalled();
  });

  it('should logout even if no tokens exist', async () => {
    // No tokens in localStorage
    await authService.logout();

    // Should still call clearAuthToken (idempotent operation)
    expect(clearAuthToken).toHaveBeenCalled();
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
          id: 'user-789',
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
      id: 'user-789',
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
