/**
 * Legal Attestation Label Patterns — single source of truth.
 *
 * Each pattern is a stable leading substring of the corresponding
 * <FormControlLabel> text rendered by LegalAttestation.tsx.  Consumers
 * (unit tests, Vitest contract tests, Playwright page objects) import
 * from here so that a label change in LegalAttestation.tsx causes a
 * compile-time / test-time failure in the same commit rather than a
 * silent 3-minute CI timeout.
 *
 * Background: PR #189 fixed a production smoke test (locator.check
 * 180 s timeout) caused by page-object patterns that did not match the
 * actual rendered text.  This module is the preventive measure
 * recommended in that PR's OMC review.
 *
 * Usage:
 *   import { LEGAL_ATTESTATION_LABEL_PATTERNS as L } from
 *     'src/components/Translation/legalAttestationLabels';
 *
 *   // Playwright
 *   page.getByRole('checkbox', { name: L.copyright })
 *
 *   // Testing Library
 *   screen.getByLabelText(L.copyright)
 */

export const LEGAL_ATTESTATION_LABEL_PATTERNS = {
  /**
   * Matches the copyright-ownership checkbox label:
   * "I confirm that I own the copyright to this document or have
   *  authorization from the copyright holder to translate it"
   */
  copyright: /I confirm that I own the copyright/i,

  /**
   * Matches the translation-rights checkbox label:
   * "I confirm that I have the right to create derivative works
   *  (translations) from this document"
   */
  translationRights: /I confirm that I have the right to create derivative works/i,

  /**
   * Matches the liability checkbox label:
   * "I understand that I am solely responsible for ensuring I have the
   *  legal right to translate this document, and I indemnify LFMT from
   *  any copyright claims"
   */
  liability: /I understand that I am solely responsible/i,
} as const;
