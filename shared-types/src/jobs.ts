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
    fileSize: z.number().min(1).max(100 * 1024 * 1024), // 100MB
    contentHash: z.string().min(1)
  }),
  translationOptions: z.object({
    preserveFormatting: z.boolean(),
    customGlossary: z.string().optional(),
    qualityLevel: z.enum(['STANDARD', 'PREMIUM'])
  }).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH'])
});