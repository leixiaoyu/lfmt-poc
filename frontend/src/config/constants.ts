/**
 * Application Constants
 *
 * Centralized configuration for the LFMT frontend application.
 * Environment-specific values are loaded from import.meta.env (Vite).
 */

/**
 * API Configuration
 */
export const API_CONFIG = {
  /**
   * Base URL for API requests
   * In development: proxied through Vite dev server
   * In production: direct API Gateway URL
   */
  BASE_URL: import.meta.env.VITE_API_URL || '/api',

  /**
   * Request timeout in milliseconds
   */
  TIMEOUT: 30000, // 30 seconds

  /**
   * Number of retry attempts for failed requests
   */
  MAX_RETRIES: 3,
} as const;

/**
 * Authentication Configuration
 */
export const AUTH_CONFIG = {
  /**
   * Local storage key for access token
   * Note: In production, consider httpOnly cookies for better security
   */
  ACCESS_TOKEN_KEY: 'lfmt_access_token',

  /**
   * Local storage key for refresh token
   */
  REFRESH_TOKEN_KEY: 'lfmt_refresh_token',

  /**
   * Local storage key for user data
   */
  USER_DATA_KEY: 'lfmt_user',

  /**
   * Token refresh threshold (refresh when token has less than 5 minutes left)
   */
  REFRESH_THRESHOLD_MS: 5 * 60 * 1000, // 5 minutes
} as const;

/**
 * Application Routes
 */
export const ROUTES = {
  // Public routes
  HOME: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  FORGOT_PASSWORD: '/forgot-password',

  // Protected routes
  DASHBOARD: '/dashboard',
  NEW_TRANSLATION: '/translation/new',
  TRANSLATION_HISTORY: '/translation/history',
  TRANSLATION_DETAIL: '/translation/:jobId',
  PROFILE: '/profile',
} as const;

/**
 * Translation Configuration
 */
export const TRANSLATION_CONFIG = {
  /**
   * Supported source/target languages
   */
  SUPPORTED_LANGUAGES: [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'zh', name: 'Chinese' },
  ] as const,

  /**
   * Document size limits (from backend constraints)
   */
  MIN_WORD_COUNT: 65_000,
  MAX_WORD_COUNT: 400_000,

  /**
   * Allowed file types for upload
   */
  ALLOWED_FILE_TYPES: ['.txt', '.doc', '.docx', '.pdf'] as const,

  /**
   * Maximum file size in bytes (50MB)
   */
  MAX_FILE_SIZE: 50 * 1024 * 1024,

  /**
   * Polling interval for job status updates (milliseconds)
   */
  STATUS_POLL_INTERVAL: 15_000, // 15 seconds
} as const;

/**
 * UI Configuration
 */
export const UI_CONFIG = {
  /**
   * Debounce delay for search inputs (milliseconds)
   */
  SEARCH_DEBOUNCE_MS: 300,

  /**
   * Toast notification duration (milliseconds)
   */
  TOAST_DURATION: 5000, // 5 seconds

  /**
   * Maximum items per page in paginated lists
   */
  ITEMS_PER_PAGE: 20,

  /**
   * Skeleton loader display duration (milliseconds)
   */
  SKELETON_MIN_DISPLAY: 500,
} as const;

/**
 * Error Messages
 */
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please check your connection and try again.',
  AUTH_FAILED: 'Authentication failed. Please log in again.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  UNAUTHORIZED: 'You do not have permission to perform this action.',
  SERVER_ERROR: 'Server error. Please try again later.',
  VALIDATION_ERROR: 'Please check your input and try again.',
  FILE_TOO_LARGE: `File size exceeds ${TRANSLATION_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB limit.`,
  INVALID_FILE_TYPE: `Only ${TRANSLATION_CONFIG.ALLOWED_FILE_TYPES.join(', ')} files are allowed.`,
  WORD_COUNT_TOO_LOW: `Document must contain at least ${TRANSLATION_CONFIG.MIN_WORD_COUNT.toLocaleString()} words.`,
  WORD_COUNT_TOO_HIGH: `Document must contain no more than ${TRANSLATION_CONFIG.MAX_WORD_COUNT.toLocaleString()} words.`,
} as const;

/**
 * Success Messages
 */
export const SUCCESS_MESSAGES = {
  LOGIN_SUCCESS: 'Successfully logged in!',
  REGISTER_SUCCESS: 'Registration successful! Please check your email to verify your account.',
  PASSWORD_RESET_SENT: 'Password reset instructions sent to your email.',
  TRANSLATION_SUBMITTED: 'Translation job submitted successfully!',
  PROFILE_UPDATED: 'Profile updated successfully!',
} as const;

/**
 * Feature Flags
 * Toggle features for development/testing
 */
export const FEATURE_FLAGS = {
  /**
   * Enable dark mode toggle
   */
  DARK_MODE: import.meta.env.VITE_FEATURE_DARK_MODE === 'true',

  /**
   * Enable debug mode (additional console logs)
   */
  DEBUG: import.meta.env.DEV,

  /**
   * Enable analytics tracking
   */
  ANALYTICS: import.meta.env.PROD,
} as const;

/**
 * External Links
 */
export const EXTERNAL_LINKS = {
  PRIVACY_POLICY: '/privacy',
  TERMS_OF_SERVICE: '/terms',
  SUPPORT: 'mailto:support@lfmt.example.com',
  DOCUMENTATION: '/docs',
} as const;
