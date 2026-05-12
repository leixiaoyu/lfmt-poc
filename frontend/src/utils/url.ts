/**
 * URL utilities shared between production code and E2E test fixtures.
 *
 * This module must remain free of Vite-specific imports (import.meta.env)
 * so it can be imported by E2E fixtures running under Node.js (Playwright /
 * Vitest jsdom) without triggering Vite's build-time variable substitution.
 *
 * #231: extracted from two divergent implementations:
 *   - frontend/src/config/constants.ts  used .replace(/\/+$/, '')  (greedy)
 *   - frontend/e2e/fixtures/url.ts      used .slice(0, -1)          (single)
 * Both sites now delegate here so the canonicalisation is a single source
 * of truth.
 */

/**
 * Strip all trailing slashes from a URL string.
 *
 * Uses a greedy regex so multiple consecutive trailing slashes are all
 * removed in one pass — e.g. `https://example.com/v1//` becomes
 * `https://example.com/v1`.  This is the canonical normalisation for API
 * base URLs in this codebase: CloudFormation emits at most one trailing
 * slash, but the helper is defensive against accidental doubles.
 *
 * @example
 * stripTrailingSlashes('https://example.com/v1/')   // 'https://example.com/v1'
 * stripTrailingSlashes('https://example.com/v1//')  // 'https://example.com/v1'
 * stripTrailingSlashes('https://example.com/v1')    // 'https://example.com/v1'
 */
export function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '');
}
