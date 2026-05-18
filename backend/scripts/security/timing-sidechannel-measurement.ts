/**
 * Timing Side-Channel Measurement — issue #288
 *
 * Purpose
 * -------
 * After PR #287 collapsed the not-found and not-owned response branches on the
 * five ownership-checked endpoints into a single privacy-preserving 404, a
 * timing side-channel residual remains: do those two cases take observably
 * different amounts of wall-clock time? If so, a patient attacker could
 * statistically distinguish them and recover the existence signal that
 * PR #287 closed off at the response level.
 *
 * This script runs an empirical measurement and reports descriptive
 * statistics plus a Welch's t-test p-value comparing the two distributions
 * (not-found vs. not-owned). It is the canonical measurement methodology
 * documented in `docs/cdk-best-practices.md` →
 * "Timing side-channel — measurement methodology and results (post-#287)".
 *
 * The script is committed but NOT run automatically. The analytical
 * conclusion in the doc is sufficient for the wontfix decision in v1; this
 * script exists so a future engineer (or the same engineer at the point real
 * users exist) can re-measure under their own access pattern, environment,
 * and statistical-power requirements without re-deriving the methodology.
 *
 * Endpoints under test (post-#287 composite-key shape; see #286 audit table)
 * --------------------------------------------------------------------------
 *   POST   /jobs/{jobId}/translate              startTranslation.ts
 *   GET    /jobs/{jobId}                        getJob.ts
 *   GET    /jobs/{jobId}/translation-status     getTranslationStatus.ts
 *   GET    /jobs/{jobId}/download               downloadTranslation.ts
 *   DELETE /jobs/{jobId}                        deleteJob.ts
 *
 * Methodology
 * -----------
 * For a single endpoint:
 *   1. Group A — "not found": request a freshly-generated random UUID that
 *      cannot collide with any existing job in either user's namespace.
 *      DDB GetItem returns no item; the handler emits 404.
 *   2. Group B — "not owned": request a jobId that DOES exist but belongs to
 *      a different user. DDB GetItem with the caller's userId on the composite
 *      key also returns no item; the handler emits the identical 404.
 *   3. Each group: N samples (default 200) of `performance.now()` deltas
 *      around the HTTPS request. Samples are interleaved (A,B,A,B,...) to
 *      cancel out warm/cold-Lambda drift across the run.
 *   4. Discard the first MIN(10, N/10) samples per group as Lambda-warmup
 *      noise.
 *   5. Compute median, mean, std-dev, p99, IQR for each group.
 *   6. Compute Welch's t-test p-value comparing the two means (robust to
 *      unequal variance). Report whether |median_A − median_B| ≥ 1 ms — that
 *      is the threshold from the issue #288 acceptance criteria above which
 *      we would consider implementing Option A (constant-time floor).
 *
 * Auth & Setup
 * ------------
 * The script needs:
 *   - An API base URL (defaults to dev: lfmt-poc API Gateway from CLAUDE.md).
 *   - A valid Cognito ID token for the calling user (the not-owned target's
 *     OTHER user). Acquire via your normal login flow; pass via the
 *     LFMT_AUTH_TOKEN env var.
 *   - A pre-existing jobId owned by some OTHER user (a different Cognito sub
 *     than the auth token belongs to). Pass via the LFMT_NOT_OWNED_JOB_ID env
 *     var. The "not-owned" measurement relies on this id resolving to a real
 *     row in DynamoDB so the GetItem hits the storage layer the same way a
 *     real cross-ownership probe would.
 *
 * The script does NOT modify any data. The 5 endpoints under test are all
 * read-only in the not-found / not-owned case: the 404 short-circuits BEFORE
 * any state mutation. (DELETE is read-only-on-failure because the
 * ConditionExpression rejects the write.) Re-running is safe.
 *
 * Usage
 * -----
 *   # Smoke-mode (no auth required; runs only an unauthenticated 401 baseline
 *   # to confirm the script + network plumbing works):
 *   npx ts-node backend/scripts/security/timing-sidechannel-measurement.ts \
 *     --endpoint=getJob --samples=50 --smoke
 *
 *   # Full empirical measurement (requires valid auth + not-owned jobId):
 *   LFMT_AUTH_TOKEN=eyJ... \
 *   LFMT_NOT_OWNED_JOB_ID=11111111-2222-3333-4444-555555555555 \
 *   npx ts-node backend/scripts/security/timing-sidechannel-measurement.ts \
 *     --endpoint=getJob --samples=200
 *
 *   # All five endpoints:
 *   LFMT_AUTH_TOKEN=eyJ... \
 *   LFMT_NOT_OWNED_JOB_ID=11111111-2222-3333-4444-555555555555 \
 *   npx ts-node backend/scripts/security/timing-sidechannel-measurement.ts \
 *     --endpoint=all --samples=200
 *
 * CLI flags
 * ---------
 *   --api-url=<url>           API base URL (default: dev API from CLAUDE.md)
 *   --endpoint=<name>         getJob | getTranslationStatus | downloadTranslation
 *                             | startTranslation | deleteJob | all
 *   --samples=<int>           Sample count per group (default: 200, min: 30)
 *   --smoke                   Don't require auth; only run a connectivity check
 *   --json                    Emit a single JSON report at end of run
 *   --help                    Show this header
 *
 * Out-of-scope
 * ------------
 *   - This script measures wall-clock time as observed by the caller. That
 *     includes network jitter, TLS handshake, API Gateway routing, Lambda
 *     warm-execution, and DDB GetItem. We are NOT trying to isolate the DDB
 *     internal cache layer — the question we are answering is the
 *     attacker-visible signal, which is the wall-clock observation.
 *   - This script does not authenticate / provision the not-owned job. The
 *     operator is expected to have a populated dev environment.
 */

import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface Args {
  apiUrl: string;
  endpoint: EndpointName | 'all';
  samples: number;
  smoke: boolean;
  json: boolean;
  help: boolean;
}

type EndpointName =
  | 'getJob'
  | 'getTranslationStatus'
  | 'downloadTranslation'
  | 'startTranslation'
  | 'deleteJob';

const DEFAULT_API_URL = 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1';

function parseArgs(argv: string[]): Args {
  const args: Args = {
    apiUrl: DEFAULT_API_URL,
    endpoint: 'getJob',
    samples: 200,
    smoke: false,
    json: false,
    help: false,
  };

  for (const a of argv) {
    if (a === '--help' || a === '-h') {
      args.help = true;
    } else if (a === '--smoke') {
      args.smoke = true;
    } else if (a === '--json') {
      args.json = true;
    } else if (a.startsWith('--api-url=')) {
      args.apiUrl = a.slice('--api-url='.length);
    } else if (a.startsWith('--endpoint=')) {
      const ep = a.slice('--endpoint='.length);
      if (
        ep === 'getJob' ||
        ep === 'getTranslationStatus' ||
        ep === 'downloadTranslation' ||
        ep === 'startTranslation' ||
        ep === 'deleteJob' ||
        ep === 'all'
      ) {
        args.endpoint = ep;
      } else {
        throw new Error(`Unknown endpoint: ${ep}`);
      }
    } else if (a.startsWith('--samples=')) {
      const n = parseInt(a.slice('--samples='.length), 10);
      if (Number.isNaN(n) || n < 30) {
        throw new Error('--samples must be an integer >= 30');
      }
      args.samples = n;
    }
  }

  return args;
}

// ---------------------------------------------------------------------------
// Endpoint definitions
// ---------------------------------------------------------------------------

interface EndpointSpec {
  name: EndpointName;
  method: 'GET' | 'POST' | 'DELETE';
  /** Path template — `{jobId}` placeholder is substituted at request time. */
  pathTemplate: string;
  /** JSON body builder (POST only). Returns undefined for GET / DELETE. */
  buildBody?: () => unknown;
}

const ENDPOINTS: Record<EndpointName, EndpointSpec> = {
  getJob: {
    name: 'getJob',
    method: 'GET',
    pathTemplate: '/jobs/{jobId}',
  },
  getTranslationStatus: {
    name: 'getTranslationStatus',
    method: 'GET',
    pathTemplate: '/jobs/{jobId}/translation-status',
  },
  downloadTranslation: {
    name: 'downloadTranslation',
    method: 'GET',
    pathTemplate: '/jobs/{jobId}/download',
  },
  startTranslation: {
    name: 'startTranslation',
    method: 'POST',
    pathTemplate: '/jobs/{jobId}/translate',
    // Minimal valid body — handler should reach the loadJob branch BEFORE
    // body-validation matters for not-found / not-owned cases (it does in
    // post-#287 code), but we send a valid body to be safe.
    buildBody: () => ({ targetLanguage: 'es' }),
  },
  deleteJob: {
    name: 'deleteJob',
    method: 'DELETE',
    pathTemplate: '/jobs/{jobId}',
  },
};

// ---------------------------------------------------------------------------
// Sample collection
// ---------------------------------------------------------------------------

interface Sample {
  group: 'not-found' | 'not-owned';
  durationMs: number;
  status: number;
  /** Best-effort body fingerprint (length-only — we never log job ids). */
  bodyLength: number;
}

async function timedRequest(
  apiUrl: string,
  spec: EndpointSpec,
  jobId: string,
  authToken: string | undefined
): Promise<{ durationMs: number; status: number; bodyLength: number }> {
  const url = apiUrl + spec.pathTemplate.replace('{jobId}', jobId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const init: RequestInit = {
    method: spec.method,
    headers,
  };

  if (spec.buildBody) {
    init.body = JSON.stringify(spec.buildBody());
  }

  const start = performance.now();
  const response = await fetch(url, init);
  const text = await response.text();
  const end = performance.now();

  return {
    durationMs: end - start,
    status: response.status,
    bodyLength: text.length,
  };
}

async function collectSamples(
  apiUrl: string,
  spec: EndpointSpec,
  authToken: string | undefined,
  notOwnedJobId: string,
  samples: number
): Promise<Sample[]> {
  const out: Sample[] = [];

  // Interleave the two groups so any drift across the run (warm-up,
  // network conditions, neighbor noise) affects both groups equally.
  for (let i = 0; i < samples; i++) {
    // Not-found: fresh UUID per request. Guaranteed not to collide.
    const notFoundId = randomUUID();
    const a = await timedRequest(apiUrl, spec, notFoundId, authToken);
    out.push({
      group: 'not-found',
      durationMs: a.durationMs,
      status: a.status,
      bodyLength: a.bodyLength,
    });

    // Not-owned: a real jobId that belongs to a different user. DDB GetItem
    // with this caller's composite key returns no item → identical 404.
    const b = await timedRequest(apiUrl, spec, notOwnedJobId, authToken);
    out.push({
      group: 'not-owned',
      durationMs: b.durationMs,
      status: b.status,
      bodyLength: b.bodyLength,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

interface GroupStats {
  group: 'not-found' | 'not-owned';
  n: number;
  mean: number;
  median: number;
  stdDev: number;
  p99: number;
  iqr: number;
  /** Distribution of HTTP status codes returned in this group. */
  statusDistribution: Record<number, number>;
  /** Distribution of response-body lengths (sanity check: should be ~uniform). */
  bodyLengthDistribution: { min: number; max: number; median: number };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarize(samples: Sample[], group: 'not-found' | 'not-owned'): GroupStats {
  const inGroup = samples.filter((s) => s.group === group);
  // Discard the first MIN(10, N/10) samples per group as warmup noise.
  const warmupDiscard = Math.min(10, Math.floor(inGroup.length / 10));
  const usable = inGroup.slice(warmupDiscard);

  const durations = usable.map((s) => s.durationMs).sort((a, b) => a - b);
  const n = durations.length;
  const sum = durations.reduce((acc, x) => acc + x, 0);
  const mean = sum / Math.max(1, n);
  const variance = durations.reduce((acc, x) => acc + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const stdDev = Math.sqrt(variance);
  const median = quantile(durations, 0.5);
  const p99 = quantile(durations, 0.99);
  const iqr = quantile(durations, 0.75) - quantile(durations, 0.25);

  const statusDistribution: Record<number, number> = {};
  for (const s of usable) {
    statusDistribution[s.status] = (statusDistribution[s.status] ?? 0) + 1;
  }

  const lens = usable.map((s) => s.bodyLength).sort((a, b) => a - b);
  const bodyLengthDistribution = {
    min: lens[0] ?? 0,
    max: lens[lens.length - 1] ?? 0,
    median: quantile(lens, 0.5),
  };

  return {
    group,
    n,
    mean,
    median,
    stdDev,
    p99,
    iqr,
    statusDistribution,
    bodyLengthDistribution,
  };
}

/**
 * Welch's t-test for unequal variances. Returns the two-sided p-value
 * (approximated via the normal distribution for large N — we expect N ≥ 30
 * per group, which is the documented adequacy threshold for the normal
 * approximation in this context).
 *
 * Null hypothesis: the two groups have the same population mean.
 * Reject (i.e., p < 0.05) → the two means are statistically distinguishable.
 *
 * This is a deliberate simplification: a research-grade analysis would use
 * the t-distribution with Welch-Satterthwaite degrees of freedom, or a
 * non-parametric Mann-Whitney U / Kolmogorov-Smirnov test (the latter is
 * more robust to non-normal latency distributions). For the present
 * "is the gap exploitable?" question, the normal approximation is sufficient
 * — if the result is borderline (0.01 < p < 0.10), the operator should
 * re-run with a larger N or switch to a non-parametric test. See the
 * `Methodology — limitations` note at the top of this file.
 */
function welchsTTestPValue(a: GroupStats, b: GroupStats): number {
  const se = Math.sqrt(a.stdDev ** 2 / a.n + b.stdDev ** 2 / b.n);
  if (se === 0 || !isFinite(se)) return 1;
  const z = (a.mean - b.mean) / se;
  // Two-sided normal-tail probability — small p means the means are different.
  // Use the complementary error function for numerical stability.
  return erfc(Math.abs(z) / Math.sqrt(2));
}

/** Numerically-stable complementary error function (Abramowitz & Stegun 7.1.26). */
function erfc(x: number): number {
  // For x < 0 we return 2 - erfc(-x), but |z| above is always ≥ 0.
  const t = 1.0 / (1.0 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const y = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return y;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface EndpointReport {
  endpoint: EndpointName;
  samplesRequested: number;
  notFound: GroupStats;
  notOwned: GroupStats;
  pValue: number;
  medianGapMs: number;
  /** True if the gap is significant AND >= 1 ms (the issue #288 threshold). */
  exploitable: boolean;
  notes: string[];
}

function buildReport(
  endpoint: EndpointName,
  samplesRequested: number,
  all: Sample[]
): EndpointReport {
  const notFound = summarize(all, 'not-found');
  const notOwned = summarize(all, 'not-owned');
  const pValue = welchsTTestPValue(notFound, notOwned);
  const medianGapMs = notOwned.median - notFound.median;
  const exploitable = pValue < 0.05 && Math.abs(medianGapMs) >= 1;

  const notes: string[] = [];
  if (notFound.bodyLengthDistribution.min !== notFound.bodyLengthDistribution.max) {
    notes.push(
      'Not-found response bodies varied in length — investigate (only requestId UUID should differ).'
    );
  }
  if (notOwned.bodyLengthDistribution.min !== notOwned.bodyLengthDistribution.max) {
    notes.push(
      'Not-owned response bodies varied in length — investigate (only requestId UUID should differ).'
    );
  }
  if (notFound.bodyLengthDistribution.median !== notOwned.bodyLengthDistribution.median) {
    notes.push(
      `Median body lengths differ across groups (${notFound.bodyLengthDistribution.median} vs ${notOwned.bodyLengthDistribution.median}) — this would be a privacy-relevant byte-length leak independent of timing.`
    );
  }
  const hasUnexpectedStatus = [
    ...Object.keys(notFound.statusDistribution),
    ...Object.keys(notOwned.statusDistribution),
  ].some((s) => s !== '404');
  if (hasUnexpectedStatus) {
    notes.push(
      'Some samples returned a status other than 404 — likely auth or rate-limit issues; re-run after fixing.'
    );
  }

  return {
    endpoint,
    samplesRequested,
    notFound,
    notOwned,
    pValue,
    medianGapMs,
    exploitable,
    notes,
  };
}

function printReport(r: EndpointReport, asJson: boolean): void {
  if (asJson) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`\n=== ${r.endpoint} ===`);
  // eslint-disable-next-line no-console
  console.log(`Samples requested per group: ${r.samplesRequested}`);
  // eslint-disable-next-line no-console
  console.log(`Usable after warmup discard:  not-found=${r.notFound.n}  not-owned=${r.notOwned.n}`);
  // eslint-disable-next-line no-console
  console.log('Group        mean (ms)    median (ms)   stddev (ms)   p99 (ms)    iqr (ms)');
  for (const g of [r.notFound, r.notOwned]) {
    // eslint-disable-next-line no-console
    console.log(
      `${g.group.padEnd(12)} ${g.mean.toFixed(2).padStart(10)}   ${g.median
        .toFixed(2)
        .padStart(10)}   ${g.stdDev.toFixed(2).padStart(10)}   ${g.p99
        .toFixed(2)
        .padStart(8)}   ${g.iqr.toFixed(2).padStart(8)}`
    );
  }
  // eslint-disable-next-line no-console
  console.log(`Median gap (not-owned − not-found): ${r.medianGapMs.toFixed(2)} ms`);
  // eslint-disable-next-line no-console
  console.log(`Welch's t-test p-value:             ${r.pValue.toExponential(2)}`);
  // eslint-disable-next-line no-console
  console.log(
    `Conclusion: ${
      r.exploitable
        ? 'EXPLOITABLE — gap ≥ 1 ms AND p < 0.05 — escalate to issue #288 Option A.'
        : 'NOT exploitable at this sample size — gap dominated by jitter.'
    }`
  );
  if (r.notes.length > 0) {
    // eslint-disable-next-line no-console
    console.log('Notes:');
    for (const n of r.notes) {
      // eslint-disable-next-line no-console
      console.log(`  - ${n}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(
      'See header comment in backend/scripts/security/timing-sidechannel-measurement.ts for full usage.'
    );
    return;
  }

  const authToken = process.env.LFMT_AUTH_TOKEN;
  const notOwnedJobId = process.env.LFMT_NOT_OWNED_JOB_ID;

  if (args.smoke) {
    // eslint-disable-next-line no-console
    console.log('Smoke mode — sending one unauthenticated request to confirm plumbing.');
    const spec = ENDPOINTS.getJob;
    const r = await timedRequest(args.apiUrl, spec, randomUUID(), undefined);
    // eslint-disable-next-line no-console
    console.log(
      `status=${r.status}  durationMs=${r.durationMs.toFixed(2)}  bodyLength=${r.bodyLength}`
    );
    // eslint-disable-next-line no-console
    console.log(
      r.status === 401
        ? 'OK — 401 confirms the API is reachable and authentication is enforced.'
        : `Unexpected status ${r.status}; investigate before running the full measurement.`
    );
    return;
  }

  if (!authToken || !notOwnedJobId) {
    // eslint-disable-next-line no-console
    console.error(
      'Missing required env vars. Set LFMT_AUTH_TOKEN and LFMT_NOT_OWNED_JOB_ID. ' +
        'See header comment for setup details.'
    );
    process.exit(2);
  }

  const targets: EndpointName[] =
    args.endpoint === 'all'
      ? (
          [
            'getJob',
            'getTranslationStatus',
            'downloadTranslation',
            'startTranslation',
            'deleteJob',
          ] as const
        ).slice()
      : [args.endpoint];

  const reports: EndpointReport[] = [];

  for (const ep of targets) {
    const spec = ENDPOINTS[ep];
    // eslint-disable-next-line no-console
    console.error(`Collecting ${args.samples * 2} samples for ${ep} ...`);
    const all = await collectSamples(args.apiUrl, spec, authToken, notOwnedJobId, args.samples);
    const r = buildReport(ep, args.samples, all);
    reports.push(r);
    printReport(r, args.json);
  }

  if (args.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ reports }, null, 2));
  }

  const anyExploitable = reports.some((r) => r.exploitable);
  process.exit(anyExploitable ? 1 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal:', err instanceof Error ? err.stack || err.message : err);
  process.exit(2);
});
