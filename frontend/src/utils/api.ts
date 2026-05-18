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
 * Generic message strings that are too vague to surface to the user.
 *
 * Mirror of the `GENERIC_MESSAGES` deny-list in
 * `frontend/src/utils/translationErrorMessages.ts` (PR #251 / issue #266).
 * The list is intentionally inlined rather than imported because:
 *   - The translationErrorMessages module is auth-context-free and
 *     pulling api.ts into its dependency graph would create a circular
 *     dependency the wrapping `getApiErrorMessage` helper already
 *     dispatches through.
 *   - Keeping the deny-list in this file means the universal interceptor
 *     fallback decision is self-contained and inspectable in one place.
 * If a third caller appears, promote this constant to a shared util.
 */
const GENERIC_BACKEND_MESSAGES = new Set(
  [
    'network error',
    'an unexpected error occurred',
    'request failed',
    'failed to fetch',
    'forbidden',
    'unauthorized',
  ].map((s) => s.toLowerCase())
);

/**
 * Extract a usable user-facing message from an axios error-response body.
 *
 * Returns `undefined` when the caller should fall back to a curated
 * generic constant (`ERROR_MESSAGES.UNAUTHORIZED` etc.). Returns the
 * backend's `message` verbatim when it is specific enough to surface.
 *
 * Rules (mirrors `getApiErrorMessage` precedence in translationErrorMessages.ts):
 *   - `data` is not an object → undefined (no envelope to read)
 *   - `data.message` is missing / non-string / empty / whitespace → undefined
 *   - `data.message` matches the GENERIC_BACKEND_MESSAGES deny-list
 *     (case-insensitive, trimmed) → undefined. This guards against
 *     issue #266's "An unexpected error occurred" class of bug, where
 *     a backend leak of a vague string would otherwise REPLACE a more
 *     useful curated constant.
 *   - Otherwise → the trimmed message verbatim.
 *
 * Introduced for issue #275: the 403 interceptor branch used to
 * unconditionally clobber the backend message with the generic
 * `ERROR_MESSAGES.UNAUTHORIZED` constant, destroying the email-
 * verification guidance from `login.ts:175` for unconfirmed-user
 * `UserNotConfirmedException`. Extracted as a helper rather than
 * inlined so other status-code branches can adopt the same pattern
 * if needed without re-implementing the deny-list logic.
 */
function extractBackendMessage(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const candidate = (data as { message?: unknown }).message;
  if (typeof candidate !== 'string') {
    return undefined;
  }
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (GENERIC_BACKEND_MESSAGES.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
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

/**
 * Read the current session from localStorage.
 *
 * Returns the parsed blob when it carries both required fields as
 * non-empty strings (OMC Round 2 item 7: an empty bearer would surface
 * to the request interceptor and trigger an infinite 401→refresh loop;
 * we tighten the guard to require positive length). Otherwise — corrupt
 * JSON, missing field, empty string — the blob is cleared and we return
 * `null`. We DO NOT throw because callers thread this function through
 * render paths and a thrown error would crash the mount.
 */
export function getStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(AUTH_CONFIG.SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.idToken === 'string' &&
      parsed.idToken.length > 0 &&
      typeof parsed.accessToken === 'string' &&
      parsed.accessToken.length > 0
    ) {
      return parsed as StoredSession;
    }
    // Malformed — clear it so the next read has a clean slate.
    localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
  } catch {
    localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
  }

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
 * token would 401 anyway.
 */
export function getAuthToken(): string | null {
  const session = getStoredSession();
  return session?.idToken ?? null;
}

/**
 * Persist the Cognito ID token that API Gateway expects as the Bearer
 * credential. Kept for backward compatibility with call sites that
 * already write tokens individually.
 *
 * If a session already exists, the idToken field is merged in (the
 * existing accessToken survives). If no session exists, the
 * accessToken is mirrored from the idToken so the resulting blob
 * satisfies the `StoredSession` shape — without this mirror, an
 * `updateStoredSession` partial with only one required field would
 * refuse to write (by design, to prevent half-blob corruption).
 */
export function setAuthToken(idToken: string): void {
  const current = getStoredSession();
  if (current) {
    setStoredSession({ ...current, idToken });
  } else {
    setStoredSession({ idToken, accessToken: idToken });
  }
}

/**
 * Persist the raw Cognito AccessToken (kept for OAuth resource-server
 * use). Same rationale as `setAuthToken` — merges into the blob so
 * the ID token survives.
 */
export function setAccessToken(accessToken: string): void {
  const current = getStoredSession();
  if (current) {
    setStoredSession({ ...current, accessToken });
  } else {
    setStoredSession({ idToken: accessToken, accessToken });
  }
}

/**
 * Clear the entire authentication session.
 */
export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_CONFIG.SESSION_KEY);
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
      // The backend `/auth/refresh` response is FLAT (PR #218 hotfix
      // flattened the previously-wrapped envelope so it matches every
      // other auth handler):
      //   { message, accessToken, idToken, expiresIn, requestId }
      //
      // The dual-path extractor that previously also tolerated a nested
      // `{ data: { ... } }` shape was deleted alongside the dead code
      // branch in PR #218 OMC R1 C2 (YAGNI — the nested shape is no
      // longer producible by any caller).
      const response = await axios.post<{
        accessToken?: string;
        idToken?: string;
        refreshToken?: string;
      }>(`${API_CONFIG.BASE_URL}/auth/refresh`, { refreshToken });

      const payload = response.data;
      const newAccessToken = payload.accessToken ?? '';
      const newIdToken = payload.idToken ?? '';
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
  //
  // Issue #275: prefer the backend's user-facing prose when present (e.g.,
  // "Please verify your email address before logging in." emitted by
  // `backend/functions/auth/login.ts:175` for `UserNotConfirmedException`).
  // Only fall back to the generic `ERROR_MESSAGES.UNAUTHORIZED` constant
  // when the backend message is absent OR matches the
  // `GENERIC_BACKEND_MESSAGES` deny-list — otherwise an opaque
  // "Forbidden" or "Request failed" string from API Gateway would
  // re-introduce the original issue-#266 "An unexpected error occurred"
  // class problem.
  //
  // Precedence mirrors `getApiErrorMessage` in
  // `frontend/src/utils/translationErrorMessages.ts` so the two code
  // paths agree on what counts as a usable backend message.
  if (axiosError.response?.status === 403) {
    const backendMessage = extractBackendMessage(axiosError.response.data);

    const apiError: ApiError = {
      message: backendMessage ?? ERROR_MESSAGES.UNAUTHORIZED,
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
