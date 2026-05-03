/**
 * Translation Upload Page Object Model
 *
 * Represents the multi-step translation upload page.
 *
 * The page is a 4-step wizard:
 *   Step 0: Legal Attestation  → Step 1: Translation Settings
 *   Step 2: Upload Document    → Step 3: Review & Submit
 *
 * ## Canonical selector strategy
 *
 * All wizard-step helpers use **role + label-pattern selectors** backed by
 * `*Labels.ts` single-source-of-truth modules and Vitest contract tests.
 * This ensures that a label change in a component surfaces as a fast
 * Vitest failure rather than a silent 180 s production-smoke timeout
 * (see PRs #189, #192 for background).
 *
 * - `LEGAL_ATTESTATION_LABEL_PATTERNS` → `legalAttestationLabels.ts`
 * - `TRANSLATION_CONFIG_LABEL_PATTERNS` → `translationConfigLabels.ts`
 *
 * ## Backward-compat wrappers
 *
 * `completeLegalAttestation()` and `completeTranslationConfig()` are
 * kept for existing spec-file call sites.  Both are thin wrappers that
 * delegate to the role-based implementation:
 *
 * - `completeLegalAttestation()` — CSS `[name]` attribute selectors
 *   target the HTML `name` on `<input>`, not label text, so they cannot
 *   drift from label changes and do not need to be role-based. Kept as-is.
 * - `completeTranslationConfig(language, tone)` — previously used CSS-id
 *   selectors (`#target-language`, `#tone`).  Now delegates to the shared
 *   private `selectTranslationSettingDropdowns()` so that both helpers
 *   drive a single code path.  New call sites should use
 *   `configureTranslationSettingsByRole()` directly.
 *
 * `completeUploadWorkflow()` is a single-call convenience for specs that
 * do not need per-step `test.step()` tracing.
 */

import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { LEGAL_ATTESTATION_LABEL_PATTERNS as L } from '../../src/components/Translation/legalAttestationLabels';
import { TRANSLATION_CONFIG_LABEL_PATTERNS as TC } from '../../src/components/Translation/translationConfigLabels';

export class TranslationUploadPage extends BasePage {
  // Locators
  private readonly pageHeading = 'h4:has-text("New Translation")';
  private readonly nextButton = 'button:has-text("Next")';
  private readonly backButton = 'button:has-text("Back")';
  private readonly submitButton = 'button:has-text("Submit")';

  // Legal Attestation Step
  private readonly copyrightCheckbox = '[name="acceptCopyrightOwnership"]';
  private readonly translationRightsCheckbox = '[name="acceptTranslationRights"]';
  private readonly liabilityCheckbox = '[name="acceptLiabilityTerms"]';

  // File Upload Step
  private readonly fileInput = 'input[type="file"]';

  constructor(page: Page) {
    super(page);
  }

  /**
   * Navigate to upload page
   */
  async goto() {
    await super.goto('/translation/upload');
    await this.waitForPageLoad();
  }

  /**
   * Wait for upload page to load
   */
  async waitForPageLoad() {
    await this.waitForElement(this.pageHeading);
  }

  /**
   * Check if on upload page
   */
  async isOnUploadPage(): Promise<boolean> {
    return await this.isVisible(this.pageHeading);
  }

  /**
   * Complete legal attestation step using CSS `[name]` attribute selectors.
   *
   * The `[name="acceptCopyrightOwnership"]` etc. selectors target the HTML
   * `name` attribute on the underlying `<input>` element — not the accessible
   * name — so they are immune to label-text changes and do not need to be
   * backed by a label-pattern module.
   * For role-based (accessible-name) selection see `completeLegalAttestationByRole`.
   *
   * @see completeLegalAttestationByRole
   */
  async completeLegalAttestation() {
    await this.clickElement(this.copyrightCheckbox);
    await this.clickElement(this.translationRightsCheckbox);
    await this.clickElement(this.liabilityCheckbox);
  }

  /**
   * Complete translation config step (backward-compat wrapper).
   *
   * Accepts string option values (e.g. `'es'`, `'neutral'`) and delegates
   * to `selectTranslationSettingDropdowns()` — the shared role-based
   * implementation — so both this wrapper and `configureTranslationSettingsByRole`
   * drive exactly one code path.
   *
   * Pass `tone = ''` to select only the language and leave the tone dropdown
   * unset; this is useful when testing that validation blocks Next when tone
   * is missing (see `multi-language.spec.ts`).
   *
   * New call sites should prefer `configureTranslationSettingsByRole()` which
   * accepts regex patterns directly and also advances the wizard.
   *
   * @param language - Option value string (e.g. `'es'`, `'fr'`). Used to
   *   build a case-insensitive regex matched against the MUI MenuItem text.
   * @param tone - Option value string (e.g. `'neutral'`), or `''` to skip
   *   tone selection.
   */
  async completeTranslationConfig(language: string, tone: string) {
    // Build a regex from the value string. MUI renders the value as part
    // of the MenuItem text (e.g. value='es' → "Spanish (Español)"), so a
    // plain value-based regex won't match. We map known values to their
    // label substrings. Unmapped values fall back to the raw value string,
    // which will cause a timeout if it doesn't appear in the option text.
    const languagePattern = languageValueToPattern(language);
    const tonePattern = tone ? toneValueToPattern(tone) : null;
    await this.selectTranslationSettingDropdowns(languagePattern, tonePattern);
  }

  /**
   * Upload file
   */
  async uploadFile(filePath: string) {
    await this.page.locator(this.fileInput).setInputFiles(filePath);
  }

  /**
   * Click next button
   */
  async clickNext() {
    await this.clickElement(this.nextButton);
  }

  /**
   * Click back button
   */
  async clickBack() {
    await this.clickElement(this.backButton);
  }

  /**
   * Click submit button
   */
  async clickSubmit() {
    await this.clickElement(this.submitButton);
  }

  /**
   * Complete full upload workflow
   */
  async completeUploadWorkflow(
    filePath: string,
    language: string = 'es',
    tone: string = 'neutral'
  ) {
    // Step 1: Legal Attestation
    await this.completeLegalAttestation();
    await this.clickNext();

    // Step 2: Translation Config
    await this.completeTranslationConfig(language, tone);
    await this.clickNext();

    // Step 3: File Upload
    await this.uploadFile(filePath);
    await this.clickNext();

    // Step 4: Review & Submit
    await this.clickSubmit();
  }

  /**
   * Wait for navigation to detail page after submit
   */
  async waitForNavigationToDetail() {
    await this.page.waitForURL(/\/translation\/[a-f0-9-]+/, { timeout: 10000 });
  }

  // ---------------------------------------------------------------------
  // Role-based wizard helpers (used by production-smoke.spec.ts)
  //
  // These mirror the steps performed by `completeUploadWorkflow()` but use
  // role-based locators (more resilient against CSS-class churn in deployed
  // environments) and accept timeouts so callers can tune for prod latency.
  // The smoke test calls each helper inside its own `test.step()` block to
  // get per-step traces in CI.
  // ---------------------------------------------------------------------

  /**
   * Tick the three required attestation checkboxes and advance to the
   * Translation Settings step using role-based accessible-name locators.
   * Returns when the target-language control is visible (handshake that
   * step 1 has rendered).
   *
   * Patterns are imported from `legalAttestationLabels.ts` — the single
   * source of truth for accessible-name substrings — so a label change in
   * `LegalAttestation.tsx` surfaces as a test failure here rather than a
   * silent 180 s timeout (see PR #189 for background).
   *
   * This method drives the same DOM as `completeLegalAttestation()`, which
   * uses `[name="..."]` attribute selectors instead of accessible names.
   * Both are correct; the `[name]` selectors target the HTML attribute on
   * the `<input>`, not the label text, so they do not need label patterns.
   *
   * @see completeLegalAttestation
   */
  async completeLegalAttestationByRole(timeout = 10000) {
    await this.page.getByRole('checkbox', { name: L.copyright }).check();
    await this.page.getByRole('checkbox', { name: L.translationRights }).check();
    await this.page.getByRole('checkbox', { name: L.liability }).check();

    await this.page.getByRole('button', { name: /next/i }).click();
    await expect(this.page.getByLabel(TC.targetLanguage)).toBeVisible({ timeout });
  }

  /**
   * Configure target language and translation tone on wizard step 1
   * (Translation Settings), then advance to the Upload Document step.
   * Returns when the file input is attached to the DOM (the input has
   * display:none — `toBeAttached` is the correct gate, not `toBeVisible`).
   *
   * Delegates dropdown selection to `selectTranslationSettingDropdowns()` —
   * the same code path used by `completeTranslationConfig()` — so there is
   * exactly one implementation for selecting the step-1 dropdowns.
   *
   * Root-cause note (PR #192): the previous helper (`configureLanguagesByRole`)
   * only selected the target language but never selected the tone.
   * `validateStep(1)` in TranslationUpload.tsx requires BOTH
   * `targetLanguage` AND `tone` to be non-empty before advancing, so
   * clicking Next did nothing and `input[type="file"]` never mounted.
   *
   * Selectors are driven by `TRANSLATION_CONFIG_LABEL_PATTERNS` — the
   * single source of truth for MUI InputLabel accessible names — so a
   * label change in TranslationConfig.tsx will fail the Vitest contract
   * test in `TranslationConfig.test.tsx` before reaching this helper.
   *
   * @param targetLanguagePattern - Regex matched against the MUI MenuItem
   *   accessible name for the target language. Defaults to
   *   `/spanish|español/i` (the standard smoke-test language).  Must
   *   correspond to an actual rendered option; a non-matching regex will
   *   cause `getByRole('option')` to time out.
   *
   * @param tonePattern - Regex matched against the MUI MenuItem accessible
   *   name for the translation tone. Defaults to `/neutral/i` ("Neutral"
   *   tone) because Neutral is the safest choice for automated testing —
   *   it satisfies `validateStep(1)`'s non-empty requirement without
   *   implying a formal or informal register in smoke-test output. Must
   *   correspond to an actual rendered option; a non-matching regex will
   *   cause `getByRole('option')` to time out.
   *
   * @param timeout - Maximum milliseconds to wait for `input[type="file"]`
   *   to be attached after clicking Next. Default is 10 000 ms; increase
   *   for slow networks or cold-start environments.
   */
  async configureTranslationSettingsByRole(
    targetLanguagePattern: RegExp = /spanish|español/i,
    tonePattern: RegExp = /neutral/i,
    timeout = 10000
  ) {
    await this.selectTranslationSettingDropdowns(targetLanguagePattern, tonePattern);

    await this.page.getByRole('button', { name: /next/i }).click();
    await expect(this.page.locator('input[type="file"]')).toBeAttached({ timeout });
  }

  /**
   * Upload a file via the hidden `<input type="file">`. Asserts the file
   * name surfaces in the UI (handshake that the wizard accepted the file).
   */
  async uploadFileAndAwaitDisplay(filePath: string, displayName: string, timeout = 10000) {
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);

    // Filename appears in the upload-step UI once the file is processed.
    await expect(
      this.page.getByText(new RegExp(displayName.replace(/\./g, '\\.'), 'i'))
    ).toBeVisible({ timeout });
  }

  /**
   * Advance from Upload Document to Review & Submit. The review screen
   * re-renders the chosen filename in its summary — assert it shows up
   * before continuing.
   */
  async advanceToReviewByRole(displayName: string, timeout = 10000) {
    await this.page.getByRole('button', { name: /next/i }).click();
    await expect(
      this.page.getByText(new RegExp(displayName.replace(/\./g, '\\.'), 'i'))
    ).toBeVisible({ timeout });
  }

  /**
   * Click the final "Submit & Start Translation" button on the Review step.
   * The regex tolerates copy variants observed in different environments.
   */
  async submitTranslationByRole() {
    const translateButton = this.page.getByRole('button', {
      name: /submit.*translation|translate|start.*translation/i,
    });
    await translateButton.click();
  }

  // ---------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------

  /**
   * Select dropdowns for wizard step 1 (Translation Settings) using
   * role-based accessible-name locators backed by `TRANSLATION_CONFIG_LABEL_PATTERNS`.
   *
   * This is the single implementation shared by both
   * `completeTranslationConfig()` (backward-compat, value-string API) and
   * `configureTranslationSettingsByRole()` (canonical, regex API). Callers
   * are responsible for clicking Next afterward.
   *
   * @param targetLanguagePattern - Regex matched against the MUI MenuItem
   *   accessible name. Must match an actual rendered option.
   * @param tonePattern - Regex matched against the tone MenuItem accessible
   *   name, or `null` to skip tone selection (used when testing that the
   *   tone-required validation error fires).
   */
  private async selectTranslationSettingDropdowns(
    targetLanguagePattern: RegExp,
    tonePattern: RegExp | null
  ) {
    await this.page.getByLabel(TC.targetLanguage).click();
    await this.page.getByRole('option', { name: targetLanguagePattern }).click();

    if (tonePattern !== null) {
      await this.page.getByLabel(TC.tone).click();
      await this.page.getByRole('option', { name: tonePattern }).click();
    }
  }
}

// ---------------------------------------------------------------------------
// Value-to-pattern helpers (module-level, not exported)
//
// MUI Select stores the raw option value (e.g. 'es') but renders the
// MenuItem text (e.g. 'Spanish (Español)'). `getByRole('option', { name })`
// matches the rendered text, so we map value → label substring.
// ---------------------------------------------------------------------------

/**
 * Map a LANGUAGE_OPTIONS value string to a case-insensitive regex that
 * matches the corresponding MUI MenuItem rendered text.
 * Unknown values fall back to a regex on the raw value string.
 */
function languageValueToPattern(value: string): RegExp {
  const map: Record<string, RegExp> = {
    es: /Spanish.*Español/i,
    fr: /French.*Français/i,
    de: /German.*Deutsch/i,
    it: /Italian.*Italiano/i,
    zh: /Chinese.*中文/i,
  };
  return map[value] ?? new RegExp(value, 'i');
}

/**
 * Map a TONE_OPTIONS value string to a case-insensitive regex that
 * matches the corresponding MUI MenuItem rendered text.
 * Unknown values fall back to a regex on the raw value string.
 */
function toneValueToPattern(value: string): RegExp {
  const map: Record<string, RegExp> = {
    formal: /formal/i,
    neutral: /neutral/i,
    informal: /informal/i,
  };
  return map[value] ?? new RegExp(value, 'i');
}
