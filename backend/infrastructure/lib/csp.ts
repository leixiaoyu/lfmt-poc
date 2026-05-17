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
 * Hardening status (Issues #133, #194, #216, #254):
 *   - 'unsafe-eval' REMOVED from script-src.
 *   - 'unsafe-inline' REMOVED from script-src — Vite's built
 *     `dist/index.html` has no inline `<script>` blocks.
 *   - 'unsafe-inline' REMOVED from style-src default (#254). MUI/Emotion
 *     CSS-in-JS now flows through a nonce-aware Emotion CacheProvider
 *     wired to a `<meta name="csp-nonce">` tag stamped into `index.html`
 *     at deploy time by the CDK custom resource defined in
 *     `lfmt-infrastructure-stack.ts`. The same custom resource exposes
 *     the nonce as a CloudFormation attribute that callers thread into
 *     `buildCsp({ directives: { 'style-src': ["'self'", "'nonce-<token>'"] } })`
 *     so the response-headers policy CSP carries the matching source.
 *     The default emitted here is just `style-src 'self'`; callers MUST
 *     pass a `'nonce-...'` source explicitly to make MUI styles work.
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
const DEFAULT_DIRECTIVES: Required<
  Pick<
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
  >
> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  // 'unsafe-inline' REMOVED from style-src as of #254. MUI/Emotion no
  // longer injects un-nonced `<style>` tags: the React tree wraps `App`
  // in a nonce-aware Emotion `CacheProvider` that reads the nonce from
  // the `<meta name="csp-nonce">` tag in `index.html`. The CDK custom
  // resource defined in `lfmt-infrastructure-stack.ts` (see
  // `createCspNonceCustomResource`) generates a fresh random nonce on
  // every `cdk deploy`, rewrites the meta-tag placeholder in S3, and
  // exposes the value to this builder so the response-headers policy
  // CSP carries `style-src 'self' 'nonce-<value>'` for the matching
  // deploy lifetime.
  //
  // The static-per-deploy trade-off is documented in
  // `docs/CLOUDFRONT-SETUP.md`: an attacker who reads the served
  // `index.html` learns the nonce until the next frontend deploy
  // rotates it. We accept this because (a) the #201 CSP violation-
  // report endpoint alarms on any regression that introduces a
  // non-nonced inline style, and (b) per-response nonces would
  // require Lambda@Edge body-rewriting which Lambda@Edge does NOT
  // expose (the original #254 design was pivoted for this reason).
  'style-src': ["'self'"],
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
    const sources =
      overrides[directive] ?? DEFAULT_DIRECTIVES[directive as keyof typeof DEFAULT_DIRECTIVES];
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
 *   1. Must parse as a valid URL. (Skipped when the value contains an
 *      UNRESOLVED CDK token like `${Token[apiId.123]}` — CDK resolves
 *      these to concrete strings at deploy time. We can't `new URL()`
 *      them, but the protocol/separator checks below still bite.)
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
    throw new Error(`Invalid CSP reportUri: must be a string (got: ${typeof reportUri})`);
  }

  // Forbidden characters: whitespace + CSP-grammar separators. This check
  // runs FIRST and applies even to unresolved CDK tokens — `${Token[...]}`
  // does not contain whitespace or `;`/`,` so legitimate tokens pass; an
  // attacker-controlled string containing any of these characters is
  // rejected before we get to the URL-parse step.
  if (/[\s;,]/.test(reportUri)) {
    throw new Error(
      `Invalid CSP reportUri: must not contain whitespace, ';' or ',' (got: ${JSON.stringify(reportUri)})`
    );
  }

  // Protocol check. We don't need a URL parser for this — checking the
  // literal prefix is sufficient and works for both concrete strings AND
  // strings that begin with `https://` and continue with an unresolved
  // CDK token (e.g. `https://${Token[...]}.execute-api...`). A `report-uri`
  // pointing at `http://...` is rejected explicitly to avoid the report-
  // payload leak path described above.
  if (!reportUri.startsWith('https://')) {
    throw new Error(
      `Invalid CSP reportUri: protocol must be https: (got: ${JSON.stringify(reportUri)})`
    );
  }

  // CDK token escape hatch: when the value contains an unresolved token
  // (the `${Token[...]}` lexical marker), skip the URL-parser check.
  // At deploy time CDK substitutes the token with the concrete value via
  // `Fn::Join`; the resulting CloudFormation-resolved string is the one
  // the browser actually receives, NOT this token-laden synth-time view.
  //
  // We deliberately do NOT call `Token.isUnresolved` here — this module
  // is a PURE FUNCTION that knows nothing about CDK, so a lexical check
  // keeps the unit tests free of CDK imports. The token-detection regex
  // matches the well-defined CDK internal format (`${Token[<id>]}`),
  // which CDK guarantees won't collide with user data because CDK
  // controls both the format and the id generator.
  const containsCdkToken = /\$\{Token\[[^\]]+\]\}/.test(reportUri);
  if (containsCdkToken) {
    return; // Validation passes — defer the URL-parse check to deploy time.
  }

  // Must parse as a URL. URL constructor throws on malformed input.
  let parsed: URL;
  try {
    parsed = new URL(reportUri);
  } catch {
    throw new Error(`Invalid CSP reportUri: not a valid URL (got: ${JSON.stringify(reportUri)})`);
  }

  if (parsed.protocol !== 'https:') {
    // Redundant guard — we already prefix-checked. Keeping it in case the
    // URL parser normalises a weird scheme into something non-https
    // (e.g., `javascript://` does parse, with a non-https protocol).
    throw new Error(`Invalid CSP reportUri: protocol must be https: (got: ${parsed.protocol})`);
  }
}
