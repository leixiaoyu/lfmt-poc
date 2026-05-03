/**
 * Unit tests for the resolveApiUrl URL-normalisation helper.
 *
 * The function lives in `e2e/fixtures/url.ts` — a Playwright-free module
 * extracted specifically so it can be imported here without pulling in the
 * Playwright bootstrap. This file imports the real implementation; there is
 * no inline copy to drift.
 *
 * These tests lock in the API_BASE_URL env-var contract and prevent a
 * regression of the double-version-prefix bug fixed in
 * fix/e2e-register-via-api-double-v1-prefix:
 *
 *   In CI, API_BASE_URL is the CloudFormation ApiUrl output which already
 *   includes the /v1 stage suffix, e.g.:
 *     https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
 *   The old auth.ts helper stripped the trailing slash → .../v1, then
 *   appended /v1/auth/register → .../v1/v1/auth/register → HTTP 404.
 *   Fix: callers append only /auth/register (no /v1 prefix).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { resolveApiUrl } from '../../e2e/fixtures/url';

describe('resolveApiUrl (e2e/fixtures/url.ts contract)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('explicit apiBaseUrl argument', () => {
    it('returns URL unchanged when no trailing slash', () => {
      expect(resolveApiUrl('https://example.com/v1')).toBe('https://example.com/v1');
    });

    it('strips a single trailing slash', () => {
      expect(resolveApiUrl('https://example.com/v1/')).toBe('https://example.com/v1');
    });

    it('strips only the last character when input ends with //', () => {
      // Single strip: the function removes exactly one trailing slash per call.
      // A double-slash input is unusual but should not silently collapse further.
      expect(resolveApiUrl('https://example.com/v1//')).toBe('https://example.com/v1/');
    });

    it('key regression: CloudFormation ApiUrl format does not double-prefix v1', () => {
      // This is the exact value CI passes as API_BASE_URL (CloudFormation ApiUrl output).
      const cfnApiUrl = 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/';
      const resolved = resolveApiUrl(cfnApiUrl);
      // After normalisation, appending /auth/register must NOT produce /v1/v1/
      const fullUrl = `${resolved}/auth/register`;
      expect(fullUrl).toBe(
        'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/register'
      );
      expect(fullUrl).not.toContain('/v1/v1/');
    });
  });

  describe('API_BASE_URL environment variable fallback', () => {
    it('reads from process.env.API_BASE_URL when no argument provided', () => {
      vi.stubEnv('API_BASE_URL', 'https://env-api.example.com/v1');
      expect(resolveApiUrl()).toBe('https://env-api.example.com/v1');
    });

    it('strips trailing slash from env var value', () => {
      vi.stubEnv('API_BASE_URL', 'https://env-api.example.com/v1/');
      expect(resolveApiUrl()).toBe('https://env-api.example.com/v1');
    });

    it('explicit argument takes precedence over env var', () => {
      vi.stubEnv('API_BASE_URL', 'https://env-api.example.com/v1');
      expect(resolveApiUrl('https://override.example.com/v1')).toBe(
        'https://override.example.com/v1'
      );
    });
  });

  describe('default fallback (no argument, no env var)', () => {
    it('returns localhost:3000 when env var is absent', () => {
      // vi.unstubAllEnvs() is called in afterEach, so API_BASE_URL is not set.
      expect(resolveApiUrl()).toBe('http://localhost:3000');
    });
  });
});
