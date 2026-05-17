/**
 * Tests for the CSP nonce custom-resource handler (Issue #254).
 *
 * These tests exercise the pure helpers (`generateNonce`, `applyNonceToHtml`)
 * directly because they have no AWS-SDK or CloudFormation contract surface.
 * The `handler` itself is integration-tested by `cdk deploy` in CI; mocking
 * the SDK + CFN response envelope here would re-prove the SDK contract
 * rather than the LFMT-specific logic.
 */

import { applyNonceToHtml, generateNonce } from './cspNonceCustomResource';

describe('cspNonceCustomResource — generateNonce', () => {
  test('produces a base64url string (no `+`, `/`, or `=`)', () => {
    const nonce = generateNonce();
    expect(typeof nonce).toBe('string');
    // base64url alphabet: A-Z, a-z, 0-9, `-`, `_`. NO `+`, `/`, `=`.
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('contains at least 128 bits of entropy', () => {
    // base64url encoding: 4 chars per 3 bytes. 24 bytes → 32 chars.
    // CSP3 §6.7 requires ≥ 128 bits = 16 bytes. We emit 24 bytes (192 bits)
    // so the encoded length is at least 32 chars (no padding) — a regression
    // that swapped to a shorter byte length would trip this assertion.
    const nonce = generateNonce();
    expect(nonce.length).toBeGreaterThanOrEqual(22); // 16 bytes → 22 base64url chars
  });

  test('successive calls produce distinct values', () => {
    // Crypto-random — collision probability is astronomical, but the
    // assertion is a load-bearing defense against an accidental swap to
    // a deterministic implementation (e.g. `Date.now().toString(36)`).
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
  });
});

describe('cspNonceCustomResource — applyNonceToHtml', () => {
  test('replaces a single placeholder occurrence', () => {
    const html = '<meta name="csp-nonce" content="__CSP_NONCE__">';
    const out = applyNonceToHtml(html, 'abc123');
    expect(out).toBe('<meta name="csp-nonce" content="abc123">');
  });

  test('replaces every occurrence (defensive — should only ever be one)', () => {
    // The contract is "one meta tag" but a future template change might
    // legitimately inline the nonce elsewhere (e.g. a SRI hash hint).
    // Global replacement keeps that path open without code changes.
    const html = '<a data-n="__CSP_NONCE__"><b data-n="__CSP_NONCE__"></b></a>';
    const out = applyNonceToHtml(html, 'xyz');
    expect(out).toBe('<a data-n="xyz"><b data-n="xyz"></b></a>');
  });

  test('is a no-op when the placeholder is absent', () => {
    // E.g. a previous deploy already substituted the value, or the
    // template was edited to remove the meta tag. The handler must
    // not throw or corrupt the HTML in that case.
    const html = '<html><head><title>LFMT</title></head></html>';
    expect(applyNonceToHtml(html, 'abc')).toBe(html);
  });

  test('does not treat regex metacharacters in the nonce as patterns', () => {
    // Defensive: base64url cannot produce `.`, but a future nonce
    // generator that does would break a naive RegExp-based replacement.
    // Verify literal-string replacement semantics.
    const html = '<meta content="__CSP_NONCE__">';
    const nonceWithDot = 'a.b.c';
    expect(applyNonceToHtml(html, nonceWithDot)).toBe('<meta content="a.b.c">');
  });
});
