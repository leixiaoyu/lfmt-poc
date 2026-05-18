/**
 * Authentication Context
 *
 * Provides global authentication state and methods to the React app.
 * Manages user session, token refresh, and auth-related operations.
 *
 * Features:
 * - Automatic user session restoration from localStorage
 * - Global auth state accessible via useAuth hook
 * - Token refresh support
 *
 * Note (issue #277): the previous `error` / `clearError` state has been
 * removed (Option B). Forms route catch payloads through
 * `getApiErrorMessage` themselves and render their own local `submitError`.
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

/**
 * Authentication context state.
 *
 * Issue #277 (Option B — delete dead state): the prior `error` / `clearError`
 * fields were set on every login/register/refresh/logout failure but no
 * component ever read them. The three auth forms (LoginForm, RegisterForm,
 * ForgotPasswordForm) maintain their own local `submitError` state and render
 * that instead. Wiring through context (Option A) would create coupling for
 * no functional benefit, so we deleted the unused fields. Each form's
 * `onSubmit` catch block already runs the rejection through `getApiErrorMessage`
 * (issue #274/#279) — the curated copy reaches the UI without context state.
 */
interface AuthContextState {
  /** Current authenticated user (null if not authenticated) */
  user: UserProfile | null;

  /** Whether user is currently authenticated */
  isAuthenticated: boolean;

  /** Whether auth state is being loaded (initial mount) */
  isLoading: boolean;

  /** Login with email and password */
  login: (credentials: LoginRequest) => Promise<void>;

  /** Register new user */
  register: (data: RegisterRequest) => Promise<void>;

  /** Logout current user */
  logout: () => Promise<void>;

  /** Refresh access token */
  refreshToken: () => Promise<RefreshTokenResponse>;
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
        }
      } catch {
        // Token is invalid or expired, clear auth. Issue #277: previously
        // we set `error` on context; that state was never read by any UI,
        // so we no longer carry it forward. ProtectedRoute redirects on
        // `user === null`, which is the only signal the UI consumes.
        await authService.logout();
        if (!cancelled) {
          setUser(null);
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
   * Login user with email and password.
   *
   * Issue #277: callers (LoginForm via RegisterPage / LoginPage) `try { ... }
   * catch (err) { setSubmitError(getApiErrorMessage(err)) }` themselves. We
   * rethrow to preserve that contract — context no longer stores the error.
   */
  const login = useCallback(async (credentials: LoginRequest) => {
    const response = await authService.login(credentials);
    setUser(response.user);
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
    // Issue #277: errors propagate to the caller (RegisterForm) which routes
    // them through `getApiErrorMessage` for its local submitError state.
    await authService.register(data);
  }, []);

  /**
   * Logout current user.
   *
   * Issue #277: logout always clears client-side state. We swallow any
   * service-call rejection (auth tokens are already gone locally; surfacing
   * a server-side logout error to the UI was never wired anywhere).
   */
  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Logout should always succeed on client side — even if the server
      // call fails, clear local state.
    } finally {
      setUser(null);
    }
  }, []);

  /**
   * Refresh access token.
   *
   * Issue #277: on failure we clear tokens and rethrow. The caller (axios
   * interceptor in `utils/api.ts`) handles surfacing SESSION_EXPIRED prose
   * back through whatever request triggered the refresh — context never
   * carried that error to any reading component.
   */
  const refreshToken = useCallback(async () => {
    try {
      const response = await authService.refreshToken();
      return response;
    } catch (err) {
      // Logout user (clear tokens). We swallow logout failures because
      // the user has already been kicked out of the session.
      try {
        await authService.logout();
      } catch {
        // Local tokens already cleared by interceptor; swallow.
      }
      setUser(null);
      throw err;
    }
  }, []);

  /**
   * Memoize context value to prevent unnecessary re-renders
   */
  const value = useMemo<AuthContextState>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      login,
      register,
      logout,
      refreshToken,
    }),
    [user, isLoading, login, register, logout, refreshToken]
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
