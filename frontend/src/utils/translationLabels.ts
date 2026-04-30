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
 * once for both selection and display.
 *
 * R2 (OMC review follow-up): the dropdown's option arrays live in
 * `TranslationConfig.tsx` as `LANGUAGE_OPTIONS` / `TONE_OPTIONS` (with
 * `as const`), and the label tables here are *derived* from those same
 * arrays. The TypeScript types `LanguageCode` and `ToneCode` are also
 * sourced from the option arrays, so a record keyed by those unions
 * forces a compile error if anyone adds a language to the dropdown
 * without picking up its label here.
 */

import {
  LANGUAGE_OPTIONS,
  TONE_OPTIONS,
  type LanguageCode,
  type ToneCode,
} from '../components/Translation/TranslationConfig';

/**
 * Derive the canonical {code → label} map directly from the dropdown's
 * option array. Typed as `Record<LanguageCode, string>` so a missing
 * entry would fail compilation — but because we *derive* the table from
 * the same source the dropdown uses, drift is structurally impossible.
 */
const DERIVED_LANGUAGE_LABELS: Record<LanguageCode, string> = Object.fromEntries(
  LANGUAGE_OPTIONS.map((o) => [o.value, o.label])
) as Record<LanguageCode, string>;

const DERIVED_TONE_LABELS: Record<ToneCode, string> = Object.fromEntries(
  TONE_OPTIONS.map((o) => [o.value, o.label])
) as Record<ToneCode, string>;

/**
 * Public label maps. Typed as `Record<string, string>` so consumers can
 * pass a wire-derived language/tone string without a cast — the wire
 * may carry codes outside the dropdown's enum (legacy rows, future
 * languages), and the resolver helpers below handle that gracefully.
 *
 * Aliases (e.g. `en`, `casual`) extend the derived map with display
 * fallbacks for codes that exist in stored data but are NOT present in
 * the dropdown.
 */
export const LANGUAGE_LABELS: Record<string, string> = {
  ...DERIVED_LANGUAGE_LABELS,
  // Alias: some legacy rows from before the dropdown existed used 'en'.
  en: 'English',
};

export const TONE_LABELS: Record<string, string> = {
  ...DERIVED_TONE_LABELS,
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
