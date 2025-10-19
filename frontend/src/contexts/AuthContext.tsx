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
import type {
  User,
  LoginRequest,
  RegisterRequest,
  RefreshTokenResponse,
} from '../services/authService';
import type { ApiError } from '../utils/api';

/**
 * Authentication context state
 */
interface AuthContextState {
  /** Current authenticated user (null if not authenticated) */
  user: User | null;

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
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<ApiError | null>(null);

  /**
   * Load user from localStorage on mount
   * This restores the user session if a valid token exists
   */
  useEffect(() => {
    async function loadUser() {
      const token = getAuthToken();

      // If no token, user is not authenticated
      if (!token) {
        return;
      }

      // If token exists, try to load user profile
      setIsLoading(true);

      try {
        const currentUser = await authService.getCurrentUser();
        setUser(currentUser);
        setError(null);
      } catch (err) {
        // Token is invalid or expired, clear auth
        await authService.logout();
        setUser(null);
        setError(err as ApiError);
      } finally {
        setIsLoading(false);
      }
    }

    loadUser();
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
   * Register new user
   */
  const register = useCallback(async (data: RegisterRequest) => {
    try {
      setError(null);
      const response = await authService.register(data);
      setUser(response.user);
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
export function useAuth(): AuthContextState {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
