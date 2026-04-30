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
  // Captured from the active session at upload time (R1: OMC review
  // follow-up). Previously `toWireJob` read `lastIssuedUser?.id` directly
  // — that broadened the `/auth/me` single-tenant escape hatch into the
  // job-side surface AND created hidden coupling between the auth and
  // job paths. By snapshotting the userId onto the job at creation and
  // having `toWireJob` echo `state.userId`, `lastIssuedUser` stays
  // strictly scoped to the `/auth/me` recovery path.
  userId: string;
  // Persisted from the upload request so the wire shape can echo back the
  // actual size on the Translation Details / History views (Issue #144).
  // Without this, every job rendered as "File Size: 0 Bytes".
  fileSize: number;
  sourceLang: string;
  targetLang: string;
  // Persisted from the translate request so all views (wizard review →
  // job details → history) display the same tone. Defaults to 'neutral'
  // when the request omits it, matching shared-types/src/jobs.ts default.
  // Issue #143: previous code dropped tone on the floor and rendered
  // 'neutral' regardless of the wizard selection.
  tone: string;
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
// Email (lowercased) → user lookup, populated on register and consulted
// on login. Without this, the login handler had no way to recover the
// firstName/lastName a user supplied at registration, so it fabricated a
// generic 'Mock User' on every login (Issue #142). Persisted across the
// closure lifetime; cleared on resetState() the same way `sessions` is.
const registeredUsers = new Map<string, MockUser>();
// Most-recently-issued user. Fallback for `GET /auth/me` when the access
// token isn't in `sessions` — happens when the SW restarts between page
// navigations and loses closure state, but the page still has a valid
// access token in localStorage. Without this, /auth/me silently returned
// `mock-user-default` ('Mock User'), breaking the perceived session
// across direct-URL navigation (Issue #141).
let lastIssuedUser: MockUser | null = null;

/**
 * Reset the closure-scoped job store. Used by Vitest `afterEach` and
 * Playwright per-test fixtures. Calling `worker.resetHandlers()`
 * alone is NOT sufficient — that only re-installs handlers, it does
 * NOT clear closure state.
 */
export function resetState(): void {
  jobs.clear();
  sessions.clear();
  registeredUsers.clear();
  lastIssuedUser = null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  // Cheap browser/node-portable UUID-ish. Sufficient for mock IDs.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildMockUser(input: { email?: string; firstName?: string; lastName?: string }): MockUser {
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
  // Track the most-recently-issued user so /auth/me can recover identity
  // after a Service-Worker restart wipes the `sessions` Map but the page
  // still holds a valid access token in localStorage (Issue #141).
  lastIssuedUser = user;
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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const user = buildMockUser({
      email: typeof body.email === 'string' ? body.email : undefined,
      firstName: typeof body.firstName === 'string' ? body.firstName : undefined,
      lastName: typeof body.lastName === 'string' ? body.lastName : undefined,
    });
    // Persist the registered user keyed by email so a subsequent login
    // round-trip can recover firstName/lastName instead of fabricating a
    // generic "Mock User" (Issue #142).
    registeredUsers.set(user.email.toLowerCase(), user);
    const tokens = issueTokens(user);
    return HttpResponse.json({ user, ...tokens }, { status: 200 });
  }),

  // POST /auth/login
  http.post(buildPath('/auth/login'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email : undefined;
    // Look up the previously-registered user by email before falling back
    // to a synthesized one. Without this, every login returned a fresh
    // 'Mock User' and the user's real firstName/lastName from registration
    // was lost (Issue #142). Mock mode is single-tenant by design, so the
    // password is intentionally not validated.
    const existing = email ? registeredUsers.get(email.toLowerCase()) : undefined;
    const user = existing ?? buildMockUser({ email });
    const tokens = issueTokens(user);
    return HttpResponse.json({ user, ...tokens }, { status: 200 });
  }),

  // POST /auth/refresh
  http.post(buildPath('/auth/refresh'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : undefined;
    if (!refreshToken) {
      // Match the real backend's 401 contract — apiClient's response
      // error interceptor (api.ts:230-236) will surface this as a
      // session-expired error.
      return HttpResponse.json({ message: 'Missing refresh token' }, { status: 401 });
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
    return HttpResponse.json({ message: 'Logged out successfully' }, { status: 200 });
  }),

  // GET /auth/me — authService expects { user: User } (NOT bare User).
  http.get(buildPath('/auth/me'), ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    const user = userFromAuthHeader(authHeader);
    if (user) {
      return HttpResponse.json({ user }, { status: 200 });
    }
    // Issue #141: when the SW restarts mid-session, the closure-scoped
    // `sessions` Map is wiped but the page still has a valid access
    // token in localStorage. The previous code returned a hardcoded
    // 'Mock User' here, breaking the UI's perceived session on every
    // direct-URL navigation. Recovery policy:
    //   1. If the request bears SOME Bearer token AND we still remember
    //      who we last issued tokens for, treat that as the active user.
    //      Mock mode is single-tenant by design, so this matches the
    //      demo scenario without leaking identity across sessions.
    //   2. Otherwise (no Authorization header at all), respond 401 so
    //      the AuthContext can route to /login deterministically — this
    //      is closer to the real backend's contract than a hardcoded
    //      fallback user.
    const hasBearerToken = !!authHeader && /^Bearer\s+\S+/.test(authHeader);
    if (hasBearerToken && lastIssuedUser) {
      return HttpResponse.json({ user: lastIssuedUser }, { status: 200 });
    }
    return HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }),

  // POST /auth/forgot-password — mirrors real backend: success even
  // for unknown emails (prevents user enumeration).
  http.post(buildPath('/auth/forgot-password'), async () => {
    return HttpResponse.json({ message: 'Password reset email sent' }, { status: 200 });
  }),

  // POST /auth/verify-email — NEW (currently 501 in real backend).
  http.post(buildPath('/auth/verify-email'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) {
      return HttpResponse.json(
        { message: 'Invalid or missing verification token' },
        { status: 400 }
      );
    }
    return HttpResponse.json({ message: 'Email verified successfully' }, { status: 200 });
  }),

  // POST /auth/reset-password — NEW (currently 501 in real backend).
  http.post(buildPath('/auth/reset-password'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const token = typeof body.token === 'string' ? body.token : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
    if (!token || !newPassword) {
      return HttpResponse.json(
        { message: 'Invalid or missing token or new password' },
        { status: 400 }
      );
    }
    return HttpResponse.json({ message: 'Password reset successfully' }, { status: 200 });
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

// ---------------------------------------------------------------------------
// VITE_MOCK_SPEED branching (per design Decision 4)
// ---------------------------------------------------------------------------
//
// Three speed profiles, selected by env var at module load:
//
//   instant   — Default for Vitest. Status handler advances
//               completedChunks by 25% per call (4 polls to 100%).
//               No wall-clock dependency; deterministic.
//   realistic — Default for `npm run dev`. Wall-clock, ~10s end-to-end.
//   slow      — Demo rehearsal cadence. Wall-clock, ~60s end-to-end.
//               Also force-triggered by reserved filename
//               `__lfmt_mock_slow__.txt` (Phase 5).
//
// Background timers are explicitly NOT used. setInterval/setTimeout
// would leak across Vitest tests and Playwright workers; tick on-demand
// inside the status handler instead. See spec Decision 4.

export type MockSpeed = 'instant' | 'realistic' | 'slow';

const REALISTIC_WINDOW_MS = 10_000;
const SLOW_WINDOW_MS = 60_000;

function readMockSpeed(): MockSpeed {
  // import.meta.env.VITE_MOCK_SPEED is read once at module load. In
  // Node (msw/node), import.meta.env is shimmed by Vitest from
  // process.env / .env.test.
  const raw =
    typeof import.meta !== 'undefined'
      ? (import.meta.env?.VITE_MOCK_SPEED as string | undefined)
      : undefined;
  if (raw === 'realistic' || raw === 'slow' || raw === 'instant') {
    return raw;
  }
  // Default: instant in Vitest (jsdom), realistic in browser dev.
  // We detect Vitest via the boolean env it sets (`VITEST`).
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITEST) {
    return 'instant';
  }
  return 'realistic';
}

const mockSpeed: MockSpeed = readMockSpeed();

/**
 * Compute the next `completedChunks` value for a translating job
 * given the current speed profile. Deterministic in `instant` mode
 * (request-count-driven), wall-clock in `realistic` and `slow`.
 *
 * Exported for use by the status handler AND Vitest tests so the
 * simulation policy has one tested implementation.
 */
export function computeProgress(
  job: JobState,
  now: number,
  speed: MockSpeed = mockSpeed
): { completedChunks: number; isComplete: boolean } {
  if (job.status !== 'translating') {
    const isComplete = job.completedChunks >= job.totalChunks;
    return { completedChunks: job.completedChunks, isComplete };
  }

  let fraction = 0;
  if (speed === 'instant') {
    // statusPollCount is incremented BY THE HANDLER before this call
    // — we read it as-is here. 1st poll → 25%, 4th poll → 100%.
    const polls = job.statusPollCount ?? 0;
    fraction = Math.min(1, polls / 4);
  } else {
    const windowMs = speed === 'slow' ? SLOW_WINDOW_MS : REALISTIC_WINDOW_MS;
    const elapsed = now - (job.translateStartedAt ?? now);
    fraction = Math.min(1, elapsed / windowMs);
  }
  const target = Math.min(job.totalChunks, Math.ceil(fraction * job.totalChunks));
  return { completedChunks: target, isComplete: target >= job.totalChunks };
}

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
    // R1: echo the userId captured on the job at upload time. Do NOT
    // touch `lastIssuedUser` here — it is reserved for the `/auth/me`
    // SW-restart recovery path (Issue #141).
    userId: state.userId,
    fileName: state.fileName,
    // Issue #144: was hardcoded to 0; now echoes the value captured from
    // the upload request body so the Job Information view shows the real
    // size instead of "0 Bytes".
    fileSize: state.fileSize,
    contentType: 'text/plain',
    status: toWireStatus(state),
    targetLanguage: state.targetLang,
    // Issue #143: was hardcoded to 'neutral'; now echoes whatever the
    // translate request supplied (or the wizard's neutral default).
    tone: state.tone,
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

// ---------------------------------------------------------------------------
// Error injection (per design Decision 7)
// ---------------------------------------------------------------------------
//
// Reserved filename pattern. Match is recomputed PER REQUEST — no
// sticky state. Re-uploading a normally-named file recovers normally.
//
// The pattern is intentionally absurd (`__lfmt_mock_*__.txt`) so the
// collision probability with real user uploads is ~0. The handlers
// only consult this matcher when `VITE_MOCK_API === 'true'` (the
// handlers themselves are not registered in production).

export type ReservedFileMode =
  | { kind: 'error'; httpStatus: 403 | 413 | 429 | 500 }
  | { kind: 'network' } // HttpResponse.error() — axios sees !error.response
  | { kind: 'slow' }
  | { kind: 'normal' };

const RESERVED_FILENAME_REGEX = /^__lfmt_mock_(error_(403|413|429|500|network)|slow)__\.txt$/;

/**
 * Inspect a filename for a reserved error-injection trigger.
 * Exported for unit tests; consumed by upload / translate / status
 * handlers below.
 */
export function classifyReservedFilename(fileName: string | undefined | null): ReservedFileMode {
  if (!fileName) return { kind: 'normal' };
  const m = fileName.match(RESERVED_FILENAME_REGEX);
  if (!m) return { kind: 'normal' };
  const inner = m[1];
  if (inner === 'slow') return { kind: 'slow' };
  if (inner === 'error_network') return { kind: 'network' };
  // inner === 'error_NNN' for NNN ∈ {403,413,429,500}
  const code = Number(inner.slice('error_'.length));
  if (code === 403 || code === 413 || code === 429 || code === 500) {
    return { kind: 'error', httpStatus: code };
  }
  return { kind: 'normal' };
}

const translationHandlers: HttpHandler[] = [
  // POST /jobs/upload — handles BOTH request shapes used today:
  //   1. translationService.uploadDocument (translationService.ts:20-38)
  //      → body: { fileName, fileSize, contentType, legalAttestation }
  //   2. uploadService.requestUploadUrl (uploadService.ts:59,81)
  //      → body: { fileName, fileSize, contentType }   (no legalAttestation)
  // Both expect the same response envelope.
  http.post(buildPath('/jobs/upload'), async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const fileName = typeof body.fileName === 'string' ? body.fileName : 'mock-upload.txt';
    const fileSize = typeof body.fileSize === 'number' ? body.fileSize : 0;

    // Reserved-filename error injection — recomputed per request.
    const reserved = classifyReservedFilename(fileName);
    if (reserved.kind === 'network') {
      return HttpResponse.error();
    }
    if (reserved.kind === 'error') {
      // Only 403 and 413 apply to upload; 429 and 500 are deferred to
      // the translate / status handlers below to keep the simulation
      // contract per spec §5.1.
      if (reserved.httpStatus === 403) {
        return HttpResponse.json({ message: 'Forbidden' }, { status: 403 });
      }
      if (reserved.httpStatus === 413) {
        return HttpResponse.json({ message: 'Payload too large' }, { status: 413 });
      }
    }

    const jobId = uuid();
    const now = new Date().toISOString();

    // R1: snapshot the active user's id at upload time so the job
    // record carries its own owner. Resolution order:
    //   1. The Bearer token on the request (real auth round-trip — the
    //      authoritative source when the SW closure is intact).
    //   2. `lastIssuedUser` (Issue #141 fallback — covers the SW-restart
    //      window where `sessions` was wiped but the page still has a
    //      valid token in localStorage).
    //   3. A stable default — only reached when the demo is launched
    //      without ever calling /auth/register or /auth/login first.
    const sessionUser = userFromAuthHeader(request.headers.get('Authorization'));
    const userId = sessionUser?.id ?? lastIssuedUser?.id ?? 'mock-user-default';

    jobs.set(jobId, {
      jobId,
      status: 'uploaded',
      totalChunks: estimateTotalChunks(fileSize),
      completedChunks: 0,
      failedChunks: 0,
      fileName,
      userId,
      fileSize,
      sourceLang: 'auto',
      targetLang: 'es',
      // Default tone matches shared-types/src/jobs.ts; overwritten by
      // the translate request when the wizard supplies a value.
      tone: 'neutral',
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
  http.post(buildPath('/jobs/:jobId/translate'), async ({ params, request }) => {
    const jobId = String(params.jobId);
    const job = jobs.get(jobId);
    if (!job) {
      return HttpResponse.json({ message: 'Job not found' }, { status: 404 });
    }
    // Reserved-filename error injection — 429 (rate limit) is
    // routed here per spec §5.1.
    const reserved = classifyReservedFilename(job.fileName);
    if (reserved.kind === 'error' && reserved.httpStatus === 429) {
      return HttpResponse.json({ message: 'Rate limit exceeded' }, { status: 429 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.targetLanguage === 'string') {
      job.targetLang = body.targetLanguage;
    }
    // Issue #143: previously, `tone` from the wizard was dropped on the
    // floor here and the job always showed 'neutral'. Persist whatever
    // the wizard supplies; any other code path that reads back the job
    // (status poll, history list, details page) will see the correct
    // value via toWireJob().
    if (typeof body.tone === 'string') {
      job.tone = body.tone;
    }
    job.status = 'translating';
    job.translateStartedAt = Date.now();
    job.statusPollCount = 0;
    jobs.set(jobId, job);

    return HttpResponse.json({ data: toWireJob(job) }, { status: 200 });
  }),

  // GET /jobs/:jobId/translation-status — on-demand simulation tick.
  // The progression policy is delegated to computeProgress() which
  // branches on VITE_MOCK_SPEED. NO setInterval/setTimeout here.
  http.get(buildPath('/jobs/:jobId/translation-status'), ({ params }) => {
    const jobId = String(params.jobId);
    const job = jobs.get(jobId);
    if (!job) {
      return HttpResponse.json({ message: 'Job not found' }, { status: 404 });
    }
    // Reserved-filename error injection — 500 (server error) is
    // routed here per spec §5.1.
    const reserved = classifyReservedFilename(job.fileName);
    if (reserved.kind === 'error' && reserved.httpStatus === 500) {
      return HttpResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
    if (job.status === 'translating') {
      job.statusPollCount = (job.statusPollCount ?? 0) + 1;
      // `__lfmt_mock_slow__.txt` forces the 60s wall-clock policy
      // regardless of VITE_MOCK_SPEED (per spec §5.1).
      const speed: MockSpeed = reserved.kind === 'slow' ? 'slow' : mockSpeed;
      const { completedChunks, isComplete } = computeProgress(job, Date.now(), speed);
      job.completedChunks = completedChunks;
      if (isComplete) {
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
      return HttpResponse.json({ message: 'Job not found' }, { status: 404 });
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
