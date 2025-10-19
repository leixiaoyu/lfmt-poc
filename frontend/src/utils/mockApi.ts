/**
 * Mock API Interceptor for Development
 *
 * This module provides mock responses for API calls when the backend is not available.
 * Enables frontend development and testing without a running backend server.
 *
 * Usage: Enable by setting VITE_MOCK_API=true in .env.local
 */

import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import type { AuthResponse, User, RegisterRequest, LoginRequest } from '../services/authService';

/**
 * Simulated API delay (milliseconds)
 */
const MOCK_DELAY = 500;

/**
 * Sleep utility for simulating network delay
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generate mock user from registration data
 */
function createMockUser(data: RegisterRequest | LoginRequest): User {
  if ('firstName' in data && 'lastName' in data) {
    // Registration data
    return {
      id: `mock-user-${Date.now()}`,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
    };
  } else {
    // Login data - create generic user
    return {
      id: `mock-user-${Date.now()}`,
      email: data.email,
      firstName: 'Test',
      lastName: 'User',
    };
  }
}

/**
 * Generate mock auth response
 */
function createMockAuthResponse(user: User): AuthResponse {
  return {
    user,
    accessToken: `mock-access-token-${Date.now()}`,
    refreshToken: `mock-refresh-token-${Date.now()}`,
  };
}

/**
 * Check if request should be mocked
 */
function shouldMockRequest(config: InternalAxiosRequestConfig): boolean {
  const url = config.url || '';

  // Mock all /auth/* endpoints
  if (url.includes('/auth/')) {
    return true;
  }

  return false;
}

/**
 * Handle mock auth/register request
 */
async function mockRegister(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await sleep(MOCK_DELAY);

  // Axios may have already parsed the data, or it might still be a string
  const data = typeof config.data === 'string'
    ? JSON.parse(config.data) as RegisterRequest
    : config.data as RegisterRequest;

  const user = createMockUser(data);
  const authResponse = createMockAuthResponse(user);

  console.log('[MOCK API] Register:', { email: data.email, user });

  return {
    data: authResponse,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Handle mock auth/login request
 */
async function mockLogin(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await sleep(MOCK_DELAY);

  const data = typeof config.data === 'string'
    ? JSON.parse(config.data) as LoginRequest
    : config.data as LoginRequest;

  const user = createMockUser(data);
  const authResponse = createMockAuthResponse(user);

  console.log('[MOCK API] Login:', { email: data.email, user });

  return {
    data: authResponse,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Handle mock auth/logout request
 */
async function mockLogout(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await sleep(200);

  console.log('[MOCK API] Logout');

  return {
    data: { message: 'Logged out successfully' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Handle mock auth/refresh request
 */
async function mockRefreshToken(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await sleep(300);

  console.log('[MOCK API] Refresh token');

  return {
    data: {
      accessToken: `mock-access-token-${Date.now()}`,
      refreshToken: `mock-refresh-token-${Date.now()}`,
    },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Handle mock auth/me request
 */
async function mockGetCurrentUser(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await sleep(200);

  // Try to get user from localStorage
  const userDataString = localStorage.getItem('lfmt_user_data');
  let user: User;

  if (userDataString) {
    user = JSON.parse(userDataString) as User;
  } else {
    // Return default user if not in localStorage
    user = {
      id: 'mock-user-default',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
    };
  }

  console.log('[MOCK API] Get current user:', user);

  return {
    data: user,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Handle mock forgot password request
 */
async function mockRequestPasswordReset(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await sleep(MOCK_DELAY);

  const data = typeof config.data === 'string'
    ? JSON.parse(config.data) as { email: string }
    : config.data as { email: string };

  console.log('[MOCK API] Password reset requested for:', data.email);

  return {
    data: { message: 'Password reset email sent' },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Mock request handler
 */
async function handleMockRequest(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const url = config.url || '';

  if (url.includes('/auth/register')) {
    return mockRegister(config);
  }

  if (url.includes('/auth/login')) {
    return mockLogin(config);
  }

  if (url.includes('/auth/logout')) {
    return mockLogout(config);
  }

  if (url.includes('/auth/refresh')) {
    return mockRefreshToken(config);
  }

  if (url.includes('/auth/me')) {
    return mockGetCurrentUser(config);
  }

  if (url.includes('/auth/forgot-password')) {
    return mockRequestPasswordReset(config);
  }

  // Default mock response for unknown endpoints
  return {
    data: { message: 'Mock endpoint not implemented' },
    status: 501,
    statusText: 'Not Implemented',
    headers: {},
    config,
  } as AxiosResponse;
}

/**
 * Install mock API interceptor
 *
 * This interceptor catches API requests and returns mock data
 * instead of making real HTTP calls.
 */
export function installMockApi(client: AxiosInstance): void {
  console.log('[MOCK API] Mock API enabled - all /auth requests will be mocked');

  client.interceptors.request.use(
    async (config: InternalAxiosRequestConfig) => {
      if (shouldMockRequest(config)) {
        // Create a mock response and fulfill the request immediately
        const mockResponse = await handleMockRequest(config);

        // Throw a special error that contains the mock response
        // This allows us to intercept and return the mock data
        return Promise.reject({
          __isMockResponse: true,
          response: mockResponse,
          config,
        });
      }

      return config;
    }
  );

  // Add response error interceptor to handle mock responses
  client.interceptors.response.use(
    undefined,
    (error: unknown) => {
      // Check if this is our mock response
      if (error && typeof error === 'object' && '__isMockResponse' in error) {
        // Return the mock response as if it was a successful request
        const mockError = error as unknown as { response: AxiosResponse };
        return Promise.resolve(mockError.response);
      }

      // Otherwise, pass through the real error
      return Promise.reject(error);
    }
  );
}

/**
 * Check if mock API should be enabled
 */
export function isMockApiEnabled(): boolean {
  // Enable mock API if:
  // 1. VITE_MOCK_API environment variable is set to 'true', OR
  // 2. We're in development mode AND no backend URL is configured

  const mockApiEnv = import.meta.env.VITE_MOCK_API;
  const isDevelopment = import.meta.env.DEV;

  if (mockApiEnv === 'true') {
    return true;
  }

  // Auto-enable in development if no real API URL is set
  if (isDevelopment) {
    const apiUrl = import.meta.env.VITE_API_URL;
    if (!apiUrl || apiUrl.includes('execute-api.us-east-1.amazonaws.com')) {
      // If pointing to AWS or not set, enable mocks for local development
      return true;
    }
  }

  return false;
}
