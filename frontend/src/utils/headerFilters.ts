/**
 * HTTP Header Filters
 *
 * Browser-side helpers for sanitising header maps before they reach
 * `fetch` / `XMLHttpRequest`. The browser refuses to let JavaScript set
 * certain headers (Fetch spec §forbidden-header-name) and emits noisy
 * "Refused to set unsafe header" warnings when we try — these helpers
 * strip such headers at the seam.
 *
 * Extracted from translationService.ts (PR #214 OMC C1) so the same
 * filter is reused by every service that performs browser-side uploads
 * (translationService, uploadService) without a cross-service import.
 */

/**
 * Headers the browser refuses to let JavaScript set on an XHR / fetch
 * (Fetch spec §forbidden-header-name). The Set is keyed on lowercase
 * names so we can match case-insensitively against whatever the backend
 * sends in `requiredHeaders` — `Content-Length`, `content-length`, etc.
 *
 * We intentionally only strip the headers actively populated by the
 * backend's PresignedUrlResponse today (`Content-Length`). The full
 * forbidden list per spec is much larger; expanding the filter to cover
 * everything risks dropping a header the backend may legitimately add
 * later that we WOULD want to forward (e.g. a custom `x-amz-...`
 * header), so each entry below is here because the backend currently
 * sets it and the browser refuses it. Add new entries deliberately,
 * with the same justification.
 */
export const BROWSER_FORBIDDEN_REQUEST_HEADERS: ReadonlySet<string> = new Set<string>([
  'content-length',
]);

/**
 * Filter out headers the browser will refuse to send (and would emit
 * "Refused to set unsafe header" warnings for) before handing the map
 * to axios / XHR.
 *
 * Returns a new object — the input is never mutated, so callers can
 * safely keep using the original headers map for documentation /
 * non-browser code paths (e.g. logging the contract the backend sent).
 */
export function stripBrowserForbiddenHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !BROWSER_FORBIDDEN_REQUEST_HEADERS.has(name.toLowerCase())
    )
  );
}
