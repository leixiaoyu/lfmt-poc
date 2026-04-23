/**
 * MSW Handlers — Local Mock API Foundation
 *
 * This module is the single source of truth for all MSW HTTP handlers
 * used by both the browser Service Worker (`browser.ts`) and the
 * Node-side server for Vitest (`server.ts`).
 *
 * Per design Decision 3, the in-memory `JobState` store is closure-
 * scoped here (NOT a module-level export) so that all mutations flow
 * through the same handler paths the real code takes. The only public
 * escape hatch is the `resetState()` named export, which is used by
 * Vitest `afterEach` and Playwright `beforeEach` fixtures.
 *
 * IMPORTANT: `worker.resetHandlers()` does NOT clear closure state —
 * it only re-installs the original handler list. Tests MUST call
 * `resetState()` explicitly. See `frontend/LOCAL-TESTING.md`.
 *
 * Handlers will be added in Phases 2-5; this file currently exposes
 * only the empty array, the state skeleton, and the reset hook so
 * that `browser.ts` and `server.ts` can wire against it from Phase 1.
 */

import type { HttpHandler } from 'msw';

/**
 * Job lifecycle state held in the closure-scoped store.
 * Shape mirrors the deployed backend's job-status response so that
 * mock and real backend cannot drift on the wire shape (per spec §1).
 */
export type JobState = {
  jobId: string;
  status: 'uploaded' | 'translating' | 'completed' | 'failed';
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  fileName: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  completedAt?: string;
  /**
   * Wall-clock start timestamp (ms since epoch) captured when the
   * frontend calls `POST /jobs/:jobId/translate`. Used by the
   * `realistic` and `slow` simulation modes to compute progress as
   * `min(1, (Date.now() - translateStartedAt) / windowMs)` without
   * any background timers (per design Decision 4).
   */
  translateStartedAt?: number;
};

// Closure-scoped — NOT exported. Forces all mutations through handlers.
const jobs = new Map<string, JobState>();

/**
 * Reset the closure-scoped job store. Used by Vitest `afterEach` and
 * Playwright per-test fixtures. Calling `worker.resetHandlers()`
 * alone is NOT sufficient — that only re-installs handlers, it does
 * NOT clear closure state.
 */
export function resetState(): void {
  jobs.clear();
}

/**
 * Empty handler array — populated in Phases 2-5 (auth, translation
 * pipeline, S3 PUT, error injection). Both `browser.ts` and
 * `server.ts` import this array directly so adding a handler here
 * automatically wires it into both contexts.
 */
export const handlers: HttpHandler[] = [];
