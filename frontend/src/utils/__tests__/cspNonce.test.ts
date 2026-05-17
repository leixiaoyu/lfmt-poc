/**
 * Tests for the CSP-nonce runtime accessor (Issue #254).
 *
 * The helper is intentionally tiny but the failure-modes matter:
 *   - Missing meta tag (dev server, SSR pre-hydration, jsdom default)
 *     → `undefined`, Emotion falls back to no-nonce.
 *   - Un-substituted `__CSP_NONCE__` placeholder (deploy regression,
 *     `npm run dev` mode) → `undefined` (NOT the literal token) so
 *     Emotion doesn't stamp the placeholder onto every style tag.
 *   - Empty `content=""` attribute → `undefined`.
 *   - Valid nonce → the string verbatim.
 */
import { describe, test, expect, afterEach } from 'vitest';
import { getCspNonceFromMeta } from '../cspNonce';

function ensureMetaTag(content: string | null): void {
  const existing = document.querySelector('meta[name="csp-nonce"]');
  if (existing) existing.remove();
  if (content === null) return;
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'csp-nonce');
  meta.setAttribute('content', content);
  document.head.appendChild(meta);
}

describe('getCspNonceFromMeta', () => {
  afterEach(() => {
    ensureMetaTag(null);
  });

  test('returns undefined when no meta tag is present', () => {
    ensureMetaTag(null);
    expect(getCspNonceFromMeta()).toBeUndefined();
  });

  test('returns undefined when content is empty', () => {
    ensureMetaTag('');
    expect(getCspNonceFromMeta()).toBeUndefined();
  });

  test('returns undefined when content is the un-substituted placeholder', () => {
    // Dev-mode case: Vite serves `index.html` without running the CDK
    // custom resource, so the placeholder is still literal. Emotion
    // must fall back to no-nonce in that case (or it would stamp
    // `nonce="__CSP_NONCE__"` onto every style tag and the production
    // CSP would block them all).
    ensureMetaTag('__CSP_NONCE__');
    expect(getCspNonceFromMeta()).toBeUndefined();
  });

  test('returns the verbatim nonce when the meta tag is properly stamped', () => {
    // Sample base64url string the CDK custom resource would emit:
    // `randomBytes(24).toString('base64url')` produces 32 chars,
    // ASCII-safe (no `'`, `;`, whitespace).
    const realNonce = 'aBcDeF1234567890aBcDeF1234567890';
    ensureMetaTag(realNonce);
    expect(getCspNonceFromMeta()).toBe(realNonce);
  });
});
