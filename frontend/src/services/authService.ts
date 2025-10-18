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

import { apiClient, setAuthToken, clearAuthToken } from '../utils/api';
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
 */
export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

/**
 * Registration request payload
 */
export interface RegisterRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
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
 */
export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
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
 * Register a new user
 *
 * @param data - Registration details (email, password, name)
 * @returns User data and authentication tokens
 * @throws ApiError if registration fails
 */
async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/register', data);

  // Store access token
  setAuthToken(response.data.accessToken);

  // Store refresh token
  localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, response.data.refreshToken);

  // Store user data
  localStorage.setItem(AUTH_CONFIG.USER_DATA_KEY, JSON.stringify(response.data.user));

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

  // Store access token
  setAuthToken(response.data.accessToken);

  // Store refresh token
  localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, response.data.refreshToken);

  // Store user data
  localStorage.setItem(AUTH_CONFIG.USER_DATA_KEY, JSON.stringify(response.data.user));

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

    // Store new access token
    setAuthToken(response.data.accessToken);

    // Store new refresh token
    localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, response.data.refreshToken);

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
