// API Types - From Document 3 (API Gateway & Lambda Functions) and Document 5 (Claude API Integration)
import { z } from 'zod';

// Generic API Response
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  metadata?: ApiMetadata;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
  timestamp: string;
  requestId: string;
}

export interface ApiMetadata {
  requestId: string;
  timestamp: string;
  version: string;
  processingTime: number;
}

// Claude API Integration
export interface ClaudeTranslationRequest {
  chunkId: string;
  content: string;
  targetLanguage: string;
  contextWindow?: {
    preceding: string;
    following: string;
  };
  translationHints?: TranslationHint[];
  retryAttempt?: number;
}

export interface TranslationHint {
  type: 'terminology' | 'style' | 'context';
  hint: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ClaudeTranslationResponse {
  chunkId: string;
  translatedContent: string;
  confidence: number; // 0-1 quality score
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
  };
  processingTime: number;
  claudeModel: string;
  translationMetadata: {
    detectedLanguage?: string;
    preservedFormatting: string[];
    qualityFlags: QualityFlag[];
  };
}

export interface QualityFlag {
  type: 'INCONSISTENCY' | 'UNTRANSLATED_SEGMENT' | 'FORMATTING_LOSS' | 'CONTEXT_BREAK';
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  description: string;
  chunkPosition?: number;
}

// Claude API Usage Tracking
export interface UsageRequest {
  timeRange: 'hour' | 'day' | 'month';
  startDate?: string;
  endDate?: string;
}

export interface UsageResponse {
  totalRequests: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCost: number;
  rateLimitStatus: {
    requestsRemaining: number;
    tokensRemaining: number;
    resetTime: string;
  };
  costProjection: {
    daily: number;
    monthly: number;
  };
}

// Rate Limiting
export interface RateLimitInfo {
  requestsPerMinute: number;
  tokensPerMinute: number;
  currentUsage: {
    requests: number;
    tokens: number;
    resetTime: string;
  };
  throttled: boolean;
}

// Progress Tracking (Polling)
export interface ProgressRequest {
  jobId: string;
}

export interface ProgressResponse {
  jobId: string;
  status: JobStatus;
  progress: number; // 0-100
  chunksProcessed: number;
  totalChunks: number;
  estimatedTimeRemaining?: number; // seconds
  lastUpdated: string; // ISO 8601
  processingSpeed?: number; // words per minute
  currentStage?: string;
  // Metadata for polling optimization
  cacheAge?: number; // seconds since last update
  nextPollRecommendation?: number; // recommended next poll interval
}

export interface StatusResponse {
  jobId: string;
  status: JobStatus;
  lastUpdated: string;
  errorMessage?: string;
}

// HTTP Headers for API responses
export interface PollingHeaders {
  'Cache-Control': string;
  'Content-Type': 'application/json';
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'ETag'?: string;
}

// Email Notifications
export interface EmailNotificationRequest {
  jobId: string;
  email: string;
  notificationTypes: ('COMPLETION' | 'FAILURE' | 'PROGRESS_MILESTONE')[];
}

export interface EmailNotificationResponse {
  notificationId: string;
  status: 'SCHEDULED' | 'SENT' | 'FAILED';
  scheduledFor?: string;
}

// Cost Estimation
export interface CostEstimationRequest {
  wordCount: number;
  targetLanguage: string;
  qualityLevel: 'STANDARD' | 'PREMIUM';
}

export interface CostEstimationResponse {
  estimatedCost: number;
  breakdown: {
    claudeAPICost: number;
    awsInfrastructureCost: number;
  };
  processingTime: {
    estimated: number; // minutes
    range: { min: number; max: number };
  };
}

// Import JobStatus from jobs.ts
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

// Validation Schemas
export const claudeTranslationRequestSchema = z.object({
  chunkId: z.string().uuid(),
  content: z.string().min(1),
  targetLanguage: z.enum(['spanish', 'french', 'italian', 'german', 'chinese']),
  contextWindow: z.object({
    preceding: z.string(),
    following: z.string()
  }).optional(),
  translationHints: z.array(z.object({
    type: z.enum(['terminology', 'style', 'context']),
    hint: z.string(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH'])
  })).optional(),
  retryAttempt: z.number().min(0).max(3).optional()
});