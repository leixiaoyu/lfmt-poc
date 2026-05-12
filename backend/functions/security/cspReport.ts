/**
 * CSP Violation Report Collector (#201)
 * POST /csp-report
 *
 * Receives Content-Security-Policy violation reports from browsers and
 * forwards them to CloudWatch Logs as structured records. The same endpoint
 * accepts BOTH wire formats:
 *
 *   - Legacy `application/csp-report` — payload shape:
 *       { "csp-report": { ... } }
 *     Sent by browsers when CSP carries a `report-uri` directive.
 *
 *   - Modern `application/reports+json` (Reporting API) — payload shape:
 *       [ { "type": "csp-violation", "body": { ... } }, ... ]
 *     Sent when CSP carries a `report-to` directive AND a `Report-To`
 *     response header defines the group. Browsers may batch multiple
 *     reports in one POST.
 *
 * ---------------------------------------------------------------------------
 * Security model — DEFENSIVE BY DESIGN
 * ---------------------------------------------------------------------------
 *
 * Browsers send CSP reports anonymously (no credentials, no auth header)
 * and from any compromised page. That means this handler is INTERNET-FACING,
 * UNAUTHENTICATED, and HOSTILE-INPUT-BY-DEFAULT. Hardening choices:
 *
 *   1. Content-Type allowlist — only `application/csp-report` and
 *      `application/reports+json` are accepted. Any other content type
 *      returns 400 with no logging (avoids drive-by log-injection).
 *
 *   2. Body-size cap — payloads >64 KB are rejected. The Reporting API
 *      spec recommends ~16 KB per report; 64 KB gives headroom for
 *      batched reports while bounding our per-invocation log volume.
 *
 *   3. Field allowlist — we copy a FIXED set of fields into the log
 *      record. Any extra/unknown fields in the payload are DROPPED
 *      (not preserved as-is). This prevents an attacker from poisoning
 *      our logs with arbitrary structured data (e.g., a forged
 *      `userId: "admin"` field).
 *
 *   4. String length caps — every copied string field is truncated to
 *      2 KB. A malicious `blocked-uri` of 10 MB would otherwise blow up
 *      a CloudWatch entry.
 *
 *   5. No PII forwarding — the `user-agent` is NOT logged at INFO level
 *      (OWASP A09:2021). Source IP is captured ONLY for rate-limiting
 *      decisions (left to API Gateway throttling here — see CDK route).
 *
 *   6. ALWAYS returns 204 No Content on success — never echo the payload
 *      back, never include a response body. Anonymous endpoints that
 *      echo input are XS-Leak vectors.
 *
 *   7. Fail-closed: validation errors return 400 with a generic message
 *      (no "field X is invalid" — that helps a fuzzer).
 *
 * Rate limiting: the API Gateway route is given a per-API throttle
 * (configured in CDK, NOT here). DynamoDB-backed per-IP token bucket
 * was considered (issue #201 mentioned it) but for the POC we let API
 * Gateway's throttle handle the flood-control gate — adding DDB writes
 * to a 1-KB telemetry endpoint would multiply the cost-per-report by
 * ~100x for negligible defense benefit. If a future incident shows
 * targeted log flooding, add the DDB token-bucket then.
 *
 * ---------------------------------------------------------------------------
 * Output
 * ---------------------------------------------------------------------------
 *
 * Successful reports are emitted at WARN level (so CloudWatch error
 * metrics fire on volume regressions) with the structured record:
 *
 *   {
 *     level: 'WARN',
 *     service: 'lfmt-csp-report',
 *     message: 'CSP violation reported',
 *     reportType: 'legacy' | 'reports-api',
 *     violatedDirective: '<directive>',
 *     effectiveDirective?: '<directive>',
 *     blockedUri: '<truncated-uri>',
 *     documentUri: '<truncated-uri>',
 *     sourceFile?: '<truncated-uri>',
 *     lineNumber?: <number>,
 *     columnNumber?: <number>,
 *     statusCode?: <number>,
 *     disposition?: 'enforce' | 'report'
 *   }
 *
 * CloudWatch metric filter on `violatedDirective` powers the
 * "regression in production" alarm (issue #201 acceptance criterion).
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import Logger from '../shared/logger';

const logger = new Logger('lfmt-csp-report');

/**
 * Hard cap on accepted request bodies. Reporting API spec recommends
 * ~16 KB per report; we allow 4x for batched submissions. Anything
 * larger is dropped to bound CloudWatch ingest.
 */
const MAX_BODY_BYTES = 64 * 1024;

/**
 * Hard cap on individual string fields after parse. URLs/paths in CSP
 * reports SHOULD be <2 KB; truncating defends against an attacker who
 * forges an absurdly long `blocked-uri` to bloat CloudWatch.
 */
const MAX_FIELD_CHARS = 2048;

/** Allowed Content-Type values for incoming reports. Matches RFC + WHATWG. */
const ALLOWED_CONTENT_TYPES = ['application/csp-report', 'application/reports+json'] as const;

/** Allowed disposition values for the structured log record. */
const ALLOWED_DISPOSITIONS = ['enforce', 'report'] as const;

/** Structured shape of a single, sanitized violation record. */
export interface SanitizedCspReport {
  reportType: 'legacy' | 'reports-api';
  violatedDirective: string;
  effectiveDirective?: string;
  blockedUri?: string;
  documentUri?: string;
  sourceFile?: string;
  lineNumber?: number;
  columnNumber?: number;
  statusCode?: number;
  disposition?: 'enforce' | 'report';
}

/**
 * Truncate an arbitrary input to a safe string. Returns `undefined` if
 * the input is not a non-empty string after coercion — callers use that
 * to detect "field absent" vs "field present but invalid".
 */
function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.length === 0) return undefined;
  return value.length > MAX_FIELD_CHARS ? value.slice(0, MAX_FIELD_CHARS) : value;
}

/** Coerce an unknown value to a finite, non-negative integer or `undefined`. */
function safeNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  // Floor to integer — line/column numbers are integral by definition.
  return Math.floor(value);
}

/** Coerce a disposition string to the allowlist, or `undefined`. */
function safeDisposition(value: unknown): 'enforce' | 'report' | undefined {
  if (typeof value !== 'string') return undefined;
  return (ALLOWED_DISPOSITIONS as readonly string[]).includes(value)
    ? (value as 'enforce' | 'report')
    : undefined;
}

/**
 * Parse a legacy `application/csp-report` body. The browser POSTs:
 *   { "csp-report": { ... } }
 *
 * Returns the sanitized record or `null` if the payload is malformed
 * (missing the wrapper, missing required `violated-directive`, etc.).
 *
 * Exported for unit testing.
 */
export function parseLegacyReport(payload: unknown): SanitizedCspReport | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const wrapper = (payload as Record<string, unknown>)['csp-report'];
  if (typeof wrapper !== 'object' || wrapper === null) return null;
  const r = wrapper as Record<string, unknown>;

  // `violated-directive` is required by the legacy spec. Drop reports
  // that omit it — they're either malformed or hostile noise.
  const violatedDirective = safeString(r['violated-directive']);
  if (!violatedDirective) return null;

  return {
    reportType: 'legacy',
    violatedDirective,
    effectiveDirective: safeString(r['effective-directive']),
    blockedUri: safeString(r['blocked-uri']),
    documentUri: safeString(r['document-uri']),
    sourceFile: safeString(r['source-file']),
    lineNumber: safeNonNegativeInt(r['line-number']),
    columnNumber: safeNonNegativeInt(r['column-number']),
    statusCode: safeNonNegativeInt(r['status-code']),
    disposition: safeDisposition(r['disposition']),
  };
}

/**
 * Parse a Reporting API `application/reports+json` body. The browser POSTs:
 *   [ { "type": "csp-violation", "body": { ... }, "url": "...", "age": N }, ... ]
 *
 * Returns the array of sanitized records. Non-CSP report types and
 * malformed entries are silently dropped (an honest browser may batch
 * a Network-Error-Report alongside the CSP one).
 *
 * Exported for unit testing.
 */
export function parseReportsApiBody(payload: unknown): SanitizedCspReport[] {
  if (!Array.isArray(payload)) return [];
  const out: SanitizedCspReport[] = [];
  for (const entry of payload) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== 'csp-violation') continue;
    const body = e.body;
    if (typeof body !== 'object' || body === null) continue;
    const b = body as Record<string, unknown>;

    // Reporting API uses camelCase (vs legacy kebab-case). The field
    // `effectiveDirective` is REQUIRED per the W3C CSP3 Reporting
    // spec; we still tolerate `violatedDirective` as a fallback for
    // browsers that emit the older field name.
    const directive = safeString(b['effectiveDirective']) ?? safeString(b['violatedDirective']);
    if (!directive) continue;

    out.push({
      reportType: 'reports-api',
      violatedDirective: directive,
      effectiveDirective: safeString(b['effectiveDirective']),
      blockedUri: safeString(b['blockedURL'] ?? b['blockedUri']),
      documentUri: safeString(b['documentURL'] ?? b['documentUri']),
      sourceFile: safeString(b['sourceFile']),
      lineNumber: safeNonNegativeInt(b['lineNumber']),
      columnNumber: safeNonNegativeInt(b['columnNumber']),
      statusCode: safeNonNegativeInt(b['statusCode']),
      disposition: safeDisposition(b['disposition']),
    });
  }
  return out;
}

/**
 * Normalize the request's Content-Type header, dropping any `;charset=...`
 * or `;boundary=...` parameters and lowercasing the result so the
 * allowlist comparison is deterministic.
 *
 * Exported for unit testing.
 */
export function normalizeContentType(raw: string | undefined): string {
  if (typeof raw !== 'string') return '';
  const semi = raw.indexOf(';');
  const base = semi >= 0 ? raw.slice(0, semi) : raw;
  return base.trim().toLowerCase();
}

/** Empty 204 — no body, no CORS credentials (anonymous endpoint). */
function noContent(): APIGatewayProxyResult {
  return {
    statusCode: 204,
    // Browsers don't read the response, but we still include the minimal
    // CORS allowance so a same-origin XHR test from the SPA succeeds.
    // No `Access-Control-Allow-Credentials` because the endpoint is
    // unauthenticated (sending credentials would be a meaningless ask).
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      // Cache the preflight response for 10 minutes to avoid an OPTIONS
      // per violation report.
      'Access-Control-Max-Age': '600',
    },
    body: '',
  };
}

/** Generic 400 — never include payload details (anti-fingerprinting). */
function badRequest(): APIGatewayProxyResult {
  return {
    statusCode: 400,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ message: 'Bad Request' }),
  };
}

/**
 * Lambda handler — entry point for POST /csp-report.
 *
 * On any error (parse failure, oversized body, unsupported content type)
 * we return 400 with NO logging. CSP reports are anonymous, so logging
 * every malformed POST would let an attacker fill CloudWatch with noise.
 * Successful reports log at WARN level (one entry per sanitized record).
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // CORS preflight — answered without parsing, no logging.
  if (event.httpMethod === 'OPTIONS') {
    return noContent();
  }
  if (event.httpMethod !== 'POST') {
    return badRequest();
  }

  // Content-Type allowlist BEFORE parse. Reject any body whose
  // declared type is outside the allowlist — protects us from
  // accidentally accepting form-encoded or HTML payloads.
  const contentType = normalizeContentType(
    event.headers['Content-Type'] || event.headers['content-type']
  );
  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    return badRequest();
  }

  // Body presence + size cap. The Lambda runtime delivers the body as
  // a UTF-8 string (or base64 when `isBase64Encoded`); we reject both
  // empty and oversized payloads silently.
  const rawBody = event.body;
  if (typeof rawBody !== 'string' || rawBody.length === 0) {
    return badRequest();
  }
  // `length` is char count, not byte count — for ASCII-heavy payloads
  // (CSP reports usually are) the two are equivalent. Use Buffer for
  // an accurate byte count on multibyte input, but fall back to the
  // string length when Buffer isn't available (unit tests).
  const byteLength =
    typeof Buffer !== 'undefined' ? Buffer.byteLength(rawBody, 'utf8') : rawBody.length;
  if (byteLength > MAX_BODY_BYTES) {
    return badRequest();
  }

  // Parse JSON. A failure here = malformed body = 400 no-log.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return badRequest();
  }

  // Dispatch by content type. Each parser returns `null` / `[]` on
  // any internal anomaly so the outer code can always reduce to a
  // simple "did we produce ANY records?" check.
  const records: SanitizedCspReport[] =
    contentType === 'application/csp-report'
      ? ((): SanitizedCspReport[] => {
          const one = parseLegacyReport(parsed);
          return one ? [one] : [];
        })()
      : parseReportsApiBody(parsed);

  if (records.length === 0) {
    // Malformed report (missing required directive, wrong shape, etc.).
    // Return 400 without logging — anonymous endpoints that log every
    // malformed POST are a log-flood vector.
    return badRequest();
  }

  // Emit one structured log record per violation. WARN level so the
  // CloudWatch alarm pattern (`level=WARN service=lfmt-csp-report`)
  // catches volume spikes; metric filters can further select by
  // `violatedDirective` for per-directive alarms (issue #201 AC).
  for (const r of records) {
    logger.warn('CSP violation reported', {
      reportType: r.reportType,
      violatedDirective: r.violatedDirective,
      ...(r.effectiveDirective ? { effectiveDirective: r.effectiveDirective } : {}),
      ...(r.blockedUri ? { blockedUri: r.blockedUri } : {}),
      ...(r.documentUri ? { documentUri: r.documentUri } : {}),
      ...(r.sourceFile ? { sourceFile: r.sourceFile } : {}),
      ...(r.lineNumber !== undefined ? { lineNumber: r.lineNumber } : {}),
      ...(r.columnNumber !== undefined ? { columnNumber: r.columnNumber } : {}),
      ...(r.statusCode !== undefined ? { statusCode: r.statusCode } : {}),
      ...(r.disposition ? { disposition: r.disposition } : {}),
    });
  }

  return noContent();
};
