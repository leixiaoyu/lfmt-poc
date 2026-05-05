// LFMT Shared Types - Complete Interface Definitions
// Based on Low-Level Design Documents 1-10

// Core interfaces (order matters to avoid conflicts)
export * from './auth';
export * from './errors'; // Export ValidationError from here
export * from './jobs'; // Export JobStatus + TranslationJobStatus + TRANSLATION_TERMINAL_STATUSES + CHUNKING_ERROR_STATUSES from here

// Re-export the *value* (const) exports of ./jobs via an
// import-then-export pattern.
//
// `export *` above compiles (under tsconfig `module: "commonjs"`) to
// `__exportStar(require('./jobs'), exports)`, which copies properties
// onto `exports` dynamically at runtime. Vite's static analyzer cannot
// trace through that pattern for named *value* imports — type-only
// imports work because they are erased, but `import { CHUNKING_ERROR_STATUSES }
// from '@lfmt/shared-types'` failed in `vitest run --coverage` with
// "is not exported by shared-types/dist/index.js".
//
// A naive `export { X } from './jobs'` does NOT fix this — TypeScript
// emits it as `Object.defineProperty(exports, 'X', { get: ... })`, which
// some Node/Vite/Rollup version combinations also fail to recognise as
// a static named export. The CI failure persisted on Node 20 even after
// the simple re-export. See PR #202 CI runs 25354493112 + 25375703338.
//
// The import-then-export pattern below compiles to direct property
// assignment (`exports.X = jobs_1.X;`), which Vite recognises reliably
// across Node 18/20/22.
import {
  CHUNKING_ERROR_STATUSES as _CHUNKING_ERROR_STATUSES,
  TRANSLATION_TERMINAL_STATUSES as _TRANSLATION_TERMINAL_STATUSES,
} from './jobs';
export const CHUNKING_ERROR_STATUSES = _CHUNKING_ERROR_STATUSES;
export const TRANSLATION_TERMINAL_STATUSES = _TRANSLATION_TERMINAL_STATUSES;
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
