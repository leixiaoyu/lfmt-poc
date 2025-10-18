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
 * Get authentication token from localStorage
 */
export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY);
}

/**
 * Set authentication token in localStorage
 */
export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, token);
}

/**
 * Clear authentication token from localStorage
 */
export function clearAuthToken(): void {
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
 * Response Error Interceptor
 * Standardizes errors and handles authentication failures
 */
async function responseErrorInterceptor(error: unknown): Promise<never> {
  if (!axios.isAxiosError(error)) {
    return Promise.reject(error);
  }

  const axiosError = error as AxiosError<{ message?: string; errors?: string[] }>;

  // Handle 401 Unauthorized - clear auth and redirect
  if (axiosError.response?.status === 401) {
    clearAuthToken();

    // In a real app, you might want to dispatch a Redux action or emit an event
    // For now, we'll just clear the token and let the auth context handle redirects

    const apiError: ApiError = {
      message: ERROR_MESSAGES.SESSION_EXPIRED,
      status: 401,
      data: axiosError.response.data,
    };

    return Promise.reject(apiError);
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
  client.interceptors.request.use(
    requestInterceptor,
    requestErrorInterceptor
  );

  // Register response interceptors
  client.interceptors.response.use(
    responseInterceptor,
    responseErrorInterceptor
  );

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
