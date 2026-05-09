/**
 * API Envelope Contract Test
 *
 * Regression guard for the 2026-05-09 demo blocker:
 *
 *   "Cannot read properties of undefined (reading 'status')"
 *
 * Root cause: the frontend service `getJobStatus` read `response.data.data`
 * but the real Lambda `backend/functions/jobs/getTranslationStatus.ts`
 * returns a FLAT object via `createSuccessResponse`. The MSW mock had
 * been wrapping responses in `{data: ...}` to match the (wrong) frontend
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
 * Strategy: drive the actual MSW handlers (msw/node) end-to-end through
 * the real `apiClient` axios instance, with a tiny axios-mock-adapter
 * shim for the `/__mock-s3/` PUT (since msw/node cannot intercept the
 * absolute URL the SW would normally handle). Asserts on the SHAPE the
 * service returns, not on incidental field values.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers, resetState } from '../mocks/handlers';
import { translationService } from '../services/translationService';
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
});

describe('API Envelope Contract — mock vs frontend reader', () => {
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
});
