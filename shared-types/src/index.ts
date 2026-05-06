// LFMT Shared Types - Complete Interface Definitions
// Based on Low-Level Design Documents 1-10
//
// Module-format note (PR #203 R3):
//   This package now ships as a DUAL ESM + CJS bundle (see
//   `shared-types/package.json` `exports` field). The previous CJS-only
//   build forced an inline-duplication workaround for value-export
//   constants because Vite/Rollup's CJS named-export static analyzer
//   could not see exports that compiled to `Object.defineProperty(...)`
//   or `exports.X = jobs_1.X`. With ESM consumed by Rollup/Vite via the
//   `import` condition, plain `export *` from `./jobs` works cleanly —
//   no inline re-declaration is needed.
//
//   Backend Lambdas (Node.js 22, CJS) continue to resolve the package
//   via the `require` condition pointing at `dist/cjs/index.js` so the
//   contract is unchanged for them.

// Core interfaces (order matters to avoid conflicts)
export * from './auth';
export * from './errors'; // Export ValidationError from here
export * from './jobs'; // Export JobStatus + TranslationJobStatus + TRANSLATION_TERMINAL_STATUSES + CHUNKING_ERROR_STATUSES from here
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
