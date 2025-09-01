// Error Handling Types - From Document 9 (Error Handling & Recovery)
import { z } from 'zod';

// Error Classifications
export type ErrorSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ErrorCategory = 'BUG' | 'ENHANCEMENT' | 'SPECIFICATION_DEVIATION';
export type ErrorStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type RecoveryStrategy = 'RETRY' | 'SKIP' | 'MANUAL' | 'ROLLBACK';

// Error Reporting
export interface ErrorReportRequest {
  errorId: string;
  component: string;
  errorCode: string;
  message: string;
  severity: ErrorSeverity;
  context: {
    jobId?: string;
    userId?: string;
    chunkId?: string;
    requestId?: string;
    timestamp: string;
    stackTrace?: string;
    additionalData?: Record<string, any>;
  };
  retryable: boolean;
  autoRecover: boolean;
}

export interface ErrorReportResponse {
  errorId: string;
  acknowledged: boolean;
  recoveryAction: RecoveryAction;
  estimatedResolutionTime?: number;
  escalationLevel: number;
}

// Error Details and Management
export interface ErrorDetailsResponse {
  errorId: string;
  component: string;
  errorCode: string;
  message: string;
  severity: ErrorSeverity;
  status: ErrorStatus;
  context: ErrorContext;
  timeline: ErrorTimelineEntry[];
  recoveryAttempts: RecoveryAttempt[];
  relatedErrors: string[];
  resolution?: ErrorResolution;
}

export interface ErrorContext {
  jobId?: string;
  userId?: string;
  chunkId?: string;
  requestId?: string;
  timestamp: string;
  stackTrace?: string;
  additionalData?: Record<string, any>;
  environment: string;
  version: string;
}

export interface ErrorTimelineEntry {
  timestamp: string;
  action: string;
  actor: string;
  details: string;
}

export interface RecoveryAttempt {
  attemptId: string;
  timestamp: string;
  strategy: RecoveryStrategy;
  parameters: Record<string, any>;
  result: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
  duration: number;
  error?: string;
}

export interface ErrorResolution {
  resolvedAt: string;
  resolvedBy: string;
  resolution: string;
  preventionMeasures: string[];
}

// Recovery Management
export interface RecoveryRequest {
  recoveryStrategy: RecoveryStrategy;
  parameters?: Record<string, any>;
  triggeredBy: string;
}

export interface RecoveryResponse {
  recoveryId: string;
  status: 'INITIATED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  estimatedDuration: number;
  actions: RecoveryAction[];
}

export interface RecoveryAction {
  actionId: string;
  type: 'RETRY' | 'ROLLBACK' | 'NOTIFY' | 'ESCALATE';
  description: string;
  parameters: Record<string, any>;
  priority: number;
}

// Error Analytics
export interface ErrorAnalyticsRequest {
  startDate: string;
  endDate: string;
  component?: string;
  severity?: ErrorSeverity[];
  includeResolved?: boolean;
}

export interface ErrorAnalyticsResponse {
  totalErrors: number;
  errorsByComponent: ComponentErrorStats[];
  errorsByCode: ErrorCodeStats[];
  errorTrends: ErrorTrendData[];
  meanTimeToResolution: number;
  recoverySuccessRate: number;
  topFailureReasons: FailureReason[];
  recommendations: string[];
}

export interface ComponentErrorStats {
  component: string;
  totalErrors: number;
  errorsBySeverity: Record<ErrorSeverity, number>;
  averageResolutionTime: number;
}

export interface ErrorCodeStats {
  errorCode: string;
  count: number;
  lastOccurrence: string;
  averageResolutionTime: number;
}

export interface ErrorTrendData {
  date: string;
  errorCount: number;
  severity: ErrorSeverity;
}

export interface FailureReason {
  reason: string;
  frequency: number;
  impact: ErrorSeverity;
  suggestedFix: string;
}

// Circuit Breaker
export interface CircuitBreakerState {
  service: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failureCount: number;
  lastFailureTime?: string;
  nextRetryTime?: string;
  configuration: {
    failureThreshold: number;
    timeout: number;
    retryTimeout: number;
  };
}

// Polling Error Types
export interface PollingError {
  type: 'NETWORK' | 'SERVER' | 'TIMEOUT' | 'RATE_LIMIT' | 'CIRCUIT_BREAKER';
  message: string;
  retryable: boolean;
  backoffTime: number;
}

export class CircuitBreakerError extends Error {
  constructor(service: string, message: string) {
    super(`Circuit breaker open for ${service}: ${message}`);
    this.name = 'CircuitBreakerError';
  }
}

export class RateLimitError extends Error {
  constructor(resetTime: string) {
    super(`Rate limit exceeded. Reset at: ${resetTime}`);
    this.name = 'RateLimitError';
  }
}

export class ValidationError extends Error {
  public details: string[];
  
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class AuthenticationError extends Error {
  constructor(message: string = 'Authentication failed') {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class NetworkError extends Error {
  constructor(message: string = 'Network connection failed') {
    super(message);
    this.name = 'NetworkError';
  }
}

// Validation Schemas
export const errorReportRequestSchema = z.object({
  errorId: z.string().uuid(),
  component: z.string().min(1),
  errorCode: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  context: z.object({
    jobId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    chunkId: z.string().uuid().optional(),
    requestId: z.string().uuid().optional(),
    timestamp: z.string().datetime(),
    stackTrace: z.string().optional(),
    additionalData: z.record(z.any()).optional()
  }),
  retryable: z.boolean(),
  autoRecover: z.boolean()
});