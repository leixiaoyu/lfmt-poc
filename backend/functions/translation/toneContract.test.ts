/**
 * Tone contract test
 *
 * Purpose: verify that TRANSLATION_TONE_VALUES in shared-types is the expected
 * set of values and matches what the frontend TONE_OPTIONS and backend validation
 * both accept.
 *
 * Context (Issue 3 of the demo-readiness plan):
 *   The backend rejected tone values that the UI legitimately offered — or vice
 *   versa — because each site maintained its own inline string list. The fix
 *   introduces TRANSLATION_TONE_VALUES in shared-types as the single source of
 *   truth.
 *
 *   Frontend consumers (TranslationConfig.tsx TONE_OPTIONS) and backend validators
 *   (startTranslation.ts validateRequest()) must each enumerate exactly the values
 *   present in TRANSLATION_TONE_VALUES. This test asserts the canonical set; the
 *   TypeScript compiler enforces that DynamoDBJob.tone / DynamoDBJob.translationTone
 *   are typed against TranslationTone, so compile-time drift is caught automatically.
 *
 * Frontend parity is verified in frontend/src/components/Translation/__tests__/
 * TranslationConfig.test.tsx which already asserts "should show all 3 tone options".
 *
 * How to add a new tone:
 *   1. Add it to TRANSLATION_TONE_VALUES in shared-types/src/jobs.ts.
 *   2. Add a matching entry to TONE_OPTIONS in TranslationConfig.tsx.
 *   3. Update the inline array in startTranslation.ts validateRequest()
 *      (or migrate that validator to use TRANSLATION_TONE_VALUES directly).
 *   4. Update the explicit assertion in this test (step 4) to document intent.
 */

import { TRANSLATION_TONE_VALUES, TranslationTone } from '@lfmt/shared-types';

/**
 * The tone values that the frontend TONE_OPTIONS selector exposes.
 * These are duplicated here (not imported from TSX) because the backend
 * Jest environment is not configured for JSX/Vite transforms.
 *
 * If the frontend TONE_OPTIONS changes, this array MUST be updated to match —
 * the TranslationConfig.test.tsx test "should show all 3 tone options with
 * descriptions when opened" will also fail, giving a second signal.
 */
const FRONTEND_TONE_VALUES: TranslationTone[] = ['formal', 'neutral', 'informal'];

/**
 * The tone values the backend startTranslation.ts validateRequest() currently
 * accepts via its inline includes() guard.
 * ['formal', 'informal', 'neutral'] — matches the literal in startTranslation.ts:252.
 */
const BACKEND_VALIDATION_TONE_VALUES: TranslationTone[] = ['formal', 'informal', 'neutral'];

describe('TranslationTone contract', () => {
  it('TRANSLATION_TONE_VALUES contains exactly the three canonical tones', () => {
    // Explicit assertion — any future addition requires updating this test
    // (documentation of intent, not just drift detection).
    expect([...TRANSLATION_TONE_VALUES].sort()).toEqual(['formal', 'informal', 'neutral']);
  });

  it('TRANSLATION_TONE_VALUES matches the frontend TONE_OPTIONS values', () => {
    expect([...TRANSLATION_TONE_VALUES].sort()).toEqual([...FRONTEND_TONE_VALUES].sort());
  });

  it('TRANSLATION_TONE_VALUES matches the backend validation allowlist', () => {
    expect([...TRANSLATION_TONE_VALUES].sort()).toEqual([...BACKEND_VALIDATION_TONE_VALUES].sort());
  });

  it('every canonical tone value is a non-empty string', () => {
    TRANSLATION_TONE_VALUES.forEach((tone) => {
      expect(typeof tone).toBe('string');
      expect(tone.length).toBeGreaterThan(0);
    });
  });

  it('TRANSLATION_TONE_VALUES has no duplicate entries', () => {
    const set = new Set(TRANSLATION_TONE_VALUES);
    expect(set.size).toBe(TRANSLATION_TONE_VALUES.length);
  });
});
