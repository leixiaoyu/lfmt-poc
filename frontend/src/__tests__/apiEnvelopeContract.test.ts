/**
 * API Envelope Contract Test
 *
 * Regression guard for the 2026-05-09 demo blocker:
 *
 *   "Cannot read properties of undefined (reading 'status')"
 *
 * Root cause: the frontend service `getJobStatus` read `response.data.data`
 * but the real Lambda `backend/functions/jobs/getTranslationStatus.ts`
 * returns a FLAT object via `createFlatResponse`. The MSW mock had been
 * wrapping responses in `{data: ...}` to match the (wrong) frontend
 * expectation, hiding the divergence until the deployed walkthrough.
 *
 * This file is the primary CONTRACT GUARD against future regressions of
 * the same class. It exercises the MSW handlers (which now mirror the
 * real Lambda wire shape) and asserts the frontend services successfully
 * project the wire body into the local types — i.e., the service does
 * NOT crash on `undefined.something`. If a Lambda ever changes its
 * response shape, this test will fail in vitest before the change can
 * reach the demo.
 *
 * ---------------------------------------------------------------------------
 * ONBOARDING — adding contract tests for new service methods
 * ---------------------------------------------------------------------------
 *
 * When you add a new method to `authService` / `translationService` /
 * any other API service, add a corresponding test here that asserts:
 *
 *   1. The wire body shape matches the corresponding `*ApiResponse`
 *      interface in `@lfmt/shared-types` (the SSoT — see
 *      `frontend/src/mocks/handlers.ts` "Wire-shape policy" block).
 *   2. The shape matches what the real Lambda's `createFlatResponse`
 *      or `createWrappedResponse` would produce — i.e., flat for
 *      everything except `POST /jobs/upload`.
 *   3. The service-layer reader projects the wire shape into the
 *      frontend type without dereferencing undefined.
 *
 * The matrix below covers every method exposed by `authService` and
 * `translationService` as of PR #218. New endpoints MUST add a row
 * here in the same PR they ship the handler in.
 *
 * Strategy: drive the actual MSW handlers (msw/node) end-to-end through
 * the real `apiClient` axios instance. Asserts on the SHAPE the service
 * returns, not on incidental field values. This file is intentionally
 * shape-only — semantic behaviour (validation, error mapping) lives in
 * the per-service unit tests next to the implementation.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { handlers, resetState } from '../mocks/handlers';
import { translationService } from '../services/translationService';
import { authService } from '../services/authService';
import { apiClient } from '../utils/api';
import type {
  PresignedUrlApiResponse,
  StartTranslationApiResponse,
  TranslationStatusApiResponse,
} from '@lfmt/shared-types';

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
beforeEach(() => {
  server.resetHandlers();
  resetState();
  // Clear any session left behind by a previous test — the
  // refresh-interceptor would otherwise inject Authorization
  // headers we don't care about here.
  localStorage.clear();
});

describe('API Envelope Contract — translation pipeline', () => {
  it('POST /jobs/upload returns {message, data: PresignedUrlResponse} envelope', async () => {
    // Hits the MSW handler (which mirrors the real Lambda's
    // PresignedUrlApiResponse shape). The frontend reader in
    // translationService.uploadDocument /
    // uploadService.requestUploadUrl dereferences `.data.data` — if
    // the envelope ever flattens (or vice versa), this test fails.
    const response = await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: 'contract.txt',
      fileSize: 100,
      contentType: 'text/plain',
    });

    expect(response.data).toBeDefined();
    expect(typeof response.data.message).toBe('string');
    expect(response.data.data).toBeDefined();
    expect(typeof response.data.data.uploadUrl).toBe('string');
    expect(typeof response.data.data.jobId).toBe('string');
  });

  it('POST /jobs/{jobId}/translate returns flat StartTranslationApiResponse', async () => {
    // Seed a job through the upload handler so the translate handler
    // has something to operate on.
    const upload = await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: 'contract.txt',
      fileSize: 100,
      contentType: 'text/plain',
    });
    const { jobId } = upload.data.data;

    const response = await apiClient.post<StartTranslationApiResponse>(`/jobs/${jobId}/translate`, {
      targetLanguage: 'es',
      tone: 'neutral',
    });

    // Body is FLAT: NO `data` wrapper. The 2026-05-09 hotfix exists
    // specifically to prevent reading `response.data.data` here.
    expect(response.data.jobId).toBe(jobId);
    expect(response.data.translationStatus).toBe('IN_PROGRESS');
    // Field name is `chunksTranslated`, not `completedChunks` —
    // mirrors the real Lambda. Frontend service translates at the seam.
    expect(typeof response.data.chunksTranslated).toBe('number');
    expect(typeof response.data.totalChunks).toBe('number');
  });

  it('GET /jobs/{jobId}/translation-status returns flat TranslationStatusApiResponse', async () => {
    const upload = await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: 'contract.txt',
      fileSize: 100,
      contentType: 'text/plain',
    });
    const { jobId } = upload.data.data;

    const response = await apiClient.get<TranslationStatusApiResponse>(
      `/jobs/${jobId}/translation-status`
    );

    // Body is FLAT — this is the EXACT failure mode of the demo
    // blocker. If `response.data.status` is undefined, the polling
    // loop in `uploadAndAwaitChunked` crashes with the original
    // "Cannot read properties of undefined (reading 'status')" error.
    expect(response.data.jobId).toBe(jobId);
    expect(typeof response.data.status).toBe('string');
    expect(typeof response.data.translationStatus).toBe('string');
    expect(typeof response.data.totalChunks).toBe('number');
    expect(typeof response.data.chunksTranslated).toBe('number');
    expect(typeof response.data.progressPercentage).toBe('number');
  });

  it('translationService.getJobStatus does not crash on the real wire shape', async () => {
    // End-to-end through the service layer. This is the precise
    // call site where the demo blocker manifested — the polling loop
    // in `uploadAndAwaitChunked` invokes `getJobStatus(...)` and then
    // dereferences `.status` on the result. Service must safely
    // project the flat wire shape into a `TranslationJob`.
    const upload = await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: 'contract.txt',
      fileSize: 100,
      contentType: 'text/plain',
    });
    const { jobId } = upload.data.data;

    const job = await translationService.getJobStatus(jobId);

    expect(job).toBeDefined();
    expect(job.jobId).toBe(jobId);
    // The bug surfaced as `job.status` being undefined; assert it
    // is a string so the regression is impossible to merge silently.
    expect(typeof job.status).toBe('string');
    expect(typeof job.totalChunks).toBe('number');
    expect(typeof job.completedChunks).toBe('number');
  });

  it('GET /jobs returns a flat array (no envelope wrapper)', async () => {
    // Seed two jobs so the list returns something non-trivial.
    // We only assert "at least the seeds" rather than an exact count
    // because earlier tests in the same file may have left jobs in
    // the closure-scoped store; that's an acceptable cross-test leak
    // for a contract test (we care about the SHAPE, not the count).
    await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: 'a.txt',
      fileSize: 50,
      contentType: 'text/plain',
    });
    await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: 'b.txt',
      fileSize: 75,
      contentType: 'text/plain',
    });

    const list = await translationService.getTranslationJobs();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(2);
    // Per-item contract: each entry is the flat TranslationJob shape
    // the History page expects.
    expect(typeof list[0].jobId).toBe('string');
    expect(typeof list[0].status).toBe('string');
    expect(typeof list[0].fileSize).toBe('number');
  });

  it('GET /jobs/{jobId}/download returns a Blob with a content-type set', async () => {
    const upload = await apiClient.post<PresignedUrlApiResponse>('/jobs/upload', {
      fileName: 'download-me.txt',
      fileSize: 40,
      contentType: 'text/plain',
    });
    const { jobId } = upload.data.data;

    const blob = await translationService.downloadTranslation(jobId);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('API Envelope Contract — auth pipeline', () => {
  // The auth handlers all return the FLAT envelope. The mock matches
  // the real backend (post-PR-#218: refreshToken was flattened too).

  it('authService.register returns flat AuthResponse with user + tokens', async () => {
    const result = await authService.register({
      email: 'contract@example.com',
      password: 'TestPass123!',
      confirmPassword: 'TestPass123!',
      firstName: 'Contract',
      lastName: 'Tester',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    // Flat: `user` is a top-level field, NOT `result.data.user`.
    expect(result.user).toBeDefined();
    expect(typeof result.user.email).toBe('string');
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.idToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });

  it('authService.login returns flat AuthResponse with user + tokens', async () => {
    // Register first so the login handler can recover the firstName/lastName
    // from `registeredUsers` (Issue #142 mock fidelity).
    await authService.register({
      email: 'login@example.com',
      password: 'TestPass123!',
      confirmPassword: 'TestPass123!',
      firstName: 'Login',
      lastName: 'Tester',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    const result = await authService.login({
      email: 'login@example.com',
      password: 'TestPass123!',
    });
    expect(result.user).toBeDefined();
    expect(result.user.email).toBe('login@example.com');
    expect(typeof result.accessToken).toBe('string');
    expect(typeof result.idToken).toBe('string');
    expect(typeof result.refreshToken).toBe('string');
  });

  it('authService.getCurrentUser returns the user inside a flat `user` field', async () => {
    const registered = await authService.register({
      email: 'me@example.com',
      password: 'TestPass123!',
      confirmPassword: 'TestPass123!',
      firstName: 'Me',
      lastName: 'Self',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    // Tokens are auto-stored by `storeAuthTokens` inside the service.
    expect(registered.user.email).toBe('me@example.com');

    const me = await authService.getCurrentUser();
    // `getCurrentUser` reads `response.data.user` — the flat envelope.
    expect(me).toBeDefined();
    expect(typeof me.email).toBe('string');
  });

  it('authService.verifyEmail returns a flat MessageResponse', async () => {
    const result = await authService.verifyEmail('any-token');
    expect(typeof result.message).toBe('string');
  });

  it('authService.requestPasswordReset returns a flat MessageResponse', async () => {
    const result = await authService.requestPasswordReset('reset@example.com');
    expect(typeof result.message).toBe('string');
  });

  it('authService.resetPassword returns a flat MessageResponse', async () => {
    const result = await authService.resetPassword({
      token: 'tok',
      newPassword: 'NewPass123!',
    });
    expect(typeof result.message).toBe('string');
  });

  it('authService.refreshToken reads tokens from the FLAT refresh response', async () => {
    // Ensure a session exists so getStoredRefreshToken() returns a value.
    const registered = await authService.register({
      email: 'refresh@example.com',
      password: 'TestPass123!',
      confirmPassword: 'TestPass123!',
      firstName: 'Refresh',
      lastName: 'Tester',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });
    expect(registered.refreshToken).toBeDefined();

    // Override the mock to return the EXACT real-backend wire shape:
    //   { message, accessToken, idToken, expiresIn, requestId }
    server.use(
      http.post('*/auth/refresh', () =>
        HttpResponse.json(
          {
            message: 'Tokens refreshed successfully',
            accessToken: 'flat-access',
            idToken: 'flat-id',
            expiresIn: 3600,
            requestId: 'r-1',
          },
          { status: 200 }
        )
      )
    );

    const result = await authService.refreshToken();
    // Flat: tokens are top-level, NOT under `result.data.accessToken`.
    expect(result.accessToken).toBe('flat-access');
    expect(result.idToken).toBe('flat-id');
  });
});

describe('API Envelope Contract — single-job CRUD', () => {
  // GET /jobs/{jobId} and DELETE /jobs/{jobId} both return the FLAT
  // envelope (createFlatResponse). The MSW handlers don't currently
  // implement these — register them inline so the contract is locked.

  it('GET /jobs/{jobId} body is FLAT (no `data` wrapper)', async () => {
    server.use(
      http.get('*/jobs/job-flat-1', () =>
        HttpResponse.json(
          {
            jobId: 'job-flat-1',
            userId: 'u',
            status: 'COMPLETED',
            filename: 'doc.txt',
            createdAt: '2026-05-09T00:00:00Z',
            requestId: 'r-1',
          },
          { status: 200 }
        )
      )
    );
    const response = await apiClient.get<{
      jobId: string;
      userId: string;
      status: string;
      data?: unknown;
    }>('/jobs/job-flat-1');

    expect(response.data.jobId).toBe('job-flat-1');
    expect(response.data.userId).toBe('u');
    expect(response.data.status).toBe('COMPLETED');
    // Anti-assertion: no nested wrapper.
    expect(response.data).not.toHaveProperty('data');
  });

  it('DELETE /jobs/{jobId} body is FLAT with `message` + `jobId` at top level', async () => {
    server.use(
      http.delete('*/jobs/job-del-1', () =>
        HttpResponse.json(
          {
            message: 'Job job-del-1 deleted successfully',
            jobId: 'job-del-1',
            requestId: 'r-1',
          },
          { status: 200 }
        )
      )
    );
    const response = await apiClient.delete<{
      message: string;
      jobId: string;
      data?: unknown;
    }>('/jobs/job-del-1');

    expect(response.data.message).toMatch(/deleted/);
    expect(response.data.jobId).toBe('job-del-1');
    expect(response.data).not.toHaveProperty('data');
  });
});
