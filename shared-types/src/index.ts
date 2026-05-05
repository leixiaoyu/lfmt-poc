// LFMT Shared Types - Complete Interface Definitions
// Based on Low-Level Design Documents 1-10

// Core interfaces (order matters to avoid conflicts)
export * from './auth';
export * from './errors'; // Export ValidationError from here
export * from './jobs'; // Export JobStatus + TranslationJobStatus + TRANSLATION_TERMINAL_STATUSES + CHUNKING_ERROR_STATUSES from here

// Explicit named re-exports for the *value* (const) exports of ./jobs.
//
// `export *` above compiles (under tsconfig `module: "commonjs"`) to
// `__exportStar(require('./jobs'), exports)`, which copies properties
// onto `exports` at runtime. Vite's static analyzer cannot trace through
// that pattern for named *value* imports — type-only imports work because
// they are erased, but `import { CHUNKING_ERROR_STATUSES } from
// '@lfmt/shared-types'` was failing in `vitest run --coverage` with
// "is not exported by shared-types/dist/index.js". Listing the value
// exports explicitly here lets Vite see them statically. The `export *`
// above continues to provide every other (type) export from ./jobs.
//
// See PR #202 CI run 25354493112 for the failure that motivated this.
export { TRANSLATION_TERMINAL_STATUSES, CHUNKING_ERROR_STATUSES } from './jobs';
export * from './documents'; // Export ValidationResult from here (primary)
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
  ProgressResponse,
} from './api';

export {
  PollingConfig,
  PollingState,
  AdaptivePollingManager,
  PerformanceMonitor,
  PerformanceMetrics,
} from './polling';

// Validation utilities (exclude ValidationError and ValidationResult to avoid conflicts)
export {
  ValidationUtils,
  FILE_VALIDATION,
  uuidSchema,
  emailSchema,
  timestampSchema,
  filenamePatter,
  filenameSchema,
  supportedLanguages,
  languageSchema,
  wordCountSchema,
  fileSizeSchema,
  tokenCountSchema,
  progressSchema,
  costSchema,
  prioritySchema,
  qualityLevelSchema,
  jobStatusSchema,
  errorSeveritySchema,
} from './validation';
