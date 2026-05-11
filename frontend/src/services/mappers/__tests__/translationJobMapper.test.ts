/**
 * translationJobMapper unit tests.
 *
 * Pins the wire ↔ frontend field-name translation (architect M3 on PR #218).
 * The mapper is the single audit point for "how does the SPA decode a
 * backend job record?" — these tests lock that contract.
 */

import { describe, it, expect } from 'vitest';
import { toTranslationJob, type TranslationJobWire } from '../translationJobMapper';

describe('translationJobMapper.toTranslationJob', () => {
  const FIXED_NOW = '2026-05-09T00:00:00.000Z';

  it('translates `translatedChunks` (wire, DDB column) into `completedChunks` (frontend)', () => {
    // #229: wire field renamed from `chunksTranslated` → `translatedChunks`.
    const wire: TranslationJobWire = {
      jobId: 'job-1',
      status: 'IN_PROGRESS',
      translatedChunks: 7,
      totalChunks: 10,
    };
    const job = toTranslationJob(wire, FIXED_NOW);

    // The architectural reason this mapper exists — lock it.
    expect(job.completedChunks).toBe(7);
    expect(job.totalChunks).toBe(10);
    // Frontend type does not surface either backend field name —
    // a future regression that leaks `translatedChunks` or `chunksTranslated`
    // onto the frontend type would break these anti-assertions.
    expect(job).not.toHaveProperty('translatedChunks');
    expect(job).not.toHaveProperty('chunksTranslated');
  });

  it('preserves the wire status string verbatim (no enum coercion)', () => {
    // The mapper trusts the wire status — coercion would mask a real
    // backend bug. This contract is enforced separately in the
    // `apiEnvelopeContract` tests.
    const wire: TranslationJobWire = {
      jobId: 'job-1',
      status: 'CHUNKED',
    };
    expect(toTranslationJob(wire, FIXED_NOW).status).toBe('CHUNKED');
  });

  it('falls back to "" / 0 / now when optional fields are omitted', () => {
    const wire: TranslationJobWire = {
      jobId: 'job-1',
      status: 'PENDING',
    };
    const job = toTranslationJob(wire, FIXED_NOW);

    expect(job.userId).toBe('');
    expect(job.fileName).toBe('');
    expect(job.fileSize).toBe(0);
    expect(job.contentType).toBe('');
    expect(job.createdAt).toBe(FIXED_NOW);
    expect(job.updatedAt).toBe(FIXED_NOW);
  });

  it('prefers `translationCompletedAt` for `completedAt` / `updatedAt` when present', () => {
    const completed = '2026-05-09T01:00:00.000Z';
    const created = '2026-05-09T00:30:00.000Z';
    const job = toTranslationJob(
      {
        jobId: 'job-1',
        status: 'COMPLETED',
        createdAt: created,
        translationCompletedAt: completed,
      },
      FIXED_NOW
    );
    expect(job.completedAt).toBe(completed);
    expect(job.updatedAt).toBe(completed);
    expect(job.createdAt).toBe(created);
  });

  it('maps `error` (wire) into `errorMessage` (frontend), with `errorMessage` (wire) as a secondary fallback', () => {
    const fromError = toTranslationJob(
      { jobId: 'j', status: 'TRANSLATION_FAILED', error: 'rate limited' },
      FIXED_NOW
    );
    expect(fromError.errorMessage).toBe('rate limited');

    const fromMessage = toTranslationJob(
      { jobId: 'j', status: 'FAILED', errorMessage: 'fallback' },
      FIXED_NOW
    );
    expect(fromMessage.errorMessage).toBe('fallback');
  });

  it('passes through `targetLanguage`, `tone`, `failedChunks` verbatim', () => {
    const job = toTranslationJob(
      {
        jobId: 'j',
        status: 'IN_PROGRESS',
        targetLanguage: 'es',
        tone: 'formal',
        failedChunks: 2,
        translatedChunks: 0,
        totalChunks: 5,
      },
      FIXED_NOW
    );
    expect(job.targetLanguage).toBe('es');
    expect(job.tone).toBe('formal');
    expect(job.failedChunks).toBe(2);
  });
});
