// Job Management Types - From Document 7 (Job State Management)
import { z } from 'zod';
import { fileSizeSchema } from './validation.js';

// Job Status Types

/**
 * Canonical translation tone type — single source of truth shared between the
 * frontend tone selector (TranslationConfig.tsx TONE_OPTIONS) and the backend
 * validation in startTranslation.ts and translateChunk.ts.
 *
 * When changing the allowed set of tones:
 *   1. Update this union.
 *   2. Update TONE_OPTIONS in frontend/src/components/Translation/TranslationConfig.tsx.
 *   3. Update the `includes()` guard in startTranslation.ts validateRequest().
 *   4. Update the `tone?` field type in TranslateChunkEvent (translateChunk.ts).
 *
 * The tone contract test (backend/functions/translation/toneContract.test.ts)
 * enforces that all three sources stay in sync at compile time.
 */
export type TranslationTone = 'formal' | 'informal' | 'neutral';

/**
 * The canonical array of allowed tone values — derived from TranslationTone so
 * the literal union and this runtime array cannot drift.
 *
 * Use this for backend validation (`TRANSLATION_TONE_VALUES.includes(body.tone)`)
 * instead of inline string arrays so all references stay in sync.
 */
export const TRANSLATION_TONE_VALUES = [
  'formal',
  'informal',
  'neutral',
] as const satisfies ReadonlyArray<TranslationTone>;

/**
 * Legacy chunk-pipeline job status union used by the original spec documents.
 * Retained for historical compatibility; prefer TranslationJobStatus for all
 * new code touching the LFMT translation workflow.
 */
export type JobStatus =
  | 'QUEUED'
  | 'PROCESSING'
  | 'RETRYING'
  | 'RATE_LIMITED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'RESUMED';

/**
 * Canonical status union for LFMT translation jobs as they flow through the
 * actual backend pipeline:
 *
 *   PENDING → (S3 event) → CHUNKING → CHUNKED
 *     → (startTranslation) → IN_PROGRESS → COMPLETED
 *
 * Terminal states (no further transitions):
 *   COMPLETED | FAILED | CHUNKING_FAILED | TRANSLATION_FAILED
 *
 * This type is the single source of truth shared between:
 *   - frontend/src/services/translationService.ts (TranslationJob.status)
 *   - frontend/src/hooks/useTranslationJob.ts (TERMINAL_STATES)
 *   - frontend/src/pages/TranslationUpload.tsx (polling loop terminal check)
 *
 * Backend Lambda handlers currently use string literals directly; a future
 * backend-types PR will import from here.
 */
export type TranslationJobStatus =
  | 'PENDING'
  | 'CHUNKING'
  | 'CHUNKED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CHUNKING_FAILED'
  | 'TRANSLATION_FAILED';

/**
 * Statuses that represent a terminal (no-further-transition) outcome for a
 * translation job. Used by the frontend polling loop and useTranslationJob
 * hook to decide when to stop polling.
 */
export const TRANSLATION_TERMINAL_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CHUNKING_FAILED',
  'TRANSLATION_FAILED',
] as const satisfies ReadonlyArray<TranslationJobStatus>;

/** Type helper — narrows to just the terminal members of TranslationJobStatus. */
export type TranslationTerminalStatus = (typeof TRANSLATION_TERMINAL_STATUSES)[number];

/**
 * Statuses that indicate the chunking pipeline has failed permanently.
 * The submit-flow polling loop exits immediately when any of these is seen
 * instead of burning the full timeout budget.
 */
export const CHUNKING_ERROR_STATUSES = [
  'CHUNKING_FAILED',
  'FAILED',
  'TRANSLATION_FAILED',
] as const satisfies ReadonlyArray<TranslationJobStatus>;

export type JobPriority = 'LOW' | 'NORMAL' | 'HIGH';
export type QualityLevel = 'STANDARD' | 'PREMIUM';

// Job Creation
export interface CreateJobRequest {
  userId: string;
  documentId: string;
  filename: string;
  targetLanguage: string;
  documentMetadata: {
    wordCount: number;
    fileSize: number;
    contentHash: string;
  };
  translationOptions?: {
    preserveFormatting: boolean;
    customGlossary?: string;
    qualityLevel: QualityLevel;
  };
  priority: JobPriority;
}

export interface CreateJobResponse {
  jobId: string;
  status: JobStatus;
  estimatedCompletion: string;
  estimatedCost: number;
  chunkCount: number;
  progressTrackingUrl: string;
}

// Job Progress Tracking
export interface JobProgress {
  overallProgress: number; // 0-100
  chunksCompleted: number;
  totalChunks: number;
  estimatedTimeRemaining?: number; // seconds
  currentStage: string;
  processingSpeed?: number; // words per minute
  detailedProgress: {
    chunking: StageProgress;
    translation: StageProgress;
    assembly: StageProgress;
    delivery: StageProgress;
  };
}

export interface StageProgress {
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  progress: number; // 0-100
  startTime?: string;
  endTime?: string;
  errorMessage?: string;
}

export interface JobProgressResponse {
  jobId: string;
  status: JobStatus;
  overallProgress: number;
  chunksCompleted: number;
  totalChunks: number;
  estimatedTimeRemaining?: number;
  currentStage: string;
  lastUpdated: string;
  processingSpeed?: number;
  detailedProgress: {
    chunking: StageProgress;
    translation: StageProgress;
    assembly: StageProgress;
    delivery: StageProgress;
  };
}

// Job Management
export interface TranslationJob {
  jobId: string;
  userId: string;
  documentId: string;
  filename: string;
  targetLanguage: string;
  status: JobStatus;
  progress: JobProgress;
  timestamps: JobTimestamps;
  costs: JobCosts;
  chunks: ChunkSummary[];
  errors?: JobError[];
  metadata: JobMetadata;
}

/**
 * DynamoDB Job Record
 * Represents the actual structure of job records stored in DynamoDB.
 * This type includes all runtime fields used by Lambda functions.
 */
export interface DynamoDBJob {
  // Primary Keys
  jobId: string;
  userId: string;

  // Basic Job Info
  documentId?: string;
  filename?: string;
  status: string; // More permissive than JobStatus to handle unknown statuses
  createdAt: string;
  updatedAt?: string;

  // Chunking Metadata
  totalChunks?: number;
  chunkingMetadata?: {
    chunkKeys?: string[];
    chunkCount?: number;
    averageChunkSize?: number;
  };

  // Translation Metadata
  translationStatus?: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'TRANSLATION_FAILED';
  targetLanguage?: string;
  translationTone?: TranslationTone;
  tone?: TranslationTone; // Alias for translationTone
  translatedChunks?: number;
  tokensUsed?: number;
  estimatedCost?: number;
  translationStartedAt?: string;
  translationCompletedAt?: string;
  translationError?: string;

  // Step Functions
  executionArn?: string;
  executionStatus?: string;

  // Legal Attestation
  legalAttestation?: {
    accepted: boolean;
    timestamp: string;
    ipAddress?: string;
    userAgent?: string;
  };

  // Additional Fields (for extensibility)
  [key: string]: unknown;
}

export interface JobTimestamps {
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastUpdated: string;
}

export interface JobCosts {
  estimated: number;
  actual?: number;
  breakdown: {
    claudeAPI: number;
    infrastructure: number;
  };
}

export interface ChunkSummary {
  chunkId: string;
  index: number;
  status: JobStatus;
  tokenCount: number;
  processingTime?: number;
  cost?: number;
}

export interface JobError {
  errorId: string;
  timestamp: string;
  component: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  resolved: boolean;
}

export interface JobMetadata {
  originalFileSize: number;
  wordCount: number;
  estimatedTokens: number;
  priority: JobPriority;
  qualityLevel: QualityLevel;
}

// Job Cancellation
export interface CancelJobRequest {
  jobId: string;
  reason?: string;
  forceCancel?: boolean;
}

export interface CancelJobResponse {
  jobId: string;
  status: 'CANCELLED' | 'CANCELLING' | 'CANNOT_CANCEL';
  message: string;
  refundAmount?: number;
  estimatedStopTime?: string;
}

// ---------------------------------------------------------------------------
// REST API response DTOs — GET /jobs, GET /jobs/{jobId}, DELETE /jobs/{jobId}
// ---------------------------------------------------------------------------

/**
 * A single job summary item returned by GET /jobs.
 *
 * Mirrors the `GetJobApiResponse` shape but is used as an element of the
 * list endpoint — named separately so the two wire contracts can diverge
 * independently if a future version adds list-specific projections.
 */
export interface ListJobsItem {
  jobId: string;
  userId: string;
  status: string;
  filename?: string;
  fileSize?: number;
  createdAt: string;
  updatedAt?: string;
  translationStatus?: string;
  targetLanguage?: string;
  [key: string]: unknown;
}

/**
 * Array element type for the GET /jobs response.
 *
 * The actual wire body is `{ jobs: ListJobsApiResponse, count: number }` —
 * this type describes the element shape of the `jobs` array. Frontend callers
 * access `response.data.jobs` after the axios get resolves.
 *
 * Authorization: the array MUST be scoped to the Cognito-claim identity
 * (`event.requestContext.authorizer.claims.sub`). Any client-supplied
 * `userId` query parameter MUST be silently ignored.
 */
export type ListJobsApiResponse = ListJobsItem[];

/**
 * Response body returned by GET /jobs/{jobId}.
 *
 * Shape is intentionally flat (no `data` wrapper) so frontend callers can
 * access `response.data.jobId` directly without an extra nesting level.
 * Only the fields that are meaningful to callers are exposed; internal
 * DynamoDB fields (e.g. executionArn, legalAttestation) are omitted.
 *
 * The index signature satisfies the `ApiSuccessResponse` constraint used
 * by `createSuccessResponse` in the Lambda handler.
 */
export interface GetJobApiResponse {
  jobId: string;
  userId: string;
  status: string;
  filename?: string;
  fileSize?: number;
  createdAt: string;
  updatedAt?: string;
  translationStatus?: string;
  targetLanguage?: string;
  [key: string]: unknown;
}

/**
 * Response body returned by DELETE /jobs/{jobId}.
 *
 * Minimal shape: confirms which job was deleted and surfaces any advisory
 * warnings (e.g. an orphaned S3 object that could not be removed).
 */
export interface DeleteJobApiResponse {
  message: string;
  jobId: string;
  /** Advisory warning when S3 cleanup fails after a successful DDB delete. */
  warning?: string;
  [key: string]: unknown;
}

/**
 * Response body returned by GET /jobs/{jobId}/translation-status.
 *
 * Shape is intentionally flat (no `data` wrapper) so frontend callers can
 * access `response.data.jobId` directly. This DTO is the SINGLE SOURCE OF
 * TRUTH for the wire shape — both the Lambda handler
 * (`backend/functions/jobs/getTranslationStatus.ts`) and the frontend
 * service (`frontend/src/services/translationService.ts:getJobStatus`) MUST
 * import this type so a wire-shape drift surfaces as a TypeScript error
 * rather than a `Cannot read properties of undefined` runtime crash
 * (the 2026-05-09 demo blocker).
 *
 * Field naming notes (preserved from the live Lambda response):
 *   - `chunksTranslated` (NOT `completedChunks`) — the backend persists this
 *     name in DDB and surfaces it as-is on the wire.
 *   - `fileName` is camelCase here even though DDB stores `filename`
 *     (lowercase n) — the Lambda translates at the response boundary.
 *
 * The index signature satisfies the `ApiSuccessResponse` constraint used by
 * `createSuccessResponse` in the Lambda handler.
 */
export interface TranslationStatusApiResponse {
  jobId: string;
  /** Owning user (Cognito sub). */
  userId?: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  /** Overall job status (PENDING_UPLOAD, UPLOADED, CHUNKED, etc.). */
  status: string;
  translationStatus: string;
  targetLanguage?: string;
  tone?: TranslationTone;
  totalChunks: number;
  /** Number of chunks translated so far (NOT named `completedChunks`). */
  chunksTranslated: number;
  progressPercentage: number;
  tokensUsed?: number;
  estimatedCost?: number;
  createdAt?: string;
  translationStartedAt?: string;
  translationCompletedAt?: string;
  estimatedCompletion?: string;
  error?: string;
  [key: string]: unknown;
}

/**
 * Response body returned by POST /jobs/{jobId}/translate.
 *
 * Shape is intentionally flat (no `data` wrapper). Both the Lambda
 * (`backend/functions/jobs/startTranslation.ts`) and the frontend
 * (`translationService.ts:startTranslation`) MUST import this DTO so any
 * future drift surfaces at compile time.
 */
export interface StartTranslationApiResponse {
  message: string;
  jobId: string;
  translationStatus: string;
  targetLanguage: string;
  totalChunks: number;
  chunksTranslated: number;
  estimatedCompletion?: string;
  estimatedCost?: number;
  /** Step Functions execution ARN (for tracking / debugging). */
  executionArn?: string;
  [key: string]: unknown;
}

/**
 * Response body returned by GET /jobs/{jobId}/download.
 *
 * Note: The actual HTTP response from the Lambda is raw text/plain (not JSON).
 * This interface documents what metadata would be available if the endpoint
 * were ever changed to return a JSON envelope. It is NOT currently used by
 * the runtime path — it exists as a type reference for documentation and
 * future-proofing.
 *
 * @internal — not part of the public API contract; subject to change without notice.
 * @see backend/functions/translation/downloadTranslation.ts
 */
export interface DownloadTranslationApiResponse {
  /** The assembled translated document as plain text. */
  content: string;
  /** Suggested filename for the browser download. */
  filename: string;
  /** Metadata derived from the job record. */
  metadata: {
    sourceLanguage: string;
    targetLanguage?: string;
    tone?: TranslationTone;
    completedAt?: string;
    totalChunks: number;
    tokensUsed?: number;
    estimatedCost?: number;
  };
  [key: string]: unknown;
}

// Validation Schemas
export const createJobRequestSchema = z.object({
  userId: z.string().uuid(),
  documentId: z.string().uuid(),
  filename: z.string().min(1),
  targetLanguage: z.enum(['spanish', 'french', 'italian', 'german', 'chinese']),
  documentMetadata: z.object({
    wordCount: z.number().min(65000).max(400000),
    fileSize: fileSizeSchema,
    contentHash: z.string().min(1),
  }),
  translationOptions: z
    .object({
      preserveFormatting: z.boolean(),
      customGlossary: z.string().optional(),
      qualityLevel: z.enum(['STANDARD', 'PREMIUM']),
    })
    .optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH']),
});
