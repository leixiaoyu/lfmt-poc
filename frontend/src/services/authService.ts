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

import { apiClient, setAuthToken, setAccessToken, clearAuthToken } from '../utils/api';
import { AUTH_CONFIG } from '../config/constants';

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
 * Centralises the "store ID token as Bearer" protocol so that the three
 * callers (register, login, refreshToken) cannot drift from each other.
 * Eliminates the copy-paste risk flagged in OMC review (Rec 4).
 *
 * Storage protocol:
 *   - `ID_TOKEN_KEY`      ← idToken ?? accessToken  (API Gateway Bearer)
 *   - `ACCESS_TOKEN_KEY`  ← accessToken             (OAuth2 resource servers)
 *   - `REFRESH_TOKEN_KEY` ← refreshToken (only when present — Cognito
 *     REFRESH_TOKEN_AUTH does not rotate the refresh token)
 *   - `USER_DATA_KEY`     ← user (only when present — refresh responses
 *     do not re-send the user object)
 */
function storeAuthTokens(tokens: {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  user?: User;
}): void {
  // ID token is what API Gateway CognitoUserPoolsAuthorizer validates.
  // `??` (nullish coalescing) is intentional: only fall through to
  // accessToken when idToken is null/undefined, not when it is empty.
  setAuthToken(tokens.idToken ?? tokens.accessToken);
  setAccessToken(tokens.accessToken);

  if (tokens.refreshToken) {
    localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, tokens.refreshToken);
  }
  if (tokens.user) {
    localStorage.setItem(AUTH_CONFIG.USER_DATA_KEY, JSON.stringify(tokens.user));
  }
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
  const refreshToken = localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY);

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

    // storeAuthTokens handles ID-token preference, access-token storage,
    // and conditional refresh-token update (all in one place — Rec 4).
    storeAuthTokens(response.data);

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
