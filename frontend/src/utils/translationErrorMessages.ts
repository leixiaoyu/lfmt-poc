/**
 * Map translation-API errors to user-facing messages (Issue #147).
 *
 * Dispatch order (issue #215 refactor):
 *   0. `errorCode === 'S3_UPLOAD_BLOCKED'` → targeted upload-blocked phrase.
 *   1. Known HTTP status → curated phrase.
 *   2. statusCode is undefined AND the error has a specific, non-generic
 *      `message` string → surface that message directly. This handles errors
 *      thrown by the polling loop (e.g. "Document processing timed out…")
 *      which are plain `Error` objects with descriptive messages but no HTTP
 *      status code.
 *   3. statusCode is undefined AND message is generic / absent → treat as a
 *      pure network error (axios sets `error.response = undefined` for
 *      ERR_NETWORK).
 *   4. Backend-provided message that is non-empty and non-generic →
 *      pass through (handles spec-driven errors we haven't enumerated).
 *   5. Final fallback.
 *
 * The wizard's submit flow used to surface either a raw backend message
 * (which can be terse, e.g. "Rate limit exceeded") or the catch-all
 * "An unexpected error occurred. Please try again." regardless of
 * cause. Demos kept showing the catch-all on 429 / 500, which makes the
 * product look unfinished even when the underlying behavior is correct.
 *
 * Inputs are typed loosely so this helper can be called both with a
 * `TranslationServiceError` (carries `statusCode` and `errorCode`) and
 * a bare `Error` (carries only `message`). The caller doesn't need to
 * import any axios types.
 */

import type { TranslationErrorCode } from '../services/translationService';

export interface TranslationErrorLike {
  message?: string;
  statusCode?: number;
  /** Typed discriminator introduced in issue #215. */
  errorCode?: TranslationErrorCode;
}

/**
 * User-visible copy indexed by short-circuit TranslationErrorCodes (issue #215).
 *
 * Typed as `Record<Exclude<TranslationErrorCode, 'API_GENERIC' | 'S3_HTTP_ERROR'>, string>`
 * so exhaustiveness IS enforced at compile time: adding a new short-circuit
 * TranslationErrorCode without a copy entry here is a tsc error.
 *
 * Fall-through codes (intentionally absent — they route via the status-code
 * table or message pass-through below):
 *   - 'API_GENERIC'  — general API/service errors; dispatched by statusCode.
 *   - 'S3_HTTP_ERROR' — S3 returned an HTTP error; statusCode carries the
 *     specific signal (e.g. 403, 503) so the status-code table produces a
 *     more accurate message than any generic copy here.
 */
const COPY_BY_CODE: Record<
  Exclude<TranslationErrorCode, 'API_GENERIC' | 'S3_HTTP_ERROR'>,
  string
> = {
  S3_UPLOAD_BLOCKED:
    'Upload was blocked. This is likely a configuration issue — please refresh and try again, or contact support if it persists.',
};

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
 * Generic message strings that are too vague to be surfaced as-is.
 * If the error's `message` property matches one of these (exact, trimmed,
 * case-insensitive), we fall back to NETWORK_MESSAGE instead of passing it
 * through. This prevents "Network Error" or "An unexpected error occurred"
 * from leaking from the axios / service layer into the UI.
 */
const GENERIC_MESSAGES = new Set(
  ['network error', 'an unexpected error occurred', 'request failed', 'failed to fetch'].map((s) =>
    s.toLowerCase()
  )
);

/**
 * Resolve a user-facing message for a translation-submit failure.
 */
export function getTranslationErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return FALLBACK_MESSAGE;
  }
  const e = error as TranslationErrorLike;

  // 0. Typed errorCode discriminator (issue #215). Short-circuits before
  //    the status-code table so copy can be edited independently of the
  //    wire signal and the HTTP status. The `in` guard implicitly excludes
  //    'API_GENERIC' (absent from COPY_BY_CODE keys) so the cast is safe.
  if (e.errorCode && e.errorCode in COPY_BY_CODE) {
    return COPY_BY_CODE[
      e.errorCode as Exclude<TranslationErrorCode, 'API_GENERIC' | 'S3_HTTP_ERROR'>
    ];
  }

  // 1. Known HTTP status → curated phrase.
  if (typeof e.statusCode === 'number' && STATUS_MESSAGES[e.statusCode]) {
    return STATUS_MESSAGES[e.statusCode];
  }

  if (e.statusCode === undefined) {
    // No HTTP status reached us. Two sub-cases:
    //   a. A descriptive message from the polling loop or another non-network
    //      throw (e.g. "Document processing timed out…") — surface it.
    //   b. A generic/absent message — treat as network/transport failure.
    if (
      typeof e.message === 'string' &&
      e.message.length > 0 &&
      !GENERIC_MESSAGES.has(e.message.trim().toLowerCase())
    ) {
      // 2. Specific polling-loop or custom error message.
      return e.message;
    }
    // 3. Generic / absent message → network error.
    return NETWORK_MESSAGE;
  }

  // 4. Unmapped HTTP status but a usable backend message.
  if (typeof e.message === 'string' && e.message.length > 0) {
    return e.message;
  }

  // 5. Final fallback.
  return FALLBACK_MESSAGE;
}
