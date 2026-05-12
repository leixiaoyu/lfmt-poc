/**
 * Content-Security-Policy builder — single source of truth (Issue #216).
 *
 * Pre-#216 the CSP was assembled by a private `buildCsp({ connectSrc, reportUri })`
 * method on `LfmtInfrastructureStack` with a per-directive named-parameter
 * shape. That shape composes poorly: every new directive that needs runtime-
 * derived input (style-src nonces for #197, future report-to groups, etc.)
 * required a new named field on the options object AND a parallel parameter
 * at every call site.
 *
 * The new shape accepts a structured directive map:
 *
 *   ```ts
 *   buildCsp({
 *     directives: {
 *       'connect-src': ["'self'", 'https://api.example.com'],
 *       'style-src': ["'self'", "'nonce-abc123'"],
 *       'report-uri': ['https://csp-report.example.com/report'],
 *     },
 *   });
 *   ```
 *
 * Callers pass ONLY the directives they want to override or extend; the
 * hardening defaults live in this module so a stack file can't accidentally
 * drop one. Each directive's source list is an array of source-expressions
 * (NOT a single string) so the validation and join semantics are crystal-
 * clear at the call site.
 *
 * Hardening status (Issues #133, #194, #216):
 *   - 'unsafe-eval' REMOVED from script-src.
 *   - 'unsafe-inline' REMOVED from script-src — Vite's built
 *     `dist/index.html` has no inline `<script>` blocks.
 *   - 'unsafe-inline' on style-src: retained by default, but callers MAY
 *     override with a `'nonce-...'` source list per #197.
 *
 * Telemetry (#201): pass `'report-uri': ['https://...']`. The value is
 * sanitized by `assertValidCspReportUri` to prevent injection attacks via
 * a malformed URL (H-3, PR #214 OMC R2).
 */

/**
 * Union of CSP directive names this module knows how to emit.
 *
 * Anchored at the standard Level 2/3 directives we actually use. Adding a
 * new directive is a deliberate API change — narrowing here forces the
 * reviewer to confirm the new directive is intended (rather than a typo'd
 * existing one). If a future need genuinely requires `frame-src`,
 * `worker-src`, etc., add it here AND extend the test matrix.
 */
export type CspDirective =
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'connect-src'
  | 'object-src'
  | 'base-uri'
  | 'form-action'
  | 'frame-ancestors'
  | 'upgrade-insecure-requests'
  | 'report-uri';

/** Per-directive source list. Empty array → directive emitted with no sources
 *  (valid only for `upgrade-insecure-requests`, which takes no value). */
export type CspDirectives = Partial<Record<CspDirective, string[]>>;

export interface BuildCspOptions {
  /**
   * Directive overrides keyed by directive name. Each entry REPLACES the
   * default source list for that directive (callers must include `'self'`
   * explicitly if they want it preserved). This is a `Partial` map; omitted
   * directives keep their hardening defaults from `DEFAULT_DIRECTIVES`.
   *
   * Rationale for REPLACE-not-MERGE: every caller already knows what its
   * directive needs to contain (e.g., `connect-src` callers explicitly pass
   * the API Gateway + S3 bucket origins alongside `'self'`). A merge
   * semantics would force every reader to mentally combine two arrays,
   * which is exactly the audit-failure mode that prompted #216.
   */
  directives?: CspDirectives;
}

/**
 * Hardening defaults. Every directive emitted here was vetted in #133/#194/
 * the OMC review chain; changing one is a security decision, not a
 * refactor. The order matches the conventional CSP write order so the
 * resulting string reads naturally in a violation-report dashboard.
 */
const DEFAULT_DIRECTIVES: Required<Pick<
  CspDirectives,
  | 'default-src'
  | 'script-src'
  | 'style-src'
  | 'img-src'
  | 'font-src'
  | 'connect-src'
  | 'object-src'
  | 'base-uri'
  | 'form-action'
  | 'frame-ancestors'
  | 'upgrade-insecure-requests'
>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'upgrade-insecure-requests': [],
};

/**
 * Emission order — the CSP grammar is tolerant of arbitrary order for most
 * directives, but `report-uri` MUST come last so a future `report-to`
 * directive (#201) can be appended without breaking parsers that split on
 * trailing semicolons.
 */
const EMISSION_ORDER: CspDirective[] = [
  'default-src',
  'script-src',
  'style-src',
  'img-src',
  'font-src',
  'connect-src',
  'object-src',
  'base-uri',
  'form-action',
  'frame-ancestors',
  'upgrade-insecure-requests',
  'report-uri',
];

/**
 * Build the Content-Security-Policy header string.
 *
 * Pure function — no AWS SDK or CDK dependencies — so this module can be
 * unit-tested in isolation and re-used from other constructs (e.g., a
 * future Lambda@Edge response transformer for #197 nonces).
 */
export function buildCsp(opts: BuildCspOptions = {}): string {
  const overrides = opts.directives ?? {};

  // Validate `report-uri` BEFORE any string assembly so a bad value fails
  // at `cdk synth` rather than at deploy time. The validator throws.
  const reportUriSources = overrides['report-uri'];
  if (reportUriSources !== undefined) {
    if (!Array.isArray(reportUriSources) || reportUriSources.length === 0) {
      throw new Error(
        `Invalid CSP report-uri: must be a non-empty array of URLs (got: ${JSON.stringify(reportUriSources)})`
      );
    }
    reportUriSources.forEach(assertValidCspReportUri);
  }

  const parts: string[] = [];
  for (const directive of EMISSION_ORDER) {
    const sources = overrides[directive] ?? DEFAULT_DIRECTIVES[directive as keyof typeof DEFAULT_DIRECTIVES];
    if (sources === undefined) continue; // omitted directive (e.g., report-uri unless overridden)
    if (sources.length === 0) {
      // Sourceless directive (only legal for `upgrade-insecure-requests`).
      parts.push(directive);
    } else {
      parts.push(`${directive} ${sources.join(' ')}`);
    }
  }

  return parts.join('; ') + ';';
}

/**
 * Validate a CSP `report-uri` source value before interpolating it into a
 * directive string (H-3, PR #214 OMC R2 — preserved across #216 refactor).
 *
 * Rules (intentionally conservative — favour false-positive on synth over
 * a false-negative that ships an injection):
 *   1. Must parse as a valid URL.
 *   2. Protocol MUST be `https:`. CSP report endpoints commonly POST
 *      cross-origin with credentials, so plain HTTP would leak violation
 *      reports (which contain blocked URIs that may include session info)
 *      over the wire.
 *   3. The raw string MUST NOT contain whitespace, `;`, or `,` — these
 *      terminate / split CSP directives, so an injected character there
 *      would let an attacker append a directive (e.g.
 *      `https://x.com; script-src *`).
 *
 * Exported so unit tests can call it without re-synthesizing a CSP string.
 */
export function assertValidCspReportUri(reportUri: string): void {
  if (typeof reportUri !== 'string') {
    throw new Error(
      `Invalid CSP reportUri: must be a string (got: ${typeof reportUri})`
    );
  }

  // Forbidden characters: whitespace + CSP-grammar separators.
  if (/[\s;,]/.test(reportUri)) {
    throw new Error(
      `Invalid CSP reportUri: must not contain whitespace, ';' or ',' (got: ${JSON.stringify(reportUri)})`
    );
  }

  // Must parse as a URL. URL constructor throws on malformed input.
  let parsed: URL;
  try {
    parsed = new URL(reportUri);
  } catch {
    throw new Error(
      `Invalid CSP reportUri: not a valid URL (got: ${JSON.stringify(reportUri)})`
    );
  }

  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid CSP reportUri: protocol must be https: (got: ${parsed.protocol})`
    );
  }
}
