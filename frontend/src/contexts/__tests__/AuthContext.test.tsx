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
import { StrictMode } from 'react';
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

    // Set up the one-blob session (Issue #196).
    localStorage.setItem(
      'lfmt_session',
      JSON.stringify({
        idToken: 'existing-token',
        accessToken: 'existing-token',
        user: mockUser,
      })
    );

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

  it('should register new user successfully without setting auth state (issue #222)', async () => {
    // The real backend returns 201 + { message } — no tokens, no user.
    // AuthContext.register() only creates the account; the caller (RegisterPage)
    // is responsible for calling login() separately to set the authenticated user.
    const mockRegisterResponse = {
      message: 'User registered successfully. You can now log in.',
    };

    vi.mocked(authService.register).mockResolvedValueOnce(mockRegisterResponse);

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

    // register() does NOT set the authenticated user — that is login()'s job.
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toBeNull();
    expect(authService.register).toHaveBeenCalledOnce();
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

    localStorage.setItem(
      'lfmt_session',
      JSON.stringify({
        idToken: 'stored-token',
        accessToken: 'stored-token',
        user: mockUser,
      })
    );

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
    localStorage.setItem(
      'lfmt_session',
      JSON.stringify({ idToken: 'invalid-token', accessToken: 'invalid-token' })
    );

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

  // -------------------------------------------------------------------------
  // #235 regression: React 18 StrictMode double-mount guard
  //
  // StrictMode mounts → unmounts → re-mounts effects in development. Without
  // the `cancelled` flag the second mount's /auth/me response (which arrives
  // after the first mount's cleanup already ran) would still call setState on
  // the original component tree, causing a double setState that could leave
  // the app in a half-authenticated state or trigger act() warnings.
  //
  // This test simulates the double-mount by calling renderHook twice in rapid
  // succession with the same localStorage session and verifies that even after
  // both mounts settle the user ends up authenticated exactly once (no double
  // setState corruption).
  // -------------------------------------------------------------------------
  it('#235 StrictMode double-mount: stale getCurrentUser resolution does NOT overwrite the live mount state', async () => {
    // OMC R2-RERUN F-2 fix (Option B): the first rewrite mounted two
    // INDEPENDENT React trees via two `renderHook` calls. Because each tree
    // has its own state setter, the stale promise resolving in tree-1's
    // closure could never have observably corrupted tree-2's state — the
    // guard's removal was not falsifiable.
    //
    // This rewrite wraps a SINGLE `renderHook` in `<React.StrictMode>`. In
    // React 18 dev mode, StrictMode mounts → cleans up → re-mounts the
    // component in the SAME parent tree, sharing the same state setter
    // across the cycle. Mount-1's effect captures a `cancelled` flag in its
    // closure. Cleanup sets that flag to `true` (this is the guard). Mount-2
    // captures a NEW `cancelled` flag (false). Both effects fire their
    // `getCurrentUser` call.
    //
    // Critical observation: in StrictMode, the SAME `setUser` state setter
    // is used by both mounts. If Mount-1's stale promise resolves AFTER
    // Mount-2 has already setState'd the fresh user, Mount-1's `setUser`
    // call (if not gated by `!cancelled`) WOULD observably overwrite the
    // fresh-user state with the stale user. The cancellation guard prevents
    // that overwrite. Removing the guard from `AuthContext.tsx` makes this
    // test fail with `result.current.user === staleUser`.
    const staleUser = {
      id: 'user-stale',
      email: 'stale@example.com',
      firstName: 'Stale',
      lastName: 'Mount',
    };
    const freshUser = {
      id: 'user-fresh',
      email: 'fresh@example.com',
      firstName: 'Fresh',
      lastName: 'Mount',
    };

    localStorage.setItem(
      'lfmt_session',
      JSON.stringify({
        idToken: 'strict-token',
        accessToken: 'strict-token',
        user: staleUser,
      })
    );

    // Mount-1's promise: held open so we control when it resolves. Must
    // resolve AFTER Mount-2 has settled, so we can verify the guard skips
    // Mount-1's setState rather than allowing it to overwrite the live state.
    let resolveStale: (u: typeof staleUser) => void = () => {};
    const stalePromise = new Promise<typeof staleUser>((resolve) => {
      resolveStale = resolve;
    });

    vi.mocked(authService.getCurrentUser)
      // StrictMode calls the effect twice on initial render. First call
      // (Mount-1) gets the held promise; second call (Mount-2 after the
      // synthetic cleanup-remount) resolves immediately with the fresh user.
      .mockReturnValueOnce(stalePromise as unknown as Promise<typeof staleUser>)
      .mockResolvedValueOnce(freshUser);

    // Wrap AuthProvider inside React.StrictMode so the double-mount fires
    // on a SINGLE shared state setter — this is what makes the guard
    // observably falsifiable.
    const StrictWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <AuthProvider>{children}</AuthProvider>
      </StrictMode>
    );

    const { result } = renderHook(() => useAuth(), { wrapper: StrictWrapper });

    // Wait for Mount-2 to settle (fresh user committed to state). At this
    // point Mount-1's promise is still pending; cleanup has already set its
    // `cancelled = true`.
    await waitFor(() => {
      expect(result.current.user).toEqual(freshUser);
    });

    // Now resolve Mount-1's stale promise. The setState inside that closure
    // must be skipped because the closure's `cancelled` is now `true`.
    await act(async () => {
      resolveStale(staleUser);
      // Yield so the resolution's microtask + any subsequent setState runs.
      await Promise.resolve();
    });

    // CRITICAL ASSERTION (this is what falsifies guard removal):
    //   state must still be the freshUser, NOT corrupted by the stale
    //   resolution. Without the `if (!cancelled)` guard, the stale
    //   promise's `setUser(staleUser)` would run on the SAME setter that
    //   committed `freshUser` and overwrite it.
    expect(result.current.user).toEqual(freshUser);
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.error).toBeNull();

    // Behavioural assertion: StrictMode actually fired the effect twice
    // (proving we exercised the double-mount path, not the no-op no-token
    // path).
    expect(vi.mocked(authService.getCurrentUser)).toHaveBeenCalledTimes(2);
  });
});
