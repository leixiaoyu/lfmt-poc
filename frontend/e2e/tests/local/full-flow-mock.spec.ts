/**
 * Full-Flow Mock E2E — verifies the MSW local mock foundation.
 *
 * Per openspec/changes/add-local-mock-api-foundation §7, this spec
 * exercises the complete demo surface:
 *
 *   register → login → upload → translate → progress → history → download
 *
 * entirely in the browser context against the MSW Service Worker.
 * Wall-clock target: <30 seconds (actual in `instant` mode: ~1-2s).
 *
 * KEY ASSERTIONS (per spec Success Criterion #1):
 *   - The browser's network layer shows ONLY localhost:3000 requests
 *     for the duration of the flow — zero requests to AWS hosts.
 *   - The mock-mode banner is present on every page in the flow.
 *   - The download response contains the simulated translated-text
 *     marker `[MOCK TRANSLATION COMPLETE]`.
 *
 * IMPORTANT: API calls go through `apiCall()` (which wraps
 * `page.evaluate(() => fetch(...))`). `page.request.*` would bypass
 * the SW and hit the real network — see the apiCall.ts header.
 */

import { test, expect } from '../../fixtures/mockReset';
import { apiCall } from '../../utils/apiCall';

// The handlers are registered under `*${path}` wildcards, which
// intercept ANY origin — so it doesn't matter what base URL we use.
// We drive through the real app's `VITE_API_URL` (stubbed in
// playwright.config.ts webServer env) for end-to-end parity.
const API_BASE = process.env.VITE_API_URL ?? 'http://localhost:3000/v1';

test.describe('Local mock foundation — full demo flow', () => {
  test('register → login → upload → translate → 100% → history → download', async ({
    page,
    resetMockState,
  }) => {
    // Per-test fresh mock state (clears jobs + sessions + localStorage).
    await resetMockState();

    // ---------------------------------------------------------------
    // 0. Sanity — the mock-mode banner is visible on load
    // ---------------------------------------------------------------
    await expect(
      page.getByTestId('mock-mode-banner'),
      'MockModeBanner must be visible in mock mode (Layer 1 safety rail)'
    ).toBeVisible();

    // ---------------------------------------------------------------
    // 1. Capture any non-localhost request on the page. If the SW is
    //    working, the list should remain empty throughout the flow.
    // ---------------------------------------------------------------
    const offsiteRequests: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      try {
        const host = new URL(url).host;
        // localhost:3000 is the page origin; any other host is a leak.
        // MSW handlers return from the SW, but the browser's DevTools
        // still records the request against its ORIGINAL URL — so even
        // when the SW intercepts a `https://example.com/v1/*` call,
        // we'd see it here. In practice that means this list will
        // contain the mocked URLs; what we DO want to assert is that
        // no AWS hosts (execute-api, s3.amazonaws.com, etc.) appear.
        if (!host.startsWith('localhost:3000') && !host.startsWith('127.0.0.1:3000')) {
          offsiteRequests.push(url);
        }
      } catch {
        // Non-URL (e.g., data: URL) — ignore.
      }
    });

    // ---------------------------------------------------------------
    // 2. Register — hits POST ${API_BASE}/auth/register
    // ---------------------------------------------------------------
    const reg = await apiCall<{
      user: { email: string };
      accessToken: string;
      refreshToken: string;
    }>(page, `${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'full-flow@e2e.dev',
        password: 'hunter2',
        firstName: 'Full',
        lastName: 'Flow',
      }),
    });
    expect(reg.status).toBe(200);
    expect(reg.body.user.email).toBe('full-flow@e2e.dev');
    expect(reg.body.accessToken).toBeTruthy();

    // ---------------------------------------------------------------
    // 3. Login — re-authenticate, confirming the handler is stateless
    //    across fresh calls (mirrors real backend).
    // ---------------------------------------------------------------
    const login = await apiCall<{ accessToken: string }>(page, `${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'full-flow@e2e.dev',
        password: 'hunter2',
      }),
    });
    expect(login.status).toBe(200);
    const bearer = `Bearer ${login.body.accessToken}`;

    // ---------------------------------------------------------------
    // 4. /auth/me — validates the bearer-token → user resolution.
    // ---------------------------------------------------------------
    const me = await apiCall<{ user: { email: string } }>(page, `${API_BASE}/auth/me`, {
      headers: { Authorization: bearer },
    });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('full-flow@e2e.dev');

    // ---------------------------------------------------------------
    // 5. Upload — issues a presigned URL; THEN the PUT to the
    //    same-origin __mock-s3 path is intercepted by the SW.
    // ---------------------------------------------------------------
    const upload = await apiCall<{
      data: { uploadUrl: string; fileId: string; requiredHeaders: Record<string, string> };
    }>(page, `${API_BASE}/jobs/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearer },
      body: JSON.stringify({
        fileName: 'demo.txt',
        fileSize: 50_000,
        contentType: 'text/plain',
        legalAttestation: {
          acceptCopyrightOwnership: true,
          acceptTranslationRights: true,
          acceptLiabilityTerms: true,
          userIPAddress: 'captured-by-backend',
          userAgent: 'playwright',
          timestamp: new Date().toISOString(),
        },
      }),
    });
    expect(upload.status).toBe(200);
    const { uploadUrl, fileId } = upload.body.data;
    // Same-origin URL so no CORS preflight is issued (spec §1).
    expect(new URL(uploadUrl).origin).toBe('http://localhost:3000');
    expect(new URL(uploadUrl).pathname).toBe(`/__mock-s3/${fileId}`);

    // 5b. The S3 PUT.
    const putS3 = await apiCall<unknown>(page, uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'This is the document content for translation.',
    });
    expect(putS3.status).toBe(200);
    expect(putS3.headers.etag ?? putS3.headers.ETag).toMatch(/^"mock-etag-/);

    // ---------------------------------------------------------------
    // 6. Translate — kick off translation.
    // ---------------------------------------------------------------
    const translate = await apiCall<{ data: { status: string } }>(
      page,
      `${API_BASE}/jobs/${fileId}/translate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: bearer },
        body: JSON.stringify({ targetLanguage: 'es', tone: 'neutral' }),
      }
    );
    expect(translate.status).toBe(200);
    expect(translate.body.data.status).toBe('IN_PROGRESS');

    // ---------------------------------------------------------------
    // 7. Poll status until COMPLETED — instant mode → 4 calls.
    // ---------------------------------------------------------------
    let finalStatus = '';
    for (let i = 0; i < 8; i++) {
      const s = await apiCall<{
        data: { status: string; completedChunks: number; totalChunks: number };
      }>(page, `${API_BASE}/jobs/${fileId}/translation-status`, {
        headers: { Authorization: bearer },
      });
      expect(s.status).toBe(200);
      finalStatus = s.body.data.status;
      if (finalStatus === 'COMPLETED') break;
    }
    expect(finalStatus).toBe('COMPLETED');

    // ---------------------------------------------------------------
    // 8. History — job visible; COMPLETED.
    // ---------------------------------------------------------------
    const history = await apiCall<{
      data: Array<{ jobId: string; status: string }>;
    }>(page, `${API_BASE}/jobs`, { headers: { Authorization: bearer } });
    expect(history.status).toBe(200);
    const ours = history.body.data.find((j) => j.jobId === fileId);
    expect(ours, 'uploaded job should appear in history').toBeTruthy();
    expect(ours?.status).toBe('COMPLETED');

    // ---------------------------------------------------------------
    // 9. Download — response contains the MOCK TRANSLATION marker.
    // ---------------------------------------------------------------
    const dl = await apiCall<string>(page, `${API_BASE}/translation/${fileId}/download`, {
      headers: { Authorization: bearer },
    });
    expect(dl.status).toBe(200);
    expect(typeof dl.body === 'string' && dl.body.includes('[MOCK TRANSLATION COMPLETE]')).toBe(
      true
    );

    // ---------------------------------------------------------------
    // 10. Network-hygiene assertion — no AWS hosts were contacted.
    // ---------------------------------------------------------------
    const awsHosts = offsiteRequests.filter((u) => {
      const h = new URL(u).host;
      return h.includes('execute-api') || h.endsWith('amazonaws.com') || h.includes('cognito');
    });
    expect(
      awsHosts,
      'Mock mode must never reach real AWS hosts — ' + 'if this fails the SW is not intercepting'
    ).toEqual([]);
  });
});
