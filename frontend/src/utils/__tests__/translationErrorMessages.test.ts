/**
 * Unit tests for translationErrorMessages.ts (Issue #147, R5 OMC follow-up).
 *
 * Locks in the precedence rules:
 *   1. Known HTTP status → curated phrase.
 *   2. statusCode === undefined → NETWORK_MESSAGE (axios !response).
 *   3. Unknown status with a usable message → pass-through.
 *   4. null / non-object error → FALLBACK_MESSAGE.
 */

import { describe, it, expect } from 'vitest';
import { getTranslationErrorMessage } from '../translationErrorMessages';

const NETWORK_MESSAGE = 'Connection lost — check your internet and try again.';
const FALLBACK_MESSAGE = 'An unexpected error occurred. Please try again.';

describe('getTranslationErrorMessage — mapped HTTP statuses', () => {
  // Each row covers one entry of the STATUS_MESSAGES table. The literal
  // text is asserted so a copy-tweak that breaks the demo phrasing
  // surfaces here, not in a manual smoke test.
  it.each([
    [
      400,
      'Translation could not start because the request was invalid. Please review your selections and try again.',
    ],
    [401, 'Your session has expired — please log in again.'],
    [403, "You don't have permission to start this translation."],
    [413, 'File too large — the maximum supported size is 10 MB.'],
    [429, 'Translation rate limit reached — please try again in a moment.'],
    [500, 'Server error — our team has been notified. Please try again.'],
    [502, 'Translation service is temporarily unavailable. Please try again shortly.'],
    [503, 'Translation service is temporarily unavailable. Please try again shortly.'],
    [504, 'Translation service is temporarily unavailable. Please try again shortly.'],
  ])('maps statusCode=%i to its curated phrase', (statusCode, expected) => {
    const error = { statusCode, message: 'irrelevant raw message' };
    expect(getTranslationErrorMessage(error)).toBe(expected);
  });
});

describe('getTranslationErrorMessage — network failures', () => {
  it('returns NETWORK_MESSAGE when statusCode is undefined', () => {
    // Axios sets `error.response = undefined` for ERR_NETWORK; the
    // wrapper TranslationServiceError surfaces that as
    // statusCode = undefined.
    const error = { message: 'Network Error' };
    expect(getTranslationErrorMessage(error)).toBe(NETWORK_MESSAGE);
  });

  it('returns NETWORK_MESSAGE when statusCode is undefined even with no message', () => {
    expect(getTranslationErrorMessage({})).toBe(NETWORK_MESSAGE);
  });
});

describe('getTranslationErrorMessage — unknown HTTP statuses', () => {
  it('passes through a usable backend message when status is unmapped', () => {
    // 418 is unmapped on purpose — the precedence check should fall
    // through to the message pass-through branch.
    const error = { statusCode: 418, message: 'Translation engine is on vacation' };
    expect(getTranslationErrorMessage(error)).toBe('Translation engine is on vacation');
  });

  it('falls back when the unmapped error message is empty', () => {
    const error = { statusCode: 418, message: '' };
    expect(getTranslationErrorMessage(error)).toBe(FALLBACK_MESSAGE);
  });

  it('falls back when an unmapped error has no message at all', () => {
    const error = { statusCode: 418 };
    expect(getTranslationErrorMessage(error)).toBe(FALLBACK_MESSAGE);
  });
});

describe('getTranslationErrorMessage — null / non-object inputs', () => {
  it.each([null, undefined, 'string error', 42, true])(
    'returns FALLBACK_MESSAGE for non-object input %p',
    (input) => {
      expect(getTranslationErrorMessage(input)).toBe(FALLBACK_MESSAGE);
    }
  );
});
