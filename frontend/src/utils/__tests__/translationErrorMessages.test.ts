/**
 * Unit tests for translationErrorMessages.ts (Issue #147, R5 OMC follow-up,
 * PR #202 OMC Round 2 Code-3).
 *
 * Locks in the precedence rules:
 *   1. Known HTTP status → curated phrase.
 *   2a. statusCode === undefined + specific message → surface the message.
 *   2b. statusCode === undefined + generic/absent message → NETWORK_MESSAGE.
 *   3. Unknown status with a usable backend message → pass-through.
 *   4. null / non-object error → FALLBACK_MESSAGE.
 *
 * Rule 2a was added in PR #202 Round 2: the polling loop throws plain Error
 * objects with descriptive messages (e.g. "Document processing timed out…")
 * that should reach the user rather than being swallowed by the catch-all
 * NETWORK_MESSAGE branch.
 */

import { describe, it, expect } from 'vitest';
import { getApiErrorMessage, getTranslationErrorMessage } from '../translationErrorMessages';

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

describe('getTranslationErrorMessage — polling-loop descriptive errors (Code-3)', () => {
  // These errors are thrown by uploadAndAwaitChunked when the chunking
  // pipeline fails or times out. They are plain Error objects (no statusCode)
  // but have descriptive message strings that should reach the user.

  it('surfaces the polling-loop terminal-error message verbatim', () => {
    // Thrown when getJobStatus returns CHUNKING_FAILED.
    const error = {
      message: 'Document processing failed with status: CHUNKING_FAILED. Please try again.',
    };
    expect(getTranslationErrorMessage(error)).toBe(
      'Document processing failed with status: CHUNKING_FAILED. Please try again.'
    );
  });

  it('surfaces the polling-loop timeout message verbatim', () => {
    const error = {
      message:
        'Document processing timed out. Your file was uploaded successfully — please refresh and try starting the translation again.',
    };
    expect(getTranslationErrorMessage(error)).toBe(
      'Document processing timed out. Your file was uploaded successfully — please refresh and try starting the translation again.'
    );
  });

  it('surfaces any non-generic descriptive message when statusCode is absent', () => {
    // Custom error not originating from the polling loop.
    const error = { message: 'Chunking service is currently offline.' };
    expect(getTranslationErrorMessage(error)).toBe('Chunking service is currently offline.');
  });
});

describe('getTranslationErrorMessage — network failures', () => {
  it('returns NETWORK_MESSAGE when statusCode is undefined and message is generic "Network Error"', () => {
    // Axios sets `error.response = undefined` for ERR_NETWORK; the
    // wrapper TranslationServiceError surfaces that as
    // statusCode = undefined with message = "Network Error".
    const error = { message: 'Network Error' };
    expect(getTranslationErrorMessage(error)).toBe(NETWORK_MESSAGE);
  });

  it('returns NETWORK_MESSAGE when statusCode is undefined and message is absent', () => {
    expect(getTranslationErrorMessage({})).toBe(NETWORK_MESSAGE);
  });

  it('returns NETWORK_MESSAGE when statusCode is undefined and message is empty string', () => {
    expect(getTranslationErrorMessage({ message: '' })).toBe(NETWORK_MESSAGE);
  });

  it.each(['Network Error', 'network error', '  NETWORK ERROR  '])(
    'treats generic message %j as a network error (case/space insensitive)',
    (msg) => {
      expect(getTranslationErrorMessage({ message: msg })).toBe(NETWORK_MESSAGE);
    }
  );

  it.each([
    'An unexpected error occurred',
    'an unexpected error occurred',
    'Request failed',
    'Failed to fetch',
  ])('treats generic message %j as a network error', (msg) => {
    expect(getTranslationErrorMessage({ message: msg })).toBe(NETWORK_MESSAGE);
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

// ---------------------------------------------------------------------------
// Issue #215: typed errorCode discriminator tests
// ---------------------------------------------------------------------------

describe('getTranslationErrorMessage — errorCode discriminator (issue #215)', () => {
  it('returns the S3_UPLOAD_BLOCKED copy when errorCode is S3_UPLOAD_BLOCKED (no statusCode)', () => {
    const error = {
      errorCode: 'S3_UPLOAD_BLOCKED' as const,
      message: 'some raw message that should be ignored',
      statusCode: undefined,
    };
    expect(getTranslationErrorMessage(error)).toBe(
      'Upload was blocked. This is likely a configuration issue — please refresh and try again, or contact support if it persists.'
    );
  });

  it('S3_UPLOAD_BLOCKED errorCode takes precedence over a known statusCode', () => {
    // Even when a statusCode is present, the errorCode should win.
    const error = {
      errorCode: 'S3_UPLOAD_BLOCKED' as const,
      statusCode: 403,
      message: 'ignored',
    };
    const result = getTranslationErrorMessage(error);
    expect(result).toBe(
      'Upload was blocked. This is likely a configuration issue — please refresh and try again, or contact support if it persists.'
    );
    // Must NOT return the 403 curated phrase.
    expect(result).not.toMatch(/permission/i);
  });

  it('API_GENERIC errorCode falls through to the status-code table', () => {
    // API_GENERIC has no COPY_BY_CODE entry; the 429 curated phrase should apply.
    const error = {
      errorCode: 'API_GENERIC' as const,
      statusCode: 429,
      message: 'raw rate limit message',
    };
    expect(getTranslationErrorMessage(error)).toBe(
      'Translation rate limit reached — please try again in a moment.'
    );
  });

  it('S3_HTTP_ERROR errorCode falls through to the status-code table for mapped statuses', () => {
    const error = {
      errorCode: 'S3_HTTP_ERROR' as const,
      statusCode: 403,
      message: 'Forbidden',
    };
    expect(getTranslationErrorMessage(error)).toBe(
      "You don't have permission to start this translation."
    );
  });

  it('returns the TRANSLATION_ALREADY_STARTED copy when errorCode is set (#266)', () => {
    // Empty message forces the errorCode branch to win — the wrapper
    // function `getApiErrorMessage` covers the API-message-wins path
    // in its own describe block.
    const error = {
      errorCode: 'TRANSLATION_ALREADY_STARTED' as const,
      statusCode: 409,
      message: '',
    };
    expect(getTranslationErrorMessage(error)).toBe(
      'Translation is already running. The page will refresh automatically as it makes progress.'
    );
  });
});

// ---------------------------------------------------------------------------
// #266: getApiErrorMessage — API-envelope precedence wrapper
// ---------------------------------------------------------------------------

describe('getApiErrorMessage — API-envelope precedence (#266)', () => {
  it('returns the API `message` when it is non-empty and non-generic', () => {
    // Shape (a): TranslationServiceError where handleError already lifted
    // the Lambda's `response.data.message` into `.message`.
    const error = {
      message: 'Translation already in_progress for this job',
      errorCode: 'TRANSLATION_ALREADY_STARTED' as const,
      statusCode: 409,
    };
    expect(getApiErrorMessage(error)).toBe('Translation already in_progress for this job');
  });

  it('prefers the API `message` even when a known COPY_BY_CODE errorCode is present', () => {
    // Precedence: API message wins over curated COPY_BY_CODE copy. The
    // backend's prose is the most context-specific signal we have.
    const error = {
      message: 'Custom Lambda-emitted phrase',
      errorCode: 'TRANSLATION_ALREADY_STARTED' as const,
      statusCode: 409,
    };
    expect(getApiErrorMessage(error)).toBe('Custom Lambda-emitted phrase');
  });

  it('falls back to COPY_BY_CODE when the API message is missing', () => {
    const error = {
      message: '',
      errorCode: 'TRANSLATION_ALREADY_STARTED' as const,
      statusCode: 409,
    };
    expect(getApiErrorMessage(error)).toBe(
      'Translation is already running. The page will refresh automatically as it makes progress.'
    );
  });

  it('falls back to FALLBACK_MESSAGE when neither API message nor errorCode is present', () => {
    // Generic axios "Request failed" passes the GENERIC_MESSAGES deny-list,
    // so the wrapper delegates to getTranslationErrorMessage, which routes
    // through the network-error / fallback branches.
    expect(getApiErrorMessage({})).toBe('Connection lost — check your internet and try again.');
  });

  it('reads errorCode from `response.data.errorCode` on a raw axios-shaped error', () => {
    // Forward-compat path: backend issue #267 will rename the field from
    // `requestId` → `errorCode` once fixed. Shape (b): raw axios error.
    const error = {
      response: {
        data: { errorCode: 'TRANSLATION_ALREADY_STARTED' },
      },
    };
    expect(getApiErrorMessage(error)).toBe(
      'Translation is already running. The page will refresh automatically as it makes progress.'
    );
  });

  it('reads errorCode from `response.data.requestId` on a raw axios-shaped error (#267 back-compat)', () => {
    // Current buggy backend places the error category in the `requestId`
    // slot. The frontend must remain correct until #267 lands.
    const error = {
      response: {
        data: { requestId: 'TRANSLATION_ALREADY_STARTED' },
      },
    };
    expect(getApiErrorMessage(error)).toBe(
      'Translation is already running. The page will refresh automatically as it makes progress.'
    );
  });

  it('prefers API `response.data.message` over the requestId-as-errorCode fallback', () => {
    // Raw axios error with both message AND requestId-as-errorCode set.
    // API message wins per #266 precedence rule.
    const error = {
      response: {
        data: {
          message: 'Translation already in_progress for this job',
          requestId: 'TRANSLATION_ALREADY_STARTED',
        },
      },
    };
    expect(getApiErrorMessage(error)).toBe('Translation already in_progress for this job');
  });

  it('treats generic API messages like "Network Error" as non-specific and falls through', () => {
    // Deny-list guard: an API envelope message that is itself a generic
    // axios string should NOT be surfaced verbatim.
    const error = {
      message: 'Network Error',
      statusCode: undefined,
    };
    expect(getApiErrorMessage(error)).toBe('Connection lost — check your internet and try again.');
  });
});
