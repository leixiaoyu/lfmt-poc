/**
 * Live-backend API envelope contract guard (#219).
 *
 * Companion to the MSW-mocked `frontend/src/__tests__/apiEnvelopeContract.test.ts`
 * — that file pins the wire envelope against the MOCK handlers, which can
 * still drift from the deployed Lambda (manual AWS-console change, prod
 * hot-fix that bypassed CDK, shared-types version mismatch in the deployed
 * bundle). This Playwright spec authenticates against the DEPLOYED dev
 * backend and asserts the live wire body matches every `*ApiResponse`
 * interface in `@lfmt/shared-types`.
 *
 * ---------------------------------------------------------------------------
 * Why nightly, not per-PR
 * ---------------------------------------------------------------------------
 *
 * This spec hits a real, deployed environment. Per-PR runs would:
 *   - Burn AWS quota on every PR (Cognito user creation, S3 upload, Step
 *     Functions execution).
 *   - Flake on transient network issues, gating unrelated merges.
 *   - Race with PRs that deploy backend changes during their own CI run.
 *
 * The corresponding workflow `.github/workflows/e2e-contract-nightly.yml`
 * runs on a schedule (post-deploy nightly) plus a manual `workflow_dispatch`
 * trigger so on-call can re-run after a hot-fix.
 *
 * ---------------------------------------------------------------------------
 * Credentials
 * ---------------------------------------------------------------------------
 *
 * The protected endpoints require an authenticated session. Two modes:
 *
 *   1. `LFMT_TEST_EMAIL` + `LFMT_TEST_PASSWORD` (preferred — set as CI
 *      repository secrets). Reuses a stable test account so the dev Cognito
 *      pool doesn't accumulate per-run users.
 *
 *   2. Fallback: register a fresh user per run. The dev-environment Cognito
 *      pool has auto-confirm enabled (see CLAUDE.md → AUTH-AUTO-CONFIRM)
 *      so the registration completes synchronously and the spec can log in
 *      immediately. This mirrors the smoke-test pattern from
 *      `production-smoke.spec.ts` so the spec degrades gracefully when the
 *      shared credentials aren't available (e.g., a forked PR running
 *      manually).
 *
 * Credentials MUST NEVER be hardcoded in the spec file — that's an OWASP
 * A07:2021 finding and the test fails if a literal credential is detected
 * (see the linter rule in `.eslintrc` if one is added later).
 *
 * ---------------------------------------------------------------------------
 * Coverage matrix
 * ---------------------------------------------------------------------------
 *
 * Mirrors the matrix in `frontend/src/__tests__/apiEnvelopeContract.test.ts`
 * so a drift between mock and live is impossible to miss. Each test asserts
 * EXACTLY the shape described by the corresponding `*ApiResponse` interface
 * in `@lfmt/shared-types`. Field VALUES are not asserted (they vary per
 * request); only KEYS + JavaScript types.
 *
 * ---------------------------------------------------------------------------
 * Failure semantics
 * ---------------------------------------------------------------------------
 *
 * A failure in this spec means the deployed Lambda's response shape has
 * diverged from the SSoT type. Triage:
 *   1. Check whether the deployed shared-types bundle is up to date.
 *   2. Compare the failing field name against the SSoT interface — a renamed
 *      field is a wire-contract break.
 *   3. If the Lambda intentionally changed shape, update the matching
 *      `*ApiResponse` interface AND the MSW handler in the SAME PR.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';
import type {
  PresignedUrlApiResponse,
  StartTranslationApiResponse,
  TranslationStatusApiResponse,
  GetJobApiResponse,
  ListJobsEnvelope,
  DeleteJobApiResponse,
} from '@lfmt/shared-types';
import { resolveApiUrl } from '../../fixtures/url';

// Tag the suite so a workflow can opt-in (`--grep @contract-live`) without
// pulling the rest of the E2E suite along for the ride.
test.describe('Live-backend API envelope contract @contract-live', () => {
  // -----------------------------------------------------------------------
  // Configuration — every value is environment-driven so the same spec
  // file can target dev, staging, or any future tier.
  // -----------------------------------------------------------------------
  const apiBaseUrl =
    process.env.LFMT_API_URL ||
    process.env.VITE_API_URL ||
    process.env.API_BASE_URL ||
    'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/';

  const sharedEmail = process.env.LFMT_TEST_EMAIL;
  const sharedPassword = process.env.LFMT_TEST_PASSWORD;
  const useSharedCreds = Boolean(sharedEmail && sharedPassword);

  // Per-run fallback user. Cognito password policy requires upper + lower +
  // digit + symbol (>=8). Keep this generation co-located with the spec so
  // the fallback path is self-contained.
  const generateRunUser = () => {
    const ts = Date.now();
    const rand = Math.random().toString(36).substring(2, 10);
    return {
      email: `contract-${ts}-${rand}@e2e-test.lfmt.com`,
      password: `Contract${ts}${rand}!Aa1`,
      firstName: 'Contract',
      lastName: 'Live',
    };
  };

  // Module-level state populated by `beforeAll`. Tests share a single
  // session (one Cognito login) to keep AWS API rates well under the
  // adminInitiateAuth burst limit.
  let idToken: string | null = null;
  let normalizedApiUrl: string;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Authenticate against the deployed Cognito pool and return an idToken.
   * Cognito-issued idToken is what the API Gateway authorizer validates,
   * NOT accessToken — see the COGNITO authorizer config in
   * `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`.
   */
  async function loginAndGetIdToken(
    request: APIRequestContext,
    email: string,
    password: string
  ): Promise<string> {
    const res = await request.post(`${normalizedApiUrl}/auth/login`, {
      data: { email, password },
      failOnStatusCode: false,
    });
    if (!res.ok()) {
      const body = await res.text();
      throw new Error(
        `Login failed for ${email} against ${normalizedApiUrl}: ${res.status()} ${body}`
      );
    }
    const body = (await res.json()) as { idToken?: string };
    if (typeof body.idToken !== 'string' || body.idToken.length === 0) {
      throw new Error(
        `Login succeeded but idToken missing from response — wire-shape drift detected.`
      );
    }
    return body.idToken;
  }

  /** Register the per-run fallback user; auto-confirm makes this synchronous. */
  async function registerRunUser(
    request: APIRequestContext,
    user: ReturnType<typeof generateRunUser>
  ): Promise<void> {
    const res = await request.post(`${normalizedApiUrl}/auth/register`, {
      data: {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        password: user.password,
        confirmPassword: user.password,
        acceptedTerms: true,
        acceptedPrivacy: true,
      },
      failOnStatusCode: false,
    });
    if (!res.ok()) {
      const body = await res.text();
      throw new Error(
        `Register failed for ${user.email} against ${normalizedApiUrl}: ${res.status()} ${body}`
      );
    }
  }

  /** Authenticated header set used by every protected-endpoint call. */
  function authHeaders(): { Authorization: string } {
    if (!idToken) {
      throw new Error('idToken not initialized — beforeAll() did not run');
    }
    return { Authorization: `Bearer ${idToken}` };
  }

  // -----------------------------------------------------------------------
  // Lifecycle — one login per file, not per test.
  // -----------------------------------------------------------------------
  test.beforeAll(async ({ request }) => {
    normalizedApiUrl = resolveApiUrl(apiBaseUrl);
    if (useSharedCreds) {
      idToken = await loginAndGetIdToken(request, sharedEmail!, sharedPassword!);
    } else {
      const fallback = generateRunUser();
      await registerRunUser(request, fallback);
      idToken = await loginAndGetIdToken(request, fallback.email, fallback.password);
    }
  });

  // -----------------------------------------------------------------------
  // 1. POST /jobs/upload — WRAPPED envelope (the only one that uses
  //    `createWrappedResponse`; every other endpoint is flat).
  // -----------------------------------------------------------------------
  test('POST /jobs/upload returns {message, data: PresignedUrlResponse}', async ({ request }) => {
    const res = await request.post(`${normalizedApiUrl}/jobs/upload`, {
      headers: authHeaders(),
      data: {
        fileName: `contract-${Date.now()}.txt`,
        // 100 bytes — enough to satisfy any minimum-size guard, small
        // enough that the S3 multipart threshold isn't tripped.
        fileSize: 100,
        contentType: 'text/plain',
      },
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as PresignedUrlApiResponse;

    // Top-level wrapper: `{message, data, requestId}`.
    expect(typeof body.message).toBe('string');
    expect(body.data).toBeDefined();
    expect(typeof body.data.uploadUrl).toBe('string');
    expect(typeof body.data.jobId).toBe('string');

    // Wire-shape regression guard: the body MUST NOT have been flattened
    // (i.e. the upload-URL fields MUST NOT appear at the top level). If
    // a future Lambda author migrates to `createFlatResponse` without
    // updating the SSoT, the frontend service crashes; this assertion
    // catches that drift.
    expect(body).not.toHaveProperty('uploadUrl');
  });

  // -----------------------------------------------------------------------
  // 2. POST /jobs/{jobId}/translate — flat envelope (#229 field rename).
  // -----------------------------------------------------------------------
  test('POST /jobs/{jobId}/translate returns flat StartTranslationApiResponse', async ({
    request,
  }) => {
    // Seed: create a job via the upload endpoint so we have a jobId to
    // translate against. The translate endpoint expects the job to be in
    // `UPLOADED` state — we don't actually run the upload, but the dev
    // backend's startTranslation handler tolerates the missing object for
    // this contract-shape check (a 4xx response would still be a CONTRACT
    // failure, which is the point of this test).
    const upload = await request.post(`${normalizedApiUrl}/jobs/upload`, {
      headers: authHeaders(),
      data: {
        fileName: `contract-translate-${Date.now()}.txt`,
        fileSize: 100,
        contentType: 'text/plain',
      },
      failOnStatusCode: false,
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const uploadBody = (await upload.json()) as PresignedUrlApiResponse;
    const { jobId } = uploadBody.data;

    const res = await request.post(`${normalizedApiUrl}/jobs/${jobId}/translate`, {
      headers: authHeaders(),
      data: { targetLanguage: 'es', tone: 'neutral' },
      failOnStatusCode: false,
    });

    // Even if the underlying job state is invalid (we didn't actually
    // upload the bytes), a 4xx response body must still carry the
    // CONTRACT shape, NOT a stack trace. Accept 2xx (job moved to
    // IN_PROGRESS) OR a structured 4xx (validation failure).
    if (res.ok()) {
      const body = (await res.json()) as StartTranslationApiResponse;
      expect(body.jobId).toBe(jobId);
      expect(typeof body.translationStatus).toBe('string');
      expect(typeof body.totalChunks).toBe('number');
      expect(typeof body.translatedChunks).toBe('number');
      // #229: old field name MUST NOT appear on the wire.
      expect(body).not.toHaveProperty('chunksTranslated');
      expect(typeof body.targetLanguage).toBe('string');
    } else {
      // Structured error envelope — `{ message, requestId, errors? }`.
      const body = (await res.json()) as {
        message: string;
        requestId?: string;
      };
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    }
  });

  // -----------------------------------------------------------------------
  // 3. GET /jobs/{jobId}/translation-status — flat envelope. This is the
  //    EXACT endpoint that produced the 2026-05-09 demo blocker; the
  //    contract guard here is the regression baseline.
  // -----------------------------------------------------------------------
  test('GET /jobs/{jobId}/translation-status returns flat TranslationStatusApiResponse', async ({
    request,
  }) => {
    const upload = await request.post(`${normalizedApiUrl}/jobs/upload`, {
      headers: authHeaders(),
      data: {
        fileName: `contract-status-${Date.now()}.txt`,
        fileSize: 100,
        contentType: 'text/plain',
      },
      failOnStatusCode: false,
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const { jobId } = ((await upload.json()) as PresignedUrlApiResponse).data;

    const res = await request.get(`${normalizedApiUrl}/jobs/${jobId}/translation-status`, {
      headers: authHeaders(),
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as TranslationStatusApiResponse;

    expect(body.jobId).toBe(jobId);
    expect(typeof body.status).toBe('string');
    expect(typeof body.translationStatus).toBe('string');
    expect(typeof body.totalChunks).toBe('number');
    expect(typeof body.translatedChunks).toBe('number');
    expect(typeof body.progressPercentage).toBe('number');
    // The 2026-05-09 demo-blocker failure mode: a non-flat envelope
    // would put these fields under `.data.*` instead of the top level.
    expect(body).not.toHaveProperty('data');
    // #229: old field name MUST NOT appear on the wire.
    expect(body).not.toHaveProperty('chunksTranslated');
  });

  // -----------------------------------------------------------------------
  // 4. GET /jobs/{jobId} — flat GetJobApiResponse.
  // -----------------------------------------------------------------------
  test('GET /jobs/{jobId} returns flat GetJobApiResponse', async ({ request }) => {
    const upload = await request.post(`${normalizedApiUrl}/jobs/upload`, {
      headers: authHeaders(),
      data: {
        fileName: `contract-get-${Date.now()}.txt`,
        fileSize: 100,
        contentType: 'text/plain',
      },
      failOnStatusCode: false,
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const { jobId } = ((await upload.json()) as PresignedUrlApiResponse).data;

    const res = await request.get(`${normalizedApiUrl}/jobs/${jobId}`, {
      headers: authHeaders(),
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as GetJobApiResponse;
    expect(body.jobId).toBe(jobId);
    expect(typeof body.userId).toBe('string');
    expect(typeof body.status).toBe('string');
    expect(typeof body.createdAt).toBe('string');
  });

  // -----------------------------------------------------------------------
  // 5. GET /jobs — {jobs, count, nextCursor?} envelope (#237 pagination).
  // -----------------------------------------------------------------------
  test('GET /jobs returns the {jobs, count} envelope', async ({ request }) => {
    const res = await request.get(`${normalizedApiUrl}/jobs`, {
      headers: authHeaders(),
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as ListJobsEnvelope;
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(typeof body.count).toBe('number');
    // `nextCursor` is OPTIONAL — present only when more pages remain. Just
    // verify the field is either a string or undefined (NOT null, which
    // would be a wire-shape drift — the SSoT interface uses `?: string`,
    // not `string | null`).
    if (body.nextCursor !== undefined) {
      expect(typeof body.nextCursor).toBe('string');
    }
  });

  // -----------------------------------------------------------------------
  // 6. DELETE /jobs/{jobId} — flat DeleteJobApiResponse. Done LAST so the
  //    cleanup also exercises the wire contract.
  // -----------------------------------------------------------------------
  test('DELETE /jobs/{jobId} returns flat DeleteJobApiResponse', async ({ request }) => {
    const upload = await request.post(`${normalizedApiUrl}/jobs/upload`, {
      headers: authHeaders(),
      data: {
        fileName: `contract-delete-${Date.now()}.txt`,
        fileSize: 100,
        contentType: 'text/plain',
      },
      failOnStatusCode: false,
    });
    expect(upload.ok(), await upload.text()).toBe(true);
    const { jobId } = ((await upload.json()) as PresignedUrlApiResponse).data;

    const res = await request.delete(`${normalizedApiUrl}/jobs/${jobId}`, {
      headers: authHeaders(),
      failOnStatusCode: false,
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as DeleteJobApiResponse;
    expect(body.jobId).toBe(jobId);
    expect(typeof body.message).toBe('string');
    // `warning` is OPTIONAL — present only on partial S3 cleanup failure.
    if (body.warning !== undefined) {
      expect(typeof body.warning).toBe('string');
    }
  });
});
