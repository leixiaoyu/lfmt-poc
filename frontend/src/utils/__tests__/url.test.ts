/**
 * Unit tests for stripTrailingSlashes (src/utils/url.ts).
 *
 * Regression guard for #231: the shared utility must apply a greedy regex so
 * both constants.ts (BASE_URL) and e2e/fixtures/url.ts (resolveApiUrl) strip
 * ALL consecutive trailing slashes, not just the last one.
 */

import { describe, it, expect } from 'vitest';
import { stripTrailingSlashes } from '../url';

describe('stripTrailingSlashes', () => {
  it('returns a clean URL unchanged', () => {
    expect(stripTrailingSlashes('https://example.com/v1')).toBe('https://example.com/v1');
  });

  it('strips a single trailing slash', () => {
    expect(stripTrailingSlashes('https://example.com/v1/')).toBe('https://example.com/v1');
  });

  it('strips multiple consecutive trailing slashes (greedy regex)', () => {
    // #231: old single-strip logic would leave one slash behind.
    expect(stripTrailingSlashes('https://example.com/v1//')).toBe('https://example.com/v1');
    expect(stripTrailingSlashes('https://example.com/v1///')).toBe('https://example.com/v1');
  });

  it('handles empty string without throwing', () => {
    expect(stripTrailingSlashes('')).toBe('');
  });

  it('handles a bare slash', () => {
    expect(stripTrailingSlashes('/')).toBe('');
  });

  it('preserves internal slashes', () => {
    expect(stripTrailingSlashes('https://example.com/a/b/c/')).toBe('https://example.com/a/b/c');
  });
});
