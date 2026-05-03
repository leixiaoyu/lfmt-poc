/**
 * Translation Config Label Patterns — single source of truth.
 *
 * Each pattern is a stable substring of the accessible name rendered by
 * the corresponding MUI InputLabel in TranslationConfig.tsx.  Consumers
 * (Vitest contract tests, Playwright page objects) import from here so
 * that a label change in TranslationConfig.tsx surfaces as a compile-time
 * / test-time failure rather than a silent 180 s production-smoke timeout.
 *
 * Background: PR #192 fixed a configureLanguagesByRole helper that only
 * selected the target language but omitted tone selection.  Because
 * validateStep(1) requires BOTH targetLanguage AND tone to be non-empty,
 * the Next button click did nothing — wizard step 2 never mounted and
 * input[type="file"] timed out.  This module is the preventive measure
 * recommended by that fix: a drift between these patterns and the actual
 * rendered labels will fail the contract test below at Vitest speed.
 *
 * Usage:
 *   import { TRANSLATION_CONFIG_LABEL_PATTERNS as TC } from
 *     'src/components/Translation/translationConfigLabels';
 *
 *   // Playwright
 *   page.getByLabel(TC.targetLanguage)
 *
 *   // Testing Library
 *   screen.getByLabelText(TC.targetLanguage)
 */

export const TRANSLATION_CONFIG_LABEL_PATTERNS = {
  /**
   * Matches the target-language InputLabel: "Target Language"
   */
  targetLanguage: /target.*language/i,

  /**
   * Matches the tone InputLabel: "Translation Tone"
   */
  tone: /translation.*tone/i,
} as const;
