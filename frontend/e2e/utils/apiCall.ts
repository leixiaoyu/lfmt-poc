/**
 * Playwright in-browser API call helper.
 *
 * IMPORTANT FOOTGUN (per design risk #2 / spec Risk 2):
 *
 *   `page.request.*` (Playwright's `APIRequestContext`) BYPASSES the
 *   MSW Service Worker because the request originates from the
 *   Playwright Node process, not from the browser context. As a
 *   result, those requests will silently hit the real network (or
 *   fail with a name-resolution error in CI).
 *
 *   To talk to the mocked API from a Playwright test, ALWAYS use this
 *   helper or an equivalent `page.evaluate(() => fetch(...))` call.
 *   Inside `page.evaluate`, the request runs in the page context, so
 *   the SW intercepts it.
 *
 * Usage:
 *
 *   import { apiCall } from '../utils/apiCall';
 *
 *   const job = await apiCall(page, '/v1/jobs/upload', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ fileName: 'demo.txt', fileSize: 100, contentType: 'text/plain' }),
 *   });
 *
 * The path is treated as same-origin (resolved against the page's
 * current URL). Pass a fully qualified URL if you need to hit a
 * different host (the MSW wildcard handlers will still intercept).
 */

import type { Page } from '@playwright/test';

export interface ApiCallInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface ApiCallResult<T = unknown> {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: T;
}

/**
 * Issue an HTTP request from the page context (so the MSW Service
 * Worker can intercept it) and return the parsed result.
 *
 * Note: `body` is JSON-parsed when the response Content-Type indicates
 * JSON; otherwise the raw text is returned. Mirrors how the real
 * `apiClient` consumers deserialize responses.
 */
export async function apiCall<T = unknown>(
  page: Page,
  url: string,
  init: ApiCallInit = {}
): Promise<ApiCallResult<T>> {
  return page.evaluate(
    async ({ url: u, init: i }) => {
      const resp = await fetch(u, {
        method: i.method ?? 'GET',
        headers: i.headers ?? {},
        body: i.body ?? undefined,
      });
      const contentType = resp.headers.get('Content-Type') ?? '';
      const isJson = contentType.toLowerCase().includes('json');
      const body = isJson ? await resp.json() : await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return {
        status: resp.status,
        ok: resp.ok,
        headers,
        body,
      };
    },
    { url, init }
  ) as Promise<ApiCallResult<T>>;
}
