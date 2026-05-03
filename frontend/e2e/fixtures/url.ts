/**
 * URL utilities for E2E test fixtures.
 *
 * This module is intentionally free of any Playwright imports so that its
 * exports can be unit-tested with Vitest (jsdom) without dragging in the
 * Playwright bootstrap. E2E fixture files that need Playwright types (e.g.
 * auth.ts) import from here rather than inlining URL normalisation logic.
 *
 * @see auth.ts for the Playwright-dependent helpers that consume resolveApiUrl.
 */

/**
 * Resolve the API base URL from an optional override or the `API_BASE_URL`
 * environment variable, normalising it so callers can safely append a path
 * segment with a single leading slash.
 *
 * Contract (matches production-smoke.spec.ts and all backend integration
 * tests): `API_BASE_URL` already includes the API Gateway stage / version
 * prefix, e.g. `https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1`
 * (or the same URL with a trailing slash as emitted by CloudFormation's
 * `ApiUrl` output). Callers must therefore append only the resource path
 * (e.g. `/auth/register`) — NOT `/v1/auth/register` — to avoid the
 * double-prefix `.../v1/v1/auth/register` bug that produced HTTP 404s in CI.
 *
 * @param apiBaseUrl - Optional explicit override; falls back to
 *   `process.env.API_BASE_URL` then `http://localhost:3000`.
 */
export function resolveApiUrl(apiBaseUrl?: string): string {
  const raw = apiBaseUrl ?? process.env.API_BASE_URL ?? 'http://localhost:3000';
  // Strip a single trailing slash to avoid double-slash in composed URLs.
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}
