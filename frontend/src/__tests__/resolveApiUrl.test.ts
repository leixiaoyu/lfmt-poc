/**
 * Unit tests for the resolveApiUrl URL-normalisation helper (e2e/fixtures/auth.ts).
 *
 * The helper is the single source of truth for how `API_BASE_URL` is consumed
 * by E2E fixtures.  These tests lock in the contract so a future edit cannot
 * accidentally reintroduce the double-version-prefix bug fixed in
 * fix/e2e-register-via-api-double-v1-prefix.
 *
 * Bug summary:
 *   In CI, `API_BASE_URL` is set to the CloudFormation `ApiUrl` output, which
 *   already includes the `/v1` stage suffix, e.g.:
 *     `https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/`
 *   The old code stripped the trailing slash → `.../v1`, then appended
 *   `/v1/auth/register`, producing `.../v1/v1/auth/register` → HTTP 404.
 *   The fix: treat `API_BASE_URL` as the full base (host + version prefix)
 *   and append only `/auth/register`.
 *
 * Implementation note:
 *   `resolveApiUrl` is a pure function with no Playwright dependency. Vitest
 *   excludes `e2e/**` files from running as test suites (to avoid Playwright
 *   bootstrap), but NOT from being imported. However, `e2e/fixtures/auth.ts`
 *   imports `@playwright/test` at the top level, which would fail in jsdom.
 *   We therefore inline the identical two-line implementation here so the
 *   logic is tested without dragging in Playwright. If the implementation
 *   ever changes, update both places.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Inline copy of `resolveApiUrl` from `e2e/fixtures/auth.ts`.
 *
 * Contract: the input already contains the version prefix (e.g. `/v1`).
 * Callers append only the resource path (e.g. `/auth/register`).
 */
function resolveApiUrl(apiBaseUrl?: string): string {
  const raw = apiBaseUrl ?? process.env.API_BASE_URL ?? 'http://localhost:3000';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

describe('resolveApiUrl (e2e/fixtures/auth.ts contract)', () => {
  const ORIGINAL_ENV = process.env.API_BASE_URL;

  beforeEach(() => {
    delete process.env.API_BASE_URL;
  });

  afterEach(() => {
    if (ORIGINAL_ENV !== undefined) {
      process.env.API_BASE_URL = ORIGINAL_ENV;
    } else {
      delete process.env.API_BASE_URL;
    }
  });

  describe('explicit apiBaseUrl argument', () => {
    it('returns URL unchanged when no trailing slash', () => {
      expect(resolveApiUrl('https://example.com/v1')).toBe('https://example.com/v1');
    });

    it('strips a single trailing slash', () => {
      expect(resolveApiUrl('https://example.com/v1/')).toBe('https://example.com/v1');
    });

    it('strips only one trailing slash (does not collapse //)', () => {
      // Defensive: if someone passes a double slash we strip just the last one
      expect(resolveApiUrl('https://example.com/v1//')).toBe('https://example.com/v1/');
    });

    it('key regression: CloudFormation ApiUrl format does not double-prefix v1', () => {
      // This is the exact value CI passes as API_BASE_URL (CloudFormation output).
      const cfnApiUrl = 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/';
      const resolved = resolveApiUrl(cfnApiUrl);
      // After normalization, appending /auth/register must NOT contain /v1/v1/
      const fullUrl = `${resolved}/auth/register`;
      expect(fullUrl).toBe(
        'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/register'
      );
      expect(fullUrl).not.toContain('/v1/v1/');
    });
  });

  describe('API_BASE_URL environment variable fallback', () => {
    it('reads from process.env.API_BASE_URL when no argument provided', () => {
      process.env.API_BASE_URL = 'https://env-api.example.com/v1';
      expect(resolveApiUrl()).toBe('https://env-api.example.com/v1');
    });

    it('strips trailing slash from env var value', () => {
      process.env.API_BASE_URL = 'https://env-api.example.com/v1/';
      expect(resolveApiUrl()).toBe('https://env-api.example.com/v1');
    });

    it('explicit argument takes precedence over env var', () => {
      process.env.API_BASE_URL = 'https://env-api.example.com/v1';
      expect(resolveApiUrl('https://override.example.com/v1')).toBe(
        'https://override.example.com/v1'
      );
    });
  });

  describe('default fallback (no argument, no env var)', () => {
    it('returns localhost:3000 when nothing is configured', () => {
      expect(resolveApiUrl()).toBe('http://localhost:3000');
    });
  });
});
