// Authentication Types - From Document 10 (User Management & Authentication)
import { z } from 'zod';

// User Profile
export interface UserProfile {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  createdAt: string;
  lastLoginAt?: string;
  isEmailVerified: boolean;
  mfaEnabled: boolean;
  role: UserRole;
  preferences: UserPreferences;
}

export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';

export interface UserPreferences {
  language: string;
  timezone: string;
  emailNotifications: boolean;
  theme: 'light' | 'dark';
}

// Authentication Requests/Responses
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

export interface RegisterResponse {
  userId: string;
  message: string;
  verificationRequired: boolean;
  verificationExpiresAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe?: boolean;
  mfaCode?: string;
}

export interface LoginResponse {
  accessToken: string;
  /**
   * Cognito ID token.
   *
   * API Gateway CognitoUserPoolsAuthorizer validates the **ID token**,
   * not the access token. Access tokens are for OAuth2 resource servers.
   * Clients MUST use this field as the `Authorization: Bearer` credential
   * for all protected API calls. See backend PR #76 for full context.
   */
  idToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserProfile;
  requiresMfa: boolean;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface RefreshTokenResponse {
  accessToken: string;
  /**
   * Cognito ID token returned by REFRESH_TOKEN_AUTH flow.
   *
   * Cognito does NOT issue a new refresh token on refresh — the original
   * remains valid until its own expiry (30 days by default). Clients
   * MUST use this field as the `Authorization: Bearer` credential on
   * subsequent requests, replacing the previous ID token.
   */
  idToken: string;
  /**
   * Cognito does not rotate the refresh token on REFRESH_TOKEN_AUTH.
   * This field is absent in the actual Cognito response; it may be
   * present in mock environments that simulate token rotation.
   */
  refreshToken?: string;
  expiresIn?: number;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  email: string;
  newPassword: string;
  confirmPassword: string;
}

// Validation Schemas
export const registerRequestSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    organization: z.string().optional(),
    acceptedTerms: z.boolean().refine((val) => val === true),
    acceptedPrivacy: z.boolean().refine((val) => val === true),
    marketingConsent: z.boolean().optional(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
  mfaCode: z.string().optional(),
});

export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1),
});

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordRequestSchema = z
  .object({
    token: z.string().min(1),
    email: z.string().email(),
    newPassword: z.string().min(8),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });
