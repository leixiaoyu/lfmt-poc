/**
 * MSW Handlers — Local Mock API Foundation
 *
 * This module is the single source of truth for all MSW HTTP handlers
 * used by both the browser Service Worker (`browser.ts`) and the
 * Node-side server for Vitest (`server.ts`).
 *
 * Per design Decision 3, the in-memory `JobState` store is closure-
 * scoped here (NOT a module-level export) so that all mutations flow
 * through the same handler paths the real code takes. The only public
 * escape hatch is the `resetState()` named export, which is used by
 * Vitest `afterEach` and Playwright `beforeEach` fixtures.
 *
 * IMPORTANT: `worker.resetHandlers()` does NOT clear closure state —
 * it only re-installs the original handler list. Tests MUST call
 * `resetState()` explicitly. See `frontend/LOCAL-TESTING.md`.
 *
 * SECURITY NOTE: Handlers MUST NOT log raw request bodies, emails,
 * passwords, tokens, or other PII to the console. The legacy
 * `mockApi.ts` (lines 88-207) violated this — preserve a clean
 * baseline here so the same anti-pattern cannot propagate. If
 * debugging is needed, log only non-PII shape information (e.g.,
 * "register handler invoked, body keys: ['email','password',...]").
 *
 * Handlers will be added across Phases 2-5:
 *   Phase 2: Auth handlers (8) — this commit.
 *   Phase 3: Translation pipeline (6) including S3 PUT mock.
 *   Phase 4: State store + on-demand simulation + VITE_MOCK_SPEED.
 *   Phase 5: Error injection via reserved filename pattern.
 */

import { http, HttpResponse, type HttpHandler } from 'msw';

// ---------------------------------------------------------------------------
// URL pattern helper
// ---------------------------------------------------------------------------
//
// The MSW handlers run in two contexts:
//
// 1. Browser (`setupWorker`): apiClient sends requests to
//    `${VITE_API_URL}/auth/...` etc. We register handlers under a
//    wildcard pattern (`*/auth/login`) so the SW intercepts regardless
//    of the value `VITE_API_URL` happens to carry in dev (e.g.,
//    `http://localhost:3000/v1`).
//
// 2. Node (`setupServer` in Vitest): tests typically set
//    `VITE_API_URL=http://localhost:3000/v1` (see `.env.test`). The
//    same wildcard pattern matches.
//
// We expose a tiny helper rather than baking the env read into every
// handler so the resolution rule has a single audit point.

function buildPath(path: string): string {
  // MSW supports `*` as an "any host + any path-prefix" wildcard.
  // Matches both same-origin (`/auth/login`) AND fully-qualified
  // (`https://api.example.com/v1/auth/login`).
  return `*${path}`;
}

// ---------------------------------------------------------------------------
// State Store (closure-scoped)
// ---------------------------------------------------------------------------

/**
 * Job lifecycle state held in the closure-scoped store.
 * Shape mirrors the deployed backend's job-status response so that
 * mock and real backend cannot drift on the wire shape (per spec §1).
 */
export type JobState = {
  jobId: string;
  status: 'uploaded' | 'translating' | 'completed' | 'failed';
  totalChunks: number;
  completedChunks: number;
  failedChunks: number;
  fileName: string;
  sourceLang: string;
  targetLang: string;
  createdAt: string;
  completedAt?: string;
  /**
   * Wall-clock start timestamp (ms since epoch) captured when the
   * frontend calls `POST /jobs/:jobId/translate`. Used by the
   * `realistic` and `slow` simulation modes to compute progress as
   * `min(1, (Date.now() - translateStartedAt) / windowMs)` without
   * any background timers (per design Decision 4).
   */
  translateStartedAt?: number;
  /**
   * Number of times `GET /jobs/:jobId/translation-status` has been
   * called for this job. Used by the `instant` simulation mode (per
   * design Decision 4) to advance `completedChunks` deterministically
   * — 25% per call, fourth call hits 100%.
   */
  statusPollCount?: number;
};

type MockUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
};

// Closure-scoped — NOT exported. Forces all mutations through handlers.
const jobs = new Map<string, JobState>();
// Token → user lookup, populated on register/login. Mirrors the real
// backend's "session" abstraction; cleared on resetState() / logout.
const sessions = new Map<string, MockUser>();

/**
 * Reset the closure-scoped job store. Used by Vitest `afterEach` and
 * Playwright per-test fixtures. Calling `worker.resetHandlers()`
 * alone is NOT sufficient — that only re-installs handlers, it does
 * NOT clear closure state.
 */
export function resetState(): void {
  jobs.clear();
  sessions.clear();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  // Cheap browser/node-portable UUID-ish. Sufficient for mock IDs.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildMockUser(input: {
  email?: string;
  firstName?: string;
  lastName?: string;
}): MockUser {
  return {
    id: `mock-user-${uuid()}`,
    email: input.email ?? 'demo@lfmt.dev',
    firstName: input.firstName ?? 'Mock',
    lastName: input.lastName ?? 'User',
  };
}

function issueTokens(user: MockUser): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = `mock-access-${uuid()}`;
  const refreshToken = `mock-refresh-${uuid()}`;
  sessions.set(accessToken, user);
  sessions.set(refreshToken, user);
  return { accessToken, refreshToken };
}

function userFromAuthHeader(authHeader: string | null): MockUser | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return sessions.get(match[1]) ?? null;
}

// ---------------------------------------------------------------------------
// Handlers — Auth (Phase 2)
// ---------------------------------------------------------------------------

const authHandlers: HttpHandler[] = [
  // POST /auth/register
  http.post(buildPath('/auth/register'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const user = buildMockUser({
      email: typeof body.email === 'string' ? body.email : undefined,
      firstName:
        typeof body.firstName === 'string' ? body.firstName : undefined,
      lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
    });
    const tokens = issueTokens(user);
    return HttpResponse.json({ user, ...tokens }, { status: 200 });
  }),

  // POST /auth/login
  http.post(buildPath('/auth/login'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const user = buildMockUser({
      email: typeof body.email === 'string' ? body.email : undefined,
    });
    const tokens = issueTokens(user);
    return HttpResponse.json({ user, ...tokens }, { status: 200 });
  }),

  // POST /auth/refresh
  http.post(buildPath('/auth/refresh'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const refreshToken =
      typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
    if (!refreshToken) {
      // Match the real backend's 401 contract — apiClient's response
      // error interceptor (api.ts:230-236) will surface this as a
      // session-expired error.
      return HttpResponse.json(
        { message: 'Missing refresh token' },
        { status: 401 }
      );
    }
    // Look up — if absent, mint a fresh anonymous user so demo flows
    // never get stuck behind a stale token from a previous page load.
    const user = sessions.get(refreshToken) ?? buildMockUser({});
    const tokens = issueTokens(user);
    return HttpResponse.json(tokens, { status: 200 });
  }),

  // POST /auth/logout
  http.post(buildPath('/auth/logout'), async ({ request }) => {
    // Best-effort: if the caller passes a Bearer token, drop it.
    const auth = request.headers.get('Authorization');
    const match = auth?.match(/^Bearer\s+(.+)$/i);
    if (match) sessions.delete(match[1]);
    return HttpResponse.json(
      { message: 'Logged out successfully' },
      { status: 200 }
    );
  }),

  // GET /auth/me — authService expects { user: User } (NOT bare User).
  http.get(buildPath('/auth/me'), ({ request }) => {
    const user = userFromAuthHeader(request.headers.get('Authorization'));
    if (!user) {
      // Default fallback so the dashboard renders even on a fresh
      // page reload before the user has an active session.
      const fallback: MockUser = {
        id: 'mock-user-default',
        email: 'demo@lfmt.dev',
        firstName: 'Mock',
        lastName: 'User',
      };
      return HttpResponse.json({ user: fallback }, { status: 200 });
    }
    return HttpResponse.json({ user }, { status: 200 });
  }),

  // POST /auth/forgot-password — mirrors real backend: success even
  // for unknown emails (prevents user enumeration).
  http.post(buildPath('/auth/forgot-password'), async () => {
    return HttpResponse.json(
      { message: 'Password reset email sent' },
      { status: 200 }
    );
  }),

  // POST /auth/verify-email — NEW (currently 501 in real backend).
  http.post(buildPath('/auth/verify-email'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) {
      return HttpResponse.json(
        { message: 'Invalid or missing verification token' },
        { status: 400 }
      );
    }
    return HttpResponse.json(
      { message: 'Email verified successfully' },
      { status: 200 }
    );
  }),

  // POST /auth/reset-password — NEW (currently 501 in real backend).
  http.post(buildPath('/auth/reset-password'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const token = typeof body.token === 'string' ? body.token : '';
    const newPassword =
      typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!token || !newPassword) {
      return HttpResponse.json(
        { message: 'Invalid or missing token or new password' },
        { status: 400 }
      );
    }
    return HttpResponse.json(
      { message: 'Password reset successfully' },
      { status: 200 }
    );
  }),
];

// ---------------------------------------------------------------------------
// Translation pipeline (Phase 3)
// ---------------------------------------------------------------------------
//
// Endpoint inventory (all served against the wildcard pattern):
//   POST /jobs/upload                             — presigned URL handoff
//   PUT  /__mock-s3/:jobId                        — S3 PUT interceptor
//   POST /jobs/:jobId/translate                   — kick off translation
//   GET  /jobs/:jobId/translation-status          — poll progress
//   GET  /jobs                                    — job history
//   GET  /translation/:jobId/download             — download translated text
//
// All responses are wrapped in `{ data: T }` to match the existing
// frontend contract (translationService.ts:175, 190, 203, 214 all
// dereference `response.data.data`).
//
// On-demand simulation policy (Phase 4) lives inside the status
// handler — there are NO setInterval/setTimeout calls. The status
// handler computes progress from `translateStartedAt` (wall-clock)
// or `statusPollCount` (instant mode). See computeProgress() below.
//
// Same-origin S3 mock: the upload handler returns a `uploadUrl` of
// the form `${origin}/__mock-s3/<jobId>`, so the browser treats the
// PUT as same-origin and the SW intercepts it. This is the only
// way to mock S3 PUT — an axios interceptor cannot intercept the
// raw `axios.put` call to a presigned URL on a different host.

const SIMULATED_TRANSLATED_TEXT_MARKER = '[MOCK TRANSLATION COMPLETE]';

/**
 * Map an internal `JobState.status` to the deployed backend's
 * `TranslationJob.status` enum (translationService.ts:20-28).
 * The internal map uses lowercase for ergonomics; the wire format
 * uses upper-snake-case.
 */
function toWireStatus(state: JobState): string {
  switch (state.status) {
    case 'uploaded':
      return 'PENDING';
    case 'translating':
      return 'IN_PROGRESS';
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
  }
}

/**
 * Project the closure-scoped `JobState` to the wire shape the
 * frontend expects (`TranslationJob` from translationService.ts:14-38).
 */
function toWireJob(state: JobState): Record<string, unknown> {
  return {
    jobId: state.jobId,
    userId: 'mock-user-default',
    fileName: state.fileName,
    fileSize: 0,
    contentType: 'text/plain',
    status: toWireStatus(state),
    targetLanguage: state.targetLang,
    tone: 'neutral',
    totalChunks: state.totalChunks,
    completedChunks: state.completedChunks,
    failedChunks: state.failedChunks,
    createdAt: state.createdAt,
    updatedAt: state.completedAt ?? state.createdAt,
    completedAt: state.completedAt,
  };
}

/**
 * Estimate `totalChunks` from file size — mirrors the rough heuristic
 * the real chunking engine uses (3.5K tokens per chunk ≈ 14KB text).
 * Capped to a sensible demo range so the progress bar always animates.
 */
function estimateTotalChunks(fileSize: number): number {
  if (!Number.isFinite(fileSize) || fileSize <= 0) return 4;
  const estimated = Math.max(1, Math.round(fileSize / 14_000));
  return Math.min(estimated, 50);
}

const translationHandlers: HttpHandler[] = [
  // POST /jobs/upload — handles BOTH request shapes used today:
  //   1. translationService.uploadDocument (translationService.ts:20-38)
  //      → body: { fileName, fileSize, contentType, legalAttestation }
  //   2. uploadService.requestUploadUrl (uploadService.ts:59,81)
  //      → body: { fileName, fileSize, contentType }   (no legalAttestation)
  // Both expect the same response envelope.
  http.post(buildPath('/jobs/upload'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const fileName =
      typeof body.fileName === 'string' ? body.fileName : 'mock-upload.txt';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;
    const jobId = uuid();
    const now = new Date().toISOString();

    jobs.set(jobId, {
      jobId,
      status: 'uploaded',
      totalChunks: estimateTotalChunks(fileSize),
      completedChunks: 0,
      failedChunks: 0,
      fileName,
      sourceLang: 'auto',
      targetLang: 'es',
      createdAt: now,
    });

    // Build a same-origin presigned URL so the browser does NOT issue
    // a CORS preflight on the PUT and the SW can intercept it
    // regardless of transport (XHR / axios / fetch). We resolve the
    // page origin from:
    //   1. the `Origin` request header (set by the browser on cross-
    //      origin XHR/fetch — most reliable in mock mode);
    //   2. globalThis.location.origin (browser direct, e.g. when no
    //      Origin header was sent);
    //   3. `http://localhost:3000` (msw/node fallback for Vitest).
    let pageOrigin = request.headers.get('origin');
    if (!pageOrigin && typeof globalThis.location !== 'undefined') {
      pageOrigin = globalThis.location.origin;
    }
    if (!pageOrigin) {
      pageOrigin = 'http://localhost:3000';
    }
    const uploadUrl = `${pageOrigin}/__mock-s3/${jobId}`;

    return HttpResponse.json(
      {
        data: {
          uploadUrl,
          fileId: jobId,
          expiresIn: 900,
          requiredHeaders: {
            'Content-Type': 'text/plain',
          },
        },
      },
      { status: 200 }
    );
  }),

  // PUT /__mock-s3/:jobId — the S3 PUT interceptor.
  // Spike-validated: works for raw XHR (uploadService.ts), raw axios
  // PUT (translationService.ts:137), and fetch.
  http.put(buildPath('/__mock-s3/:jobId'), async ({ params }) => {
    const jobId = String(params.jobId);
    // We deliberately do NOT read the request body — for large files
    // (50 MB cap) buffering the bytes wastes memory in the worker. S3
    // returns an empty body with an ETag header; we do the same.
    return new HttpResponse(null, {
      status: 200,
      headers: {
        ETag: `"mock-etag-${jobId}"`,
      },
    });
  }),

  // POST /jobs/:jobId/translate — start translation.
  http.post(
    buildPath('/jobs/:jobId/translate'),
    async ({ params, request }) => {
      const jobId = String(params.jobId);
      const job = jobs.get(jobId);
      if (!job) {
        return HttpResponse.json(
          { message: 'Job not found' },
          { status: 404 }
        );
      }
      const body = (await request.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (typeof body.targetLanguage === 'string') {
        job.targetLang = body.targetLanguage;
      }
      job.status = 'translating';
      job.translateStartedAt = Date.now();
      job.statusPollCount = 0;
      jobs.set(jobId, job);

      return HttpResponse.json({ data: toWireJob(job) }, { status: 200 });
    }
  ),

  // GET /jobs/:jobId/translation-status — on-demand simulation tick.
  // Phase 4 will plug in the VITE_MOCK_SPEED branching; for now,
  // every call advances completedChunks toward totalChunks at a
  // generous default rate so the smoke test in this phase passes.
  http.get(buildPath('/jobs/:jobId/translation-status'), ({ params }) => {
    const jobId = String(params.jobId);
    const job = jobs.get(jobId);
    if (!job) {
      return HttpResponse.json(
        { message: 'Job not found' },
        { status: 404 }
      );
    }
    if (job.status === 'translating') {
      // Default policy until Phase 4 lands the speed-profile branching.
      const polls = (job.statusPollCount ?? 0) + 1;
      job.statusPollCount = polls;
      const target = Math.min(
        job.totalChunks,
        Math.ceil((polls / 4) * job.totalChunks)
      );
      job.completedChunks = target;
      if (job.completedChunks >= job.totalChunks) {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
      }
      jobs.set(jobId, job);
    }
    return HttpResponse.json({ data: toWireJob(job) }, { status: 200 });
  }),

  // GET /jobs — list all jobs in the in-memory store.
  http.get(buildPath('/jobs'), () => {
    const list = Array.from(jobs.values()).map(toWireJob);
    return HttpResponse.json({ data: list }, { status: 200 });
  }),

  // GET /translation/:jobId/download — return simulated translated text.
  // The frontend's translationService.downloadTranslation requests
  // `responseType: 'blob'`. MSW returns a body with the right
  // Content-Type and axios will produce a Blob in the browser.
  http.get(buildPath('/translation/:jobId/download'), ({ params }) => {
    const jobId = String(params.jobId);
    const job = jobs.get(jobId);
    if (!job) {
      return HttpResponse.json(
        { message: 'Job not found' },
        { status: 404 }
      );
    }
    const body = `Translated content for ${job.fileName} (target: ${job.targetLang}).\n\n${SIMULATED_TRANSLATED_TEXT_MARKER}\n`;
    return new HttpResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${job.fileName}.translated.txt"`,
      },
    });
  }),
];

// ---------------------------------------------------------------------------
// Public handlers list (consumed by browser.ts and server.ts)
// ---------------------------------------------------------------------------

export const handlers: HttpHandler[] = [...authHandlers, ...translationHandlers];
