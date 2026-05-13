/**
 * Authentication Context
 *
 * Provides global authentication state and methods to the React app.
 * Manages user session, token refresh, and auth-related operations.
 *
 * Features:
 * - Automatic user session restoration from localStorage
 * - Global auth state accessible via useAuth hook
 * - Centralized error handling
 * - Token refresh support
 *
 * Usage:
 * ```tsx
 * import { useAuth } from '@/contexts/AuthContext';
 *
 * function MyComponent() {
 *   const { user, isAuthenticated, login, logout } = useAuth();
 *   // ...
 * }
 * ```
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { authService } from '../services/authService';
import { getAuthToken } from '../utils/api';
import type { UserProfile } from '@lfmt/shared-types';
import type { LoginRequest, RegisterRequest, RefreshTokenResponse } from '../services/authService';
import type { ApiError } from '../utils/api';

/**
 * Authentication context state
 */
interface AuthContextState {
  /** Current authenticated user (null if not authenticated) */
  user: UserProfile | null;

  /** Whether user is currently authenticated */
  isAuthenticated: boolean;

  /** Whether auth state is being loaded (initial mount) */
  isLoading: boolean;

  /** Current error from auth operations */
  error: ApiError | null;

  /** Login with email and password */
  login: (credentials: LoginRequest) => Promise<void>;

  /** Register new user */
  register: (data: RegisterRequest) => Promise<void>;

  /** Logout current user */
  logout: () => Promise<void>;

  /** Refresh access token */
  refreshToken: () => Promise<RefreshTokenResponse>;

  /** Clear current error */
  clearError: () => void;
}

/**
 * Auth context - undefined by default to detect usage outside provider
 */
const AuthContext = createContext<AuthContextState | undefined>(undefined);

// Export for testing purposes
export { AuthContext };
export type { AuthContextState as AuthContextType };

/**
 * AuthProvider Props
 */
interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Authentication Provider Component
 *
 * Wraps the app to provide authentication context to all children.
 * Automatically loads user session on mount if token exists.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<UserProfile | null>(null);
  // Issue #228: initialise isLoading to `true` when a session token already
  // exists in localStorage, so ProtectedRoute sees a loading state on the
  // very first render (before the async /auth/me probe completes) rather
  // than `isLoading=false + user=null`, which caused an immediate redirect
  // to /login on hard-reload of any protected route.
  //
  // Option A chosen over Option B (synchronous localStorage read) because
  // the session might be stale/expired — we still want the /auth/me probe
  // to validate it before declaring the user authenticated. isLoading=true
  // is the correct signal: "we have a token, we are verifying it, hold on."
  const [isLoading, setIsLoading] = useState<boolean>(() => getAuthToken() !== null);
  const [error, setError] = useState<ApiError | null>(null);

  /**
   * Load user from localStorage on mount.
   *
   * #235: React 18 StrictMode mounts effects twice in development, so
   * this effect can fire concurrently. A `cancelled` flag prevents the
   * second mount from overwriting state that the first mount already
   * committed. The cleanup function sets `cancelled = true` so any
   * in-flight /auth/me response from an unmounted effect is discarded
   * rather than applied to the new mount's state.
   */
  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      const token = getAuthToken();

      // If no token, user is not authenticated; isLoading was initialised
      // false (no token path), so no state update needed.
      if (!token) {
        return;
      }

      // Token exists — isLoading was already set to true by the useState
      // initialiser above, so we skip the redundant setIsLoading(true) call.
      // We go straight to the /auth/me probe.

      try {
        const currentUser = await authService.getCurrentUser();
        if (!cancelled) {
          setUser(currentUser);
          setError(null);
        }
      } catch (err) {
        // Token is invalid or expired, clear auth
        await authService.logout();
        if (!cancelled) {
          setUser(null);
          setError(err as ApiError);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Login user with email and password
   */
  const login = useCallback(async (credentials: LoginRequest) => {
    try {
      setError(null);
      const response = await authService.login(credentials);
      setUser(response.user);
    } catch (err) {
      setError(err as ApiError);
      throw err;
    }
  }, []);

  /**
   * Register new user.
   *
   * Only creates the account (POST /auth/register). The real backend
   * returns 201 + { message } — no tokens. Setting the authenticated
   * user is the caller's responsibility via a subsequent login() call
   * (see RegisterPage and issue #222). This separation avoids silently
   * swallowing a missing-user shape that would leave isAuthenticated
   * stuck as false despite a successful API round-trip.
   */
  const register = useCallback(async (data: RegisterRequest) => {
    try {
      setError(null);
      await authService.register(data);
    } catch (err) {
      setError(err as ApiError);
      throw err;
    }
  }, []);

  /**
   * Logout current user
   */
  const logout = useCallback(async () => {
    try {
      setError(null);
      await authService.logout();
      setUser(null);
    } catch (err) {
      // Logout should always succeed on client side
      // Even if server call fails, clear local state
      setUser(null);
      setError(err as ApiError);
    }
  }, []);

  /**
   * Refresh access token
   */
  const refreshToken = useCallback(async () => {
    try {
      setError(null);
      const response = await authService.refreshToken();
      return response;
    } catch (err) {
      // If refresh fails, user needs to login again
      const refreshError = err as ApiError;

      // Logout user (clear tokens)
      await authService.logout();
      setUser(null);

      // Preserve the refresh error (don't let logout clear it)
      setError(refreshError);
      throw err;
    }
  }, []);

  /**
   * Clear current error
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Memoize context value to prevent unnecessary re-renders
   */
  const value = useMemo<AuthContextState>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      error,
      login,
      register,
      logout,
      refreshToken,
      clearError,
    }),
    [user, isLoading, error, login, register, logout, refreshToken, clearError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth Hook
 *
 * Access authentication context from any component.
 * Must be used within an AuthProvider.
 *
 * @throws Error if used outside AuthProvider
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { user, isAuthenticated, login, logout } = useAuth();
 *
 *   if (!isAuthenticated) {
 *     return <LoginForm onSubmit={login} />;
 *   }
 *
 *   return <div>Welcome, {user.firstName}!</div>;
 * }
 * ```
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextState {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
