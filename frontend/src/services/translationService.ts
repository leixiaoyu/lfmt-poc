/**
 * Translation Service
 *
 * Handles all translation-related API calls including job management,
 * file uploads, and status tracking.
 */

import axios, { AxiosError } from 'axios';
import { apiClient } from '../utils/api';
import type { TranslationJobStatus } from '@lfmt/shared-types';
import { CHUNKING_ERROR_STATUSES } from '@lfmt/shared-types';

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
 * Translation Service Error
 */
export class TranslationServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: AxiosError
  ) {
    super(message);
    this.name = 'TranslationServiceError';
  }
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
    // Step 1: Request presigned URL from backend
    const presignedResponse = await apiClient.post<{
      data: {
        uploadUrl: string;
        fileId: string;
        jobId: string;
        expiresIn: number;
        requiredHeaders: Record<string, string>;
      };
    }>('/jobs/upload', {
      fileName: request.file.name,
      fileSize: request.file.size,
      contentType: request.file.type,
      legalAttestation: request.legalAttestation,
    });

    const { uploadUrl, jobId, requiredHeaders } = presignedResponse.data.data;

    // Step 2: Upload file directly to S3 using presigned URL.
    // Note: We use axios directly here because S3 doesn't need our API interceptors/auth headers.
    // IMPORTANT: rely exclusively on requiredHeaders returned by the backend. The backend signs the
    // presigned URL with the exact Content-Type it puts in requiredHeaders (lines 224-227 of
    // uploadRequest.ts). Adding an extra 'Content-Type' override here risks a mismatch between
    // the signed value and the sent value when the browser File.type differs from what the backend
    // normalised, which causes S3 to reject the request with SignatureDoesNotMatch.
    await axios.put(uploadUrl, request.file, {
      headers: { ...requiredHeaders },
    });

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
 * Start translation for a job
 */
export const startTranslation = async (
  jobId: string,
  config: TranslationConfig
): Promise<TranslationJob> => {
  try {
    const response = await apiClient.post<{ data: TranslationJob }>(`/jobs/${jobId}/translate`, {
      targetLanguage: config.targetLanguage,
      tone: config.tone,
    });

    return response.data.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get job status
 */
export const getJobStatus = async (jobId: string): Promise<TranslationJob> => {
  try {
    const response = await apiClient.get<{ data: TranslationJob }>(
      `/jobs/${jobId}/translation-status`
    );

    return response.data.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get all translation jobs for the current user
 */
export const getTranslationJobs = async (): Promise<TranslationJob[]> => {
  try {
    const response = await apiClient.get<{ data: TranslationJob[] }>('/jobs');

    return response.data.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Download translated document
 */
export const downloadTranslation = async (jobId: string): Promise<Blob> => {
  try {
    const response = await apiClient.get(`/translation/${jobId}/download`, {
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
