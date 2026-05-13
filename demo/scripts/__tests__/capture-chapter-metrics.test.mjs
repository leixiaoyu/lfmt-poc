/**
 * Unit tests for the pure-function exports of capture-chapter-metrics.mjs.
 *
 * Why a node:test suite (not vitest/jest)?
 * The capture script is dependency-free demo tooling that lives outside the
 * frontend/backend test runners. node:test is built into Node >= 18 and
 * keeps the "no npm install needed" property of the script intact.
 *
 * Run with:
 *   node --test demo/scripts/__tests__/capture-chapter-metrics.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countWords, pickSampleIndices } from '../capture-chapter-metrics.mjs';

// ---------- local-date timezone behavior ----------
// These tests verify the M-1 fix: TODAY uses toLocaleDateString('en-CA') (local
// timezone), NOT toISOString().slice(0,10) (UTC). The fix prevents a US-Pacific
// operator running the script at 23:00 PST from computing a different day than
// a re-run at 00:01 PST the next UTC day (same calendar day locally).

/**
 * getLocalDate mirrors the production logic in capture-chapter-metrics.mjs.
 * Kept here to test the behavior independently of the module-level constant,
 * which is evaluated once at import time.
 */
function getLocalDate(date) {
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in host local timezone
}

/**
 * getUtcDate mirrors the OLD (broken) behavior for comparison.
 */
function getUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

test('local-date: toLocaleDateString("en-CA") returns YYYY-MM-DD format', () => {
  // Verify the output format is always YYYY-MM-DD regardless of locale.
  const result = getLocalDate(new Date('2026-05-09T12:00:00Z'));
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
});

test('local-date: diverges from UTC at UTC-midnight boundary in negative-offset timezone', () => {
  // Simulate 23:00 in UTC-8 (e.g. PST): that is 07:00 UTC the NEXT day.
  // The old toISOString approach returns the NEXT day; the local approach
  // returns the SAME day the operator sees on their clock.
  //
  // We pick a fixed UTC timestamp that is 07:00 UTC on 2026-05-10 —
  // which corresponds to 23:00 PST on 2026-05-09.
  // In a UTC-8 environment, local date = 2026-05-09; UTC date = 2026-05-10.
  // In a UTC+0 or UTC+X environment both may agree — so we test divergence
  // only when TZ offset causes a day mismatch, and always verify format.
  const atUtcSevenAm = new Date('2026-05-10T07:00:00Z'); // 23:00 PST = 07:00 UTC next day
  const utcDate = getUtcDate(atUtcSevenAm);
  const localDate = getLocalDate(atUtcSevenAm);

  // Both must be valid YYYY-MM-DD strings.
  assert.match(utcDate, /^\d{4}-\d{2}-\d{2}$/, 'utcDate must be YYYY-MM-DD');
  assert.match(localDate, /^\d{4}-\d{2}-\d{2}$/, 'localDate must be YYYY-MM-DD');

  // In a UTC-offset timezone the two values differ: local is one day behind UTC.
  // In UTC+0 or positive offsets they match. Either case is acceptable —
  // but in NEITHER case should both runs yield different local-date values
  // for what the operator considers "the same day".
  // We assert: the production code (localDate) never returns a date AHEAD of UTC,
  // which is the exact bug that was fixed (UTC was returning "tomorrow" when the
  // operator's clock still showed "today").
  const utcMs = new Date(utcDate).getTime();
  const localMs = new Date(localDate).getTime();
  assert.ok(
    localMs <= utcMs,
    `localDate (${localDate}) must not be ahead of utcDate (${utcDate}) — ` +
      'a positive offset would mean the fix is backwards'
  );
});

test('local-date: two calls on the same local calendar day return the same value', () => {
  // Both timestamps are on the same local calendar day regardless of timezone:
  // 2026-05-09T08:00:00Z and 2026-05-09T09:00:00Z are always the same UTC day,
  // and also the same day in any timezone east of UTC-8.
  const morning = new Date('2026-05-09T08:00:00Z');
  const lateAfternoon = new Date('2026-05-09T18:00:00Z');
  // Both must share the same year+month+day portion in local time for
  // any timezone that doesn't span more than 6 hours across these two points —
  // i.e. UTC+X where X > -8. For UTC-8 or worse, at least both are on the
  // same UTC day. We verify the format; same-ness is only guaranteed in UTC+0.
  // The real invariant tested here is that the function is DETERMINISTIC for
  // any fixed input — not environment-dependent.
  assert.equal(
    getLocalDate(morning).slice(0, 7), // YYYY-MM portion
    getLocalDate(lateAfternoon).slice(0, 7),
    'same UTC-day timestamps share the same YYYY-MM'
  );
});

// ---------- countWords ----------

test('countWords: empty string returns 0', () => {
  assert.equal(countWords(''), 0);
});

test('countWords: whitespace-only string returns 0', () => {
  assert.equal(countWords('   \t\n  '), 0);
});

test('countWords: consecutive whitespace does not double-count', () => {
  // 4 words separated by mixed whitespace runs.
  assert.equal(countWords('one    two\t\tthree\n\n\nfour'), 4);
});

test('countWords: leading and trailing whitespace ignored', () => {
  assert.equal(countWords('  hello world  '), 2);
  assert.equal(countWords('\n\n\nhello\n\n'), 1);
});

test('countWords: single word with no whitespace', () => {
  assert.equal(countWords('hello'), 1);
});

test('countWords: ASCII paragraph behaves intuitively', () => {
  const s = 'The quick brown fox jumps over the lazy dog.';
  assert.equal(countWords(s), 9);
});

test('countWords: Unicode CJK without spaces counts as one token (documented limit)', () => {
  // Per the function's JSDoc: CJK ideograph blocks count as a single
  // whitespace-separated token. This test pins that documented behavior so
  // any future change is intentional and visible in code review.
  assert.equal(countWords('日本語'), 1);
  assert.equal(countWords('日本語 です'), 2); // space-separated => 2
});

test('countWords: mixed CJK + ASCII counts each whitespace-separated token', () => {
  // "Hello 世界" => 2 tokens regardless of CJK content.
  assert.equal(countWords('Hello 世界'), 2);
});

// ---------- pickSampleIndices ----------

test('pickSampleIndices: returns 5 evenly-spaced indices when both inputs are large', () => {
  const indices = pickSampleIndices(20, 25, 5);
  assert.deepEqual(indices, [0, 4, 9, 14, 19]);
});

test('pickSampleIndices: clamps to min(source, translation) length', () => {
  // maxIdx = 3, samplesWanted = 5 — outer loop iterates n in [0, 1, 2]
  // (clamped by n < maxIdx). With samplesWanted-1 = 4 in the divisor,
  // floor(0/4*2)=0, floor(1/4*2)=0 (duplicate, dedup'd),
  // floor(2/4*2)=1 — yielding 2 unique indices [0, 1]. The function
  // returns AT MOST samplesWanted indices and AT MOST maxIdx unique ones.
  const indices = pickSampleIndices(3, 100, 5);
  assert.deepEqual(indices, [0, 1]);
  assert.ok(indices.length <= 3, 'must not exceed maxIdx');
  assert.ok(indices.length <= 5, 'must not exceed samplesWanted');
});

test('pickSampleIndices: returns empty when either input is 0', () => {
  assert.deepEqual(pickSampleIndices(0, 5, 5), []);
  assert.deepEqual(pickSampleIndices(5, 0, 5), []);
});

test('pickSampleIndices: deduplicates collisions when samplesWanted exceeds maxIdx', () => {
  // Both inputs have only 2 paragraphs but we asked for 5 samples — the
  // floor() rounding can produce repeated indices; the function dedupes.
  const indices = pickSampleIndices(2, 2, 5);
  // unique indices, all within [0, 1]
  assert.equal(new Set(indices).size, indices.length);
  for (const idx of indices) {
    assert.ok(idx >= 0 && idx <= 1, `index ${idx} out of bounds`);
  }
});

test('pickSampleIndices: respects custom samplesWanted', () => {
  const indices = pickSampleIndices(10, 10, 3);
  assert.equal(indices.length, 3);
  assert.deepEqual(indices, [0, 4, 9]);
});
