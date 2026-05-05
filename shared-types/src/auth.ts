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

/**
 * One-blob session storage model (Issue #196).
 *
 * The frontend persists the entire authenticated session under a SINGLE
 * `localStorage` key (`lfmt_session`) as a JSON document of this shape.
 * This replaces the previous "two-keys" model in which `idToken`,
 * `accessToken`, `refreshToken` and `user` lived under independent keys
 * and could drift out of sync if any individual `setItem` call failed
 * (e.g., quota error) or two browser tabs raced a token refresh.
 *
 * Atomicity guarantee: every write replaces the entire blob. A single
 * `JSON.parse`/`stringify` round-trip costs microseconds and eliminates
 * the consistency hazard the OMC reviewer flagged.
 *
 * Migration: a one-time, idempotent migration in `getStoredSession()`
 * reconstructs the blob from the legacy keys (`lfmt_id_token`,
 * `lfmt_access_token`, `lfmt_refresh_token`, `lfmt_user`) and removes
 * the legacy keys. Every other read path (`getAuthToken`,
 * `getStoredRefreshToken`, `getStoredUser`) goes through
 * `getStoredSession`, so the migration is hit on first read regardless
 * of which helper the caller invokes. Removal plan: see issue #199.
 *
 * SECURITY NOTE: storing the ID token in `localStorage` keeps the
 * Bearer credential reachable from any executed JavaScript.
 * `unsafe-inline` was removed from `script-src` in the same PR (#194,
 * #198) so an XSS payload can no longer inject an inline `<script>`
 * to exfiltrate this value. A future hardening initiative may move
 * the tokens to httpOnly cookies — see follow-up issue #197.
 */
export interface StoredSession {
  /** Cognito ID token — the API Gateway Bearer credential. */
  idToken: string;
  /** Cognito Access token — kept for OAuth2 resource-server use. */
  accessToken: string;
  /**
   * Cognito Refresh token. Optional because the in-memory session
   * may be created without a refresh token in degraded paths (e.g.,
   * a mock harness that hands out single-use tokens).
   */
  refreshToken?: string;
  /**
   * Epoch milliseconds at which the ID token expires. Optional
   * because the backend currently surfaces `expiresIn` (seconds)
   * not an absolute timestamp; consumers compute `expiresAt =
   * Date.now() + expiresIn * 1000` when persisting.
   */
  expiresAt?: number;
  /**
   * The authenticated user object. Optional because token-only
   * refresh responses do not re-send the user object.
   *
   * Typed as `unknown` (rather than `UserProfile`) intentionally:
   * the frontend SPA persists a NARROWER shape than the canonical
   * `UserProfile` (it stores only the fields it renders — id,
   * email, firstName, lastName). Consumers that read this field
   * are responsible for narrowing it to whatever shape they
   * actually need; this keeps the `StoredSession` contract honest
   * and avoids forcing every future caller to satisfy every
   * required field on `UserProfile`.
   */
  user?: unknown;
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
