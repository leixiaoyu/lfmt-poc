/**
 * Application Constants
 *
 * Centralized configuration for the LFMT frontend application.
 * Environment-specific values are loaded from import.meta.env (Vite).
 */

/**
 * Validate required environment variable
 */
function getRequiredEnv(key: string): string {
  const value = import.meta.env[key];
  if (!value) {
    throw new Error(`${key} environment variable is not defined. Please check your .env file.`);
  }
  return value;
}

/**
 * API Configuration
 */
export const API_CONFIG = {
  /**
   * Base URL for API requests
   * REQUIRED: Must be set via VITE_API_URL environment variable
   * In development: proxied through Vite dev server
   * In production: direct API Gateway URL
   */
  BASE_URL: getRequiredEnv('VITE_API_URL'),

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
   * Local storage key for the one-blob session document (Issue #196).
   *
   * The entire authenticated session — `idToken`, `accessToken`,
   * optional `refreshToken`, optional `expiresAt`, optional `user` —
   * is serialized to JSON and stored under THIS single key. See the
   * `StoredSession` type in `@lfmt/shared-types`.
   *
   * Atomicity: every session write replaces the blob in full, so the
   * fields cannot drift out of sync (the failure mode that motivated
   * this change in OMC review of PR #193).
   *
   * Migration: a one-time, idempotent migration runs lazily in
   * `getStoredSession()` to convert any pre-existing session that
   * still uses the legacy per-field keys (`lfmt_id_token`,
   * `lfmt_access_token`, `lfmt_refresh_token`, `lfmt_user`) into
   * the blob and then deletes those legacy keys.
   */
  SESSION_KEY: 'lfmt_session',

  /**
   * Legacy local-storage keys preserved ONLY for the migration path
   * in `getStoredSession()`. New code MUST NOT read or write these
   * keys directly — go through the session helpers in `utils/api.ts`
   * instead.
   *
   * `utils/api.ts` derives its `LEGACY_KEYS` array from
   * `Object.values(AUTH_CONFIG.LEGACY)` so this object is the single
   * source of truth — addition or rename here automatically
   * propagates to the migration code (Round 2 item 13).
   *
   * Removal plan: tracked in issue #199. Once telemetry confirms no
   * in-the-wild sessions pre-date the blob (one release cycle is
   * sufficient — worst case is one 401 → refresh → re-login), this
   * object can be deleted along with the migration code.
   */
  LEGACY: {
    ID_TOKEN_KEY: 'lfmt_id_token',
    ACCESS_TOKEN_KEY: 'lfmt_access_token',
    REFRESH_TOKEN_KEY: 'lfmt_refresh_token',
    USER_DATA_KEY: 'lfmt_user',
  },

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
  TRANSLATION_COMPARE: '/translation/:jobId/compare',
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

  /**
   * Enable Side-by-Side Compare View.
   *
   * Default OFF: the source-text retrieval API is not yet implemented, so
   * the source pane currently renders a "requires backend implementation"
   * placeholder. Hiding the entry-point prevents shipping a half-built
   * feature to end users. Set VITE_ENABLE_COMPARE_VIEW=true to expose it
   * for development / demos.
   *
   * Tracking issue: source-text retrieval API + viewer completion.
   */
  COMPARE_VIEW: import.meta.env.VITE_ENABLE_COMPARE_VIEW === 'true',
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
