/**
 * AuthContext Tests
 *
 * Following TDD approach - tests written BEFORE implementation.
 * Tests cover:
 * - AuthContext provider initialization
 * - useAuth hook functionality
 * - Authentication state management
 * - Login/logout/register flows
 * - Token refresh handling
 * - Error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { authService } from '../../services/authService';
import type { ReactNode } from 'react';

// Mock the auth service
vi.mock('../../services/authService', () => ({
  authService: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    getCurrentUser: vi.fn(),
    refreshToken: vi.fn(),
    verifyEmail: vi.fn(),
    requestPasswordReset: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

// Helper to create wrapper with AuthProvider
function createWrapper() {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>;
  };
}

describe('AuthContext - Initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should provide auth context to children', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    expect(result.current).toBeDefined();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('should throw error when useAuth is used outside AuthProvider', () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAuth());
    }).toThrow('useAuth must be used within an AuthProvider');

    consoleSpy.mockRestore();
  });

  it('should initialize with loading state when user is in localStorage', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    // Set up localStorage with user data
    localStorage.setItem('lfmt_access_token', 'existing-token');
    localStorage.setItem('lfmt_user', JSON.stringify(mockUser));

    vi.mocked(authService.getCurrentUser).mockResolvedValueOnce(mockUser);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Should start with loading state
    expect(result.current.isLoading).toBe(true);

    // Wait for user to load
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });
});

describe('AuthContext - Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should login user successfully', async () => {
    const mockAuthResponse = {
      user: {
        id: 'user-456',
        email: 'login@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
      },
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-123',
    };

    vi.mocked(authService.login).mockResolvedValueOnce(mockAuthResponse);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Perform login
    await act(async () => {
      await result.current.login({
        email: 'login@example.com',
        password: 'Password123!',
      });
    });

    // Verify user is logged in
    expect(result.current.user).toEqual(mockAuthResponse.user);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should handle login errors', async () => {
    const loginError = {
      message: 'Invalid email or password',
      status: 401,
    };

    vi.mocked(authService.login).mockRejectedValueOnce(loginError);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Attempt login
    await act(async () => {
      try {
        await result.current.login({
          email: 'wrong@example.com',
          password: 'WrongPass',
        });
      } catch (error) {
        // Expected to throw
      }
    });

    // Verify user is NOT logged in
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toEqual(loginError);
  });

  it('should clear previous errors on successful login', async () => {
    const loginError = {
      message: 'Invalid credentials',
      status: 401,
    };

    const mockAuthResponse = {
      user: {
        id: 'user-789',
        email: 'success@example.com',
        firstName: 'Success',
        lastName: 'User',
      },
      accessToken: 'token',
      refreshToken: 'refresh',
    };

    vi.mocked(authService.login)
      .mockRejectedValueOnce(loginError)
      .mockResolvedValueOnce(mockAuthResponse);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // First login fails
    await act(async () => {
      try {
        await result.current.login({
          email: 'test@example.com',
          password: 'wrong',
        });
      } catch (error) {
        // Expected
      }
    });

    expect(result.current.error).toEqual(loginError);

    // Second login succeeds
    await act(async () => {
      await result.current.login({
        email: 'test@example.com',
        password: 'correct',
      });
    });

    expect(result.current.user).toEqual(mockAuthResponse.user);
    expect(result.current.error).toBeNull();
  });
});

describe('AuthContext - Register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should register new user successfully', async () => {
    const mockAuthResponse = {
      user: {
        id: 'new-user-123',
        email: 'newuser@example.com',
        firstName: 'New',
        lastName: 'User',
      },
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    };

    vi.mocked(authService.register).mockResolvedValueOnce(mockAuthResponse);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Perform registration
    await act(async () => {
      await result.current.register({
        email: 'newuser@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!',
        firstName: 'New',
        lastName: 'User',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
    });

    // Verify user is registered and logged in
    expect(result.current.user).toEqual(mockAuthResponse.user);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('should handle registration errors', async () => {
    const registrationError = {
      message: 'Email already exists',
      status: 400,
    };

    vi.mocked(authService.register).mockRejectedValueOnce(registrationError);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Attempt registration
    await act(async () => {
      try {
        await result.current.register({
          email: 'existing@example.com',
          password: 'Password123!',
          confirmPassword: 'Password123!',
          firstName: 'Test',
          lastName: 'User',
          acceptedTerms: true,
          acceptedPrivacy: true,
        });
      } catch (error) {
        // Expected
      }
    });

    // Verify user is NOT registered
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toEqual(registrationError);
  });
});

describe('AuthContext - Logout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should logout user and clear state', async () => {
    const mockAuthResponse = {
      user: {
        id: 'user-123',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
      },
      accessToken: 'token',
      refreshToken: 'refresh',
    };

    vi.mocked(authService.login).mockResolvedValueOnce(mockAuthResponse);
    vi.mocked(authService.logout).mockResolvedValueOnce();

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Login first
    await act(async () => {
      await result.current.login({
        email: 'test@example.com',
        password: 'Password123!',
      });
    });

    expect(result.current.isAuthenticated).toBe(true);

    // Logout
    await act(async () => {
      await result.current.logout();
    });

    // Verify user is logged out
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('should handle logout when not authenticated', async () => {
    vi.mocked(authService.logout).mockResolvedValueOnce();

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Logout without being logged in
    await act(async () => {
      await result.current.logout();
    });

    // Should still be in logged out state
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});

describe('AuthContext - Token Refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should refresh tokens successfully', async () => {
    const mockRefreshResponse = {
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    };

    vi.mocked(authService.refreshToken).mockResolvedValueOnce(mockRefreshResponse);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Perform token refresh
    let refreshResult;
    await act(async () => {
      refreshResult = await result.current.refreshToken();
    });

    expect(refreshResult).toEqual(mockRefreshResponse);
    expect(result.current.error).toBeNull();
  });

  it('should handle refresh token failure and logout user', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
    };

    const mockAuthResponse = {
      user: mockUser,
      accessToken: 'token',
      refreshToken: 'refresh',
    };

    const refreshError = {
      message: 'Your session has expired. Please log in again.',
      status: 401,
    };

    vi.mocked(authService.login).mockResolvedValueOnce(mockAuthResponse);
    vi.mocked(authService.refreshToken).mockRejectedValueOnce(refreshError);
    vi.mocked(authService.logout).mockResolvedValueOnce();

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Login first
    await act(async () => {
      await result.current.login({
        email: 'test@example.com',
        password: 'Password123!',
      });
    });

    expect(result.current.isAuthenticated).toBe(true);

    // Attempt token refresh
    await act(async () => {
      try {
        await result.current.refreshToken();
      } catch (error) {
        // Expected to fail
      }
    });

    // Should be logged out after failed refresh
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toEqual(refreshError);
  });
});

describe('AuthContext - Error Clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should clear errors manually', async () => {
    const loginError = {
      message: 'Invalid credentials',
      status: 401,
    };

    vi.mocked(authService.login).mockRejectedValueOnce(loginError);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Login fails
    await act(async () => {
      try {
        await result.current.login({
          email: 'test@example.com',
          password: 'wrong',
        });
      } catch (error) {
        // Expected
      }
    });

    expect(result.current.error).toEqual(loginError);

    // Clear error
    act(() => {
      result.current.clearError();
    });

    expect(result.current.error).toBeNull();
  });
});

describe('AuthContext - Initial User Load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should load user from localStorage on mount', async () => {
    const mockUser = {
      id: 'stored-user',
      email: 'stored@example.com',
      firstName: 'Stored',
      lastName: 'User',
    };

    localStorage.setItem('lfmt_access_token', 'stored-token');
    localStorage.setItem('lfmt_user', JSON.stringify(mockUser));

    vi.mocked(authService.getCurrentUser).mockResolvedValueOnce(mockUser);

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Should start loading
    expect(result.current.isLoading).toBe(true);

    // Wait for load to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.user).toEqual(mockUser);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should handle failed user load and clear auth', async () => {
    localStorage.setItem('lfmt_access_token', 'invalid-token');

    const loadError = {
      message: 'Your session has expired. Please log in again.',
      status: 401,
    };

    vi.mocked(authService.getCurrentUser).mockRejectedValueOnce(loadError);
    vi.mocked(authService.logout).mockResolvedValueOnce();

    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    // Wait for load to complete
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should be logged out
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('should not load user when no token exists', () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(authService.getCurrentUser).not.toHaveBeenCalled();
  });
});
