// LFMT Shared Types - Complete Interface Definitions
// Based on Low-Level Design Documents 1-10

// Core interfaces (order matters to avoid conflicts)
export * from './auth';
export * from './errors'; // Export ValidationError from here
export * from './jobs'; // Export JobStatus + TranslationJobStatus + TRANSLATION_TERMINAL_STATUSES + CHUNKING_ERROR_STATUSES from here

// Inline the value (const) exports for the translation-job status arrays.
//
// These constants are also defined in `./jobs` and the `export *` above
// includes them in the runtime barrel. We re-declare them here as
// top-level `export const` so they compile (under tsconfig
// `module: "commonjs"`) to direct property assignment:
//   exports.CHUNKING_ERROR_STATUSES = [...];
// Vite/Rollup's CJS named-export detection recognises this pattern
// reliably across Node 18/20/22.
//
// Why not re-export from ./jobs? Tried in PR #202 commits 9d955f6 and
// aa83497 — both `export { X } from './jobs'` (compiles to
// `Object.defineProperty(exports, 'X', { get: ... })`) and the
// import-then-export pattern (compiles to `exports.X = jobs_1.X;`)
// failed Vite's static analyzer on Node 20 in CI when consumed via
// the dist/index.js alias. Inlining the arrays here is a duplication
// risk vs ./jobs (the satisfies clause guards against type drift); a
// future ESM migration of shared-types eliminates the workaround.
// See PR #202 CI runs 25354493112, 25375703338, 25376048087.
import type { TranslationJobStatus } from './jobs';

export const TRANSLATION_TERMINAL_STATUSES = [
  'COMPLETED',
  'FAILED',
  'CHUNKING_FAILED',
  'TRANSLATION_FAILED',
] as const satisfies ReadonlyArray<TranslationJobStatus>;

export const CHUNKING_ERROR_STATUSES = [
  'CHUNKING_FAILED',
  'FAILED',
  'TRANSLATION_FAILED',
] as const satisfies ReadonlyArray<TranslationJobStatus>;
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
