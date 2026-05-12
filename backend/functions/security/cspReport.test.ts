/**
 * Unit tests for the CSP Violation Report collector (#201).
 *
 * Covers:
 *   1. Method/content-type/size gates (return 400 without parsing).
 *   2. Legacy `application/csp-report` parse path — required fields,
 *      field truncation, integer coercion, disposition allowlist.
 *   3. Reporting API `application/reports+json` parse path — batched
 *      reports, non-CSP entries dropped, camelCase field names.
 *   4. Anti-log-poisoning — extra fields in payload are NOT forwarded.
 *   5. CORS preflight returns 204 without invoking the parser.
 */

import type { APIGatewayProxyEvent } from 'aws-lambda';
import {
  handler,
  parseLegacyReport,
  parseReportsApiBody,
  normalizeContentType,
  type SanitizedCspReport,
} from './cspReport';

/** Build a minimal API Gateway event for POST /csp-report. */
function buildEvent(opts: {
  method?: string;
  contentType?: string | undefined;
  body?: string | null;
}): APIGatewayProxyEvent {
  return {
    httpMethod: opts.method ?? 'POST',
    headers: opts.contentType !== undefined ? { 'Content-Type': opts.contentType } : {},
    body: opts.body ?? null,
    path: '/csp-report',
    isBase64Encoded: false,
    multiValueHeaders: {},
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      requestId: 'test-req',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    resource: '/csp-report',
  };
}

describe('cspReport — normalizeContentType', () => {
  it('lowercases and strips parameters', () => {
    expect(normalizeContentType('Application/CSP-Report; charset=utf-8')).toBe(
      'application/csp-report'
    );
    expect(normalizeContentType('application/reports+json')).toBe(
      'application/reports+json'
    );
  });

  it('returns empty string on non-string input', () => {
    expect(normalizeContentType(undefined)).toBe('');
  });
});

describe('cspReport — parseLegacyReport', () => {
  it('extracts required and optional fields', () => {
    const payload = {
      'csp-report': {
        'violated-directive': "script-src 'self'",
        'effective-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/x.js',
        'document-uri': 'https://app.lfmt.example.com/dashboard',
        'source-file': 'https://app.lfmt.example.com/main.js',
        'line-number': 42,
        'column-number': 17,
        'status-code': 200,
        disposition: 'enforce',
      },
    };
    const r = parseLegacyReport(payload);
    expect(r).not.toBeNull();
    expect(r!.reportType).toBe('legacy');
    expect(r!.violatedDirective).toBe("script-src 'self'");
    expect(r!.effectiveDirective).toBe('script-src');
    expect(r!.blockedUri).toBe('https://evil.example.com/x.js');
    expect(r!.lineNumber).toBe(42);
    expect(r!.disposition).toBe('enforce');
  });

  it('returns null when violated-directive is missing (REQUIRED)', () => {
    expect(parseLegacyReport({ 'csp-report': {} })).toBeNull();
    expect(parseLegacyReport({ 'csp-report': { 'blocked-uri': 'x' } })).toBeNull();
  });

  it('returns null when wrapper is missing', () => {
    expect(parseLegacyReport({})).toBeNull();
    expect(parseLegacyReport(null)).toBeNull();
    expect(parseLegacyReport('string')).toBeNull();
  });

  it('truncates field strings to MAX_FIELD_CHARS', () => {
    const longUri = 'https://x.com/' + 'a'.repeat(5000);
    const r = parseLegacyReport({
      'csp-report': {
        'violated-directive': "script-src 'self'",
        'blocked-uri': longUri,
      },
    });
    expect(r!.blockedUri!.length).toBe(2048);
  });

  it('drops unknown fields silently (anti-log-poisoning)', () => {
    const r = parseLegacyReport({
      'csp-report': {
        'violated-directive': "script-src 'self'",
        // Attacker forges `userId` / `level` / `service` to confuse log analysis.
        userId: 'admin',
        level: 'INFO',
        service: 'lfmt-not-this',
        // Attacker tries to inject extra-large field that isn't on the allowlist.
        extraNoise: 'x'.repeat(10_000),
      },
    });
    expect(r).not.toBeNull();
    expect(r).not.toHaveProperty('userId');
    expect(r).not.toHaveProperty('level');
    expect(r).not.toHaveProperty('service');
    expect(r).not.toHaveProperty('extraNoise');
  });

  it('coerces integer fields safely (drops NaN/negative/non-numbers)', () => {
    const r = parseLegacyReport({
      'csp-report': {
        'violated-directive': "script-src 'self'",
        'line-number': 'not a number',
        'column-number': -5,
        'status-code': Number.NaN,
      },
    });
    expect(r!.lineNumber).toBeUndefined();
    expect(r!.columnNumber).toBeUndefined();
    expect(r!.statusCode).toBeUndefined();
  });

  it('rejects disposition values outside the allowlist', () => {
    const r = parseLegacyReport({
      'csp-report': {
        'violated-directive': "script-src 'self'",
        disposition: 'malicious-mode',
      },
    });
    expect(r!.disposition).toBeUndefined();
  });
});

describe('cspReport — parseReportsApiBody', () => {
  it('parses a single csp-violation entry (camelCase field names)', () => {
    const payload = [
      {
        type: 'csp-violation',
        url: 'https://app.lfmt.example.com/dashboard',
        age: 0,
        body: {
          effectiveDirective: 'script-src',
          blockedURL: 'https://evil.example.com/x.js',
          documentURL: 'https://app.lfmt.example.com/dashboard',
          sourceFile: 'https://app.lfmt.example.com/main.js',
          lineNumber: 42,
          columnNumber: 17,
          statusCode: 200,
          disposition: 'enforce',
        },
      },
    ];
    const out = parseReportsApiBody(payload);
    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r.reportType).toBe('reports-api');
    expect(r.violatedDirective).toBe('script-src');
    expect(r.blockedUri).toBe('https://evil.example.com/x.js');
    expect(r.documentUri).toBe('https://app.lfmt.example.com/dashboard');
  });

  it('drops non-csp-violation entries silently (e.g. network-error)', () => {
    const payload = [
      {
        type: 'network-error',
        body: { phase: 'connection' },
      },
      {
        type: 'csp-violation',
        body: { effectiveDirective: 'script-src' },
      },
    ];
    const out = parseReportsApiBody(payload);
    expect(out).toHaveLength(1);
    expect(out[0].violatedDirective).toBe('script-src');
  });

  it('returns empty array on non-array input', () => {
    expect(parseReportsApiBody({})).toEqual([]);
    expect(parseReportsApiBody(null)).toEqual([]);
    expect(parseReportsApiBody('string')).toEqual([]);
  });

  it('drops entries with missing directive (REQUIRED)', () => {
    const out = parseReportsApiBody([{ type: 'csp-violation', body: {} }]);
    expect(out).toEqual([]);
  });
});

describe('cspReport — handler (HTTP gates)', () => {
  it('returns 204 for OPTIONS preflight without invoking the parser', async () => {
    const event = buildEvent({ method: 'OPTIONS' });
    const res = await handler(event);
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    // Preflight headers should be set so the browser can cache.
    expect(res.headers!['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers!['Access-Control-Allow-Methods']).toContain('POST');
  });

  it('rejects non-POST methods', async () => {
    const event = buildEvent({ method: 'GET' });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('rejects unsupported content types (no parse attempted)', async () => {
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/json',
      body: '{"csp-report":{"violated-directive":"script-src \'self\'"}}',
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('rejects oversized bodies (>64 KB)', async () => {
    // Build a payload that exceeds 64 KB. The directive itself is valid;
    // the gate is purely on size so we don't burn parse time on a flood.
    const huge = 'x'.repeat(70 * 1024);
    const body = JSON.stringify({
      'csp-report': {
        'violated-directive': "script-src 'self'",
        'blocked-uri': huge,
      },
    });
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/csp-report',
      body,
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty bodies', async () => {
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/csp-report',
      body: '',
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('rejects malformed JSON', async () => {
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/csp-report',
      body: '{not valid json',
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });
});

describe('cspReport — handler (success paths)', () => {
  // Capture console.error since the logger writes WARN/ERROR to stderr.
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    // eslint-disable-next-line no-console
    warnSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('logs a legacy report at WARN level and returns 204', async () => {
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/csp-report',
      body: JSON.stringify({
        'csp-report': {
          'violated-directive': "script-src 'self'",
          'blocked-uri': 'https://evil.example.com/x.js',
          'document-uri': 'https://app.lfmt.example.com/dashboard',
        },
      }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(204);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.level).toBe('WARN');
    expect(logged.service).toBe('lfmt-csp-report');
    expect(logged.violatedDirective).toBe("script-src 'self'");
    expect(logged.blockedUri).toBe('https://evil.example.com/x.js');
    expect(logged.reportType).toBe('legacy');
  });

  it('logs batched Reporting-API entries (one WARN per record)', async () => {
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/reports+json',
      body: JSON.stringify([
        {
          type: 'csp-violation',
          body: { effectiveDirective: 'script-src', blockedURL: 'https://a' },
        },
        {
          type: 'csp-violation',
          body: { effectiveDirective: 'style-src', blockedURL: 'https://b' },
        },
        // Non-CSP entry — must be dropped, NOT logged.
        {
          type: 'network-error',
          body: { phase: 'connection' },
        },
      ]),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(204);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('returns 400 (no log) when payload contains zero valid reports', async () => {
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/csp-report',
      // Wrapper present but no violated-directive — drop silently.
      body: JSON.stringify({ 'csp-report': { 'blocked-uri': 'https://x' } }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does NOT log forged fields (extra payload keys are stripped before log)', async () => {
    // Attacker tries to forge `userId` / `level` so the log entry looks
    // like it came from a legitimate Lambda. The handler must NOT echo
    // attacker-controlled fields into the structured log record.
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/csp-report',
      body: JSON.stringify({
        'csp-report': {
          'violated-directive': "script-src 'self'",
          userId: 'admin',
          service: 'lfmt-forged-service',
          level: 'INFO',
        },
      }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(204);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.userId).toBeUndefined();
    expect(logged.service).toBe('lfmt-csp-report'); // the REAL service name
    expect(logged.level).toBe('WARN'); // the REAL level
  });

  it('truncates oversized field strings to MAX_FIELD_CHARS before logging', async () => {
    const huge = 'https://x.com/' + 'a'.repeat(5000);
    const event = buildEvent({
      method: 'POST',
      contentType: 'application/csp-report',
      body: JSON.stringify({
        'csp-report': {
          'violated-directive': "script-src 'self'",
          'blocked-uri': huge,
        },
      }),
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(204);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(logged.blockedUri.length).toBe(2048);
  });
});

describe('cspReport — SanitizedCspReport type contract (compile-time)', () => {
  it('reportType is the discriminated literal union', () => {
    const a: SanitizedCspReport = { reportType: 'legacy', violatedDirective: 'x' };
    const b: SanitizedCspReport = {
      reportType: 'reports-api',
      violatedDirective: 'x',
    };
    expect(a.reportType).toBe('legacy');
    expect(b.reportType).toBe('reports-api');
  });
});
