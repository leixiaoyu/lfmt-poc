/**
 * CSP style-src nonce — runtime accessor (Issue #254).
 *
 * Reads the `content` attribute of the `<meta name="csp-nonce">` tag that
 * the CDK custom resource stamps into `index.html` at deploy time. The
 * value is threaded into the Emotion `CacheProvider` in `main.tsx` so
 * MUI/Emotion runtime `<style>` injections carry the matching `nonce`
 * attribute and pass the response CSP `style-src 'self' 'nonce-<value>'`
 * directive.
 *
 * Dev-mode fallback
 * -----------------
 *
 * In `npm run dev` (Vite dev server) the placeholder `__CSP_NONCE__` is
 * NOT replaced (only the CDK + S3-upload pipeline performs that
 * substitution). The literal token would be invalid as a CSP nonce
 * source, so this helper detects the un-replaced placeholder and
 * returns `undefined` — Emotion then falls back to emitting un-nonced
 * `<style>` tags. The Vite dev server does not set a production CSP
 * header, so the inline styles are not blocked.
 *
 * This module is intentionally side-effect-free (no `document` access at
 * import time) so it is safe to use in SSR-style environments and in the
 * Vitest jsdom test runner (which lacks the meta tag entirely).
 */

/**
 * Sentinel that the CDK custom resource (and the CI rebuild composite
 * action) replaces with the per-deploy nonce. Kept in lockstep with
 * `frontend/index.html`, `backend/functions/security/cspNonceCustomResource.ts`,
 * and `.github/actions/rebuild-frontend/action.yml`.
 */
const NONCE_PLACEHOLDER = '__CSP_NONCE__';

/**
 * Returns the runtime CSP nonce, or `undefined` if the page is being
 * served in a mode that does not stamp the value (dev server, vitest
 * jsdom, or a misconfigured deploy where the placeholder was left
 * literal — the latter is reported via the #201 CSP violation endpoint
 * because MUI styles would silently fail).
 */
export function getCspNonceFromMeta(): string | undefined {
  if (typeof document === 'undefined') {
    // SSR / pre-hydration / vitest jsdom-less mode. Nothing to read.
    return undefined;
  }
  const meta = document.querySelector('meta[name="csp-nonce"]');
  if (!meta) {
    return undefined;
  }
  const value = meta.getAttribute('content');
  if (!value) {
    return undefined;
  }
  // Dev-mode guard: if the placeholder was not substituted, treat it as
  // "no nonce available" so Emotion does not stamp the literal token
  // onto every <style> tag (which would still fail CSP and add noise to
  // every page load). The placeholder is a sentinel; the CSP nonce
  // generator emits a 32-char base64url string with no underscores at
  // the boundaries, so the equality check is a tight match.
  if (value === NONCE_PLACEHOLDER) {
    return undefined;
  }
  return value;
}
