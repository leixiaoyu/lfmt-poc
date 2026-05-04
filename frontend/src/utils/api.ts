/**
 * API Client Utility
 *
 * Axios-based HTTP client with interceptors for:
 * - Automatic authentication token injection
 * - Request/response logging
 * - Error standardization
 * - Token refresh handling
 *
 * Following enterprise patterns for robust API communication.
 */

import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import type { StoredSession } from '@lfmt/shared-types';
import { API_CONFIG, AUTH_CONFIG, ERROR_MESSAGES } from '../config/constants';

/**
 * Standardized API Error
 */
export interface ApiError {
  message: string;
  status?: number;
  data?: unknown;
  requestId?: string;
}

/**
 * Generate a unique request ID for tracing
 */
function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Session storage (Issue #196 — one-blob model)
// ---------------------------------------------------------------------------
//
// The entire authenticated session lives under a SINGLE localStorage key
// (`AUTH_CONFIG.SESSION_KEY`). Every write replaces the blob in full so
// the fields cannot drift out of sync — the failure mode the OMC reviewer
// flagged on PR #193 (two browser tabs racing a refresh; one setItem
// succeeding while another hits a quota error).
//
// The previous "two-keys" model is preserved ONLY through a one-time,
// idempotent migration in `getStoredSession()`. Once a session is read
// in the new format, the legacy keys are deleted and never written
// again. New code MUST NOT touch the legacy keys directly — call the
// session helpers exported below.

/**
 * Local-storage keys we DELETE during migration. Keep this list
 * synchronized with `AUTH_CONFIG.LEGACY` — it is duplicated here so
 * the migration code reads naturally without extra indirection.
 */
const LEGACY_KEYS = [
  AUTH_CONFIG.LEGACY.ID_TOKEN_KEY,
  AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY,
  AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY,
  AUTH_CONFIG.LEGACY.USER_DATA_KEY,
] as const;

/**
 * Read the legacy two-key session and synthesize a StoredSession from
 * whatever fields are present. Returns `null` if no legacy keys exist
 * OR if neither `idToken` nor `accessToken` is set (the only two values
 * that could possibly serve as the Bearer credential — without one,
 * there is nothing meaningful to migrate).
 *
 * Pure function: no side effects. The caller decides whether to commit
 * the synthesized blob and delete the legacy keys.
 */
function readLegacySession(): StoredSession | null {
  const idToken = localStorage.getItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY);
  const accessToken = localStorage.getItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY);
  const refreshToken = localStorage.getItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY);
  const rawUser = localStorage.getItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY);

  // Nothing legacy stored — nothing to migrate.
  if (!idToken && !accessToken && !refreshToken && !rawUser) {
    return null;
  }

  // No bearer-eligible token — the legacy session is effectively dead;
  // signal "nothing to migrate" so the caller can clean up the orphan
  // keys without writing a useless blob.
  if (!idToken && !accessToken) {
    return null;
  }

  let user: unknown;
  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch {
      // Corrupted user JSON — discard rather than fail the whole
      // migration. The user will be re-fetched via `/auth/me`.
      user = undefined;
    }
  }

  return {
    // Prefer idToken (the API Gateway Bearer); fall back to accessToken
    // ONLY for legacy sessions that pre-date PR #193 — those sessions
    // will hit a 401, the refresh interceptor will fire, and the new
    // session blob will replace this synthetic one. This fallback is
    // strictly migration-scoped; the runtime fallback in `getAuthToken()`
    // was removed in Issue #195.
    idToken: (idToken ?? accessToken) as string,
    accessToken: (accessToken ?? idToken) as string,
    refreshToken: refreshToken ?? undefined,
    user,
  };
}

/**
 * Remove every legacy auth key from localStorage. Idempotent — safe to
 * call repeatedly. Used both by the migration path AND by the explicit
 * `clearStoredSession()` to ensure we never leave half-deleted state.
 */
function deleteLegacyKeys(): void {
  for (const key of LEGACY_KEYS) {
    localStorage.removeItem(key);
  }
}

/**
 * Read the current session from localStorage.
 *
 * Resolution order:
 *   1. Modern path: parse the blob under `AUTH_CONFIG.SESSION_KEY`.
 *   2. Legacy migration: if the blob is absent BUT legacy keys exist,
 *      synthesize a blob, persist it, delete the legacy keys, and
 *      return the synthesized session. Idempotent — the second call
 *      hits step 1 and returns immediately.
 *   3. Otherwise return `null` (no session).
 *
 * A corrupted blob (invalid JSON, missing required fields) is treated
 * as "no session" — we DO NOT throw because callers thread this
 * function through render paths and a thrown error would crash the
 * mount. The corrupted value is also cleared so the next call has a
 * clean slate.
 */
export function getStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(AUTH_CONFIG.SESSION_KEY);

  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      // The two non-optional fields on StoredSession are idToken and
      // accessToken. If either is absent the blob is unusable.
      if (typeof parsed.idToken === 'string' && typeof parsed.accessToken === 'string') {
        return parsed as StoredSession;
      }
      // Malformed — fall through to clear it.
      localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
    } catch {
      localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
    }
  }

  // Step 2: migration.
  const legacy = readLegacySession();
  if (legacy) {
    // Persist the synthesized blob FIRST, then delete legacy keys.
    // If the setItem somehow throws (quota), the legacy keys remain
    // intact and the next call will retry the migration.
    localStorage.setItem(AUTH_CONFIG.SESSION_KEY, JSON.stringify(legacy));
    deleteLegacyKeys();
    return legacy;
  }

  // Step 3: still nothing. Best-effort cleanup of any orphan legacy
  // keys that don't yield a bearer-eligible session (e.g., only
  // `lfmt_user` or only `lfmt_refresh_token` left over). Keeps
  // localStorage tidy without affecting behavior.
  deleteLegacyKeys();
  return null;
}

/**
 * Persist a StoredSession atomically under the single session key.
 * Replaces any prior blob in full.
 */
export function setStoredSession(session: StoredSession): void {
  localStorage.setItem(AUTH_CONFIG.SESSION_KEY, JSON.stringify(session));
}

/**
 * Update specific fields on the stored session, preserving the rest.
 *
 * Designed for the token-refresh path where the response carries
 * `accessToken` + `idToken` (and sometimes `refreshToken`) but not the
 * user object. Atomicity comes for free because the merge runs in a
 * single setItem call.
 *
 * If no session exists, the partial is treated as a full session — but
 * only when it carries both required fields. Otherwise the call is a
 * no-op (we refuse to write an incomplete blob, since a malformed
 * blob would cascade into corrupted reads).
 */
export function updateStoredSession(partial: Partial<StoredSession>): void {
  const current = getStoredSession();
  if (current) {
    setStoredSession({ ...current, ...partial });
    return;
  }
  if (typeof partial.idToken === 'string' && typeof partial.accessToken === 'string') {
    // Cast is safe — the type guard above proved both required fields are present.
    setStoredSession(partial as StoredSession);
  }
  // Otherwise: no current session AND no complete partial → nothing
  // to persist; intentionally silent so the refresh interceptor's
  // "empty bearer" guard remains the single decision point on
  // session lifecycle.
}

/**
 * Get the Bearer token used for API Gateway authorization.
 *
 * Reads `idToken` from the one-blob session (Issue #196). Per Issue
 * #195 there is NO runtime fallback to `accessToken` — API Gateway's
 * CognitoUserPoolsAuthorizer accepts ID tokens only, so an access
 * token would 401 anyway. The migration path in `getStoredSession()`
 * already handles legacy sessions that pre-date the blob (those are
 * upgraded once and never seen again).
 */
export function getAuthToken(): string | null {
  const session = getStoredSession();
  return session?.idToken ?? null;
}

/**
 * Persist the Cognito ID token that API Gateway expects as the Bearer
 * credential. Kept for backward compatibility with call sites that
 * already write tokens individually; internally it merges into the
 * blob via `updateStoredSession()` so the access token is never
 * accidentally cleared.
 */
export function setAuthToken(idToken: string): void {
  updateStoredSession({ idToken });
}

/**
 * Persist the raw Cognito AccessToken (kept for OAuth resource-server
 * use). Same rationale as `setAuthToken` — merges into the blob so
 * the ID token survives.
 */
export function setAccessToken(accessToken: string): void {
  updateStoredSession({ accessToken });
}

/**
 * Clear the entire authentication session.
 *
 * Removes the blob AND any straggling legacy keys, so an upgraded
 * session left over from a previous deploy cannot reincarnate after
 * a logout.
 */
export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
  deleteLegacyKeys();
}

/**
 * Convenience reader for the refresh token. Returns `null` if no
 * session is stored OR the session has no refresh token (Cognito
 * REFRESH_TOKEN_AUTH does not rotate it, so this is normal after the
 * first refresh).
 */
export function getStoredRefreshToken(): string | null {
  return getStoredSession()?.refreshToken ?? null;
}

/**
 * Convenience reader for the persisted user object. Returns `null`
 * when no session is stored or the session was created without a
 * user object (e.g., a refresh-only response).
 *
 * The return type is `unknown` because the SPA stores a narrower
 * shape than the canonical `UserProfile` (see the JSDoc on
 * `StoredSession.user`). Callers should narrow it with their own
 * type guard or cast.
 */
export function getStoredUser(): unknown {
  return getStoredSession()?.user ?? null;
}

/**
 * Request Interceptor
 * Adds authentication token and request ID to all requests
 */
function requestInterceptor(config: InternalAxiosRequestConfig): InternalAxiosRequestConfig {
  // Add authentication token if available
  const token = getAuthToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Add request ID for tracing
  if (config.headers) {
    config.headers['X-Request-ID'] = generateRequestId();
  }

  return config;
}

/**
 * Request Error Interceptor
 */
function requestErrorInterceptor(error: unknown): Promise<never> {
  return Promise.reject(error);
}

/**
 * Response Interceptor
 * Passes through successful responses unchanged
 */
function responseInterceptor(response: AxiosResponse): AxiosResponse {
  return response;
}

/**
 * Flag to prevent infinite refresh loops
 */
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

/**
 * Process queued requests after token refresh
 */
function processQueue(error: unknown, token: string | null = null) {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });

  failedQueue = [];
}

/**
 * Response Error Interceptor
 * Standardizes errors and handles authentication failures with automatic token refresh
 */
async function responseErrorInterceptor(error: unknown): Promise<unknown> {
  if (!axios.isAxiosError(error)) {
    return Promise.reject(error);
  }

  const axiosError = error as AxiosError<{ message?: string; errors?: string[] }>;

  // Handle 401 Unauthorized - attempt token refresh first
  if (axiosError.response?.status === 401 && axiosError.config) {
    const originalRequest = axiosError.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If we already tried to refresh, or this is a refresh request, don't retry
    if (originalRequest._retry || originalRequest.url?.includes('/auth/refresh')) {
      clearAuthToken();

      const apiError: ApiError = {
        message: ERROR_MESSAGES.SESSION_EXPIRED,
        status: 401,
        data: axiosError.response.data,
      };

      return Promise.reject(apiError);
    }

    // If already refreshing, queue this request
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      })
        .then((token) => {
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${token}`;
          }
          return axios(originalRequest);
        })
        .catch((err) => {
          return Promise.reject(err);
        });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    // Try to refresh the token
    const refreshToken = getStoredRefreshToken();

    if (!refreshToken) {
      clearAuthToken();
      isRefreshing = false;

      const apiError: ApiError = {
        message: ERROR_MESSAGES.SESSION_EXPIRED,
        status: 401,
        data: axiosError.response.data,
      };

      return Promise.reject(apiError);
    }

    try {
      // Call refresh endpoint.
      //
      // The backend `/auth/refresh` response is shaped by `createSuccessResponse`:
      //   { message, data: { accessToken, idToken, expiresIn }, requestId }
      //
      // We also tolerate a flat shape `{ accessToken, idToken, refreshToken }`
      // so that unit tests can mock a simpler payload without breaking.
      const response = await axios.post<{
        // Flat shape (unit-test mocks / forward-compat)
        accessToken?: string;
        idToken?: string;
        refreshToken?: string;
        // Nested shape (actual backend via createSuccessResponse)
        data?: { accessToken?: string; idToken?: string; expiresIn?: number };
      }>(`${API_CONFIG.BASE_URL}/auth/refresh`, { refreshToken });

      const payload = response.data;
      const newAccessToken = payload.data?.accessToken ?? payload.accessToken ?? '';
      const newIdToken = payload.data?.idToken ?? payload.idToken ?? '';
      // Cognito REFRESH_TOKEN_AUTH does not rotate the refresh token, so
      // `refreshToken` may be absent in the backend response. Fall back to
      // the existing value so we don't accidentally store an empty string.
      const newRefreshToken = payload.refreshToken ?? refreshToken;

      // Treat an empty/missing bearer as a refresh FAILURE rather than
      // silently storing an empty string — a blank Bearer header would
      // cause every subsequent request to 401 immediately, creating an
      // infinite loop that is worse than logging out cleanly.
      //
      // The new bearer MUST be the idToken (API Gateway requires it).
      // The previous code allowed `accessToken` as a fallback here; we
      // now reject that path because (a) Cognito always returns idToken
      // when it returns accessToken, so an idToken-less response is a
      // backend bug worth surfacing, and (b) issue #195 removed all
      // runtime fallbacks between the two token types.
      if (!newIdToken) {
        clearAuthToken();
        isRefreshing = false;
        const apiError: ApiError = {
          message: ERROR_MESSAGES.SESSION_EXPIRED,
          status: 401,
          data: axiosError.response.data,
        };
        processQueue(apiError, null);
        return Promise.reject(apiError);
      }

      // Atomic: one setItem rewrites the entire blob — id, access,
      // and refresh fields stay consistent regardless of whether the
      // backend rotated the refresh token or not.
      updateStoredSession({
        idToken: newIdToken,
        accessToken: newAccessToken || newIdToken,
        refreshToken: newRefreshToken,
      });

      // Update authorization header for original request
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newIdToken}`;
      }

      // Process queued requests with the new bearer token
      processQueue(null, newIdToken);
      isRefreshing = false;

      // Retry original request with new token
      return axios(originalRequest);
    } catch (refreshError) {
      // Refresh failed - clear auth and reject all queued requests
      processQueue(refreshError, null);
      clearAuthToken();
      isRefreshing = false;

      const apiError: ApiError = {
        message: ERROR_MESSAGES.SESSION_EXPIRED,
        status: 401,
        data: axiosError.response.data,
      };

      return Promise.reject(apiError);
    }
  }

  // Handle 403 Forbidden
  if (axiosError.response?.status === 403) {
    const apiError: ApiError = {
      message: ERROR_MESSAGES.UNAUTHORIZED,
      status: 403,
      data: axiosError.response.data,
    };

    return Promise.reject(apiError);
  }

  // Handle network errors
  if (!axiosError.response) {
    const apiError: ApiError = {
      message: axiosError.message || ERROR_MESSAGES.NETWORK_ERROR,
    };

    return Promise.reject(apiError);
  }

  // Handle validation errors (400, 422)
  if (axiosError.response.status === 400 || axiosError.response.status === 422) {
    const backendMessage = axiosError.response.data?.message;

    const apiError: ApiError = {
      message: backendMessage || ERROR_MESSAGES.VALIDATION_ERROR,
      status: axiosError.response.status,
      data: axiosError.response.data,
    };

    return Promise.reject(apiError);
  }

  // Handle server errors (500+)
  if (axiosError.response.status >= 500) {
    const apiError: ApiError = {
      message: ERROR_MESSAGES.SERVER_ERROR,
      status: axiosError.response.status,
      data: axiosError.response.data,
    };

    return Promise.reject(apiError);
  }

  // Handle other errors - preserve backend message if available
  const backendMessage = axiosError.response.data?.message;

  const apiError: ApiError = {
    message: backendMessage || axiosError.message || 'An unexpected error occurred',
    status: axiosError.response.status,
    data: axiosError.response.data,
  };

  return Promise.reject(apiError);
}

/**
 * Create and configure Axios instance
 */
export function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_CONFIG.BASE_URL,
    timeout: API_CONFIG.TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Register request interceptors
  client.interceptors.request.use(requestInterceptor, requestErrorInterceptor);

  // Register response interceptors
  client.interceptors.response.use(responseInterceptor, responseErrorInterceptor);

  return client;
}

/**
 * Default API client instance
 * Use this for all API calls throughout the application
 */
export const apiClient = createApiClient();

/**
 * Export axios for type definitions and testing
 */
export { axios };
