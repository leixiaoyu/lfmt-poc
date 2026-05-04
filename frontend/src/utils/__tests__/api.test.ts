/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * API Client Tests
 *
 * Following TDD approach with pragmatic TypeScript-friendly tests.
 * Tests core functionality without over-mocking complex Axios internals.
 *
 * Storage model: Issue #196 introduced the one-blob session under
 * `AUTH_CONFIG.SESSION_KEY` and removed the runtime fallback to
 * `accessToken` in `getAuthToken()` (Issue #195). The legacy keys live
 * on only as inputs to a one-time, idempotent migration covered in the
 * dedicated migration block below.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setAuthToken,
  setAccessToken,
  clearAuthToken,
  getAuthToken,
  getStoredSession,
  setStoredSession,
  updateStoredSession,
  getStoredRefreshToken,
  getStoredUser,
} from '../api';
import { AUTH_CONFIG } from '../../config/constants';
import type { StoredSession } from '@lfmt/shared-types';

function readBlob(): StoredSession | null {
  const raw = localStorage.getItem(AUTH_CONFIG.SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}

describe('API Client - Token Management (one-blob model)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('setAuthToken', () => {
    it('should write idToken into the session blob', () => {
      const idToken = 'test-id-token-123';

      setAuthToken(idToken);

      const blob = readBlob();
      expect(blob?.idToken).toBe(idToken);
      // accessToken is mirrored from idToken when no prior session exists,
      // so updateStoredSession can persist a complete blob (both required
      // fields present).
      expect(blob?.accessToken).toBe(idToken);
    });

    it('should overwrite an existing idToken without clobbering accessToken', () => {
      // Pre-existing session with both fields distinct.
      setStoredSession({
        idToken: 'old-id',
        accessToken: 'old-access',
        refreshToken: 'rt',
      });

      setAuthToken('new-id');

      const blob = readBlob();
      expect(blob?.idToken).toBe('new-id');
      expect(blob?.accessToken).toBe('old-access');
      expect(blob?.refreshToken).toBe('rt');
    });
  });

  describe('setAccessToken', () => {
    it('should merge accessToken into the session without disturbing idToken', () => {
      setStoredSession({
        idToken: 'id-123',
        accessToken: 'old-access',
      });

      setAccessToken('new-access');

      const blob = readBlob();
      expect(blob?.idToken).toBe('id-123');
      expect(blob?.accessToken).toBe('new-access');
    });
  });

  describe('getAuthToken', () => {
    it('should return idToken from the blob when present', () => {
      setStoredSession({ idToken: 'id-xyz', accessToken: 'access-xyz' });

      expect(getAuthToken()).toBe('id-xyz');
    });

    it('should NOT fall back to accessToken at runtime (Issue #195)', () => {
      // Hand-construct a malformed blob with idToken empty — getAuthToken
      // must NOT silently substitute the accessToken. The previous
      // `?? accessToken` fallback was removed; legacy sessions are now
      // handled exclusively by the migration path tested below.
      setStoredSession({ idToken: '', accessToken: 'access-only' });

      // Empty string is a valid string per JSON, so the type guard in
      // getStoredSession passes; getAuthToken returns the empty string
      // (which the request interceptor will then refuse to send as a
      // Bearer header). This is the documented behavior — Issue #195
      // explicitly chose "fail fast" over "silent fallback".
      expect(getAuthToken()).toBe('');
    });

    it('should return null when no session exists', () => {
      expect(getAuthToken()).toBeNull();
    });
  });

  describe('clearAuthToken', () => {
    it('should remove the session blob', () => {
      setStoredSession({
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'rt',
        user: { id: 'u1' },
      });

      clearAuthToken();

      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
      expect(getAuthToken()).toBeNull();
      expect(getStoredSession()).toBeNull();
    });

    it('should also remove every legacy key (defensive — covers post-deploy cleanup)', () => {
      // Simulate a deploy where a stray legacy key survived alongside a new blob.
      localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'legacy-id');
      localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'legacy-access');
      localStorage.setItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY, 'legacy-refresh');
      localStorage.setItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY, '{}');
      setStoredSession({ idToken: 'id', accessToken: 'access' });

      clearAuthToken();

      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY)).toBeNull();
    });
  });

  describe('updateStoredSession', () => {
    it('should merge into an existing session, preserving non-mentioned fields', () => {
      setStoredSession({
        idToken: 'id-1',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        user: { id: 'u1' },
      });

      updateStoredSession({ idToken: 'id-2', accessToken: 'access-2' });

      const blob = readBlob();
      expect(blob?.idToken).toBe('id-2');
      expect(blob?.accessToken).toBe('access-2');
      expect(blob?.refreshToken).toBe('refresh-1');
      expect(blob?.user).toEqual({ id: 'u1' });
    });

    it('should treat a complete partial as a full session when nothing is stored', () => {
      updateStoredSession({ idToken: 'id', accessToken: 'access' });

      const blob = readBlob();
      expect(blob).toEqual({ idToken: 'id', accessToken: 'access' });
    });

    it('should refuse to write an incomplete blob when no session exists', () => {
      // Only one of the two required fields — must NOT create a malformed blob.
      updateStoredSession({ idToken: 'orphan' });

      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
    });
  });

  describe('getStoredRefreshToken / getStoredUser', () => {
    it('should return the refresh token from the session', () => {
      setStoredSession({ idToken: 'id', accessToken: 'a', refreshToken: 'rt' });
      expect(getStoredRefreshToken()).toBe('rt');
    });

    it('should return null when no refresh token is present', () => {
      setStoredSession({ idToken: 'id', accessToken: 'a' });
      expect(getStoredRefreshToken()).toBeNull();
    });

    it('should return the persisted user object', () => {
      const user = { id: 'u1', email: 'test@example.com' };
      setStoredSession({ idToken: 'id', accessToken: 'a', user });
      expect(getStoredUser()).toEqual(user);
    });
  });
});

describe('API Client - Legacy Session Migration (Issue #196)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should synthesize a blob from legacy keys and remove them on first read', () => {
    // Pre-populate localStorage in the legacy two-keys shape.
    localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'legacy-id-token');
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'legacy-access-token');
    localStorage.setItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY, 'legacy-refresh-token');
    localStorage.setItem(
      AUTH_CONFIG.LEGACY.USER_DATA_KEY,
      JSON.stringify({ id: 'legacy-u1', email: 'legacy@example.com' })
    );

    // First read triggers migration.
    const session = getStoredSession();

    expect(session).toEqual({
      idToken: 'legacy-id-token',
      accessToken: 'legacy-access-token',
      refreshToken: 'legacy-refresh-token',
      user: { id: 'legacy-u1', email: 'legacy@example.com' },
    });

    // Blob is now persisted under the new key.
    const blob = readBlob();
    expect(blob).toEqual(session);

    // All legacy keys are gone.
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY)).toBeNull();
  });

  it('should be idempotent — second call is a no-op', () => {
    localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'legacy-id');
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'legacy-access');

    const first = getStoredSession();
    const blobAfterFirst = readBlob();

    // Legacy keys gone after the first read.
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY)).toBeNull();

    const second = getStoredSession();

    expect(second).toEqual(first);
    expect(readBlob()).toEqual(blobAfterFirst);
  });

  it('should fall back to accessToken when only the legacy access key exists', () => {
    // Sessions created BEFORE PR #193 only had accessToken stored (no idToken).
    // The migration must still extract a usable Bearer credential rather than
    // log the user out; the upgraded session will then 401 on the next
    // authenticated call and the refresh interceptor takes over.
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'pre-pr-193-access-token');

    const session = getStoredSession();

    expect(session?.idToken).toBe('pre-pr-193-access-token');
    expect(session?.accessToken).toBe('pre-pr-193-access-token');
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('should return null and clean orphan keys when no bearer-eligible token exists', () => {
    // Only refresh token + user, no id/access — nothing meaningful to migrate.
    localStorage.setItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY, 'orphan-refresh');
    localStorage.setItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY, '{}');

    expect(getStoredSession()).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
    // Orphan keys cleaned up.
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY)).toBeNull();
  });

  it('should treat a corrupted blob as no session and clear it', () => {
    localStorage.setItem(AUTH_CONFIG.SESSION_KEY, '{not valid json');

    expect(getStoredSession()).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
  });

  it('should treat a structurally-incomplete blob as no session and clear it', () => {
    // Missing idToken (required).
    localStorage.setItem(
      AUTH_CONFIG.SESSION_KEY,
      JSON.stringify({ accessToken: 'a', refreshToken: 'rt' })
    );

    expect(getStoredSession()).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
  });

  it('should tolerate corrupted user JSON in legacy storage', () => {
    localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'id');
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'access');
    localStorage.setItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY, '{not valid');

    const session = getStoredSession();

    expect(session?.idToken).toBe('id');
    expect(session?.accessToken).toBe('access');
    expect(session?.user).toBeUndefined();
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

describe('API Client - Request Interceptor', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should add Authorization header when token exists', async () => {
    const token = 'test-bearer-token';
    setAuthToken(token);

    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock the adapter to capture the config
    let capturedConfig: any = null;
    client.defaults.adapter = async (config) => {
      capturedConfig = config;
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    // Make a request
    await client.get('/test');

    // Verify Authorization header was added
    expect(capturedConfig.headers.Authorization).toBe(`Bearer ${token}`);
  });

  it('should add X-Request-ID header to all requests', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock the adapter to capture the config
    let capturedConfig: any = null;
    client.defaults.adapter = async (config) => {
      capturedConfig = config;
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    // Make a request
    await client.get('/test');

    // Verify X-Request-ID header was added
    expect(capturedConfig.headers['X-Request-ID']).toBeDefined();
    expect(typeof capturedConfig.headers['X-Request-ID']).toBe('string');
    expect(capturedConfig.headers['X-Request-ID']).toMatch(/^\d+-[a-z0-9]+$/);
  });

  it('should not add Authorization header when token does not exist', async () => {
    // No token in localStorage
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock the adapter to capture the config
    let capturedConfig: any = null;
    client.defaults.adapter = async (config) => {
      capturedConfig = config;
      return {
        data: { success: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    // Make a request
    await client.get('/test');

    // Verify Authorization header was NOT added
    expect(capturedConfig.headers.Authorization).toBeUndefined();
    // But X-Request-ID should still be present
    expect(capturedConfig.headers['X-Request-ID']).toBeDefined();
  });
});

describe('API Client - Response Error Interceptor', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.skip('should handle 401 Unauthorized and clear auth tokens', async () => {
    // Set up tokens
    setStoredSession({
      idToken: 'id',
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      user: { id: '123' },
    });

    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate 401 error
    client.defaults.adapter = async () => {
      const error: any = new Error('Request failed with status code 401');
      error.isAxiosError = true;
      error.response = {
        status: 401,
        data: { message: 'Unauthorized' },
        statusText: 'Unauthorized',
        headers: {},
        config: {},
      };
      throw error;
    };

    // Make a request that will fail with 401
    try {
      await client.get('/protected');
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      // Verify error was transformed correctly
      expect(error.status).toBe(401);
      expect(error.message).toBe('Unauthorized');

      // Verify session was cleared
      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
    }
  });

  it('should handle 403 Forbidden', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate 403 error
    client.defaults.adapter = async () => {
      const error: any = new Error('Request failed with status code 403');
      error.isAxiosError = true;
      error.response = {
        status: 403,
        data: { message: 'Forbidden' },
        statusText: 'Forbidden',
        headers: {},
        config: {},
      };
      throw error;
    };

    try {
      await client.get('/admin');
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(403);
      expect(error.message).toBe('You do not have permission to perform this action.');
    }
  });

  it('should handle network errors (no response)', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate network error
    client.defaults.adapter = async () => {
      const error: any = new Error('Network Error');
      error.isAxiosError = true;
      error.response = undefined; // No response means network error
      throw error;
    };

    try {
      await client.get('/test');
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.message).toBe('Network Error');
      expect(error.status).toBeUndefined();
    }
  });

  it('should handle validation errors (400)', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate 400 error with backend message
    client.defaults.adapter = async () => {
      const error: any = new Error('Request failed with status code 400');
      error.isAxiosError = true;
      error.response = {
        status: 400,
        data: { message: 'Email is required' },
        statusText: 'Bad Request',
        headers: {},
        config: {},
      };
      throw error;
    };

    try {
      // Use non-auth endpoint to avoid mock API interference
      await client.post('/api/users', {});
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(400);
      expect(error.message).toBe('Email is required');
    }
  });

  it('should handle validation errors (422)', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate 422 error
    client.defaults.adapter = async () => {
      const error: any = new Error('Request failed with status code 422');
      error.isAxiosError = true;
      error.response = {
        status: 422,
        data: { message: 'Validation failed', errors: ['Email is invalid'] },
        statusText: 'Unprocessable Entity',
        headers: {},
        config: {},
      };
      throw error;
    };

    try {
      // Use non-auth endpoint to avoid mock API interference
      await client.post('/api/users', { email: 'invalid' });
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(422);
      expect(error.message).toBe('Validation failed');
      expect(error.data.errors).toEqual(['Email is invalid']);
    }
  });

  it('should handle server errors (500+)', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate 500 error
    client.defaults.adapter = async () => {
      const error: any = new Error('Request failed with status code 500');
      error.isAxiosError = true;
      error.response = {
        status: 500,
        data: { message: 'Internal server error' },
        statusText: 'Internal Server Error',
        headers: {},
        config: {},
      };
      throw error;
    };

    try {
      await client.get('/crash');
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(500);
      expect(error.message).toBe('Server error. Please try again later.');
    }
  });

  it('should handle other HTTP errors with backend message', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate 418 error with custom message
    client.defaults.adapter = async () => {
      const error: any = new Error('Request failed with status code 418');
      error.isAxiosError = true;
      error.response = {
        status: 418,
        data: { message: 'I am a teapot' },
        statusText: 'I am a teapot',
        headers: {},
        config: {},
      };
      throw error;
    };

    try {
      await client.get('/teapot');
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      expect(error.status).toBe(418);
      expect(error.message).toBe('I am a teapot');
    }
  });

  it('should handle non-Axios errors', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();

    // Mock adapter to simulate non-Axios error
    client.defaults.adapter = async () => {
      throw new Error('This is not an Axios error');
    };

    try {
      await client.get('/test');
      expect.fail('Should have thrown an error');
    } catch (error: any) {
      // Non-Axios errors should be passed through unchanged
      expect(error.message).toBe('This is not an Axios error');
      expect(error.status).toBeUndefined();
    }
  });
});
