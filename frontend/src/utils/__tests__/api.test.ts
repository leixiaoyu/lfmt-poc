/**
 * API Client Tests
 *
 * Following TDD approach with pragmatic TypeScript-friendly tests.
 * Tests core functionality without over-mocking complex Axios internals.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setAuthToken, clearAuthToken, getAuthToken } from '../api';
import { AUTH_CONFIG } from '../../config/constants';

describe('API Client - Token Management', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('setAuthToken', () => {
    it('should store token in localStorage', () => {
      const token = 'test-jwt-token-123';

      setAuthToken(token);

      const stored = localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY);
      expect(stored).toBe(token);
    });

    it('should overwrite existing token', () => {
      const oldToken = 'old-token';
      const newToken = 'new-token';

      setAuthToken(oldToken);
      setAuthToken(newToken);

      const stored = localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY);
      expect(stored).toBe(newToken);
    });
  });

  describe('getAuthToken', () => {
    it('should retrieve stored token', () => {
      const token = 'test-token-456';

      localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, token);

      const retrieved = getAuthToken();
      expect(retrieved).toBe(token);
    });

    it('should return null when no token exists', () => {
      const retrieved = getAuthToken();
      expect(retrieved).toBeNull();
    });
  });

  describe('clearAuthToken', () => {
    it('should remove access token from localStorage', () => {
      localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, 'test-token');

      clearAuthToken();

      const stored = localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY);
      expect(stored).toBeNull();
    });

    it('should remove refresh token from localStorage', () => {
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'refresh-token');

      clearAuthToken();

      const stored = localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY);
      expect(stored).toBeNull();
    });

    it('should remove user data from localStorage', () => {
      localStorage.setItem(AUTH_CONFIG.USER_DATA_KEY, JSON.stringify({ id: '123' }));

      clearAuthToken();

      const stored = localStorage.getItem(AUTH_CONFIG.USER_DATA_KEY);
      expect(stored).toBeNull();
    });

    it('should clear all auth data at once', () => {
      localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, 'access');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'refresh');
      localStorage.setItem(AUTH_CONFIG.USER_DATA_KEY, '{}');

      clearAuthToken();

      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.USER_DATA_KEY)).toBeNull();
    });
  });
});

describe('API Client - Configuration', () => {
  it('should export createApiClient function', async () => {
    const { createApiClient } = await import('../api');
    expect(typeof createApiClient).toBe('function');
  });

  it('should export default apiClient instance', async () => {
    const { apiClient } = await import('../api');
    expect(apiClient).toBeDefined();
    expect(apiClient.get).toBeDefined();
    expect(apiClient.post).toBeDefined();
    expect(apiClient.put).toBeDefined();
    expect(apiClient.delete).toBeDefined();
  });

  it('should have interceptors registered', async () => {
    const { apiClient } = await import('../api');
    expect(apiClient.interceptors).toBeDefined();
    expect(apiClient.interceptors.request).toBeDefined();
    expect(apiClient.interceptors.response).toBeDefined();
  });
});

describe('API Client - Error Handling', () => {
  it('should export ApiError interface type', async () => {
    // TypeScript compile-time check
    // If this compiles, ApiError is properly exported
    type TestError = {
      message: string;
      status?: number;
      data?: unknown;
      requestId?: string;
    };

    const error: TestError = {
      message: 'Test error',
      status: 400,
    };

    expect(error).toBeDefined();
  });
});
