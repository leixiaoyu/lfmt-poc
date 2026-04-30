/**
 * Map translation-API errors to user-facing messages (Issue #147).
 *
 * The wizard's submit flow used to surface either a raw backend message
 * (which can be terse, e.g. "Rate limit exceeded") or the catch-all
 * "An unexpected error occurred. Please try again." regardless of
 * cause. Demos kept showing the catch-all on 429 / 500, which makes the
 * product look unfinished even when the underlying behavior is correct.
 *
 * We map well-known HTTP statuses to phrases the user can act on, fall
 * back to the backend-provided message when it's specific enough, and
 * only ever land on a generic catch-all when neither path applies.
 *
 * Inputs are typed loosely so this helper can be called both with a
 * `TranslationServiceError` (carries `statusCode`) and a bare `Error`
 * (carries only `message`). The caller doesn't need to import any axios
 * types.
 */

export interface TranslationErrorLike {
  message?: string;
  statusCode?: number;
}

const STATUS_MESSAGES: Record<number, string> = {
  400: 'Translation could not start because the request was invalid. Please review your selections and try again.',
  401: 'Your session has expired — please log in again.',
  403: "You don't have permission to start this translation.",
  413: 'File too large — the maximum supported size is 10 MB.',
  429: 'Translation rate limit reached — please try again in a moment.',
  500: 'Server error — our team has been notified. Please try again.',
  502: 'Translation service is temporarily unavailable. Please try again shortly.',
  503: 'Translation service is temporarily unavailable. Please try again shortly.',
  504: 'Translation service is temporarily unavailable. Please try again shortly.',
};

const NETWORK_MESSAGE = 'Connection lost — check your internet and try again.';
const FALLBACK_MESSAGE = 'An unexpected error occurred. Please try again.';

/**
 * Resolve a user-facing message for a translation-submit failure.
 *
 * Precedence:
 *   1. Known HTTP status → curated phrase.
 *   2. statusCode is undefined AND we have no usable message → treat as
 *      a network error (axios sets `error.response = undefined` for
 *      ERR_NETWORK).
 *   3. Backend-provided message that is non-empty and non-generic →
 *      pass through (handles spec-driven errors we haven't enumerated).
 *   4. Final fallback.
 */
export function getTranslationErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return FALLBACK_MESSAGE;
  }
  const e = error as TranslationErrorLike;
  if (typeof e.statusCode === 'number' && STATUS_MESSAGES[e.statusCode]) {
    return STATUS_MESSAGES[e.statusCode];
  }
  if (e.statusCode === undefined) {
    // No HTTP status reached us — almost certainly a network/transport
    // failure (axios.isAxiosError && !error.response).
    return NETWORK_MESSAGE;
  }
  if (typeof e.message === 'string' && e.message.length > 0) {
    return e.message;
  }
  return FALLBACK_MESSAGE;
}
