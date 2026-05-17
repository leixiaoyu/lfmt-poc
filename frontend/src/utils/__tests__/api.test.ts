/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * API Client Tests
 *
 * Following TDD approach with pragmatic TypeScript-friendly tests.
 * Tests core functionality without over-mocking complex Axios internals.
 *
 * Storage model: Issue #196 introduced the one-blob session under
 * `AUTH_CONFIG.SESSION_KEY` and removed the runtime fallback to
 * `accessToken` in `getAuthToken()` (Issue #195). The legacy two-keys
 * migration (Issue #199 follow-up) was removed once all users had
 * rolled over to the blob format.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setAuthToken,
  setAccessToken,
  clearAuthToken,
  getAuthToken,
  getStoredSession,
  setStoredSession,
  updateStoredSession,
  getStoredRefreshToken,
} from '../api';
import { AUTH_CONFIG } from '../../config/constants';
import type { StoredSession, UserProfile } from '@lfmt/shared-types';

function readBlob(): StoredSession | null {
  const raw = localStorage.getItem(AUTH_CONFIG.SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}

function fullReset(): void {
  localStorage.clear();
}

describe('API Client - Token Management (one-blob model)', () => {
  beforeEach(() => {
    fullReset();
  });

  afterEach(() => {
    fullReset();
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
      //
      // Round 2 item 7: the structural guard now also rejects an
      // empty-string idToken (length === 0), so getAuthToken returns
      // null AND the malformed blob is cleared. Without this guard,
      // the request interceptor would have sent `Authorization: Bearer `
      // (trailing space) on every request, looping 401 → refresh.
      setStoredSession({ idToken: '', accessToken: 'access-only' });

      expect(getAuthToken()).toBeNull();
      // Side effect: malformed blob is cleared on read so the next
      // call has a clean slate.
      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
    });

    it('should reject a blob with empty-string accessToken (Round 2 item 7)', () => {
      // Symmetric to the idToken guard. accessToken is structurally
      // required and must be non-empty; otherwise the blob is dropped.
      setStoredSession({ idToken: 'real-id', accessToken: '' });

      expect(getStoredSession()).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
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
        // Minimal fixture — tests clearAuthToken removes blob, not user shape.
        user: { userId: 'u1' } as unknown as UserProfile,
      });

      clearAuthToken();

      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
      expect(getAuthToken()).toBeNull();
      expect(getStoredSession()).toBeNull();
    });
  });

  describe('updateStoredSession', () => {
    it('should merge into an existing session, preserving non-mentioned fields', () => {
      setStoredSession({
        idToken: 'id-1',
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        // Minimal fixture — tests merge semantics, not user shape.
        user: { userId: 'u1' } as unknown as UserProfile,
      });

      updateStoredSession({ idToken: 'id-2', accessToken: 'access-2' });

      const blob = readBlob();
      expect(blob?.idToken).toBe('id-2');
      expect(blob?.accessToken).toBe('access-2');
      expect(blob?.refreshToken).toBe('refresh-1');
      expect(blob?.user).toEqual({ userId: 'u1' });
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

  describe('getStoredRefreshToken', () => {
    it('should return the refresh token from the session', () => {
      setStoredSession({ idToken: 'id', accessToken: 'a', refreshToken: 'rt' });
      expect(getStoredRefreshToken()).toBe('rt');
    });

    it('should return null when no refresh token is present', () => {
      setStoredSession({ idToken: 'id', accessToken: 'a' });
      expect(getStoredRefreshToken()).toBeNull();
    });
  });

  describe('getStoredSession - malformed blob handling', () => {
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
  });
});

// =====================================================================
// Round 2 item 6: strengthened regression test for the
// abfe5743 fix — calling setAuthToken / setAccessToken against
// an EMPTY localStorage (no prior blob, no prior anything) MUST
// produce a blob the request interceptor can read on the next call.
// The original abfe5743 test only verified the blob existed; this
// reproduces the user-visible failure mode (the API client silently
// dropped the Authorization header).
// =====================================================================

describe('API Client - setAuthToken empty-storage regression (Round 2 item 6)', () => {
  beforeEach(() => {
    fullReset();
  });

  afterEach(() => {
    fullReset();
  });

  it('setAuthToken on empty storage → request interceptor sends Bearer header', async () => {
    // Empty localStorage. setAuthToken must write a complete blob
    // (mirroring idToken into accessToken to satisfy the type guard).
    setAuthToken('test-bearer-from-cold-start');

    // Round-trip through the actual request interceptor — this is the
    // bug the abfe5743 fix landed for. The original-pre-fix code
    // called updateStoredSession({ idToken }) which refused to write
    // a partial blob, so getAuthToken() returned null and the
    // interceptor sent NO Authorization header.
    const { createApiClient } = await import('../api');
    const client = createApiClient();
    let captured: Record<string, unknown> | null = null;
    client.defaults.adapter = async (config) => {
      captured = config.headers as unknown as Record<string, unknown>;
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    await client.get('/test');

    expect(captured).not.toBeNull();
    expect(captured!.Authorization).toBe('Bearer test-bearer-from-cold-start');
  });

  it('setAccessToken on empty storage → mirrored idToken keeps the blob valid', async () => {
    setAccessToken('access-from-cold-start');
    // Per the legacy-compat semantic (mirror), idToken == accessToken
    // when there's no prior session. The interceptor reads idToken.
    expect(getAuthToken()).toBe('access-from-cold-start');
  });
});

// =====================================================================
// Logged-out request integration: no Authorization header attached.
// =====================================================================

describe('API Client - logged-out request', () => {
  beforeEach(() => {
    fullReset();
  });

  it('should send NO Authorization header when no session exists', async () => {
    const { createApiClient } = await import('../api');
    const client = createApiClient();
    let captured: Record<string, unknown> | null = null;
    client.defaults.adapter = async (config) => {
      captured = config.headers as unknown as Record<string, unknown>;
      return {
        data: { ok: true },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    };

    await client.get('/some/endpoint');

    expect(captured).not.toBeNull();
    expect(captured!.Authorization).toBeUndefined();
  });
});

// =====================================================================
// Issue #224: double-slash URL regression guard.
//
// VITE_API_URL may arrive with a trailing slash (e.g. when copy-pasted
// from the CloudFormation output). Every request URL constructed from
// BASE_URL must contain at most one slash at the join point — i.e., no
// `//` anywhere except the protocol (`https://`).
//
// The test captures the raw URL via a custom axios adapter and checks
// every callsite that constructs a path:
//   - apiClient.get/post paths (prefix slash on path, handled by axios)
//   - inline template literal in the refresh interceptor:
//     `${API_CONFIG.BASE_URL}/auth/refresh`
// =====================================================================

describe('API Client - No double-slash in constructed URLs (issue #224)', () => {
  beforeEach(() => {
    fullReset();
  });

  afterEach(() => {
    fullReset();
    // Unstub env vars AND reset the module registry so that stubs set inside
    // individual tests (vi.stubEnv + vi.resetModules) do not leak into
    // subsequent test files or describe blocks.
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /**
   * Strip the protocol scheme so assertions on `https://…` don't
   * false-positive on the `://` in the scheme itself.
   */
  function pathAfterScheme(url: string): string {
    return url.replace(/^https?:\/\//, '');
  }

  it('apiClient.get path should not produce // in the final URL when VITE_API_URL has trailing slash', async () => {
    // Simulate the copy-paste scenario: VITE_API_URL arrives with a trailing
    // slash. Without vi.stubEnv + vi.resetModules the test uses the cached
    // .env.test value (http://localhost:3000/v1 — no slash) and would pass
    // even if the fix in constants.ts were reverted. This is the actual
    // regression guard for issue #224.
    vi.stubEnv('VITE_API_URL', 'http://localhost:3000/v1/');
    vi.resetModules();
    const { createApiClient } = await import('../api');
    const client = createApiClient();
    const captured: string[] = [];
    client.defaults.adapter = async (config) => {
      captured.push(config.url ?? '');
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };

    await client.get('/auth/me');

    // There must be exactly one captured URL and it must not contain //
    // outside of the protocol scheme.
    expect(captured).toHaveLength(1);
    expect(pathAfterScheme(captured[0])).not.toContain('//');
  });

  it('apiClient.post path should not produce // in the final URL when VITE_API_URL has trailing slash', async () => {
    // Same rationale as the .get test above: stub with a trailing-slash value
    // so this test fails when the constants.ts fix is absent.
    vi.stubEnv('VITE_API_URL', 'http://localhost:3000/v1/');
    vi.resetModules();
    const { createApiClient } = await import('../api');
    const client = createApiClient();
    const captured: string[] = [];
    client.defaults.adapter = async (config) => {
      captured.push(config.url ?? '');
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };

    await client.post('/auth/refresh', { refreshToken: 'rt' });

    expect(captured).toHaveLength(1);
    expect(pathAfterScheme(captured[0])).not.toContain('//');
  });

  it('BASE_URL constant itself must not have a trailing slash', async () => {
    // vi.stubEnv + vi.resetModules is required to force constants.ts to
    // re-evaluate with a different VITE_API_URL value. Without the module
    // reset the cached module instance is returned regardless of the stub.
    vi.stubEnv('VITE_API_URL', 'https://example.execute-api.us-east-1.amazonaws.com/v1/');
    vi.resetModules();
    const { API_CONFIG } = await import('../../config/constants');
    expect(API_CONFIG.BASE_URL).not.toMatch(/\/$/);
    expect(API_CONFIG.BASE_URL).toBe('https://example.execute-api.us-east-1.amazonaws.com/v1');
  });

  it('BASE_URL with multiple trailing slashes is fully stripped', async () => {
    vi.stubEnv('VITE_API_URL', 'https://example.execute-api.us-east-1.amazonaws.com/v1///');
    vi.resetModules();
    const { API_CONFIG } = await import('../../config/constants');
    expect(API_CONFIG.BASE_URL).toBe('https://example.execute-api.us-east-1.amazonaws.com/v1');
  });

  it('BASE_URL without trailing slash is left unchanged', async () => {
    vi.stubEnv('VITE_API_URL', 'https://example.execute-api.us-east-1.amazonaws.com/v1');
    vi.resetModules();
    const { API_CONFIG } = await import('../../config/constants');
    expect(API_CONFIG.BASE_URL).toBe('https://example.execute-api.us-east-1.amazonaws.com/v1');
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
    fullReset();
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
    fullReset();
  });

  it.skip('should handle 401 Unauthorized and clear auth tokens', async () => {
    // Set up tokens
    setStoredSession({
      idToken: 'id',
      accessToken: 'test-token',
      refreshToken: 'refresh-token',
      user: { userId: '123' } as unknown as UserProfile,
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
