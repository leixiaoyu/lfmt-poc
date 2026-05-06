// LFMT Shared Types - Complete Interface Definitions
// Based on Low-Level Design Documents 1-10
//
// Module-format note (PR #203 R3 + R4):
//   This package ships as a DUAL ESM + CJS bundle (see
//   `shared-types/package.json` `exports` field). The previous CJS-only
//   build forced an inline-duplication workaround for value-export
//   constants because Vite/Rollup's CJS named-export static analyzer
//   could not see exports that compiled to `Object.defineProperty(...)`
//   or `exports.X = jobs_1.X`. With ESM consumed by Rollup/Vite via the
//   `import` condition, plain `export *` from `./jobs.js` works cleanly —
//   no inline re-declaration is needed.
//
//   Backend Lambdas (Node.js 22, CJS) continue to resolve the package
//   via the `require` condition pointing at `dist/cjs/index.js` so the
//   contract is unchanged for them.
//
//   R4 — `.js` extensions on relative imports below: required by the
//   ESM build's `module: node16` setting (TSC preserves the literal
//   `.js` from source into the output, and Node-native ESM does NOT
//   probe extensions). The CJS build under `module: commonjs` happily
//   accepts the same `.js`-suffixed imports, so the source compiles
//   cleanly under both targets without divergence.

// Core interfaces (order matters to avoid conflicts)
export * from './auth.js';
export * from './errors.js'; // Export ValidationError from here
export * from './jobs.js'; // Export JobStatus + TranslationJobStatus + TRANSLATION_TERMINAL_STATUSES + CHUNKING_ERROR_STATUSES from here
export * from './documents.js'; // Export ValidationResult from here (primary)
export * from './legal.js';
export * from './workflows.js';

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
} from './api.js';

export {
  PollingConfig,
  PollingState,
  AdaptivePollingManager,
  PerformanceMonitor,
  PerformanceMetrics,
} from './polling.js';

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
} from './validation.js';
