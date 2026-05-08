/**
 * Header Filters Unit Tests
 *
 * Locks the contract of `stripBrowserForbiddenHeaders` (PR #214 OMC C1):
 * - Filters Content-Length case-insensitively (the only header on the
 *   forbidden list today).
 * - Returns a NEW object — input is never mutated.
 * - Allows non-forbidden headers through unchanged.
 *
 * Coverage rationale: the helper is the seam where backend headers
 * cross into browser XHR land. Bugs here surface as the "Refused to
 * set unsafe header" warning class that hid the original 2026-05-08
 * demo-blocking incident, so we exhaustively pin the contract.
 */

import { describe, it, expect } from 'vitest';
import { BROWSER_FORBIDDEN_REQUEST_HEADERS, stripBrowserForbiddenHeaders } from '../headerFilters';

describe('stripBrowserForbiddenHeaders', () => {
  it('strips Content-Length (canonical Pascal-Case spelling)', () => {
    const filtered = stripBrowserForbiddenHeaders({
      'Content-Type': 'text/plain',
      'Content-Length': '7',
    });
    expect(filtered).toEqual({ 'Content-Type': 'text/plain' });
  });

  it('strips content-length (lowercase) — case-insensitive match', () => {
    const filtered = stripBrowserForbiddenHeaders({
      'content-type': 'text/plain',
      'content-length': '7',
    });
    expect(filtered).toEqual({ 'content-type': 'text/plain' });
  });

  it('strips CONTENT-LENGTH (uppercase) and odd casings (Content-LENGTH)', () => {
    const filtered = stripBrowserForbiddenHeaders({
      'CONTENT-LENGTH': '7',
      'Content-LENGTH': '7',
      'X-Trace-Id': 'abc',
    });
    expect(filtered).toEqual({ 'X-Trace-Id': 'abc' });
  });

  it('does NOT mutate the input object', () => {
    const input = {
      'Content-Type': 'text/plain',
      'Content-Length': '7',
    };
    const snapshot = { ...input };

    stripBrowserForbiddenHeaders(input);

    expect(input).toEqual(snapshot);
  });

  it('returns a NEW object reference (not the same ref as input)', () => {
    const input = { 'X-Trace-Id': 'abc' };
    const filtered = stripBrowserForbiddenHeaders(input);
    expect(filtered).not.toBe(input);
  });

  it('passes allowed headers through unchanged (Content-Type, x-amz-*)', () => {
    const input = {
      'Content-Type': 'application/octet-stream',
      'x-amz-server-side-encryption': 'AES256',
      'x-amz-meta-foo': 'bar',
      Authorization: 'Bearer token',
    };
    const filtered = stripBrowserForbiddenHeaders(input);
    expect(filtered).toEqual(input);
    // Stronger guard — entries identical, key order preserved.
    expect(Object.keys(filtered)).toEqual(Object.keys(input));
  });

  it('returns an empty object when given an empty object', () => {
    expect(stripBrowserForbiddenHeaders({})).toEqual({});
  });

  it('exposes the forbidden-headers Set with `content-length` (lowercase key)', () => {
    // Lock the documented contract — the Set is keyed lowercase so the
    // case-insensitive `.has(name.toLowerCase())` lookup works for any
    // backend casing. If a future contributor adds an entry, the key
    // MUST be lowercase or the filter silently misses it.
    expect(BROWSER_FORBIDDEN_REQUEST_HEADERS.has('content-length')).toBe(true);
    // Negative guard — `Content-Length` (mixed case) must NOT be in the
    // Set; the filter relies on `.toLowerCase()` to normalise.
    expect(BROWSER_FORBIDDEN_REQUEST_HEADERS.has('Content-Length')).toBe(false);
  });
});
