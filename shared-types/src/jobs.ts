// Job Management Types - From Document 7 (Job State Management)
import { z } from 'zod';
import { fileSizeSchema } from './validation';

// Job Status Types

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
  translationTone?: 'formal' | 'informal' | 'neutral';
  tone?: 'formal' | 'informal' | 'neutral'; // Alias for translationTone
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
