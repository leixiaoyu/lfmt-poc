/**
 * Translation Service
 *
 * Handles all translation-related API calls including job management,
 * file uploads, and status tracking.
 */

import axios from 'axios';
import { apiClient } from '../utils/api';
import { uploadToS3 } from './uploadService';
import type {
  PresignedUrlApiResponse,
  StartTranslationApiResponse,
  TranslationJobStatus,
  TranslationStatusApiResponse,
  ListJobsEnvelope,
} from '@lfmt/shared-types';
import { CHUNKING_ERROR_STATUSES } from '@lfmt/shared-types';
import { toTranslationJob } from './mappers/translationJobMapper';

// N1 (PR #214 OMC R2): the back-compat re-export of
// `stripBrowserForbiddenHeaders` from this module has been removed.
// No live caller imports the helper through `translationService`
// (verified via `grep -r "from '../services/translationService'"
// frontend/src` for the symbol). Removing the shim breaks the
// indirect coupling and lets the two modules truly decouple — anyone
// who needs the helper must now import it directly from
// `utils/headerFilters`, where the source of truth lives.

// Re-export so callers can use the shared-types values without an extra import.
export type { TranslationJobStatus };

/**
 * Translation Job
 *
 * Represents the frontend view of a job record. `status` uses the canonical
 * TranslationJobStatus union defined in @lfmt/shared-types so the type is
 * the single source of truth across service, hooks, and page components.
 */
export interface TranslationJob {
  jobId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: TranslationJobStatus;
  targetLanguage?: string;
  tone?: 'formal' | 'informal' | 'neutral';
  totalChunks?: number;
  completedChunks?: number;
  failedChunks?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

/**
 * Legal Attestation Data
 */
export interface LegalAttestation {
  acceptCopyrightOwnership: boolean;
  acceptTranslationRights: boolean;
  acceptLiabilityTerms: boolean;
  userIPAddress: string;
  userAgent: string;
  timestamp: string;
}

/**
 * Translation Configuration
 */
export interface TranslationConfig {
  targetLanguage: 'es' | 'fr' | 'de' | 'it' | 'zh';
  tone: 'formal' | 'informal' | 'neutral';
}

/**
 * Upload Document Request
 */
export interface UploadDocumentRequest {
  file: File;
  legalAttestation: LegalAttestation;
}

/**
 * Start Translation Request
 */
export interface StartTranslationRequest {
  targetLanguage: string;
  tone: string;
}

/**
 * Narrow return type of `startTranslation`.
 *
 * Pre-PR-#218 the function fabricated a full `TranslationJob` shape with
 * five hollow sentinel fields (`userId: ''`, `fileName: ''`,
 * `fileSize: 0`, ...) because the real `POST /jobs/{jobId}/translate`
 * Lambda only returns the fields enumerated below. The sentinels were a
 * code-quality H1 risk (OMC R1 on PR #218): any optimistic UI / polling
 * seed that read the result would render "0 Bytes" and an empty
 * filename until the first `getJobStatus` resolved.
 *
 * Narrowing the return removes the lie at the type level — the wizard
 * + `TranslationDetail` page already discard the return value (they
 * either navigate or call `fetchJobDetails` immediately after), and the
 * narrower type makes that contract explicit. Future callers MUST use
 * `getJobStatus` to enrich with file metadata.
 */
export interface StartTranslationResult {
  jobId: string;
  status: TranslationJobStatus;
  targetLanguage: string;
  totalChunks: number;
  completedChunks: number;
  message: string;
  /** Step Functions execution ARN — present in dev for tracing. */
  executionArn?: string;
}

/**
 * Options for uploadAndAwaitChunked.
 */
export interface UploadAndAwaitChunkedOptions {
  /**
   * How long to wait between getJobStatus polls (ms).
   * Defaults to UPLOAD_AWAIT_CHUNKED_POLL_INTERVAL_MS.
   */
  pollIntervalMs?: number;
  /**
   * Total wall-clock budget before timing out (ms).
   * Defaults to UPLOAD_AWAIT_CHUNKED_TIMEOUT_MS.
   */
  timeoutMs?: number;
  /**
   * Called after each completed poll tick so the caller can update UI
   * (e.g. set a "Processing upload..." label).
   */
  onPollTick?: (status: TranslationJobStatus) => void;
}

/**
 * Typed discriminator for TranslationServiceError instances (issue #215).
 *
 * Replaces the previous `S3_UPLOAD_BLOCKED_MESSAGE` sentinel-string
 * pattern. Having a stable enum as the dispatch key means:
 *   - User-visible copy lives in ONE place (translationErrorMessages.ts).
 *   - Tests assert on the enum value, not on copy that can be reworded.
 *   - New error categories slot in without precedence-rule gymnastics.
 *   - The compiler enforces exhaustive COPY_BY_CODE coverage.
 *
 * 'API_GENERIC' is the catch-all for errors that fall through to the
 * existing status-code / message-pass-through logic in
 * `getTranslationErrorMessage`. A TranslationServiceError without an
 * explicit errorCode should never be constructed in practice; the
 * `handleError` helper always sets one of the other variants.
 */
export type TranslationErrorCode =
  | 'S3_UPLOAD_BLOCKED' // Transport-level block (CSP, network, DNS, XHR abort)
  | 'S3_HTTP_ERROR' // S3 returned an HTTP error (e.g. SignatureDoesNotMatch, 403)
  | 'API_GENERIC'; // API / service error — fall through to status-code map

/**
 * Translation Service Error.
 *
 * `errorCode` (required) is a stable discriminator for the error category
 * (issue #215). `statusCode` is preserved for HTTP errors so the
 * `getTranslationErrorMessage` status-code table still works for API-side
 * failures. `originalError` is typed `Error | undefined` (NOT `AxiosError`)
 * so the non-axios branch in `wrapS3UploadError` can preserve plain Error
 * causes without a type cast (PR #214 OMC R2 M-1).
 */
export class TranslationServiceError extends Error {
  constructor(
    message: string,
    public errorCode: TranslationErrorCode,
    public statusCode?: number,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'TranslationServiceError';
  }
}

/**
 * Backwards-compatibility re-export for tests and call sites that still
 * reference `S3_UPLOAD_BLOCKED_MESSAGE` by name (issue #215 cleanup).
 *
 * @deprecated Use `error.errorCode === 'S3_UPLOAD_BLOCKED'` instead of
 * matching on this string. This constant will be removed in a follow-up
 * once all consumers have migrated to the `errorCode` discriminator.
 *
 * The message text is intentionally preserved verbatim so any UI that
 * accidentally surfaces `error.message` instead of routing through
 * `getTranslationErrorMessage` still shows the same copy as before.
 */
export const S3_UPLOAD_BLOCKED_MESSAGE =
  'Upload was blocked. This is likely a configuration issue — please refresh and try again, or contact support if it persists.';

/**
 * Re-shape an S3 PUT failure so the page-level error UI can tell it
 * apart from API-side failures.
 *
 * Handles two error shapes:
 *
 * 1. AxiosError (legacy, from direct axios.put callers): `error.response`
 *    is undefined for CSP/network blocks, or carries an HTTP status for
 *    S3-side rejections (e.g. SignatureDoesNotMatch).
 *
 * 2. Plain Error (from uploadToS3 XHR path, #230 refactor): the XHR
 *    `error` event produces "Network error during file upload" (no HTTP
 *    response), and HTTP errors produce "Upload failed with status N: …".
 *    We match on the message to restore the same CSP-block vs. HTTP-error
 *    distinction the axios path had, without requiring a different error
 *    type from the XHR layer.
 */
function wrapS3UploadError(error: unknown): TranslationServiceError {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      // No HTTP response — CSP block, DNS failure, or network outage.
      return new TranslationServiceError(
        S3_UPLOAD_BLOCKED_MESSAGE,
        'S3_UPLOAD_BLOCKED',
        undefined,
        error
      );
    }
    // S3 returned an HTTP error (e.g. SignatureDoesNotMatch, 403). Surface
    // its status to the page so it can branch on the curated table in
    // translationErrorMessages.
    return new TranslationServiceError(
      error.response.statusText || `S3 upload failed with status ${error.response.status}`,
      'S3_HTTP_ERROR',
      error.response.status,
      error
    );
  }

  // Plain Error from uploadToS3 (XHR-based S3 PUT, #230).
  //
  // uploadToS3 throws:
  //   "Network error during file upload"  — XHR `error` event (CSP block /
  //                                          DNS / network outage; no HTTP response).
  //   "Upload was cancelled"              — XHR `abort` event.
  //   "Upload failed with status N: …"   — XHR `load` event with status ≥ 300.
  //
  // Network / abort failures → errorCode 'S3_UPLOAD_BLOCKED' (same
  // category as the axios `error.response === undefined` path) so the
  // page's error mapper shows the targeted phrase instead of a raw XHR
  // string. HTTP errors → 'S3_HTTP_ERROR'; the status code is extracted
  // from the message string for the curated-table lookup.
  if (error instanceof Error) {
    const msg = error.message;
    if (msg === 'Network error during file upload' || msg === 'Upload was cancelled') {
      return new TranslationServiceError(
        S3_UPLOAD_BLOCKED_MESSAGE,
        'S3_UPLOAD_BLOCKED',
        undefined,
        error
      );
    }
    // "Upload failed with status N: text" — extract the numeric status.
    const statusMatch = /Upload failed with status (\d+)/.exec(msg);
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : undefined;
    return new TranslationServiceError(msg, 'S3_HTTP_ERROR', statusCode, error);
  }

  // Non-Error rejection — preserve as much context as possible.
  //
  // M-1 (PR #214 OMC R2): widen `originalError` to `Error | undefined`
  // at the field level so the non-axios branch no longer needs a cast.
  const originalError: Error = new Error(String(error));
  return new TranslationServiceError('S3 upload failed', 'S3_HTTP_ERROR', undefined, originalError);
}

// ---------------------------------------------------------------------------
// Polling constants — owned here (service layer) so the UI component is free
// of backend-protocol knowledge. Values can be overridden via
// UploadAndAwaitChunkedOptions for tests or future tuning.
// ---------------------------------------------------------------------------

/**
 * Default interval between getJobStatus polls while waiting for chunking
 * to complete. 1 s provides responsive feedback without hammering the API.
 */
export const UPLOAD_AWAIT_CHUNKED_POLL_INTERVAL_MS = 1_000;

/**
 * Default maximum wall-clock budget for the chunking-wait loop.
 * After this deadline the caller receives a descriptive timeout error.
 */
export const UPLOAD_AWAIT_CHUNKED_TIMEOUT_MS = 60_000;

/**
 * Handle API errors
 */
const handleError = (error: unknown): never => {
  // Guard: re-throw TranslationServiceError without wrapping.
  // Note: This branch is unreachable in practice because TranslationServiceError does not
  // extend AxiosError, so it will never also satisfy axios.isAxiosError(). The guard
  // exists defensively in case a TranslationServiceError is thrown from caller code or
  // re-raised from a nested try/catch, ensuring it is never double-wrapped here.
  // Branch coverage reflects this as the 1% gap (error instanceof TranslationServiceError
  // && axios.isAxiosError never both true simultaneously).
  if (error instanceof TranslationServiceError) {
    throw error;
  }

  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message || error.message;
    const statusCode = error.response?.status;
    throw new TranslationServiceError(message, 'API_GENERIC', statusCode, error);
  }
  throw new TranslationServiceError('An unexpected error occurred', 'API_GENERIC');
};

/**
 * Upload a document for translation
 */
export const uploadDocument = async (request: UploadDocumentRequest): Promise<TranslationJob> => {
  try {
    // Step 1: Request presigned URL from backend.
    //
    // POST /jobs/upload is the ONLY job-side endpoint that wraps its payload
    // in `{message, data}` — every other handler returns a flat object. We
    // type the response with the shared `PresignedUrlApiResponse` DTO from
    // @lfmt/shared-types so a wire-shape drift between the Lambda
    // (`backend/functions/jobs/uploadRequest.ts`) and this reader fails at
    // compile time rather than crashing the demo at runtime.
    const presignedResponse = await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: request.file.name,
      fileSize: request.file.size,
      contentType: request.file.type,
      legalAttestation: request.legalAttestation,
    });

    const { uploadUrl, jobId, requiredHeaders } = presignedResponse.data.data;

    // Step 2: Upload file directly to S3 using the shared uploadToS3 helper
    // (from uploadService.ts, #230 SRP refactor).
    //
    // uploadToS3 owns:
    //   - browser-safe header filtering (strips Content-Length per Fetch spec
    //     §forbidden-header-name — see uploadService.ts for the 2026-05-08
    //     post-mortem comment).
    //   - XHR lifecycle management (progress events, error/abort handling).
    //
    // This coordinator (uploadDocument) owns:
    //   - legal-attestation bundling in the presigned-URL request body.
    //   - wrapping raw XHR errors into TranslationServiceError via
    //     wrapS3UploadError so the UI can distinguish S3 failures from
    //     API-side failures.
    //
    // IMPORTANT (SignatureDoesNotMatch): rely exclusively on requiredHeaders
    // returned by the backend. The backend signs the presigned URL with the
    // exact Content-Type it puts in requiredHeaders. Adding an extra
    // Content-Type override risks a mismatch (File.type vs. backend-normalised
    // value) → S3 rejects with SignatureDoesNotMatch.
    try {
      await uploadToS3(request.file, uploadUrl, requiredHeaders);
    } catch (uploadError) {
      // Re-shape S3-side failures so the UI layer can distinguish them from
      // API-side failures (presigned URL request, status polling, etc.).
      throw wrapS3UploadError(uploadError);
    }

    // Step 3: Return job information
    // Note: The backend creates the job record but doesn't return it immediately
    // The job will be retrieved later when starting translation
    return {
      jobId,
      userId: '', // Will be populated by backend
      fileName: request.file.name,
      fileSize: request.file.size,
      contentType: request.file.type,
      status: 'PENDING' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Upload a document and wait until the backend chunking pipeline advances
 * the job to `CHUNKED` status before returning.
 *
 * This encapsulates the race-condition fix (PR #202 Bug #2): after the S3
 * PUT completes, the backend pipeline
 *   S3 event → uploadComplete Lambda → chunkDocument Lambda → CHUNKED
 * runs asynchronously. `startTranslation` requires `status === 'CHUNKED'`;
 * calling it before that returns 400 INVALID_JOB_STATUS.
 *
 * By owning the polling loop here (service layer) we keep the UI component
 * free of backend-protocol knowledge and give callers a single awaitable:
 *
 * ```ts
 * const job = await translationService.uploadAndAwaitChunked(request, opts);
 * await translationService.startTranslation(job.jobId, config);
 * ```
 *
 * @throws {TranslationServiceError} — propagated from uploadDocument or
 *   getJobStatus on API errors.
 * @throws {Error} — `message` set to a user-displayable string for both
 *   terminal-error and timeout exit paths so callers can surface it directly
 *   via getTranslationErrorMessage (which reads `error.message` when
 *   `statusCode` is undefined).
 */
export const uploadAndAwaitChunked = async (
  request: UploadDocumentRequest,
  options: UploadAndAwaitChunkedOptions = {}
): Promise<TranslationJob> => {
  const pollIntervalMs = options.pollIntervalMs ?? UPLOAD_AWAIT_CHUNKED_POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? UPLOAD_AWAIT_CHUNKED_TIMEOUT_MS;
  const onPollTick = options.onPollTick;

  // Phase 1: upload to S3 and receive initial job record.
  const job = await uploadDocument(request);

  // Phase 2: poll until CHUNKED, terminal error, or timeout.
  const deadline = Date.now() + timeoutMs;

  return new Promise<TranslationJob>((resolve, reject) => {
    const tick = async () => {
      try {
        const statusJob = await getJobStatus(job.jobId);

        onPollTick?.(statusJob.status);

        if (statusJob.status === 'CHUNKED') {
          // Chunking complete — resolve with the fresh job record.
          resolve(statusJob);
          return;
        }

        // Terminal-error statuses: chunking failed permanently.
        if (
          (CHUNKING_ERROR_STATUSES as ReadonlyArray<TranslationJobStatus>).includes(
            statusJob.status
          )
        ) {
          reject(
            new Error(
              `Document processing failed with status: ${statusJob.status}. Please try again.`
            )
          );
          return;
        }

        // Timeout guard.
        if (Date.now() >= deadline) {
          reject(
            new Error(
              'Document processing timed out. Your file was uploaded successfully — please refresh and try starting the translation again.'
            )
          );
          return;
        }

        // Still PENDING / CHUNKING — schedule the next tick.
        setTimeout(() => void tick(), pollIntervalMs);
      } catch (err) {
        // getJobStatus threw (e.g. network error) — propagate.
        reject(err);
      }
    };

    // Kick off the first tick immediately so we don't add an unnecessary
    // poll-interval pause when chunking completes quickly.
    void tick();
  });
};

/**
 * Start translation for a job.
 *
 * The real Lambda (`backend/functions/jobs/startTranslation.ts`) returns a
 * FLAT object — not `{data: ...}`. Reading `response.data.data` here was
 * the demo blocker fixed in the 2026-05-09 hotfix; this version reads
 * `response.data` directly and uses the shared `StartTranslationApiResponse`
 * DTO so any future drift fails at compile time.
 *
 * Returns a narrow `StartTranslationResult` containing only the fields the
 * Lambda actually echoes back (PR #218 OMC R1 H1-cq). Pre-fix this
 * function fabricated a full `TranslationJob` with five hollow sentinels
 * (`userId: ''`, `fileName: ''`, `fileSize: 0`, ...) which risked
 * "0 Bytes / empty filename" UI flicker if any consumer treated the
 * result as authoritative. Today's consumers (the upload wizard +
 * `TranslationDetail` retry button) discard the return value and either
 * navigate or call `fetchJobDetails` immediately after — narrowing makes
 * that contract type-checkable.
 */
export const startTranslation = async (
  jobId: string,
  config: TranslationConfig
): Promise<StartTranslationResult> => {
  try {
    const response = await apiClient.post<StartTranslationApiResponse>(`/jobs/${jobId}/translate`, {
      targetLanguage: config.targetLanguage,
      tone: config.tone,
    });

    const body = response.data;
    return {
      jobId: body.jobId,
      // The job has just been transitioned to IN_PROGRESS — the wire
      // shape of `translationStatus` happens to be the same as
      // TranslationJob.status for this code path.
      status: body.translationStatus as TranslationJobStatus,
      targetLanguage: body.targetLanguage,
      totalChunks: body.totalChunks,
      // Wire field name → frontend field name. Mirrors the
      // translation done by `toTranslationJob` in the mapper module
      // (M3-arch). Kept inline here because `StartTranslationResult`
      // is a narrower shape than `TranslationJob`; using the full
      // mapper would require silently inventing fields the wire never
      // returned, which is the exact anti-pattern this refactor closes.
      // #229: wire field renamed from `chunksTranslated` → `translatedChunks`.
      completedChunks: body.translatedChunks,
      message: body.message,
      executionArn: body.executionArn,
    };
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get job status.
 *
 * The real Lambda (`backend/functions/jobs/getTranslationStatus.ts`) returns
 * a FLAT object, NOT `{data: ...}`. Reading `response.data.data` here was
 * the root cause of the 2026-05-09 demo blocker:
 *
 *   "Cannot read properties of undefined (reading 'status')"
 *
 * — `response.data.data` was undefined, the polling loop in
 * `uploadAndAwaitChunked` then dereferenced `.status` on undefined and
 * crashed step 4 of the upload wizard.
 *
 * The shared `TranslationStatusApiResponse` DTO from @lfmt/shared-types
 * is the single source of truth; both the Lambda and this reader import
 * it so a future drift surfaces at compile time, not at the demo.
 *
 * Note on field-name mapping: the backend returns `translatedChunks`
 * (the DDB column name — renamed from `chunksTranslated` in issue #229)
 * while the frontend's `TranslationJob` uses `completedChunks`. The
 * `toTranslationJob` mapper translates at this ACL seam.
 */
export const getJobStatus = async (jobId: string): Promise<TranslationJob> => {
  try {
    const response = await apiClient.get<TranslationStatusApiResponse>(
      `/jobs/${jobId}/translation-status`
    );

    // Project the wire shape into the frontend `TranslationJob` via the
    // shared `toTranslationJob` mapper (architect M3 on PR #218). The
    // mapper is the single audit point for "how does the SPA decode a
    // backend job record?" — see frontend/src/services/mappers/.
    return toTranslationJob(response.data);
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get all translation jobs for the current user (first page only).
 *
 * Calls `GET /v1/jobs` — the endpoint added in PR #226/#220.
 * The backend scopes the result exclusively to the Cognito-claim identity;
 * any client-side `userId` override in the request is silently ignored by
 * the Lambda (OWASP API1:2023 IDOR guard).
 *
 * Wire shape (post-#237): `{ jobs: ListJobsItem[], count: number,
 * nextCursor?: string }`. The service projects the `jobs` array and
 * discards `count` and `nextCursor` — the array length carries the same
 * information as `count`, and pagination UI is deferred for the POC
 * (tracked in issue #237). Each item passes through `toTranslationJob`
 * so the field-name mapping at the ACL boundary is applied consistently
 * with `getJobStatus`.
 *
 * GAP (#237 POC): only the first page (up to 100 jobs) is returned.
 * Accounts with >100 jobs will see truncated history until a paginator
 * UI is added. The backend emits `nextCursor` when more pages exist;
 * this function intentionally ignores it for now.
 */
export const getTranslationJobs = async (): Promise<TranslationJob[]> => {
  try {
    // Use ListJobsEnvelope from shared-types so any future wire-shape
    // change to the GET /jobs envelope surfaces as a TypeScript error here.
    type WireItem = Parameters<typeof toTranslationJob>[0];
    const response = await apiClient.get<ListJobsEnvelope & { jobs: WireItem[] }>('/jobs');

    return (response.data.jobs ?? []).map((item) => toTranslationJob(item));
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Download translated document
 */
export const downloadTranslation = async (jobId: string): Promise<Blob> => {
  try {
    const response = await apiClient.get(`/jobs/${jobId}/download`, {
      responseType: 'blob',
    });

    return response.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get user's IP address for legal attestation
 * Note: IP address is now captured on the backend from request headers
 * This function returns a placeholder that will be replaced by the backend
 */
export const getUserIPAddress = async (): Promise<string> => {
  // Backend will capture the actual IP from API Gateway event headers
  return 'captured-by-backend';
};

/**
 * Create legal attestation data
 */
export const createLegalAttestation = async (
  acceptCopyrightOwnership: boolean,
  acceptTranslationRights: boolean,
  acceptLiabilityTerms: boolean
): Promise<LegalAttestation> => {
  const ipAddress = await getUserIPAddress();
  const userAgent = navigator.userAgent;
  const timestamp = new Date().toISOString();

  return {
    acceptCopyrightOwnership,
    acceptTranslationRights,
    acceptLiabilityTerms,
    userIPAddress: ipAddress,
    userAgent,
    timestamp,
  };
};

/**
 * Translation Service exports
 */
export const translationService = {
  uploadDocument,
  uploadAndAwaitChunked,
  startTranslation,
  getJobStatus,
  getTranslationJobs,
  downloadTranslation,
  getUserIPAddress,
  createLegalAttestation,
};
