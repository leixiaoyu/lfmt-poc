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
