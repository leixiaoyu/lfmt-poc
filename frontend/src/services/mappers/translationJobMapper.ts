/**
 * Translation job wire ↔ frontend mapper.
 *
 * The backend persists chunk progress under the field name
 * `translatedChunks` (matching the DDB column — renamed from
 * `chunksTranslated` in issue #229) while the frontend's `TranslationJob`
 * shape uses `completedChunks`. Both seams need the same translation;
 * pre-PR-#218 the logic was duplicated:
 *
 *   - `translationService.getJobStatus` (wire → TranslationJob)
 *   - `mocks/handlers.ts.toWireJobListItem` and `toWireTranslationStatus`
 *     (state → wire) — the in-memory mock contract
 *
 * Per architect M3 review on PR #218: extract the translation seam into
 * a single utility so a future renaming of either field updates ONE
 * implementation. The mock and the real wire contract still differ on
 * other fields (the mock lacks `userId` rich semantics, etc.) — only
 * the chunk-progress translation is hoisted here, not the entire
 * projection. KISS / YAGNI.
 */

import type { TranslationJobStatus } from '@lfmt/shared-types';
import type { TranslationJob } from '../translationService';

/**
 * Minimal subset of the `TranslationStatusApiResponse` (and its mock
 * parallel) that the mapper actually reads. Defined locally so the
 * mapper is decoupled from the shared-types module shape — the wire
 * DTO can grow new fields without forcing a touch here, and the mock
 * can add internal scaffolding without exposing it through the wire
 * boundary type.
 */
export interface TranslationJobWire {
  jobId: string;
  userId?: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  status: string;
  /**
   * Backend wire field name (#229: renamed from `chunksTranslated` to match DDB column).
   * Frontend model uses `completedChunks` — the ACL translation happens in toTranslationJob.
   */
  translatedChunks?: number;
  totalChunks?: number;
  failedChunks?: number;
  targetLanguage?: string;
  tone?: 'formal' | 'informal' | 'neutral';
  createdAt?: string;
  updatedAt?: string;
  translationCompletedAt?: string;
  completedAt?: string;
  error?: string;
  errorMessage?: string;
}

/**
 * Project a wire-shape job into the frontend `TranslationJob` type.
 *
 * Defensive defaults mirror the per-field nullish-coalescing fallbacks
 * that previously lived inline in `getJobStatus` — keeping them here
 * means a single audit point for "what does the SPA do when the
 * backend omits an optional field?".
 *
 * The `now` parameter is injected so callers can pass a deterministic
 * timestamp in tests; it defaults to `new Date().toISOString()` so the
 * production code path stays a one-liner.
 */
export function toTranslationJob(
  wire: TranslationJobWire,
  now: string = new Date().toISOString()
): TranslationJob {
  return {
    jobId: wire.jobId,
    userId: wire.userId ?? '',
    fileName: wire.fileName ?? '',
    fileSize: wire.fileSize ?? 0,
    contentType: wire.contentType ?? '',
    status: wire.status as TranslationJobStatus,
    targetLanguage: wire.targetLanguage,
    tone: wire.tone,
    totalChunks: wire.totalChunks,
    // The ACL seam — `translatedChunks` (wire, DDB column) → `completedChunks` (frontend model).
    // `translatedChunks` was renamed from `chunksTranslated` in issue #229.
    // This translation is the architectural reason the mapper exists.
    completedChunks: wire.translatedChunks,
    failedChunks: wire.failedChunks,
    createdAt: wire.createdAt ?? now,
    updatedAt: wire.translationCompletedAt ?? wire.updatedAt ?? wire.createdAt ?? now,
    completedAt: wire.translationCompletedAt ?? wire.completedAt,
    errorMessage: wire.error ?? wire.errorMessage,
  };
}
