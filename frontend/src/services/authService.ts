/**
 * Authentication Service
 *
 * Handles all authentication-related API operations:
 * - User registration
 * - User login
 * - Token refresh
 * - Logout
 * - Email verification
 * - Password reset
 *
 * Uses the centralized API client with automatic token injection.
 */

import {
  apiClient,
  clearAuthToken,
  getStoredRefreshToken,
  setStoredSession,
  updateStoredSession,
} from '../utils/api';
import type { StoredSession } from '@lfmt/shared-types';

/**
 * User data returned from authentication endpoints
 */
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified?: boolean;
  createdAt?: string;
}

/**
 * Authentication response structure
 *
 * Both `accessToken` and `idToken` come from Cognito via the backend login /
 * register handlers.  API Gateway CognitoUserPoolsAuthorizer validates the
 * **ID token** (it carries the user's identity claims).  The access token is
 * for OAuth2 resource servers and is NOT accepted by the authorizer.
 *
 * The `idToken` field may be absent in older mock responses; callers fall
 * back to `accessToken` in that case.
 */
export interface AuthResponse {
  user: User;
  accessToken: string;
  idToken?: string;
  refreshToken: string;
}

/**
 * Registration request payload
 */
export interface RegisterRequest {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
  organization?: string;
  acceptedTerms: boolean;
  acceptedPrivacy: boolean;
  marketingConsent?: boolean;
}

/**
 * Login request payload
 */
export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * Token refresh response
 *
 * Cognito REFRESH_TOKEN_AUTH returns a new AccessToken and IdToken but does
 * NOT return a new RefreshToken (the original refresh token remains valid
 * until its own expiry, which is 30 days by default).
 */
export interface RefreshTokenResponse {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
}

/**
 * Password reset request payload
 */
export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

/**
 * Generic message response
 */
export interface MessageResponse {
  message: string;
}

/**
 * Persist Cognito tokens and user data returned by login / register.
 *
 * Writes a single `StoredSession` blob (Issue #196). Eliminates the
 * "two-keys" drift hazard the OMC reviewer flagged AND removes the
 * `idToken ?? accessToken` runtime fallback (Issue #195) — every code
 * path that reads `idToken` now reads it from the canonical blob, and
 * the migration in `getStoredSession()` handles legacy sessions.
 *
 * Why we still write `accessToken` (mirrored from `idToken` if absent):
 *   - The `StoredSession` shape requires both fields so a malformed
 *     blob can be detected unambiguously by the migration.
 *   - Callers (e.g., a future OAuth2 resource server integration) can
 *     read `accessToken` directly via `getStoredSession()` without
 *     coordinating a second migration.
 *
 * The user-shape coercion is safe: the backend's `User` and
 * `UserProfile` are wire-compatible for the fields the SPA renders
 * (id/email/firstName/lastName); the additional `UserProfile` fields
 * (`mfaEnabled`, `preferences`, ...) are optional from the SPA's
 * perspective and surface lazily when the user updates their profile.
 */
function storeAuthTokens(tokens: {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  user?: User;
}): void {
  // ID token is what API Gateway CognitoUserPoolsAuthorizer validates.
  // The legacy `idToken ?? accessToken` fallback survives ONLY at this
  // ingest boundary, because mock harnesses (and pre-rollout backends)
  // can return responses without an idToken. New responses from the
  // current backend always include both tokens — this nullish
  // coalescing is the last remaining compat seam and can be deleted
  // once the mock fixtures all carry idToken.
  const idToken = tokens.idToken ?? tokens.accessToken;
  const session: StoredSession = {
    idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    // `user` on StoredSession is `unknown` — the SPA persists its
    // narrower `User` shape and reads it back through `getStoredUser`,
    // which returns `unknown` and forces callers to narrow.
    user: tokens.user,
  };
  setStoredSession(session);
}

/**
 * Register a new user
 *
 * @param data - Registration details (email, password, name)
 * @returns User data and authentication tokens
 * @throws ApiError if registration fails
 */
async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/register', data);
  storeAuthTokens(response.data);
  return response.data;
}

/**
 * Login existing user
 *
 * @param credentials - Email and password
 * @returns User data and authentication tokens
 * @throws ApiError if login fails
 */
async function login(credentials: LoginRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/login', credentials);
  storeAuthTokens(response.data);
  return response.data;
}

/**
 * Refresh access token using refresh token
 *
 * @returns New access and refresh tokens
 * @throws ApiError if refresh fails or no refresh token available
 */
async function refreshToken(): Promise<RefreshTokenResponse> {
  const refreshToken = getStoredRefreshToken();

  if (!refreshToken) {
    // Clear any stale auth data
    clearAuthToken();

    return Promise.reject({
      message: 'No refresh token available',
      status: 401,
    });
  }

  try {
    const response = await apiClient.post<RefreshTokenResponse>('/auth/refresh', {
      refreshToken,
    });

    // updateStoredSession is the partial-update sibling of
    // setStoredSession — it preserves the existing user profile when
    // the refresh response does not re-send it (Cognito doesn't).
    // We synthesize idToken with the same nullish-coalescing rule used
    // by storeAuthTokens above for the ingest boundary.
    const data = response.data;
    updateStoredSession({
      accessToken: data.accessToken,
      idToken: data.idToken ?? data.accessToken,
      // Cognito REFRESH_TOKEN_AUTH does not rotate the refresh token —
      // when absent, leave the existing value untouched (don't write
      // undefined; updateStoredSession would otherwise erase the
      // previous refresh token via spread semantics).
      ...(data.refreshToken ? { refreshToken: data.refreshToken } : {}),
    });

    return response.data;
  } catch (error) {
    // If refresh fails, clear all auth data
    clearAuthToken();
    throw error;
  }
}

/**
 * Logout current user
 *
 * Clears all authentication data from localStorage.
 * Note: This is a client-side logout. In production, you may want to
 * also invalidate the refresh token on the server.
 */
async function logout(): Promise<void> {
  clearAuthToken();
}

/**
 * Get current user profile
 *
 * @returns Current user data
 * @throws ApiError if not authenticated or request fails
 */
async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<{ user: User }>('/auth/me');
  return response.data.user;
}

/**
 * Verify email address with verification token
 *
 * @param token - Email verification token from email link
 * @returns Success message
 * @throws ApiError if verification fails
 */
async function verifyEmail(token: string): Promise<MessageResponse> {
  const response = await apiClient.post<MessageResponse>('/auth/verify-email', {
    token,
  });
  return response.data;
}

/**
 * Request password reset email
 *
 * @param email - User's email address
 * @returns Success message
 * @throws ApiError if request fails
 */
async function requestPasswordReset(email: string): Promise<MessageResponse> {
  const response = await apiClient.post<MessageResponse>('/auth/forgot-password', {
    email,
  });
  return response.data;
}

/**
 * Reset password with reset token
 *
 * @param data - Reset token and new password
 * @returns Success message
 * @throws ApiError if reset fails
 */
async function resetPassword(data: ResetPasswordRequest): Promise<MessageResponse> {
  const response = await apiClient.post<MessageResponse>('/auth/reset-password', data);
  return response.data;
}

/**
 * AuthService
 *
 * Exported object with all authentication methods
 */
export const authService = {
  register,
  login,
  refreshToken,
  logout,
  getCurrentUser,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
};
