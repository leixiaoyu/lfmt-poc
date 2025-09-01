// Polling System Types - From Document 2 (Frontend Polling System)
import { z } from 'zod';

// Polling Configuration
export interface PollingConfig {
  intervals: {
    initial: number;    // 15000ms - first 5 minutes
    medium: number;     // 30000ms - 5-30 minutes  
    extended: number;   // 60000ms - 30+ minutes
    background: number; // 120000ms - when page not visible
  };
  thresholds: {
    mediumThreshold: number;  // 5 minutes
    extendedThreshold: number; // 30 minutes
  };
  circuit: {
    errorThreshold: number;     // 5 consecutive errors
    timeoutThreshold: number;   // 10 seconds
    recoveryTime: number;       // 30 seconds
  };
}

// Polling State Management
export interface PollingState {
  jobId: string;
  isActive: boolean;
  interval: number;
  startTime: number;
  lastSuccess: number;
  errorCount: number;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  pageVisible: boolean;
  performanceMetrics: {
    averageResponseTime: number;
    successRate: number;
    cacheHitRate: number;
  };
}

export interface AdaptivePollingManager {
  activePollers: Map<string, PollingState>;
  globalConfig: PollingConfig;
  performanceMonitor: PerformanceMonitor;
}

// Performance Monitoring
export interface PerformanceMonitor {
  trackResponse(jobId: string, responseTime: number, success: boolean): void;
  getMetrics(jobId: string): PerformanceMetrics;
  shouldAdjustInterval(jobId: string): boolean;
}

export interface PerformanceMetrics {
  averageResponseTime: number;
  successRate: number;
  requestCount: number;
  lastUpdated: number;
}

// React Query Integration
export interface PollingCacheEntry {
  data: ProgressResponse;
  timestamp: number;
  etag?: string;
  cacheAge: number;
}

// Adaptive Polling Hook Options
export interface UseAdaptivePollingOptions {
  enabled?: boolean;
  onStatusChange?: (status: JobStatus) => void;
  onError?: (error: Error) => void;
  onComplete?: (result: ProgressResponse) => void;
  onCancelled?: (result: ProgressResponse) => void;
}

// Page Visibility Management
export interface PageVisibilityManager {
  isVisible: boolean;
  listeners: Set<(visible: boolean) => void>;
  addListener(callback: (visible: boolean) => void): void;
  removeListener(callback: (visible: boolean) => void): void;
  getIsVisible(): boolean;
  destroy(): void;
}

// Circuit Breaker for Polling
export interface PollingCircuitBreaker {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime: number;
  config: {
    errorThreshold: number;
    timeoutThreshold: number;
    recoveryTime: number;
  };
  
  canExecute(): boolean;
  recordSuccess(): void;
  recordFailure(): void;
  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

// Adaptive Interval Calculation
export interface AdaptivePollingCalculator {
  config: PollingConfig;
  
  calculateInterval(
    jobAge: number,
    pageVisible: boolean,
    errorCount: number,
    averageResponseTime: number
  ): number;
  
  shouldBackoff(errorCount: number, circuitState: string): boolean;
  getBackoffMultiplier(errorCount: number): number;
}

// Polling Hook Return Type
export interface UseAdaptivePollingReturn {
  data: ProgressResponse | undefined;
  error: Error | undefined;
  isLoading: boolean;
  pollingState: PollingState;
  setEnabled: (enabled: boolean) => void;
  refetch: () => Promise<ProgressResponse>;
}

// Cancellation-Aware Polling
export interface CancellationAwarePolling {
  stopPolling: () => void;
  resumePolling: () => void;
  handleCancellation: (jobId: string) => Promise<void>;
}

// Multi-Job Polling Coordination
export interface MultiJobPollingState {
  activeJobs: string[];
  pollingInstances: Map<string, UseAdaptivePollingReturn>;
  globalPerformance: {
    totalRequests: number;
    averageResponseTime: number;
    errorRate: number;
  };
}

// Progress Response (re-exported for convenience)
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

// Import JobStatus for type consistency
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
export const pollingConfigSchema = z.object({
  intervals: z.object({
    initial: z.number().min(5000).max(30000), // 5-30 seconds
    medium: z.number().min(15000).max(60000), // 15-60 seconds
    extended: z.number().min(30000).max(300000), // 30s-5min
    background: z.number().min(60000).max(600000) // 1-10 minutes
  }),
  thresholds: z.object({
    mediumThreshold: z.number().min(300000), // 5 minutes
    extendedThreshold: z.number().min(1800000) // 30 minutes
  }),
  circuit: z.object({
    errorThreshold: z.number().min(3).max(10),
    timeoutThreshold: z.number().min(5000).max(30000),
    recoveryTime: z.number().min(15000).max(300000)
  })
});