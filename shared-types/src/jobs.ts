// Job Management Types - From Document 7 (Job State Management)
import { z } from 'zod';

// Job Status Types
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
