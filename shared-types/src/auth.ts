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
  refreshToken: string;
  expiresIn: number;
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
export const registerRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  organization: z.string().optional(),
  acceptedTerms: z.boolean().refine(val => val === true),
  acceptedPrivacy: z.boolean().refine(val => val === true),
  marketingConsent: z.boolean().optional()
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});

export const loginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional(),
  mfaCode: z.string().optional()
});

export const refreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1)
});

export const forgotPasswordRequestSchema = z.object({
  email: z.string().email()
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  newPassword: z.string().min(8),
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"]
});