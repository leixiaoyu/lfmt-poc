/**
 * API Token Refresh Tests
 *
 * Comprehensive test suite for automatic token refresh functionality.
 * Tests the response error interceptor's ability to handle 401 errors
 * by refreshing tokens and retrying requests.
 *
 * Mocking strategy:
 *   We attach `axios-mock-adapter` directly to the apiClient INSTANCE
 *   produced by `createApiClient()`. This intercepts every request that
 *   goes through that instance, including the retry path inside the
 *   response error interceptor. Module-level `axios.post`/`axios.get`
 *   spies do not work for this purpose because the interceptor calls
 *   `axios.post(...)` for `/auth/refresh` and `axios(originalRequest)`
 *   for the retry — to keep these on the same mocked transport we also
 *   attach a MockAdapter to the default `axios` module.
 *
 * Key scenarios tested:
 * - Successful token refresh and request retry
 * - Concurrent request queuing during refresh (single refresh fan-out)
 * - Refresh failures and fallback behavior (clear tokens)
 * - Edge cases: missing refresh token, _retry guard, /auth/refresh URL
 *   guard, non-401 passthrough
 * - Error message formatting on refresh failure
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createApiClient, setAuthToken } from '../api';
import { AUTH_CONFIG } from '../../config/constants';

describe('API Token Refresh Interceptor', () => {
  let apiClient: ReturnType<typeof createApiClient>;
  let instanceMock: MockAdapter;
  let moduleMock: MockAdapter;

  beforeEach(() => {
    localStorage.clear();
    apiClient = createApiClient();
    // Attach to the actual instance — this is what fixes the previous
    // architecture mismatch where vi.spyOn(axios, 'post') never fired.
    instanceMock = new MockAdapter(apiClient);
    // The interceptor itself calls `axios.post('/auth/refresh', ...)` and
    // `axios(originalRequest)` on the default module, so we mock that too.
    moduleMock = new MockAdapter(axios);
  });

  afterEach(() => {
    instanceMock.restore();
    moduleMock.restore();
    localStorage.clear();
    vi.unstubAllEnvs();
  });

  describe('Successful Token Refresh', () => {
    it('should refresh token on 401 and retry original request', async () => {
      const expiredToken = 'expired-token';
      const refreshToken = 'valid-refresh-token';
      const newAccessToken = 'new-access-token';
      const newRefreshToken = 'new-refresh-token';

      setAuthToken(expiredToken);
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, refreshToken);

      // First call to /auth/me → 401, then retry succeeds.
      instanceMock.onGet('/auth/me').replyOnce(401, { message: 'Token expired' });

      // The interceptor retries via `axios(originalRequest)` on the module,
      // not the instance, so the retry hits the moduleMock.
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });

      moduleMock.onGet(/\/auth\/me$/).replyOnce(200, { message: 'Success with new token' });

      const response = await apiClient.get('/auth/me');

      // Refresh was called once with the stored refresh token.
      const refreshCalls = moduleMock.history.post.filter((req) =>
        (req.url ?? '').includes('/auth/refresh')
      );
      expect(refreshCalls).toHaveLength(1);
      expect(JSON.parse(refreshCalls[0].data)).toEqual({ refreshToken });

      // New tokens persisted.
      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBe(newAccessToken);
      expect(localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY)).toBe(newRefreshToken);

      // Retry succeeded.
      expect(response.data).toEqual({ message: 'Success with new token' });
    });

    it('should queue concurrent requests during token refresh (single refresh fan-out)', async () => {
      const refreshToken = 'valid-refresh-token';
      const newAccessToken = 'new-access-token';
      const newRefreshToken = 'new-refresh-token';

      setAuthToken('expired-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, refreshToken);

      // Each in-flight request gets its own 401.
      instanceMock.onGet('/endpoint1').replyOnce(401, {});
      instanceMock.onGet('/endpoint2').replyOnce(401, {});
      instanceMock.onGet('/endpoint3').replyOnce(401, {});

      // Refresh: only one should fire even though three 401s land at once.
      // We use replyOnce so a second refresh call would surface as
      // "no handler" and reject.
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });

      // Retries succeed via the module adapter.
      moduleMock.onGet(/\/endpoint1$/).replyOnce(200, { result: 1 });
      moduleMock.onGet(/\/endpoint2$/).replyOnce(200, { result: 2 });
      moduleMock.onGet(/\/endpoint3$/).replyOnce(200, { result: 3 });

      const results = await Promise.all([
        apiClient.get('/endpoint1'),
        apiClient.get('/endpoint2'),
        apiClient.get('/endpoint3'),
      ]);

      // Single refresh, despite three concurrent 401s.
      const refreshCalls = moduleMock.history.post.filter((req) =>
        (req.url ?? '').includes('/auth/refresh')
      );
      expect(refreshCalls).toHaveLength(1);

      const resultValues = results.map((r) => r.data.result).sort();
      expect(resultValues).toEqual([1, 2, 3]);
    });

    it('should persist rotated refresh token after successful refresh', async () => {
      const initialRefreshToken = 'initial-refresh-token';
      const rotatedRefreshToken = 'rotated-refresh-token';
      const newAccessToken = 'new-access-token';

      setAuthToken('expired-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, initialRefreshToken);

      instanceMock.onGet('/auth/me').replyOnce(401, {});

      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: newAccessToken,
        refreshToken: rotatedRefreshToken,
      });
      moduleMock.onGet(/\/auth\/me$/).replyOnce(200, { ok: true });

      await apiClient.get('/auth/me');

      // Rotation: refresh token in storage replaced with the rotated value.
      expect(localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY)).toBe(rotatedRefreshToken);
      expect(localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY)).not.toBe(initialRefreshToken);
      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBe(newAccessToken);
    });
  });

  describe('Refresh Failures', () => {
    it('should clear tokens and reject if refresh fails', async () => {
      setAuthToken('expired-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'valid-refresh-token');
      localStorage.setItem(AUTH_CONFIG.USER_DATA_KEY, JSON.stringify({ id: 'u1' }));

      instanceMock.onGet('/auth/me').replyOnce(401, {});
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(401, { message: 'Refresh token expired' });

      await expect(apiClient.get('/auth/me')).rejects.toMatchObject({
        message: expect.stringContaining('expired'),
        status: 401,
      });

      // All three auth keys cleared by clearAuthToken().
      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY)).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.USER_DATA_KEY)).toBeNull();
    });

    it('should clear tokens immediately if no refresh token exists', async () => {
      setAuthToken('expired-token');
      // No refresh token stored.

      instanceMock.onGet('/auth/me').replyOnce(401, {});

      await expect(apiClient.get('/auth/me')).rejects.toMatchObject({
        status: 401,
      });

      // Refresh endpoint was never hit.
      const refreshCalls = moduleMock.history.post.filter((req) =>
        (req.url ?? '').includes('/auth/refresh')
      );
      expect(refreshCalls).toHaveLength(0);

      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('should reject when refresh succeeds but the retried request fails', async () => {
      setAuthToken('expired-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'valid-refresh-token');

      instanceMock.onGet('/auth/me').replyOnce(401, {});

      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });

      // Retried request still fails (e.g., backend 500).
      moduleMock.onGet(/\/auth\/me$/).replyOnce(500, { message: 'Server error' });

      await expect(apiClient.get('/auth/me')).rejects.toBeDefined();

      // Even though the retried request failed, refresh succeeded so the
      // new tokens MUST be persisted (no spurious logout).
      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBe('new-access-token');
      expect(localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY)).toBe('new-refresh-token');
    });
  });

  describe('Edge Cases', () => {
    it('should not retry if request was already retried (_retry flag)', async () => {
      setAuthToken('expired-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'refresh-token');

      // Inject _retry=true into the outgoing config so the interceptor
      // treats the 401 as a hard failure (no further refresh attempts).
      instanceMock.onGet('/auth/me').replyOnce((config) => {
        (config as unknown as { _retry?: boolean })._retry = true;
        return [401, {}];
      });

      await expect(apiClient.get('/auth/me')).rejects.toMatchObject({
        status: 401,
      });

      // Refresh was not attempted.
      const refreshCalls = moduleMock.history.post.filter((req) =>
        (req.url ?? '').includes('/auth/refresh')
      );
      expect(refreshCalls).toHaveLength(0);

      // Tokens cleared as fallback.
      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('should not refresh for /auth/refresh endpoint itself (no infinite loop)', async () => {
      setAuthToken('some-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'refresh-token');

      // A 401 returned BY the refresh endpoint must not trigger another
      // refresh — it must immediately clear tokens and reject.
      instanceMock.onPost('/auth/refresh').replyOnce(401, {});

      await expect(apiClient.post('/auth/refresh', { refreshToken: 'test' })).rejects.toMatchObject(
        {
          status: 401,
        }
      );

      // Only the one refresh post hit the instance; no fan-out via the module.
      expect(instanceMock.history.post).toHaveLength(1);
      const moduleRefreshCalls = moduleMock.history.post.filter((req) =>
        (req.url ?? '').includes('/auth/refresh')
      );
      expect(moduleRefreshCalls).toHaveLength(0);

      // Tokens cleared.
      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBeNull();
    });

    it('should handle non-401 errors normally without refresh', async () => {
      setAuthToken('valid-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'refresh-token');

      instanceMock.onGet('/some/endpoint').replyOnce(500, { message: 'Server error' });

      await expect(apiClient.get('/some/endpoint')).rejects.toMatchObject({
        message: expect.any(String),
        status: 500,
      });

      // Refresh was not attempted.
      const refreshCalls = moduleMock.history.post.filter((req) =>
        (req.url ?? '').includes('/auth/refresh')
      );
      expect(refreshCalls).toHaveLength(0);

      // Tokens preserved on non-auth errors.
      expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBe('valid-token');
      expect(localStorage.getItem(AUTH_CONFIG.REFRESH_TOKEN_KEY)).toBe('refresh-token');
    });
  });

  describe('Error Message Formatting', () => {
    it('should preserve SESSION_EXPIRED message in refresh failures', async () => {
      setAuthToken('expired-token');
      localStorage.setItem(AUTH_CONFIG.REFRESH_TOKEN_KEY, 'refresh-token');

      instanceMock.onGet('/auth/me').replyOnce(401, {});
      moduleMock
        .onPost(/\/auth\/refresh$/)
        .replyOnce(401, { message: 'Refresh token has been revoked' });

      await expect(apiClient.get('/auth/me')).rejects.toMatchObject({
        status: 401,
        // The interceptor surfaces the SESSION_EXPIRED constant rather than
        // the raw backend message — verify the contract.
        message: expect.stringMatching(/expired/i),
      });
    });
  });
});
