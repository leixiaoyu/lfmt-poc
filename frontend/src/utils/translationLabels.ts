/**
 * Display-label helpers for translation enums (Issue #145).
 *
 * The translation pipeline persists language and tone as short codes
 * (`es`, `formal`, …) on the wire and in DDB. The UI was rendering
 * those raw codes in 4+ places (wizard review, job details, history,
 * side-by-side viewer), which looked unfinished — investors don't
 * speak ISO-639-1.
 *
 * Single source of truth here so a new language or tone added in
 * `TranslationConfig.tsx` (the dropdown source) only needs to be added
 * once for both selection and display. The selection lists themselves
 * still live next to the form so the dropdown layout stays local; we
 * mirror the labels here for read-only views.
 */

export const LANGUAGE_LABELS: Record<string, string> = {
  es: 'Spanish (Español)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  it: 'Italian (Italiano)',
  zh: 'Chinese (中文)',
  // Common aliases just in case the wire occasionally returns these.
  en: 'English',
};

export const TONE_LABELS: Record<string, string> = {
  formal: 'Formal',
  neutral: 'Neutral',
  informal: 'Informal',
  // Some legacy job rows used 'casual'; keep it readable rather than
  // stripping it (the data still exists in DDB).
  casual: 'Casual',
};

/**
 * Resolve a language code to its display label. Returns the input
 * unchanged when no mapping exists, so an unknown code degrades to
 * the raw value rather than producing an empty cell.
 */
export function getLanguageLabel(code: string | undefined | null): string {
  if (!code) return '';
  return LANGUAGE_LABELS[code] ?? code;
}

/**
 * Resolve a tone code to its display label. Same fallback policy as
 * `getLanguageLabel`. Capitalizes the first character of unknown codes
 * for visual consistency with the known labels.
 */
export function getToneLabel(code: string | undefined | null): string {
  if (!code) return '';
  if (TONE_LABELS[code]) return TONE_LABELS[code];
  return code.charAt(0).toUpperCase() + code.slice(1);
}
