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
 * The actual wire body is `{ jobs: ListJobsApiResponse, count: number,
 * nextCursor?: string }` — this type describes the element shape of the
 * `jobs` array. Frontend callers access `response.data.jobs` after the
 * axios get resolves.
 *
 * Authorization: the array MUST be scoped to the Cognito-claim identity
 * (`event.requestContext.authorizer.claims.sub`). Any client-supplied
 * `userId` query parameter MUST be silently ignored.
 */
export type ListJobsApiResponse = ListJobsItem[];

/**
 * Response envelope returned by GET /jobs.
 *
 * `nextCursor` is present when DynamoDB returned a `LastEvaluatedKey`,
 * indicating there are more jobs beyond this page. Clients pass it back as
 * `?cursor=<value>` to retrieve the next page. The value is an opaque
 * base64-encoded string — clients MUST NOT attempt to parse it.
 *
 * POC scope: the frontend currently ignores `nextCursor` and renders only
 * the first page. A paginator UI is deferred until user history grows
 * beyond 100 jobs in practice.
 */
export interface ListJobsEnvelope {
  jobs: ListJobsItem[];
  count: number;
  /**
   * Opaque base64-encoded DynamoDB continuation token. Present only when
   * a subsequent page exists. Absent (not `null`) when this is the last page.
   */
  nextCursor?: string;
  /** Index signature required by `createFlatResponse<T extends ApiFlatResponseBody>`. */
  [key: string]: unknown;
}

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
 * Field naming notes:
 *   - `translatedChunks` (#229 rename from `chunksTranslated`) — now
 *     matches the DDB column name, eliminating the 3-tier naming drift.
 *     Single-shot rename is safe for this POC: there is exactly ONE
 *     consumer (the SPA we own), atomic deploys are used, and no
 *     third-party clients exist.
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
  /**
   * Number of chunks translated so far.
   *
   * Named `translatedChunks` to match the DDB column (issue #229 — eliminated
   * 3-tier naming drift between DDB / wire / frontend). The frontend's
   * Anti-Corruption Layer mapper (translationJobMapper.ts) projects this to
   * `completedChunks` on the frontend model; that internal rename is a
   * separate, optional cleanup.
   */
  translatedChunks: number;
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
 *
 * `translatedChunks` (#229 rename from `chunksTranslated`) — matches the
 * DDB column and the TranslationStatusApiResponse field for consistency.
 */
export interface StartTranslationApiResponse {
  message: string;
  jobId: string;
  translationStatus: string;
  targetLanguage: string;
  totalChunks: number;
  /** Always 0 at start; named `translatedChunks` to match DDB column (#229). */
  translatedChunks: number;
  estimatedCompletion?: string;
  estimatedCost?: number;
  /** Step Functions execution ARN (for tracking / debugging). */
  executionArn?: string;
  /**
   * API Gateway correlation UUID (echo of `event.requestContext.requestId`).
   * Present on every response shape produced by `createFlatResponse` /
   * `createErrorResponse`; reserved for log correlation, NEVER for a
   * status-code signal (see #267 for the bug this caveat addresses).
   */
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Canonical 4xx error-code union emitted by POST /jobs/{jobId}/translate.
 *
 * Added in #267 alongside the API-error-envelope `errorCode` field so the
 * frontend can dispatch on a stable machine-readable signal instead of
 * pattern-matching the human-readable `message`. The values mirror the
 * literal-string codes used by the Lambda (`backend/functions/jobs/
 * startTranslation.ts`). The frontend's `TranslationErrorCode` union
 * (`frontend/src/services/translationService.ts`) is a SUPERSET of this one
 * — it also covers transport-level codes (`S3_UPLOAD_BLOCKED`, etc.) that
 * never reach a Lambda. Keep this union in sync with the backend literals
 * when adding new failure modes.
 *
 * #286 — `FORBIDDEN` was removed from this union. POST /jobs/{jobId}/translate
 * no longer emits a 403 when the caller does not own the job; both the
 * not-found and not-owned cases now collapse into a single 404 with
 * `JOB_NOT_FOUND` (OWASP API1:2023 — BOLA / resource-existence leak). The
 * frontend's looser `TranslationErrorCode` union retains the `FORBIDDEN`
 * literal as a deployment-window forward-compat / defense-in-depth measure
 * and to type the auth-handler 403 path that is orthogonal to this fix.
 */
export type StartTranslationErrorCode =
  | 'MISSING_JOB_ID'
  | 'INVALID_REQUEST'
  | 'JOB_NOT_FOUND'
  | 'INVALID_JOB_STATUS'
  | 'TRANSLATION_ALREADY_STARTED'
  | 'NO_CHUNKS_AVAILABLE'
  | 'INTERNAL_ERROR';

/**
 * Canonical flat error envelope shared across every Lambda that returns a
 * 4xx/5xx body via `createErrorResponse`. The runtime helper lives in
 * `backend/functions/shared/api-response.ts`; this interface is the type-level
 * mirror so the frontend (and the live contract spec) can import a single
 * authoritative shape.
 *
 * `errorCode` was added in #267 — pre-#267 the only machine-readable signal
 * the frontend had was a status-code string stuffed into `requestId` (a
 * misuse that broke CloudWatch log correlation). The `errorCode` field is
 * the canonical home for that signal; `requestId` is reserved for the API
 * Gateway request UUID.
 */
export interface ApiErrorEnvelope {
  message: string;
  /** API Gateway correlation UUID — `event.requestContext.requestId`. */
  requestId?: string;
  /** Machine-readable status-code discriminator (e.g. `JOB_NOT_FOUND`). */
  errorCode?: string;
  /** Per-field validation errors (only present on Zod-validated handlers). */
  errors?: Record<string, string[]>;
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

// ---------------------------------------------------------------------------
// Output Format — issue #28 (additional download formats: ePub + PDF).
// ---------------------------------------------------------------------------

/**
 * Canonical output-format union for translated documents (issue #28).
 *
 * - `markdown` — the original raw text/plain output (existing behaviour).
 * - `epub`     — industry-standard ebook format (Kindle, Kobo, iBooks, etc.).
 * - `pdf`      — universal format that preserves layout on any device.
 *
 * This type is the SINGLE SOURCE OF TRUTH shared between:
 *   - frontend/src/services/translationService.ts (downloadTranslation `format` arg)
 *   - frontend/src/pages/TranslationDetail.tsx (download-button group)
 *   - backend/functions/translation/downloadTranslation.ts (Lambda dispatch)
 *
 * Markdown is retained as a value so legacy callers that omit the query
 * parameter still receive the original behaviour. The Lambda validates the
 * query value against `OUTPUT_FORMAT_VALUES` and rejects unknown formats
 * with 400 — defense-in-depth against typos and supply-chain confusion.
 */
export type OutputFormat = 'markdown' | 'epub' | 'pdf';

/**
 * Runtime array of allowed OutputFormat values — derived from the union so
 * the literal type and this array cannot drift.
 *
 * Use for input validation on the Lambda boundary:
 *
 * ```ts
 * if (!OUTPUT_FORMAT_VALUES.includes(format as OutputFormat)) {
 *   return createErrorResponse(400, ...);
 * }
 * ```
 */
export const OUTPUT_FORMAT_VALUES = [
  'markdown',
  'epub',
  'pdf',
] as const satisfies ReadonlyArray<OutputFormat>;

/**
 * Type-guard for OutputFormat. Use to narrow a wire-supplied string value
 * (e.g. a query-string parameter) into the union before dispatching on it.
 *
 * ```ts
 * const format = event.queryStringParameters?.format ?? 'markdown';
 * if (!isOutputFormat(format)) {
 *   return createErrorResponse(400, `Unsupported format: ${format}`, ...);
 * }
 * // `format` is now typed as OutputFormat.
 * ```
 */
export function isOutputFormat(value: unknown): value is OutputFormat {
  return typeof value === 'string' && (OUTPUT_FORMAT_VALUES as readonly string[]).includes(value);
}

/**
 * MIME content type used in the Content-Type response header for each format.
 *
 * Source of truth for the Lambda response wiring; the frontend does not need
 * to read this directly because it always treats the response as `Blob`, but
 * the table is exported so contract tests can assert agreement.
 */
export const OUTPUT_FORMAT_CONTENT_TYPES: Readonly<Record<OutputFormat, string>> = {
  markdown: 'text/plain; charset=utf-8',
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
};

/**
 * File-extension token used when building the Content-Disposition `filename=`
 * attribute. Centralised here so the Lambda and any future client-side
 * filename-derivation share a single value.
 */
export const OUTPUT_FORMAT_FILE_EXTENSIONS: Readonly<Record<OutputFormat, string>> = {
  markdown: 'txt',
  epub: 'epub',
  pdf: 'pdf',
};

/**
 * JSON envelope returned by GET /jobs/{jobId}/download?format=epub|pdf.
 *
 * The Lambda generates (or reuses) the converted artefact, uploads it to
 * S3 under `translated-output/{jobId}/translation.{ext}`, and replies
 * with this envelope. The SPA follows `downloadUrl` to trigger the
 * direct-from-S3 browser download — no Lambda round trip for the bytes.
 *
 * `markdown` requests do NOT return this shape; they return raw text/plain
 * (preserves the pre-#28 contract).
 *
 * The presigned URL expiry is informational — the SPA does not need to
 * persist this value; it should redirect to `downloadUrl` immediately.
 */
export interface PresignedDownloadEnvelope {
  /** Always 'epub' or 'pdf' (never 'markdown' — that path stays inline). */
  format: Exclude<OutputFormat, 'markdown'>;
  /** S3 presigned GET URL. Time-bounded; do not log or share. */
  downloadUrl: string;
  /** TTL of the presigned URL in seconds (informational). */
  expiresInSeconds: number;
  /**
   * S3 object key — exposed so the SPA can show a stable identifier in
   * dev tools / error reports without dumping the (long, signed) URL.
   */
  objectKey: string;
  /** Index signature for the createFlatResponse generic constraint. */
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
