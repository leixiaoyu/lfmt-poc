/**
 * Translation Service
 *
 * Handles all translation-related API calls including job management,
 * file uploads, and status tracking.
 */

import axios from 'axios';
import { apiClient } from '../utils/api';
import { stripBrowserForbiddenHeaders } from '../utils/headerFilters';
import type {
  PresignedUrlApiResponse,
  StartTranslationApiResponse,
  TranslationJobStatus,
  TranslationStatusApiResponse,
} from '@lfmt/shared-types';
import { CHUNKING_ERROR_STATUSES } from '@lfmt/shared-types';

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
 * Translation Service Error.
 *
 * `originalError` is typed `Error | undefined` (NOT `AxiosError`) so
 * the non-axios branch in `wrapS3UploadError` can preserve plain Error
 * causes (disk-full, generic XHR failure, etc.) without a type cast.
 * AxiosError extends Error, so axios-error code paths remain
 * compatible — callers that need axios-specific fields (`.response`,
 * `.request`) MUST narrow with `axios.isAxiosError(originalError)`
 * before reading them. This matches the wider runtime contract
 * ("preserve any underlying cause") and removes the `as unknown as
 * AxiosError` lie that previously allowed the field to silently lose
 * the cause shape (PR #214 OMC R2 M-1).
 */
export class TranslationServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'TranslationServiceError';
  }
}

/**
 * Sentinel message used by `wrapS3UploadError` when the browser blocks
 * the S3 PUT before any HTTP response is received. Exported so the
 * page-level error mapper (`translationErrorMessages`) can match on it
 * deterministically rather than parsing a free-form string.
 *
 * The wording is deliberately neutral: from the browser's perspective
 * we cannot prove which of {CSP block, network outage, DNS failure,
 * S3 outage} caused `error.response === undefined`, so we describe the
 * symptom and point the user at the action with the highest expected
 * value (contact support if persistent — these are config issues, not
 * transient network blips, in 95%+ of observed cases).
 */
export const S3_UPLOAD_BLOCKED_MESSAGE =
  'Upload was blocked. This is likely a configuration issue — please refresh and try again, or contact support if it persists.';

/**
 * Re-shape an S3 PUT failure so the page-level error UI can tell it
 * apart from API-side failures. axios reports CSP-blocked / network-
 * level failures with `error.response` undefined; that's the only
 * signal we have at this seam. We map it to a TranslationServiceError
 * with `statusCode = undefined` and `S3_UPLOAD_BLOCKED_MESSAGE` so the
 * page mapper surfaces the targeted phrase rather than the misleading
 * generic "Connection lost" text.
 */
function wrapS3UploadError(error: unknown): TranslationServiceError {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      // No HTTP response — CSP block, DNS failure, or network outage.
      return new TranslationServiceError(S3_UPLOAD_BLOCKED_MESSAGE, undefined, error);
    }
    // S3 returned an HTTP error (e.g. SignatureDoesNotMatch, 403). Surface
    // its status to the page so it can branch on the curated table in
    // translationErrorMessages.
    return new TranslationServiceError(
      error.response.statusText || `S3 upload failed with status ${error.response.status}`,
      error.response.status,
      error
    );
  }
  // Non-axios error — preserve the message AND the original cause so
  // monitoring tools (Sentry, Rollbar, etc.) see the underlying failure
  // rather than a stripped-down service error. If the rejected value
  // wasn't even an Error (string, undefined, plain object), wrap it in
  // a synthetic Error so `originalError.message` stays a string and the
  // cause chain remains inspectable downstream.
  //
  // M-1 (PR #214 OMC R2): widen `originalError` to `Error | undefined`
  // at the field level so the non-axios branch no longer needs a cast.
  // The previous `as unknown as AxiosError` was a type-system lie —
  // monitoring tools that read `.response` on a non-axios cause would
  // hit `undefined`, but the compiler didn't warn. Treating the field
  // as the broader `Error` type matches the runtime contract ("preserve
  // ANY cause"); axios-error consumers narrow with `axios.isAxiosError`
  // before reading axios-specific fields (which is what they should be
  // doing anyway).
  const originalError: Error = error instanceof Error ? error : new Error(String(error));
  const message = error instanceof Error ? error.message : 'S3 upload failed';
  return new TranslationServiceError(message, undefined, originalError);
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
    throw new TranslationServiceError(message, statusCode, error);
  }
  throw new TranslationServiceError('An unexpected error occurred');
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

    // Step 2: Upload file directly to S3 using presigned URL.
    // Note: We use axios directly here because S3 doesn't need our API interceptors/auth headers.
    //
    // IMPORTANT (Bug #1, SignatureDoesNotMatch): rely exclusively on requiredHeaders returned by
    // the backend. The backend signs the presigned URL with the exact Content-Type it puts in
    // requiredHeaders (lines 224-227 of uploadRequest.ts). Adding an extra 'Content-Type' override
    // here risks a mismatch between the signed value and the sent value when the browser File.type
    // differs from what the backend normalised, which causes S3 to reject the request with
    // SignatureDoesNotMatch.
    //
    // IMPORTANT (browser unsafe-header rule): strip Content-Length before handing headers to the
    // browser-side XHR. Per Fetch spec §forbidden-header-name, browsers refuse setRequestHeader on
    // 'Content-Length' (and several other transport-managed headers) and emit
    // "Refused to set unsafe header 'Content-Length'" to the console. The browser ALWAYS sets
    // Content-Length itself based on the body size, so the signature still matches — but only if
    // we don't try to set it manually. The backend keeps Content-Length in `requiredHeaders` for
    // documentation purposes and for non-browser callers (e.g., CLI smoke tests via curl that DO
    // honour the value); the browser path filters it out at the seam where headers cross into XHR
    // land.
    //
    // Root cause of the 2026-05-08 browser walkthrough failure: the curl validation path bypasses
    // both CSP and the unsafe-header rule, so the API contract worked end-to-end via curl but the
    // browser path was never exercised against the deployed configuration. This filter + the CSP
    // bucket-origin entry in lfmt-infrastructure-stack.ts (`buildCsp`) close that gap.
    const browserSafeHeaders = stripBrowserForbiddenHeaders(requiredHeaders);

    try {
      await axios.put(uploadUrl, request.file, {
        headers: browserSafeHeaders,
      });
    } catch (uploadError) {
      // Step 2a: re-shape S3-side failures so the UI layer can distinguish them
      // from API-side failures (presigned URL request, status polling, etc.).
      //
      // axios reports CSP-blocked / network-failed XHRs with `error.response`
      // === undefined (no HTTP response was ever received) and `error.request`
      // populated. Without distinguishing this from an API outage we surface a
      // generic "Connection lost" message — see PR for issue #98 + bug class
      // explanation in `getTranslationErrorMessage` for the precedence rules.
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
 * The Lambda's response is a wider shape than `TranslationJob` (it also
 * carries `executionArn`, `estimatedCost`, etc.), but the wizard only
 * needs the `TranslationJob`-compatible fields, so we map at this seam.
 */
export const startTranslation = async (
  jobId: string,
  config: TranslationConfig
): Promise<TranslationJob> => {
  try {
    const response = await apiClient.post<StartTranslationApiResponse>(`/jobs/${jobId}/translate`, {
      targetLanguage: config.targetLanguage,
      tone: config.tone,
    });

    const body = response.data;
    return {
      jobId: body.jobId,
      // The backend response does not echo userId here; the field is
      // tracked elsewhere (auth context / job detail endpoint). Default
      // to '' to satisfy the TranslationJob shape; the value is not
      // read on the post-startTranslation code paths today.
      userId: '',
      fileName: '',
      fileSize: 0,
      contentType: '',
      // The job has just been transitioned to IN_PROGRESS — the wire
      // shape of `translationStatus` happens to be the same as
      // TranslationJob.status for this code path.
      status: body.translationStatus as TranslationJobStatus,
      targetLanguage: body.targetLanguage,
      totalChunks: body.totalChunks,
      completedChunks: body.chunksTranslated,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
 * Note on field-name mapping: the backend returns `chunksTranslated`
 * (mirroring its DDB column) while the frontend's `TranslationJob` uses
 * `completedChunks`. We translate at this seam.
 */
export const getJobStatus = async (jobId: string): Promise<TranslationJob> => {
  try {
    const response = await apiClient.get<TranslationStatusApiResponse>(
      `/jobs/${jobId}/translation-status`
    );

    const body = response.data;
    return {
      jobId: body.jobId,
      userId: body.userId ?? '',
      fileName: body.fileName ?? '',
      fileSize: body.fileSize ?? 0,
      contentType: body.contentType ?? '',
      status: body.status as TranslationJobStatus,
      targetLanguage: body.targetLanguage,
      tone: body.tone,
      totalChunks: body.totalChunks,
      completedChunks: body.chunksTranslated,
      createdAt: body.createdAt ?? new Date().toISOString(),
      updatedAt: body.translationCompletedAt ?? body.createdAt ?? new Date().toISOString(),
      completedAt: body.translationCompletedAt,
      errorMessage: body.error,
    };
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get all translation jobs for the current user.
 *
 * KNOWN-LIMITATION: as of 2026-05-09 there is NO `GET /jobs` route on the
 * real backend (`backend/infrastructure/lib/lfmt-infrastructure-stack.ts`
 * only exposes `GET /jobs/{jobId}` and `GET /jobs/{jobId}/translation-status`).
 * The History page (`pages/TranslationHistory.tsx`) currently calls this
 * method against the deployed backend and gets a 403/404 — the page
 * surfaces an empty list, which is the "silently broken" behaviour
 * flagged in the hotfix audit. This is a pre-existing gap, NOT a
 * regression from this hotfix; tracked as a follow-up.
 *
 * For envelope correctness when the endpoint DOES exist (today only via
 * the MSW mock): the convention across the rest of the API is a flat
 * shape, so the reader expects `response.data` to BE the array.
 */
export const getTranslationJobs = async (): Promise<TranslationJob[]> => {
  try {
    const response = await apiClient.get<TranslationJob[]>('/jobs');

    return response.data;
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
