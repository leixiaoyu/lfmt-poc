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

/**
 * Get the Bearer token used for API Gateway authorization.
 *
 * API Gateway CognitoUserPoolsAuthorizer validates ID tokens, not access
 * tokens.  We therefore prefer the stored ID token and fall back to the
 * access token only for backward-compatibility with sessions that pre-date
 * the idToken storage (i.e., sessions created before this change was
 * deployed — those users will get a 401 on the next authenticated request
 * and be prompted to log in again, which is the correct safe behaviour).
 */
export function getAuthToken(): string | null {
  return (
    localStorage.getItem(AUTH_CONFIG.ID_TOKEN_KEY) ||
    localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)
  );
}

/**
 * Store the Cognito ID token that API Gateway expects as the Bearer credential.
 *
 * Keeping the function name `setAuthToken` preserves backward compatibility
 * with all existing call sites.  Internally we write to `ID_TOKEN_KEY` so
 * that `getAuthToken()` returns the correct token for authenticated requests.
 */
export function setAuthToken(idToken: string): void {
  localStorage.setItem(AUTH_CONFIG.ID_TOKEN_KEY, idToken);
}

/**
 * Store the raw Cognito AccessToken separately (kept for reference / future
 * OAuth resource-server use). Call sites that receive both tokens from the
 * backend can persist the access token without overwriting the id token.
 */
export function setAccessToken(accessToken: string): void {
  localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, accessToken);
}

/**
 * Clear all authentication tokens from localStorage, including the ID token.
 */
export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_CONFIG.ID_TOKEN_KEY);
  localStorage.removeItem(AUTH_CONFIG.ACCESS_TOKEN_KEY);
  localStorage.removeItem(AUTH_CONFIG.REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_CONFIG.USER_DATA_KEY);
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
    const refreshToken = localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY);

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
      // the existing value so we don't accidentally store `undefined`.
      const newRefreshToken =
        payload.refreshToken ?? localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY) ?? '';

      // Store the id token as the primary Bearer credential.
      // If the backend did not return one (e.g. a test mock) fall back to
      // the access token so existing behavior is preserved.
      const bearerToken = newIdToken || newAccessToken;
      setAuthToken(bearerToken);
      if (newAccessToken) {
        setAccessToken(newAccessToken);
      }
      if (newRefreshToken) {
        localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, newRefreshToken);
      }

      // Update authorization header for original request
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${bearerToken}`;
      }

      // Process queued requests with the new bearer token
      processQueue(null, bearerToken);
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
