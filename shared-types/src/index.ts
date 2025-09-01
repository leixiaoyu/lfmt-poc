// LFMT Shared Types - Complete Interface Definitions
// Based on Low-Level Design Documents 1-10

// Core interfaces (order matters to avoid conflicts)
export * from './auth';
export * from './errors';         // Export ValidationError from here
export * from './jobs';           // Export JobStatus from here
export * from './documents';      // Export ValidationResult from here (primary)
export * from './legal';
export * from './workflows';

// API and polling interfaces with selective exports to avoid conflicts
export {
  ApiResponse,
  ApiError,
  ApiMetadata,
  ClaudeTranslationRequest,
  TranslationHint,
  ClaudeTranslationResponse,
  CostEstimationRequest,
  CostEstimationResponse,
  ProgressResponse
} from './api';

export {
  PollingConfig,
  PollingState,
  AdaptivePollingManager,
  PerformanceMonitor,
  PerformanceMetrics
} from './polling';

// Validation utilities (exclude ValidationError and ValidationResult to avoid conflicts)
export {
  ValidationUtils
} from './validation';