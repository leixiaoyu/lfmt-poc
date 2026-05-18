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
  // #266: surfaced when POST /jobs/:id/translate is invoked but a translation
  // is already running for the job. Auto-polling means progress is being
  // tracked already, so the message tells the user to wait rather than retry.
  TRANSLATION_ALREADY_STARTED:
    'Translation is already running. The page will refresh automatically as it makes progress.',
  // ---- Issue #273: codes emitted by jobs/startTranslation.ts ---------------
  //
  // These codes ride alongside the Lambda's user-readable `message` field, so
  // `getApiErrorMessage` will normally surface the prose directly (per the
  // PR #266 precedence rule). The entries below are the FALLBACK copy used
  // when the message is absent, empty, or matches the GENERIC_MESSAGES deny-
  // list (e.g. an axios path that swallows the envelope and only leaves the
  // typed `errorCode` discriminator).
  //
  // Copy rules (per PR #251 / PR #268 precedent):
  //   - One sentence, ≤ 100 chars.
  //   - Tells the user what to do next, not the technical reason.
  //   - No mention of AWS / DDB / Step Functions / status codes.
  //   - Ends with a period.
  MISSING_JOB_ID: 'Translation request is missing a job identifier — please refresh and try again.',
  INVALID_REQUEST:
    'Translation settings are invalid — please check your target language and tone and try again.',
  JOB_NOT_FOUND:
    "We couldn't find that translation — it may have been deleted. Please try again from your history.",
  FORBIDDEN: "You don't have permission to start this translation.",
  INVALID_JOB_STATUS:
    "This translation isn't ready to start yet — please wait for processing to finish and try again.",
  NO_CHUNKS_AVAILABLE:
    "This document couldn't be prepared for translation — please re-upload it and try again.",
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
 * Resolve a user-facing message with API-envelope precedence (#266).
 *
 * Precedence:
 *   1. `response.data.message` from the structured API envelope — when present
 *      AND non-generic, surface it verbatim. This is the Lambda-emitted
 *      human-readable text and is the most context-specific message we can show.
 *   2. Fall through to `getTranslationErrorMessage` which dispatches on
 *      `errorCode` / `statusCode` / pass-through / fallback (PR #251 logic).
 *
 * Why this wrapper exists instead of inlining into `getTranslationErrorMessage`:
 *   The PR #251 / issue #215 precedence (errorCode > statusCode > message) is
 *   used by other call sites (e.g. the upload wizard) where curated copy is
 *   strictly preferred for certain error categories (S3_UPLOAD_BLOCKED).
 *   The TranslationDetail "start translation" flow (#266) instead wants the
 *   Lambda's `message` field to win because the backend already crafts
 *   user-facing prose for these errors. Keeping the two layered avoids
 *   regressing the upload-wizard error-mapping tests.
 *
 * Red-team note: when the backend returns a 500-class error with a stack-trace-
 * like string in `message`, we DO NOT want to leak it. The GENERIC_MESSAGES
 * deny-list (below) already catches the most common variants ("network error",
 * "request failed", etc.); for 500-class errors the backend's API contract
 * dictates a human-readable phrase only, so passing through is safe. If the
 * backend ever starts leaking unsafe internals, the answer is a server-side
 * fix, not a frontend deny-list arms race.
 *
 * Forward-compat with backend issue #267: the `errorCode` discriminator is
 * read from both `response.data.errorCode` (the eventual correct field) AND
 * `response.data.requestId` (the current buggy field). The frontend remains
 * correct whether the backend has been fixed yet or not.
 */
export function getApiErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return getTranslationErrorMessage(error);
  }

  // Two shapes can reach this helper:
  //   a. A `TranslationServiceError` thrown by `translationService.handleError`.
  //      The Lambda's `response.data.message` has ALREADY been extracted into
  //      `error.message` (see translationService.ts handleError), and the
  //      typed `errorCode` discriminator is set via the same path.
  //   b. A raw `AxiosError` — `error.response.data.message` is the envelope
  //      field; some non-translation code paths reach the page-level catch
  //      without going through handleError.
  //
  // Both shapes converge here so callers don't need a type-narrowing dance.
  type WithResponse = {
    response?: { data?: { message?: unknown; errorCode?: unknown; requestId?: unknown } };
    originalError?: WithResponse;
    message?: unknown;
  };
  const candidate = error as WithResponse;

  // Probe the raw axios envelope first (shape b) — only used if shape a
  // hasn't already lifted the message into `e.message`.
  const envelope = candidate.response?.data ?? candidate.originalError?.response?.data ?? undefined;
  const envelopeMessage = typeof envelope?.message === 'string' ? envelope.message : undefined;

  const e = error as TranslationErrorLike;
  // Pre-extracted message lives on TranslationServiceError; raw envelope
  // message comes from a bare AxiosError. Either way, we want the
  // Lambda-emitted prose to take precedence over curated COPY_BY_CODE
  // copy when it's specific enough to surface (#266 acceptance criterion).
  const candidateMessage =
    typeof e.message === 'string' && e.message.length > 0 ? e.message : envelopeMessage;

  if (
    typeof candidateMessage === 'string' &&
    candidateMessage.length > 0 &&
    !GENERIC_MESSAGES.has(candidateMessage.trim().toLowerCase())
  ) {
    return candidateMessage;
  }

  // No usable API message — delegate to the PR #251 logic. Before doing so,
  // enrich the shape with an errorCode pulled from the envelope's `errorCode`
  // (forward-compat with backend #267) or `requestId` (current buggy field
  // name) so the COPY_BY_CODE branch can dispatch correctly even when the
  // upstream `handleError` didn't get a chance to set it.
  const envelopeCode =
    typeof envelope?.errorCode === 'string'
      ? envelope.errorCode
      : typeof envelope?.requestId === 'string'
        ? envelope.requestId
        : undefined;
  if (envelopeCode && !e.errorCode) {
    return getTranslationErrorMessage({
      ...e,
      errorCode: envelopeCode as TranslationErrorCode,
    });
  }

  return getTranslationErrorMessage(error);
}

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
