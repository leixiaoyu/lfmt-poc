/**
 * Unit tests for translationLabels.ts (Issue #145, R5 OMC follow-up).
 *
 * These pure-function tests lock in:
 *   - All entries in LANGUAGE_LABELS / TONE_LABELS are present.
 *   - getLanguageLabel / getToneLabel handle null + undefined.
 *   - getToneLabel capitalizes unknown codes (visual consistency).
 *   - getLanguageLabel passes unknown codes through verbatim.
 *
 * They are intentionally O(ms) — no React rendering, no MSW setup.
 */

import { describe, it, expect } from 'vitest';
import { LANGUAGE_LABELS, TONE_LABELS, getLanguageLabel, getToneLabel } from '../translationLabels';

describe('LANGUAGE_LABELS table', () => {
  it('exposes the dropdown-derived languages', () => {
    // The labels are derived from `LANGUAGE_OPTIONS` in
    // `TranslationConfig.tsx` — re-asserting them here pins both the
    // derive step AND the alias extension in one place.
    expect(LANGUAGE_LABELS.es).toBe('Spanish (Español)');
    expect(LANGUAGE_LABELS.fr).toBe('French (Français)');
    expect(LANGUAGE_LABELS.de).toBe('German (Deutsch)');
    expect(LANGUAGE_LABELS.it).toBe('Italian (Italiano)');
    expect(LANGUAGE_LABELS.zh).toBe('Chinese (中文)');
  });

  it('includes the legacy English alias not present in the dropdown', () => {
    // 'en' is an extension on top of the derived map — it appears in
    // legacy DDB rows but is not selectable from the wizard.
    expect(LANGUAGE_LABELS.en).toBe('English');
  });
});

describe('TONE_LABELS table', () => {
  it('exposes the dropdown-derived tones', () => {
    expect(TONE_LABELS.formal).toBe('Formal');
    expect(TONE_LABELS.neutral).toBe('Neutral');
    expect(TONE_LABELS.informal).toBe('Informal');
  });

  it('includes the legacy "casual" alias for old DDB rows', () => {
    expect(TONE_LABELS.casual).toBe('Casual');
  });
});

describe('getLanguageLabel', () => {
  it.each([
    ['es', 'Spanish (Español)'],
    ['fr', 'French (Français)'],
    ['de', 'German (Deutsch)'],
    ['it', 'Italian (Italiano)'],
    ['zh', 'Chinese (中文)'],
    ['en', 'English'],
  ])('resolves "%s" → "%s"', (code, expected) => {
    expect(getLanguageLabel(code)).toBe(expected);
  });

  it('returns empty string for null / undefined / empty input', () => {
    expect(getLanguageLabel(undefined)).toBe('');
    expect(getLanguageLabel(null)).toBe('');
    expect(getLanguageLabel('')).toBe('');
  });

  it('passes unknown codes through verbatim (degraded display)', () => {
    // No capitalize fallback — the language code may already be a
    // localized name (e.g. "ja-JP") and modifying it would break
    // legitimate values.
    expect(getLanguageLabel('xx')).toBe('xx');
    expect(getLanguageLabel('ja-JP')).toBe('ja-JP');
  });
});

describe('getToneLabel', () => {
  it.each([
    ['formal', 'Formal'],
    ['neutral', 'Neutral'],
    ['informal', 'Informal'],
    ['casual', 'Casual'],
  ])('resolves "%s" → "%s"', (code, expected) => {
    expect(getToneLabel(code)).toBe(expected);
  });

  it('returns empty string for null / undefined / empty input', () => {
    expect(getToneLabel(undefined)).toBe('');
    expect(getToneLabel(null)).toBe('');
    expect(getToneLabel('')).toBe('');
  });

  it('capitalizes the first character of unknown codes', () => {
    // The tone enum in DDB is small; if a new value sneaks in (e.g.
    // 'sarcastic'), render it Title-Case for visual consistency with
    // the known entries instead of leaving it raw lowercase.
    expect(getToneLabel('sarcastic')).toBe('Sarcastic');
    expect(getToneLabel('a')).toBe('A');
  });

  it('does not double-capitalize known entries', () => {
    // Sanity check that the mapped-table branch wins over the
    // capitalize-fallback branch.
    expect(getToneLabel('formal')).toBe('Formal');
  });
});
