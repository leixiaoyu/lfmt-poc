/**
 * Browser-side network probes for Playwright smoke / E2E tests.
 *
 * Extracted from `frontend/e2e/tests/smoke/production-smoke.spec.ts`
 * (PR #214 OMC R2, convergent: 4 agents) so the wizard-driving
 * @csp-regression test no longer carries 50 lines of inline
 * `addInitScript` plumbing. The probes patch the page's
 * `XMLHttpRequest.prototype.open` to surface S3-specific failure
 * signatures via `window.__s3CspBlocked` / `window.__s3PutFailed`,
 * letting the test fail fast rather than waiting for downstream
 * timeouts (and — more importantly — before the backend's S3-event
 * pipeline burns Gemini quota on a job that's known to fail).
 *
 * Hygiene contract (`restoreXhr` / installed via `installXhrProbe`):
 *   The patched prototype IS scoped to the test's BrowserContext, so
 *   per-test isolation already prevents cross-test bleed. We still
 *   expose an explicit `restoreXhr` helper so a future contributor who
 *   adds an iframe / popup step (which would inherit the patched
 *   prototype) has a clear, named tear-down hook to call from
 *   `test.afterEach`. Keeping the contract hygienic in the helper
 *   means the call sites stay tidy too.
 */

import type { Page } from '@playwright/test';

/**
 * Result emitted by `readNetworkProbes` — one per probe, plus the raw
 * CSP-violation log so the test can surface every blocked URI on a
 * failed assertion.
 */
export interface NetworkProbesSnapshot {
  cspViolations: Array<{ violatedDirective: string; blockedURI: string }>;
  s3CspBlocked: { violatedDirective: string; blockedURI: string } | null;
  s3PutFailed: { url: string; status: number } | null;
}

/**
 * Install both probes on the next navigation. Call this BEFORE
 * `page.goto(...)` so the init script lands on the first document.
 *
 * Probes installed:
 *   1. `securitypolicyviolation` listener → `window.__cspViolations`,
 *      with a fast-fail flag (`__s3CspBlocked`) when the blocked URI
 *      points at the document S3 bucket.
 *   2. `XMLHttpRequest.prototype.open` patch → `window.__s3PutFailed`
 *      when a PUT to the S3 origin completes with status 0
 *      (CORS-preflight reject / DNS failure / network blip).
 *
 * Both probes also stash the original `XMLHttpRequest.prototype.open`
 * on `window.__lfmtRestoreXhrOpen` so `restoreXhr()` can put it back.
 */
export async function installNetworkProbes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // ---------- CSP probe ----------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__cspViolations = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__s3CspBlocked = null;
    window.addEventListener('securitypolicyviolation', (e) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__cspViolations.push({
        violatedDirective: e.violatedDirective,
        blockedURI: e.blockedURI,
      });
      // Short-circuit signal: any CSP block whose blocked URI points
      // at the document S3 bucket means the upload PUT was rejected
      // and the test can fail fast without waiting for translation
      // kick-off.
      if (
        e.violatedDirective?.startsWith('connect-src') &&
        /s3[.-][a-z0-9-]+\.amazonaws\.com/i.test(e.blockedURI || '')
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__s3CspBlocked = {
          violatedDirective: e.violatedDirective,
          blockedURI: e.blockedURI,
        };
      }
    });

    // ---------- XHR probe ----------
    // Patch `XMLHttpRequest.prototype.open` to record the URL +
    // method, then surface the failure via `__s3PutFailed` when the
    // load event fires with status 0 against the document-bucket
    // origin. Stash the original so `restoreXhr` can revert.
    const OriginalXHR = window.XMLHttpRequest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__s3PutFailed = null;
    const originalOpen = OriginalXHR.prototype.open;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__lfmtRestoreXhrOpen = originalOpen;
    // We forward via `arguments` (instead of a `(...args)` rest spread)
    // because XMLHttpRequest.open is variadic — its full signature is
    //   open(method, url, async?, user?, password?)
    // The 3rd-5th parameters are rare in modern code, but a future
    // caller could legitimately set them; using `arguments` preserves
    // EVERY positional argument exactly as the caller passed it,
    // matching native semantics. A `(...args)` rest spread would also
    // work today (and a future TS migration may prefer it for
    // type-safety), but `arguments` is the closest-to-native
    // forwarding idiom and avoids needing a tuple type for the rest
    // parameter.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    OriginalXHR.prototype.open = function (this: any, method: string, url: string) {
      this.__lfmtUrl = url;
      this.__lfmtMethod = method;
      this.addEventListener('loadend', () => {
        if (
          this.__lfmtMethod === 'PUT' &&
          this.status === 0 &&
          /s3[.-][a-z0-9-]+\.amazonaws\.com/i.test(String(this.__lfmtUrl))
        ) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__s3PutFailed = { url: this.__lfmtUrl, status: this.status };
        }
      });
      // eslint-disable-next-line prefer-rest-params
      return originalOpen.apply(this, arguments as unknown as Parameters<typeof originalOpen>);
    };
  });
}

/**
 * Restore the original `XMLHttpRequest.prototype.open` on the live
 * page (no init-script remount — this runs in the existing context).
 *
 * Call from `test.afterEach`. Even though Playwright's per-test
 * BrowserContext isolation guarantees the patched prototype dies with
 * the context, this hook keeps the contract hygienic so a future
 * contributor who introduces an iframe / popup step doesn't
 * accidentally inherit the patched prototype across what they expect
 * to be a clean boundary.
 */
export async function restoreXhr(page: Page): Promise<void> {
  // The page may have already navigated away (or closed) — guard so
  // the helper is safe to call unconditionally from `afterEach`.
  if (page.isClosed()) return;
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.__lfmtRestoreXhrOpen) {
      window.XMLHttpRequest.prototype.open = w.__lfmtRestoreXhrOpen;
      delete w.__lfmtRestoreXhrOpen;
    }
  });
}

/**
 * Read the current state of every probe in a single page round-trip.
 * Use after a failed assertion to surface the underlying signal.
 */
export async function readNetworkProbes(page: Page): Promise<NetworkProbesSnapshot> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    return {
      cspViolations: (w.__cspViolations ?? []) as Array<{
        violatedDirective: string;
        blockedURI: string;
      }>,
      s3CspBlocked: (w.__s3CspBlocked ?? null) as {
        violatedDirective: string;
        blockedURI: string;
      } | null,
      s3PutFailed: (w.__s3PutFailed ?? null) as { url: string; status: number } | null,
    };
  });
}
