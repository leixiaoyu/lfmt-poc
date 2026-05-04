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
 * Storage model: Issue #196 introduced the one-blob session under
 * `AUTH_CONFIG.SESSION_KEY`. All assertions read the blob through the
 * canonical helpers (`getStoredSession`) so that any future change to
 * the blob shape only needs to touch this file in one place.
 *
 * Key scenarios tested:
 * - Successful token refresh and request retry (flat mock shape)
 * - Successful token refresh with the REAL backend wrapped shape
 *   { message, data: { accessToken, idToken, expiresIn }, requestId }
 * - Authorization header on retried request carries idToken, not accessToken
 * - Concurrent request queuing during refresh (single refresh fan-out)
 * - Refresh failures and fallback behavior (clear tokens)
 * - Edge cases: missing refresh token, _retry guard, /auth/refresh URL
 *   guard, non-401 passthrough, empty bearer treated as failure
 * - Error message formatting on refresh failure
 * - Old refresh token survives when Cognito omits it from the response
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createApiClient, getStoredSession, setStoredSession } from '../api';
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
    it('should refresh token on 401 and retry original request (flat mock shape)', async () => {
      const expiredIdToken = 'expired-id-token';
      const refreshToken = 'valid-refresh-token';
      const newAccessToken = 'new-access-token';
      // Deliberately different from newAccessToken so the assertion
      // distinguishes which token ended up in the Bearer header.
      const newIdToken = 'new-id-token';
      const newRefreshToken = 'new-refresh-token';

      setStoredSession({
        idToken: expiredIdToken,
        accessToken: 'old-access',
        refreshToken,
      });

      // First call to /auth/me → 401, then retry succeeds.
      instanceMock.onGet('/auth/me').replyOnce(401, { message: 'Token expired' });

      // Flat mock shape (backward-compat; see api.ts comment).
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: newAccessToken,
        idToken: newIdToken,
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

      // Blob now holds the rotated tokens, atomically.
      const session = getStoredSession();
      expect(session?.idToken).toBe(newIdToken);
      expect(session?.accessToken).toBe(newAccessToken);
      expect(session?.refreshToken).toBe(newRefreshToken);

      // Retry succeeded.
      expect(response.data).toEqual({ message: 'Success with new token' });
    });

    it('should extract idToken from the real backend wrapped response shape', async () => {
      // This test uses the ACTUAL backend response shape produced by
      // `createSuccessResponse()`:
      //   { message, data: { accessToken, idToken, expiresIn }, requestId }
      //
      // The flat mock shape used by other tests exercises the compat path.
      // This test ensures the interceptor extracts tokens from the nested
      // `data` field — the absence of this test was the root cause that
      // allowed the original wrong-token bug to ship undetected.
      const newAccessToken = 'wrapped-access-token';
      const newIdToken = 'wrapped-id-token'; // distinct value — must end up as Bearer

      setStoredSession({
        idToken: 'expired-id-token',
        accessToken: 'expired-access',
        refreshToken: 'some-refresh-token',
      });

      instanceMock.onGet('/protected').replyOnce(401, {});

      // Wrapped shape — matches what the backend actually sends:
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        message: 'Tokens refreshed successfully',
        data: {
          accessToken: newAccessToken,
          idToken: newIdToken,
          expiresIn: 3600,
        },
        requestId: 'req-abc-123',
      });

      moduleMock.onGet(/\/protected$/).replyOnce(200, { ok: true });

      await apiClient.get('/protected');

      // ID token extracted from response.data.data.idToken — the nested field.
      const session = getStoredSession();
      expect(session?.idToken).toBe(newIdToken);
      expect(session?.accessToken).toBe(newAccessToken);
    });

    it('should send the new idToken (not accessToken) as Authorization Bearer on the retried request', async () => {
      // Critical 2: assert the Authorization header on the RETRIED request
      // carries the idToken. Using deliberately different values for
      // accessToken and idToken so any mix-up is caught.
      const newAccessToken = 'retry-access-token';
      const newIdToken = 'retry-id-token';

      setStoredSession({
        idToken: 'old-id-token',
        accessToken: 'old-access',
        refreshToken: 'some-refresh-token',
      });

      instanceMock.onGet('/auth/me').replyOnce(401, {});

      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: newAccessToken,
        idToken: newIdToken,
        refreshToken: 'new-refresh-token',
      });

      // Capture the Authorization header on the retry.
      let capturedAuthHeader: string | undefined;
      moduleMock.onGet(/\/auth\/me$/).replyOnce((config) => {
        capturedAuthHeader = (config.headers as Record<string, string>)['Authorization'];
        return [200, { ok: true }];
      });

      await apiClient.get('/auth/me');

      // The retried request MUST use the idToken, not the accessToken.
      expect(capturedAuthHeader).toBe(`Bearer ${newIdToken}`);
      expect(capturedAuthHeader).not.toBe(`Bearer ${newAccessToken}`);
    });

    it('should queue concurrent requests during token refresh (single refresh fan-out)', async () => {
      const refreshToken = 'valid-refresh-token';
      const newAccessToken = 'new-access-token';
      const newIdToken = 'new-id-token';
      const newRefreshToken = 'new-refresh-token';

      setStoredSession({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        refreshToken,
      });

      // Each in-flight request gets its own 401.
      instanceMock.onGet('/endpoint1').replyOnce(401, {});
      instanceMock.onGet('/endpoint2').replyOnce(401, {});
      instanceMock.onGet('/endpoint3').replyOnce(401, {});

      // Refresh: only one should fire even though three 401s land at once.
      // We use replyOnce so a second refresh call would surface as
      // "no handler" and reject.
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: newAccessToken,
        idToken: newIdToken,
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
      const newIdToken = 'new-id-token';

      setStoredSession({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        refreshToken: initialRefreshToken,
      });

      instanceMock.onGet('/auth/me').replyOnce(401, {});

      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: newAccessToken,
        idToken: newIdToken,
        refreshToken: rotatedRefreshToken,
      });
      moduleMock.onGet(/\/auth\/me$/).replyOnce(200, { ok: true });

      await apiClient.get('/auth/me');

      // Rotation: refresh token in storage replaced with the rotated value.
      const session = getStoredSession();
      expect(session?.refreshToken).toBe(rotatedRefreshToken);
      expect(session?.refreshToken).not.toBe(initialRefreshToken);
      // ID token is the Bearer credential; access token stored separately.
      expect(session?.idToken).toBe(newIdToken);
      expect(session?.accessToken).toBe(newAccessToken);
    });
  });

  describe('Refresh Failures', () => {
    it('should clear tokens and reject if refresh fails', async () => {
      setStoredSession({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        refreshToken: 'valid-refresh-token',
        user: { id: 'u1' },
      });

      instanceMock.onGet('/auth/me').replyOnce(401, {});
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(401, { message: 'Refresh token expired' });

      await expect(apiClient.get('/auth/me')).rejects.toMatchObject({
        message: expect.stringContaining('expired'),
        status: 401,
      });

      // Session blob cleared.
      expect(getStoredSession()).toBeNull();
      expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();
    });

    it('should clear tokens immediately if no refresh token exists', async () => {
      setStoredSession({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        // No refresh token stored.
      });

      instanceMock.onGet('/auth/me').replyOnce(401, {});

      await expect(apiClient.get('/auth/me')).rejects.toMatchObject({
        status: 401,
      });

      // Refresh endpoint was never hit.
      const refreshCalls = moduleMock.history.post.filter((req) =>
        (req.url ?? '').includes('/auth/refresh')
      );
      expect(refreshCalls).toHaveLength(0);

      expect(getStoredSession()).toBeNull();
    });

    it('should reject when refresh succeeds but the retried request fails', async () => {
      setStoredSession({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        refreshToken: 'valid-refresh-token',
      });

      instanceMock.onGet('/auth/me').replyOnce(401, {});

      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: 'new-access-token',
        idToken: 'new-id-token',
        refreshToken: 'new-refresh-token',
      });

      // Retried request still fails (e.g., backend 500).
      moduleMock.onGet(/\/auth\/me$/).replyOnce(500, { message: 'Server error' });

      await expect(apiClient.get('/auth/me')).rejects.toBeDefined();

      // Even though the retried request failed, refresh succeeded so the
      // new tokens MUST be persisted (no spurious logout).
      const session = getStoredSession();
      expect(session?.idToken).toBe('new-id-token');
      expect(session?.accessToken).toBe('new-access-token');
      expect(session?.refreshToken).toBe('new-refresh-token');
    });
  });

  describe('Edge Cases', () => {
    it('should not retry if request was already retried (_retry flag)', async () => {
      setStoredSession({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        refreshToken: 'refresh-token',
      });

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
      expect(getStoredSession()).toBeNull();
    });

    it('should not refresh for /auth/refresh endpoint itself (no infinite loop)', async () => {
      setStoredSession({
        idToken: 'some-id',
        accessToken: 'some-access',
        refreshToken: 'refresh-token',
      });

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
      expect(getStoredSession()).toBeNull();
    });

    it('should handle non-401 errors normally without refresh', async () => {
      setStoredSession({
        idToken: 'valid-id',
        accessToken: 'valid-access',
        refreshToken: 'refresh-token',
      });

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
      const session = getStoredSession();
      expect(session?.idToken).toBe('valid-id');
      expect(session?.refreshToken).toBe('refresh-token');
    });

    it('should treat an empty bearer from the refresh response as a failure and clear tokens', async () => {
      // Security Rec 1: a malformed/empty refresh response must not silently
      // store an empty string as the Bearer token. An empty Bearer header
      // would cause every subsequent request to 401 immediately — the
      // interceptor must treat this the same as a refresh failure.
      setStoredSession({
        idToken: 'old-id-token',
        accessToken: 'old-access',
        refreshToken: 'valid-refresh',
      });

      instanceMock.onGet('/protected').replyOnce(401, {});

      // Backend returns a response with both tokens empty/absent.
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        // No accessToken, no idToken → bearerToken = '' → should trigger logout.
        message: 'ok',
      });

      await expect(apiClient.get('/protected')).rejects.toMatchObject({
        status: 401,
        message: expect.stringMatching(/expired/i),
      });

      // Session cleared — not an empty-string bearer.
      expect(getStoredSession()).toBeNull();
    });

    it('should preserve the existing refresh token when Cognito omits it from the refresh response', async () => {
      // Test Rec 5: Cognito REFRESH_TOKEN_AUTH does not return a new refresh
      // token. The interceptor must fall back to the stored value rather than
      // overwriting it with an empty/undefined string.
      const originalRefreshToken = 'cognito-original-refresh-token';

      setStoredSession({
        idToken: 'old-id-token',
        accessToken: 'old-access',
        refreshToken: originalRefreshToken,
      });

      instanceMock.onGet('/protected').replyOnce(401, {});

      // Refresh endpoint omits refreshToken — Cognito real behaviour.
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        accessToken: 'new-access-token',
        idToken: 'new-id-token',
        // No refreshToken field.
      });

      moduleMock.onGet(/\/protected$/).replyOnce(200, { ok: true });

      await apiClient.get('/protected');

      // Original refresh token MUST survive.
      expect(getStoredSession()?.refreshToken).toBe(originalRefreshToken);
    });
  });

  describe('End-to-End: Login → Call → 401 → Refresh Chain', () => {
    it('should recover transparently from a 401 on a post-login API call using the correct idToken', async () => {
      // Test Rec 3: exercises the full happy-path through-the-401-recovery
      // cycle to catch token-type bugs at Vitest speed.
      //
      // Sequence:
      //   1. Simulate "just logged in" — store idToken + accessToken in the blob.
      //   2. Make an authenticated API call → 401 (id token expired).
      //   3. Interceptor refreshes — backend returns new idToken + accessToken.
      //   4. Interceptor retries with new idToken.
      //   5. Assert: (a) correct token in storage, (b) retry used idToken
      //      not accessToken in Authorization header.
      const loginIdToken = 'login-id-token';
      const loginAccessToken = 'login-access-token';
      const newIdToken = 'refreshed-id-token'; // distinct from newAccessToken
      const newAccessToken = 'refreshed-access-token';

      // Step 1: simulate post-login state.
      setStoredSession({
        idToken: loginIdToken,
        accessToken: loginAccessToken,
        refreshToken: 'user-refresh-token',
      });

      // Step 2: API call → 401.
      instanceMock.onPost('/jobs/translate').replyOnce(401, { message: 'Token expired' });

      // Step 3: refresh → new tokens (wrapped backend shape to also cover Critical 1).
      moduleMock.onPost(/\/auth\/refresh$/).replyOnce(200, {
        message: 'Tokens refreshed successfully',
        data: { accessToken: newAccessToken, idToken: newIdToken, expiresIn: 3600 },
        requestId: 'req-chain-test',
      });

      // Step 4: retried POST — capture auth header.
      let authHeaderOnRetry: string | undefined;
      moduleMock.onPost(/\/jobs\/translate$/).replyOnce((config) => {
        authHeaderOnRetry = (config.headers as Record<string, string>)['Authorization'];
        return [200, { jobId: 'job-abc' }];
      });

      const result = await apiClient.post('/jobs/translate', { language: 'es' });

      // Step 5a: tokens in storage.
      const session = getStoredSession();
      expect(session?.idToken).toBe(newIdToken);
      expect(session?.accessToken).toBe(newAccessToken);

      // Step 5b: retry used idToken, not accessToken.
      expect(authHeaderOnRetry).toBe(`Bearer ${newIdToken}`);
      expect(authHeaderOnRetry).not.toBe(`Bearer ${newAccessToken}`);

      // Underlying call returned the expected body.
      expect(result.data).toEqual({ jobId: 'job-abc' });
    });
  });

  describe('Error Message Formatting', () => {
    it('should preserve SESSION_EXPIRED message in refresh failures', async () => {
      setStoredSession({
        idToken: 'expired-id',
        accessToken: 'expired-access',
        refreshToken: 'refresh-token',
      });

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
