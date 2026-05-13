// Authentication Types - From Document 10 (User Management & Authentication)
import { z } from 'zod';

// User Profile
//
// Issue #200: unified canonical user shape for all consumers (frontend SPA,
// backend responses, localStorage session).
//
// Fields that the frontend SPA receives and persists:
//   userId, email, firstName, lastName, organization?, createdAt?, lastLoginAt?
//
// Fields that the SPA does NOT receive in the current implementation and are
// therefore optional (marked optional so UserProfile can be used directly as
// the frontend session type without unsafe `as` casts or parallel type defs):
//   isEmailVerified, mfaEnabled, role, preferences
//
// `id` is an optional alias for `userId`. Legacy Cognito-adjacent endpoints
// and mock handlers surface this field as `id`; new endpoints use `userId`.
// Consumers SHOULD prefer `userId`; `id` is preserved so that sessions
// created by older code remain valid after this migration.
export interface UserProfile {
  userId: string;
  /**
   * @deprecated Alias for `userId` preserved for pre-#200 session blobs.
   * Consumers MUST prefer `userId`. This field will be removed on or after
   * 2026-06-04 as part of the #199 migration cleanup — the same sweep that
   * removes the `LEGACY` keys and the `narrowStoredUser` id-fallback path.
   */
  id?: string;
  email: string;
  firstName: string;
  lastName: string;
  organization?: string;
  /** Optional: not present in all auth responses (e.g. REFRESH_TOKEN_AUTH). */
  createdAt?: string;
  lastLoginAt?: string;
  /** Optional: not returned by all auth endpoints (e.g. REFRESH_TOKEN_AUTH). */
  isEmailVerified?: boolean;
  /** Optional: MFA is not required by current SPA flows. */
  mfaEnabled?: boolean;
  /** Optional: role is not surfaced in the current auth response. */
  role?: UserRole;
  /** Optional: preferences are loaded lazily (profile page). */
  preferences?: UserPreferences;
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
   * The authenticated user object (issue #200 — unified with UserProfile).
   *
   * Typed as `UserProfile | undefined` now that `UserProfile` is safe to use
   * as the SPA session type: all fields beyond the core four (userId, email,
   * firstName, lastName) are optional. Token-only refresh responses do not
   * re-send the user object, so the field remains optional.
   *
   * Legacy sessions that stored a `{ id, ... }` shape (pre-issue-#200) are
   * still valid: `UserProfile.id` is an optional alias for `userId` so the
   * stored value satisfies the type at runtime. `narrowStoredUser` in
   * `utils/api.ts` accepts both `id` and `userId` for backwards compatibility.
   */
  user?: UserProfile;
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
