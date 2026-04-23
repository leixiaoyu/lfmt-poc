/**
 * MSW Handlers — Unit Tests
 *
 * Covers the simulation policy (instant / realistic / slow), the
 * closure-scoped state store + resetState() contract, and the
 * end-to-end pipeline against the in-process `msw/node` server.
 *
 * These tests are intentionally light on assertions about response
 * SHAPES (those are exercised in component / integration tests via
 * the real services) and heavy on the simulation INVARIANTS that
 * Decision 4 calls out (no setInterval, deterministic instant mode,
 * wall-clock realistic / slow modes).
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { server } from '../server';
import {
  resetState,
  computeProgress,
  type JobState,
  type MockSpeed,
} from '../handlers';

const API_URL = 'https://example.com/v1';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  resetState();
});

describe('computeProgress (simulation policy)', () => {
  function buildJob(overrides: Partial<JobState> = {}): JobState {
    return {
      jobId: 'j',
      status: 'translating',
      totalChunks: 4,
      completedChunks: 0,
      failedChunks: 0,
      fileName: 'doc.txt',
      sourceLang: 'auto',
      targetLang: 'es',
      createdAt: new Date(0).toISOString(),
      ...overrides,
    };
  }

  it('instant mode: 4 polls reach 100% (25% per call)', () => {
    const job = buildJob();
    const speed: MockSpeed = 'instant';
    const fixedNow = 0; // wall-clock irrelevant in instant mode

    const expected = [1, 2, 3, 4];
    const observed: Array<{ completed: number; isComplete: boolean }> = [];
    for (let pollIdx = 0; pollIdx < 4; pollIdx++) {
      // The handler increments statusPollCount BEFORE calling
      // computeProgress, so we mirror that here.
      job.statusPollCount = (job.statusPollCount ?? 0) + 1;
      const result = computeProgress(job, fixedNow, speed);
      observed.push({
        completed: result.completedChunks,
        isComplete: result.isComplete,
      });
      job.completedChunks = result.completedChunks;
    }
    expect(observed.map((o) => o.completed)).toEqual(expected);
    // Only the final poll completes the job.
    expect(observed.map((o) => o.isComplete)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('instant mode: independent of Date.now()', () => {
    const job = buildJob({ statusPollCount: 1 });
    const a = computeProgress(job, 0, 'instant');
    const b = computeProgress(job, 1_000_000_000, 'instant');
    expect(a.completedChunks).toBe(b.completedChunks);
  });

  it('realistic mode: ~10s window — t=0 → 0%, t=5s → 50%, t=10s → 100%', () => {
    const start = 1_000_000;
    const job = buildJob({ translateStartedAt: start });
    const at0 = computeProgress(job, start, 'realistic');
    const at5 = computeProgress(job, start + 5_000, 'realistic');
    const at10 = computeProgress(job, start + 10_000, 'realistic');
    const at15 = computeProgress(job, start + 15_000, 'realistic');
    expect(at0.completedChunks).toBe(0);
    expect(at5.completedChunks).toBe(2); // ceil(0.5 * 4)
    expect(at10.completedChunks).toBe(4);
    expect(at10.isComplete).toBe(true);
    // Beyond the window, still capped at 100% (no overshoot).
    expect(at15.completedChunks).toBe(4);
  });

  it('slow mode: ~60s window', () => {
    const start = 0;
    const job = buildJob({ translateStartedAt: start });
    const at0 = computeProgress(job, 0, 'slow');
    const at30 = computeProgress(job, 30_000, 'slow');
    const at60 = computeProgress(job, 60_000, 'slow');
    expect(at0.completedChunks).toBe(0);
    expect(at30.completedChunks).toBe(2); // ceil(0.5 * 4)
    expect(at60.completedChunks).toBe(4);
    expect(at60.isComplete).toBe(true);
  });

  it('returns completedChunks unchanged for non-translating jobs', () => {
    const job = buildJob({ status: 'completed', completedChunks: 4 });
    const r = computeProgress(job, 0, 'instant');
    expect(r.completedChunks).toBe(4);
    expect(r.isComplete).toBe(true);
  });
});

describe('resetState()', () => {
  it('clears all jobs and sessions between tests', async () => {
    // Seed: register a user (populates sessions) and upload a file
    // (populates jobs).
    await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'reset@test.dev',
        firstName: 'Reset',
        lastName: 'Test',
      }),
    });
    await fetch(`${API_URL}/jobs/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'reset.txt',
        fileSize: 1000,
        contentType: 'text/plain',
      }),
    });

    // Confirm at least one job is in the store.
    const before = await fetch(`${API_URL}/jobs`).then((r) => r.json());
    expect(before.data.length).toBeGreaterThan(0);

    // Reset.
    resetState();

    const after = await fetch(`${API_URL}/jobs`).then((r) => r.json());
    expect(after.data.length).toBe(0);
  });
});

describe('Auth handlers (msw/node)', () => {
  it('register returns user + tokens; /auth/me round-trip resolves the same email', async () => {
    const reg = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'roundtrip@test.dev',
        firstName: 'Round',
        lastName: 'Trip',
      }),
    }).then((r) => r.json());
    expect(reg.user.email).toBe('roundtrip@test.dev');
    expect(typeof reg.accessToken).toBe('string');

    const me = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${reg.accessToken}` },
    }).then((r) => r.json());
    // /auth/me MUST wrap the user in { user } per
    // services/authService.ts:185 — NOT a bare User object.
    expect(me.user.email).toBe('roundtrip@test.dev');
  });

  it('refresh without a refreshToken returns 401', async () => {
    const r = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r.status).toBe(401);
  });

  it('verify-email rejects empty token with 400', async () => {
    const r = await fetch(`${API_URL}/auth/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '' }),
    });
    expect(r.status).toBe(400);
  });

  it('reset-password rejects empty token with 400', async () => {
    const r = await fetch(`${API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '', newPassword: '' }),
    });
    expect(r.status).toBe(400);
  });
});

describe('Translation pipeline (msw/node)', () => {
  it('full happy path: upload → S3 PUT → translate → status x4 → COMPLETED → download', async () => {
    // 1. upload
    const upload = await fetch(`${API_URL}/jobs/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: 'doc.txt',
        fileSize: 50_000,
        contentType: 'text/plain',
      }),
    }).then((r) => r.json());
    const jobId = upload.data.fileId;
    const uploadUrl = upload.data.uploadUrl as string;
    expect(jobId).toBeTruthy();
    // Same-origin (Node fallback resolves to localhost:3000).
    expect(new URL(uploadUrl).pathname).toBe(`/__mock-s3/${jobId}`);

    // 2. S3 PUT
    const put = await fetch(uploadUrl, { method: 'PUT', body: 'payload' });
    expect(put.status).toBe(200);
    expect(put.headers.get('etag')).toMatch(/^"mock-etag-/);

    // 3. translate
    const start = await fetch(`${API_URL}/jobs/${jobId}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'es', tone: 'neutral' }),
    }).then((r) => r.json());
    expect(start.data.status).toBe('IN_PROGRESS');

    // 4. poll status — instant mode → 4 polls reach 100%.
    let lastStatus = '';
    for (let i = 0; i < 4; i++) {
      const s = await fetch(
        `${API_URL}/jobs/${jobId}/translation-status`
      ).then((r) => r.json());
      lastStatus = s.data.status;
    }
    expect(lastStatus).toBe('COMPLETED');

    // 5. history
    const hist = await fetch(`${API_URL}/jobs`).then((r) => r.json());
    expect(hist.data.length).toBe(1);
    expect(hist.data[0].jobId).toBe(jobId);

    // 6. download
    const dl = await fetch(`${API_URL}/translation/${jobId}/download`);
    expect(dl.status).toBe(200);
    const text = await dl.text();
    expect(text).toContain('[MOCK TRANSLATION COMPLETE]');
  });

  it('translate against an unknown jobId returns 404', async () => {
    const r = await fetch(`${API_URL}/jobs/unknown/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLanguage: 'es', tone: 'neutral' }),
    });
    expect(r.status).toBe(404);
  });
});
