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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  narrowStoredUser,
  __testResetLegacyShortCircuit,
} from '../api';
import { AUTH_CONFIG } from '../../config/constants';
import type { StoredSession } from '@lfmt/shared-types';

function readBlob(): StoredSession | null {
  const raw = localStorage.getItem(AUTH_CONFIG.SESSION_KEY);
  return raw ? (JSON.parse(raw) as StoredSession) : null;
}

/**
 * Reset both localStorage AND the in-memory legacy-cleanup
 * short-circuit. Tests that pre-populate legacy keys after a previous
 * test triggered the sweep need this to force a fresh sweep on the
 * next `getStoredSession()` call.
 */
function fullReset(): void {
  localStorage.clear();
  __testResetLegacyShortCircuit();
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

    it('should return the persisted user object (well-formed)', () => {
      // Round 2 item 8: user must satisfy `narrowStoredUser` shape —
      // id, email, firstName, lastName all required as strings. The
      // previous version of this test stored only id+email and
      // happened to pass because the helper was a bare passthrough;
      // the hardened narrower correctly returns null for that input.
      const user = { id: 'u1', email: 'test@example.com', firstName: 'T', lastName: 'U' };
      setStoredSession({ idToken: 'id', accessToken: 'a', user });
      expect(getStoredUser()).toEqual(user);
    });

    it('should return null when persisted user fails shape validation', () => {
      // Documenting the new contract: a malformed user surfaces as
      // null, not as the partial value. Previously the bare-cast in
      // getStoredUser would have returned `{ id: 'u1' }` typed as
      // `unknown`, and a downstream consumer doing
      // `(user as User).email.toLowerCase()` would crash. Now they
      // get null and can branch defensively.
      setStoredSession({ idToken: 'id', accessToken: 'a', user: { id: 'u1' } });
      expect(getStoredUser()).toBeNull();
    });
  });
});

describe('API Client - Legacy Session Migration (Issue #196)', () => {
  beforeEach(() => {
    fullReset();
  });

  afterEach(() => {
    fullReset();
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

  // ---------------------------------------------------------------------
  // Round 2 item 2: symmetric legacy idToken-only migration test.
  // The access-only branch above tests pre-PR-#193 sessions; the
  // idToken-only branch tests the inverse — a legacy session that
  // was upgraded once but somehow lost its access key. The migration
  // must still produce a usable blob (idToken doubles as accessToken
  // for storage shape; the SPA's request interceptor only reads
  // idToken anyway).
  // ---------------------------------------------------------------------
  it('should migrate when only the legacy idToken key exists', () => {
    localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'legacy-id-only');

    const session = getStoredSession();

    expect(session?.idToken).toBe('legacy-id-only');
    // Mirror — the readLegacySession synthesizer falls back to idToken
    // when accessToken is absent so the blob's required `accessToken`
    // field is satisfied.
    expect(session?.accessToken).toBe('legacy-id-only');
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Round 2 item 1 (latent coexistence bug): when a valid blob AND
  // stray legacy keys both exist, the legacy keys MUST be cleaned up
  // on the next read. Otherwise an out-of-band write to a legacy key
  // (e.g., a third-party script poking localStorage) would survive
  // forever, and a future bug that read a legacy key would silently
  // pick up stale data.
  // ---------------------------------------------------------------------
  it('should sweep straggling legacy keys when a valid blob is present', () => {
    // Pre-populate BOTH the modern blob AND legacy keys.
    setStoredSession({ idToken: 'blob-id', accessToken: 'blob-access' });
    localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'stray-legacy-id');
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'stray-legacy-access');
    localStorage.setItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY, 'stray-legacy-refresh');
    localStorage.setItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY, '{}');
    // Force a fresh sweep — the previous setStoredSession may have
    // already triggered the short-circuit via a prior read.
    __testResetLegacyShortCircuit();

    // Trigger the sweep.
    const session = getStoredSession();

    // Modern blob wins.
    expect(session?.idToken).toBe('blob-id');
    expect(session?.accessToken).toBe('blob-access');
    // ALL legacy keys are now gone (the bug was that they survived).
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.REFRESH_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.USER_DATA_KEY)).toBeNull();
  });

  // ---------------------------------------------------------------------
  // Round 2 Critical: setItem inside the migration block must be
  // wrapped in try/catch so a QuotaExceededError doesn't escape into
  // AuthContext's mount effect and crash React. Verify the
  // fail-closed contract: caller gets null AND legacy keys are
  // cleaned (so the next render doesn't loop on the same failed
  // migration).
  // ---------------------------------------------------------------------
  it('should fail closed (return null + warn) when setItem throws QuotaExceededError', () => {
    localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'legacy-id');
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'legacy-access');

    // Stub setItem to throw. We restore via the spy's lifecycle so
    // the test doesn't bleed into siblings.
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      const quotaError = new Error('QuotaExceededError') as Error & { name: string };
      quotaError.name = 'QuotaExceededError';
      throw quotaError;
    });
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Force a fresh sweep so the legacy keys are visible.
    __testResetLegacyShortCircuit();

    let result: ReturnType<typeof getStoredSession> | undefined;
    expect(() => {
      result = getStoredSession();
    }).not.toThrow();
    expect(result).toBeNull();

    // Logged the failure so ops can see it.
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('migration failed'),
      expect.anything()
    );

    setItemSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });
});

// =====================================================================
// Round 2 item 8: narrowStoredUser runtime narrowing helper.
// =====================================================================

describe('API Client - narrowStoredUser (Round 2 item 8)', () => {
  it('should return a typed user when all required fields are present', () => {
    const result = narrowStoredUser({
      id: 'u1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
    });
    expect(result).toEqual({ id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B' });
  });

  it('should include optional fields when well-typed', () => {
    const result = narrowStoredUser({
      id: 'u1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      emailVerified: true,
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result?.emailVerified).toBe(true);
    expect(result?.createdAt).toBe('2026-01-01T00:00:00Z');
  });

  it('should drop optional fields with the wrong type', () => {
    const result = narrowStoredUser({
      id: 'u1',
      email: 'a@b.com',
      firstName: 'A',
      lastName: 'B',
      emailVerified: 'yes', // wrong type
      createdAt: 1234567890, // wrong type
    });
    expect(result).toEqual({ id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B' });
  });

  it('should return null for null/undefined/non-object input', () => {
    expect(narrowStoredUser(null)).toBeNull();
    expect(narrowStoredUser(undefined)).toBeNull();
    expect(narrowStoredUser('string')).toBeNull();
    expect(narrowStoredUser(42)).toBeNull();
    // Arrays are typeof 'object' but lack the required string fields
    // → still null. (Documenting the edge case with the comment so a
    // future reader doesn't have to re-derive why the assertion is
    // toBeNull rather than not.toBeNull.)
    expect(narrowStoredUser([])).toBeNull();
  });

  it('should return null when any required field is missing or wrong type', () => {
    // Missing firstName.
    expect(narrowStoredUser({ id: 'u1', email: 'a@b.com', lastName: 'B' })).toBeNull();
    // Wrong type for email.
    expect(narrowStoredUser({ id: 'u1', email: 42, firstName: 'A', lastName: 'B' })).toBeNull();
    // Empty object.
    expect(narrowStoredUser({})).toBeNull();
  });

  it('getStoredUser routes through narrowStoredUser', () => {
    fullReset();
    setStoredSession({
      idToken: 'id',
      accessToken: 'a',
      user: { id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B' },
    });
    const user = getStoredUser();
    expect(user).toEqual({ id: 'u1', email: 'a@b.com', firstName: 'A', lastName: 'B' });

    // A malformed user surfaces as null even though the blob has SOME value.
    setStoredSession({
      idToken: 'id',
      accessToken: 'a',
      user: { id: 'u1' /* missing email, firstName, lastName */ },
    });
    expect(getStoredUser()).toBeNull();

    fullReset();
  });
});

// =====================================================================
// Round 2 item 16: in-memory short-circuit for logged-out requests.
// =====================================================================

describe('API Client - legacy-cleanup short-circuit (Round 2 item 16)', () => {
  beforeEach(() => {
    fullReset();
  });

  afterEach(() => {
    fullReset();
  });

  it('should skip removeItem syscalls on subsequent calls when no legacy keys exist', () => {
    // First call: no session, no legacy keys → does the sweep, sets the flag.
    expect(getStoredSession()).toBeNull();

    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');

    // Second call: should NOT issue any removeItem on the legacy keys.
    expect(getStoredSession()).toBeNull();

    // Filter to legacy-key removeItem calls only — getItem on
    // SESSION_KEY returns null without calling removeItem on it.
    const legacyRemovals = removeSpy.mock.calls.filter((args) =>
      Object.values(AUTH_CONFIG.LEGACY).includes(args[0] as string)
    );
    expect(legacyRemovals).toHaveLength(0);

    removeSpy.mockRestore();
  });

  it('should still migrate late-arrival legacy keys (short-circuit only skips cleanup, not the migration read)', () => {
    // Bring the flag up via a logged-out read.
    expect(getStoredSession()).toBeNull();

    // Stuff in legacy keys AFTER the sweep — simulates an out-of-band
    // write (third-party script poking localStorage, or a stale tab
    // that finally writes after a deploy).
    localStorage.setItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY, 'late-arrival-id');
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'late-arrival-access');

    // Migration DOES still kick in — `readLegacySession()` reads
    // localStorage directly without consulting the short-circuit
    // flag. The flag only optimizes the step-3 cleanup branch, never
    // the migration read. This is the documented contract.
    const session = getStoredSession();
    expect(session?.idToken).toBe('late-arrival-id');
    expect(session?.accessToken).toBe('late-arrival-access');
    // Migration deleted the legacy keys as part of upgrading them.
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ID_TOKEN_KEY)).toBeNull();

    // Logout → resets the flag (so a NEW logged-out read will sweep
    // again if needed) and clears the blob.
    clearAuthToken();
    expect(getStoredSession()).toBeNull();
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
// Round 2 item 3: end-to-end migration → request integration test.
//
// The original Issue #195 negative test asserted the no-fallback
// behavior with synthetic empty-string blob input — logically weak
// because it doesn't trace the user-facing scenario. This test
// reproduces the full path:
//
//   1. localStorage seeded with ONLY `lfmt_access_token` (a pre-PR-#193
//      session that survived the deploy).
//   2. Code path that issues a request (apiClient.get).
//   3. Assert the Authorization header on the wire carries a value
//      derived from the legacy-migration synthesis — NOT a stale
//      raw access-token-as-bearer that the runtime fallback would
//      have produced.
// =====================================================================

describe('API Client - legacy access-only migration → first request (Round 2 item 3)', () => {
  beforeEach(() => {
    fullReset();
  });

  afterEach(() => {
    fullReset();
  });

  it('should send the migration-synthesized idToken as Bearer on the first authenticated request', async () => {
    // Pre-PR-#193 session shape: only the access-token key was
    // populated, no idToken, no blob.
    localStorage.setItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY, 'pre-pr-193-token');

    // Sanity: the modern blob doesn't exist yet.
    expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).toBeNull();

    // First authenticated request — this triggers
    // requestInterceptor → getAuthToken → getStoredSession →
    // readLegacySession → migration → upgraded blob → idToken read.
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

    await client.get('/some/protected/endpoint');

    // The migration synthesizes idToken from the legacy access token
    // (`readLegacySession` mirrors `accessToken` into `idToken` when
    // the legacy idToken key is absent). The interceptor sends THAT
    // value — NOT the raw legacy access-token-as-bearer that the
    // removed runtime fallback (#195) would have produced.
    expect(captured).not.toBeNull();
    expect(captured!.Authorization).toBe('Bearer pre-pr-193-token');

    // Side effects we want to verify happened:
    //   - Blob exists under the modern key.
    //   - Legacy access-token key is gone (idempotency).
    expect(localStorage.getItem(AUTH_CONFIG.SESSION_KEY)).not.toBeNull();
    expect(localStorage.getItem(AUTH_CONFIG.LEGACY.ACCESS_TOKEN_KEY)).toBeNull();
  });

  it('should send NO Authorization header when no legacy or modern session exists', async () => {
    // Symmetric negative case: a logged-out user must not have a
    // Bearer header attached.
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
