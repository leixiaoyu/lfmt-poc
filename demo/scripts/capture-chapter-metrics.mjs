#!/usr/bin/env node
/**
 * Track B — Free-tier chapter-level demo metrics capture.
 *
 * Walks each fixture in demo/test-documents/chapters through the deployed
 * dev environment (register/login -> upload -> wait for chunking ->
 * start translation -> poll status until COMPLETED) and writes a metrics
 * JSON per chapter under demo/results/.
 *
 * Constraints (free-tier Gemini, do NOT exceed):
 *   - 5 RPM, 250K TPM, 25 RPD
 *   - Realistic chunk count per run at 3,500-token chunk size:
 *       Sherlock ~12 chunks, Pride ~1 chunk, War & Peace ~3 chunks
 *       => ~15-17 Gemini requests per full run (not the 5-7 originally
 *       projected). Still under the 20-of-25 RPD safety rail, but a
 *       same-day re-run after a partial failure could bust 25, so the
 *       script warns at startup if a recent prior run is detected.
 *
 * No backend code changes — pure data capture. The script is intentionally
 * dependency-free (only Node's built-in https/fs/crypto) so it can run
 * straight from a fresh checkout without `npm install`.
 *
 * Prerequisites:
 *   - Node.js >= 18 (uses ESM, node:timers/promises, built-in fetch-style APIs)
 *   - AWS CLI v2 (tested with aws-cli/2.28.21) on PATH with credentials
 *     configured for the dev AWS account. Used for jobId discovery via
 *     DynamoDB Query, S3 chunk download, and DynamoDB read-back fallback.
 *   - Environment variables (mandatory unless noted):
 *       TEST_PASSWORD       — Cognito password for the test account.
 *                             Script fails at startup if unset (R7 — burned
 *                             credentials must not live in source).
 *       LFMT_TEST_EMAIL     — Optional. Defaults to a fresh per-day address.
 *
 * Usage:
 *   TEST_PASSWORD='...' node demo/scripts/capture-chapter-metrics.mjs [chapter-key]
 *   - With no arg: runs all 3 chapters serially (recommended).
 *   - With a key (sherlock|pride|wp): runs just that one.
 */

import { request as httpsRequest } from 'node:https';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const API_HOST = '8brwlwf68h.execute-api.us-east-1.amazonaws.com';
const API_BASE_PATH = '/v1';

// Schema version for emitted metrics JSON. Downstream "replace [TBD] markers"
// PR will pin against this — bump on any breaking change to the JSON shape.
const METRICS_SCHEMA_VERSION = '1.0.0';

// Polling / pause constants (R-suggestion: extract magic numbers).
const POLL_INTERVAL_MS = 5_000;            // status poll cadence (translation phase)
const CHUNKING_POLL_INTERVAL_MS = 1_000;   // chunking is fast — tighter poll
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 min ceiling per chapter
const CHUNKING_MAX_WAIT_MS = 4 * 60 * 1000;  // chunking ceiling
const INTER_CHAPTER_PAUSE_MS = 15_000;     // rate-limiter slack between chapters
const DISCOVER_JOB_ID_RETRY_MS = 2_000;
const DISCOVER_JOB_ID_MAX_ATTEMPTS = 30;
const AWS_CLI_TIMEOUT_MS = 30_000;         // R5 — cap every spawnSync('aws', ...)
const RPD_GUARD_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h same-day RPD warning window

// Terminal status sets (R6 — short-circuit polls instead of running to ceiling).
const CHUNKING_TERMINAL_STATES = new Set(['VALIDATION_FAILED', 'CHUNKING_FAILED']);
const TRANSLATION_TERMINAL_STATES = new Set(['COMPLETED', 'TRANSLATION_FAILED']);

// Fresh test account per the Track B brief. Auto-confirmed in dev env.
const TEST_EMAIL = process.env.LFMT_TEST_EMAIL || 'claude-track-b-2026-04-25@lfmt-poc.dev';
// R7: TEST_PASSWORD MUST come from the environment — the previous literal
// default ('TrackBDemo!2026') was a known-burned credential. We prefer
// TEST_PASSWORD but accept the legacy LFMT_TEST_PASSWORD name during the
// transition. Failing-fast at startup avoids running with a burned default.
const TEST_PASSWORD = process.env.TEST_PASSWORD || process.env.LFMT_TEST_PASSWORD;
// NOTE: enforcement happens in main() so importing this module for unit tests
// (which exercises pure functions like countWords / pickSampleIndices) does
// NOT require setting TEST_PASSWORD.
function assertTestPasswordSet() {
  if (!TEST_PASSWORD) {
    console.error(
      'FATAL: TEST_PASSWORD environment variable is required.\n' +
        'Please export TEST_PASSWORD before running this script:\n' +
        "  export TEST_PASSWORD='<dev cognito password>'\n" +
        '  node demo/scripts/capture-chapter-metrics.mjs\n' +
        '\nThe previous hardcoded default was a burned credential and has been removed.'
    );
    process.exit(1);
  }
}

const CHAPTERS = [
  {
    key: 'sherlock',
    label: 'Sherlock Holmes — A Scandal in Bohemia',
    file: 'demo/test-documents/chapters/sherlock-ch1.txt',
    fileName: 'sherlock-ch1.txt',
    targetLanguage: 'es',
  },
  {
    key: 'pride',
    label: 'Pride and Prejudice — Chapter 1',
    file: 'demo/test-documents/chapters/pride-ch1.txt',
    fileName: 'pride-ch1.txt',
    targetLanguage: 'fr',
  },
  {
    key: 'wp',
    label: 'War and Peace — Book 1 Chapter 1',
    file: 'demo/test-documents/chapters/wp-bk1-ch1.txt',
    fileName: 'wp-bk1-ch1.txt',
    targetLanguage: 'de',
  },
];

// ---------- HTTPS helpers ----------

function jsonRequest({ method, host, path, headers = {}, body }) {
  return new Promise((resolveReq, rejectReq) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const finalHeaders = { Accept: 'application/json', ...headers };
    if (payload) {
      finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
      finalHeaders['Content-Length'] = payload.length;
    }
    const req = httpsRequest(
      { method, hostname: host, path, headers: finalHeaders },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = { _raw: text };
          }
          resolveReq({ status: res.statusCode, headers: res.headers, body: parsed, raw: text });
        });
      }
    );
    req.on('error', rejectReq);
    if (payload) req.write(payload);
    req.end();
  });
}

function rawPut({ url, body, contentType }) {
  return new Promise((resolveReq, rejectReq) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        method: 'PUT',
        hostname: u.hostname,
        path: `${u.pathname}${u.search}`,
        headers: {
          'Content-Type': contentType,
          'Content-Length': body.length,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolveReq({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', rejectReq);
    req.write(body);
    req.end();
  });
}

// ---------- AWS CLI helper ----------

/**
 * Wrap spawnSync('aws', ...) so every call has a uniform 30s timeout (R5)
 * and a clear error message naming which command stalled. Returns the
 * spawnSync result; callers handle non-zero exit codes locally so the wrapper
 * stays a thin policy layer.
 */
function awsCli(args, { allowNonZeroExit = true } = {}) {
  const out = spawnSync('aws', args, { encoding: 'utf8', timeout: AWS_CLI_TIMEOUT_MS });
  if (out.error && out.error.code === 'ETIMEDOUT') {
    throw new Error(
      `AWS CLI command timed out after ${AWS_CLI_TIMEOUT_MS}ms: aws ${args.slice(0, 3).join(' ')}...`
    );
  }
  if (!allowNonZeroExit && out.status !== 0) {
    throw new Error(
      `AWS CLI command failed (exit ${out.status}): aws ${args.slice(0, 3).join(' ')}...\nstderr: ${out.stderr}`
    );
  }
  return out;
}

// ---------- Auth ----------

async function ensureAuth() {
  const apiPath = (p) => `${API_BASE_PATH}${p}`;
  console.log(`[auth] attempting login for ${TEST_EMAIL}`);
  const loginAttempt = await jsonRequest({
    method: 'POST',
    host: API_HOST,
    path: apiPath('/auth/login'),
    body: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });

  if (loginAttempt.status === 200 && loginAttempt.body?.idToken) {
    console.log('[auth] login succeeded with existing account');
    return loginAttempt.body;
  }

  console.log(`[auth] login returned ${loginAttempt.status}; registering new account`);
  const reg = await jsonRequest({
    method: 'POST',
    host: API_HOST,
    path: apiPath('/auth/register'),
    body: {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      confirmPassword: TEST_PASSWORD,
      firstName: 'TrackB',
      lastName: 'DemoBot',
      organization: 'LFMT POC Demo Capture',
      acceptedTerms: true,
      acceptedPrivacy: true,
      marketingConsent: false,
    },
  });
  if (reg.status !== 201 && reg.status !== 409) {
    throw new Error(`Registration failed (${reg.status}): ${JSON.stringify(reg.body)}`);
  }
  console.log(`[auth] registration status ${reg.status}`);

  const login = await jsonRequest({
    method: 'POST',
    host: API_HOST,
    path: apiPath('/auth/login'),
    body: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });
  if (login.status !== 200 || !login.body?.idToken) {
    throw new Error(`Login after register failed (${login.status}): ${JSON.stringify(login.body)}`);
  }
  console.log('[auth] login succeeded after register');
  return login.body;
}

// ---------- Same-day RPD guard (C1) ----------

/**
 * Warn (do not block) when an existing capture-summary.json indicates a recent
 * prior run within RPD_GUARD_WINDOW_MS. Stacking back-to-back captures at
 * ~15-17 Gemini requests each can bust the 25 RPD ceiling.
 */
async function checkSameDayRpdGuard() {
  const summaryPath = resolve(REPO_ROOT, 'demo', 'results', 'capture-summary.json');
  if (!existsSync(summaryPath)) return;
  try {
    const fileStat = await stat(summaryPath);
    const ageMs = Date.now() - fileStat.mtimeMs;
    if (ageMs < RPD_GUARD_WINDOW_MS) {
      const ageHours = (ageMs / 1000 / 60 / 60).toFixed(1);
      console.warn(
        `\n⚠️  RPD GUARD: capture-summary.json found from ${ageHours}h ago.\n` +
          '    Each full run consumes ~15-17 Gemini requests (Sherlock ~12, Pride ~1, WP ~3).\n' +
          '    Free-tier ceiling is 25 RPD — stacking two same-day runs WILL bust it.\n' +
          '    Press Ctrl+C within 10s to abort, or wait to continue.\n'
      );
      await sleep(10_000);
    }
  } catch (err) {
    console.warn(`[rpd-guard] could not stat capture-summary.json: ${err.message}`);
  }
}

// ---------- Workflow per chapter ----------

async function processChapter(chapter, auth) {
  const apiPath = (p) => `${API_BASE_PATH}${p}`;
  const idToken = auth.idToken;
  const authHeaders = { Authorization: `Bearer ${idToken}` };

  const filePath = resolve(REPO_ROOT, chapter.file);
  const fileBytes = await readFile(filePath);
  const fileSize = fileBytes.length;
  console.log(`\n[${chapter.key}] file=${chapter.file} size=${fileSize}B`);

  const wallStart = new Date();
  const uploadStart = wallStart.toISOString();

  // 1) request presigned URL
  const uploadReq = await jsonRequest({
    method: 'POST',
    host: API_HOST,
    path: apiPath('/jobs/upload'),
    headers: authHeaders,
    body: {
      fileName: chapter.fileName,
      fileSize,
      contentType: 'text/plain',
      legalAttestation: {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
      },
    },
  });
  if (uploadReq.status !== 200) {
    throw new Error(`[${chapter.key}] /jobs/upload failed (${uploadReq.status}): ${JSON.stringify(uploadReq.body)}`);
  }

  // Response shape: createSuccessResponse spreads the second arg, so the body
  // is `{ message, data: PresignedUrlResponse, requestId }`. The actual
  // presigned URL fields live under `body.data`.
  const presigned = uploadReq.body?.data || uploadReq.body;
  const uploadUrl = presigned.uploadUrl;
  const fileId = presigned.fileId;
  if (!uploadUrl || !fileId) {
    throw new Error(`[${chapter.key}] upload response missing uploadUrl/fileId: ${JSON.stringify(uploadReq.body)}`);
  }
  console.log(`[${chapter.key}] presigned URL acquired, fileId=${fileId}`);

  // 2) PUT bytes to S3
  const putRes = await rawPut({ url: uploadUrl, body: fileBytes, contentType: 'text/plain' });
  if (putRes.status !== 200) {
    throw new Error(`[${chapter.key}] S3 PUT failed (${putRes.status}): ${putRes.body}`);
  }
  const uploadCompleteDate = new Date();
  const uploadComplete = uploadCompleteDate.toISOString();
  console.log(
    `[${chapter.key}] S3 upload OK in ${uploadCompleteDate.getTime() - wallStart.getTime()}ms`
  );

  // 3) Find the jobId. uploadRequest.ts created a job at the same time as the
  //    presigned URL but didn't echo its jobId in the response; we re-derive
  //    it via DynamoDB. R2: previously a full table Scan with no pagination —
  //    now a bounded Query against the UserJobsIndex GSI (userId + createdAt
  //    sorted descending), filtering for documentId == fileId locally. Bounded
  //    by the test account's job count (typically <50), instead of the entire
  //    jobs table.
  const jobId = await discoverJobId(fileId, auth.user?.id);
  if (!jobId) {
    throw new Error(`[${chapter.key}] could not discover jobId for fileId=${fileId}`);
  }
  console.log(`[${chapter.key}] discovered jobId=${jobId}`);

  // 4) Wait for status to reach CHUNKED before starting translation.
  await waitForStatus(jobId, idToken, 'CHUNKED', CHUNKING_MAX_WAIT_MS);

  // 5) Start translation
  const translationStartDate = new Date();
  const translationStart = translationStartDate.toISOString();
  const startRes = await jsonRequest({
    method: 'POST',
    host: API_HOST,
    path: apiPath(`/jobs/${jobId}/translate`),
    headers: authHeaders,
    body: { targetLanguage: chapter.targetLanguage, tone: 'neutral', contextChunks: 2 },
  });
  if (startRes.status !== 200) {
    throw new Error(`[${chapter.key}] start translation failed (${startRes.status}): ${JSON.stringify(startRes.body)}`);
  }
  // startTranslation flattens fields onto the response; totalChunks lives at the top level.
  const startBody = startRes.body || {};
  const totalChunks = startBody?.totalChunks ?? null;
  console.log(`[${chapter.key}] translation started, totalChunks=${totalChunks}`);

  // 6) Poll until COMPLETED (or TRANSLATION_FAILED — both terminal).
  const finalStatus = await pollUntilComplete(jobId, idToken);
  const wallEnd = new Date();

  // 7) Save metrics. R3: Prefer API-returned values from PR #166's expanded
  //    response shape; fall back to DDB read-back ONLY when a field is missing
  //    from the API response. After PR #166, only `tokensUsed` historically
  //    needed DDB fallback (verified against backend/functions/jobs/
  //    getTranslationStatus.ts:107-119). The fallback contract is:
  //      1. If API response has the field, use it (canonical).
  //      2. If API response is missing the field, fetch from DDB and tag
  //         the metrics field name with `*FromDynamo` to make the source
  //         observable downstream.
  //      3. Both sources are emitted only when both are present (drift
  //         detection); DDB-only is acceptable for tokensUsed.
  let jobCreatedAt = finalStatus.createdAt || null;
  if (!jobCreatedAt) {
    jobCreatedAt = await fetchCreatedAtFromDynamo(jobId, auth.user?.id);
  }
  const translationStartedAtServer = finalStatus.translationStartedAt || translationStart;
  const translationCompletedAt = finalStatus.translationCompletedAt || wallEnd.toISOString();
  const durationMs =
    jobCreatedAt && translationCompletedAt
      ? new Date(translationCompletedAt).getTime() - new Date(jobCreatedAt).getTime()
      : null;
  const translationOnlyMs =
    new Date(translationCompletedAt).getTime() - new Date(translationStartedAtServer).getTime();
  const wallClockMs = wallEnd.getTime() - wallStart.getTime();

  // R3: only fetch from DDB when the API response is missing token data.
  // Post-PR #166, the API response should always carry these — we keep the
  // fallback as defense-in-depth for older deployed builds.
  const apiHasTokens =
    finalStatus.tokensUsed != null || finalStatus.estimatedCost != null;
  const dynamoTokenStats = apiHasTokens
    ? {}
    : await fetchTokenStatsFromDynamo(jobId, auth.user?.id);

  const metrics = {
    schemaVersion: METRICS_SCHEMA_VERSION,
    document: {
      key: chapter.key,
      label: chapter.label,
      file: chapter.file,
      fileName: chapter.fileName,
      fileSizeBytes: fileSize,
      targetLanguage: chapter.targetLanguage,
    },
    timing: {
      uploadStartWallclock: uploadStart,
      uploadCompleteWallclock: uploadComplete,
      translationStartWallclock: translationStart,
      wallEnd: wallEnd.toISOString(),
      jobCreatedAtServer: jobCreatedAt,
      translationStartedAtServer,
      translationCompletedAtServer: translationCompletedAt,
      durationMsServerAnchored: durationMs,
      translationOnlyMs,
      wallClockMs,
      pollIntervalMs: POLL_INTERVAL_MS,
    },
    chunks: {
      totalChunks: finalStatus.totalChunks ?? totalChunks,
      chunksTranslated: finalStatus.chunksTranslated,
      progressPercentage: finalStatus.progressPercentage,
    },
    geminiRequestsAttributed: finalStatus.totalChunks ?? totalChunks ?? null,
    tokens: {
      tokensUsedReportedByApi: finalStatus.tokensUsed ?? null,
      estimatedCostUsdReportedByApi: finalStatus.estimatedCost ?? null,
      // R3: these two are fallback-only (empty {} when API response carries
      // tokensUsed/estimatedCost). Their presence indicates the deployed
      // Lambda is older than PR #166 OR the backend isn't back-propagating
      // Gemini usage metadata — useful for downstream drift detection.
      tokensUsedFromDynamo: dynamoTokenStats.tokensUsed ?? null,
      estimatedCostFromDynamo: dynamoTokenStats.estimatedCost ?? null,
      note:
        'tokensUsed/estimatedCost come from /jobs/{id}/translation-status (post-translation Step Functions update). When 0 or null, the deployed translateChunk Lambda is not back-propagating Gemini usage metadata to DynamoDB for this build — we treat per-chunk token counts as N/A in that case and rely on chunk count × 3,500-token chunk-size assumption for downstream cost projections.',
    },
    rawFinalStatus: finalStatus,
    fixture: {
      sourceWordCount: countWords(fileBytes.toString('utf8')),
    },
  };

  const outDir = resolve(REPO_ROOT, 'demo', 'results', chapter.key);
  await mkdir(outDir, { recursive: true });

  // Pull translated chunks from S3 so we can produce side-by-side quality
  // samples. R4: returns { text, partial, missingChunkIndices } so we can
  // record partial-data semantics in the metrics JSON instead of silently
  // discarding everything when one chunk is missing.
  const translation = await fetchTranslatedChunks(jobId, metrics.chunks.totalChunks);
  if (translation && translation.partial) {
    metrics.partial = true;
    metrics.partialReason = `missing chunks ${translation.missingChunkIndices.join(',')}`;
  }

  await writeFile(resolve(outDir, '..', `${chapter.key}-metrics.json`), JSON.stringify(metrics, null, 2));
  await writeFile(resolve(outDir, 'raw-status.json'), JSON.stringify(finalStatus, null, 2));
  await writeFile(resolve(outDir, 'source.txt'), fileBytes);

  if (translation && translation.text) {
    await writeFile(resolve(outDir, 'translation.txt'), translation.text);
    await writeQualitySamples({
      chapter,
      sourceText: fileBytes.toString('utf8'),
      translation: translation.text,
      outDir,
      partial: translation.partial,
    });
  } else {
    console.warn(`[${chapter.key}] could not fetch any translated chunks; quality samples skipped`);
  }

  console.log(`[${chapter.key}] metrics written to demo/results/${chapter.key}-metrics.json`);
  console.log(`[${chapter.key}] DONE — durationMs(server)=${durationMs} chunks=${metrics.chunks.totalChunks}`);

  return { chapter, metrics, jobId };
}

/**
 * Pure-function word count. Splits on whitespace and counts non-empty tokens.
 *
 * Unicode behavior (R9 — documented for tests):
 *   - We count whitespace-separated tokens. ASCII text behaves intuitively.
 *   - For CJK input where whole sentences may run together without spaces,
 *     a single ideograph block counts as ONE token. This is a known limit;
 *     the fixtures in this repo are English so it does not affect committed
 *     metrics. CJK callers should use a language-aware tokenizer instead.
 *   - Empty / whitespace-only strings return 0 (the .filter(Boolean) drops
 *     the leading empty token from .split(/\s+/) when input starts blank).
 *
 * Exported for unit tests in __tests__/capture-chapter-metrics.test.mjs.
 */
export function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Pick evenly-spaced sample paragraph indices given counts of source and
 * translation paragraphs. Returns up to `samplesWanted` unique indices in
 * ascending order. Pure function — extracted from writeQualitySamples for
 * testability (R9 follow-up suggestion).
 */
export function pickSampleIndices(sourceParagraphCount, translationParagraphCount, samplesWanted = 5) {
  const maxIdx = Math.min(sourceParagraphCount, translationParagraphCount);
  const indices = [];
  for (let n = 0; n < samplesWanted && n < maxIdx; n++) {
    const idx = Math.floor((n / Math.max(samplesWanted - 1, 1)) * (maxIdx - 1));
    if (!indices.includes(idx)) indices.push(idx);
  }
  return indices;
}

async function waitForStatus(jobId, idToken, target, maxWaitMs) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await jsonRequest({
      method: 'GET',
      host: API_HOST,
      path: `${API_BASE_PATH}/jobs/${jobId}/translation-status`,
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 200) {
      const body = res.body || {};
      const status = body?.status;
      if (status === target) return body;
      if (CHUNKING_TERMINAL_STATES.has(status)) {
        throw new Error(`Job moved to terminal status ${status}: ${JSON.stringify(body)}`);
      }
      console.log(`[wait] job=${jobId} status=${status} waiting for ${target}`);
    } else {
      console.log(`[wait] status endpoint returned ${res.status} (job not yet visible?), retrying`);
    }
    // Chunking is fast — poll at 1s rather than the translation-phase 5s.
    await sleep(CHUNKING_POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for job ${jobId} to reach ${target}`);
}

async function pollUntilComplete(jobId, idToken) {
  const start = Date.now();
  while (Date.now() - start < MAX_POLL_DURATION_MS) {
    const res = await jsonRequest({
      method: 'GET',
      host: API_HOST,
      path: `${API_BASE_PATH}/jobs/${jobId}/translation-status`,
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (res.status === 200) {
      const body = res.body || {};
      const ts = body?.translationStatus;
      console.log(
        `[poll] job=${jobId} translationStatus=${ts} progress=${body?.progressPercentage}% ${body?.chunksTranslated}/${body?.totalChunks}`
      );
      // R6: short-circuit on either terminal state — after PR #165 the API
      // reliably reports TRANSLATION_FAILED, so we should fast-fail rather
      // than running the full 4-minute timeout when the run has already
      // failed. COMPLETED check first preserves the success path's behavior.
      if (TRANSLATION_TERMINAL_STATES.has(ts)) {
        if (ts === 'TRANSLATION_FAILED') {
          throw new Error(`Translation FAILED: ${body?.error || JSON.stringify(body)}`);
        }
        return body;
      }
    } else {
      console.log(`[poll] status endpoint returned ${res.status}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Polling timed out for job ${jobId}`);
}

// ---------- jobId discovery via AWS CLI ----------

async function fetchTranslatedChunks(jobId, totalChunks) {
  if (!totalChunks || totalChunks < 1) return null;
  // R8 / S3-bucket-guessing suggestion: the script reconstructs the bucket
  // name from the deployed dev convention. translateChunk writes to
  // `translated/<jobId>/chunk-<i>.txt`. Bucket choice is environment-
  // dependent, so we still try both candidates — but with `aws s3 cp
  // --recursive`, one call per bucket replaces the previous 2N calls.
  const candidates = ['lfmt-documents-lfmtpocdev', 'lfmt-results-lfmtpocdev'];
  const tmpDir = resolve(REPO_ROOT, 'demo', 'results', '.tmp-chunks', jobId);
  await mkdir(tmpDir, { recursive: true });

  let downloadedFromBucket = null;
  for (const bucket of candidates) {
    const out = awsCli([
      's3',
      'cp',
      `s3://${bucket}/translated/${jobId}/`,
      tmpDir,
      '--recursive',
      '--exclude',
      '*',
      '--include',
      '*.txt',
    ]);
    if (out.status === 0) {
      // Verify at least one file landed.
      try {
        const files = await readdir(tmpDir);
        if (files.length > 0) {
          downloadedFromBucket = bucket;
          break;
        }
      } catch {
        /* directory empty / unreadable, try next bucket */
      }
    }
  }

  if (!downloadedFromBucket) {
    console.warn(`[fetchTranslatedChunks] no chunks found for jobId=${jobId} in any bucket`);
    return null;
  }
  console.log(`[fetchTranslatedChunks] downloaded chunks from ${downloadedFromBucket}`);

  // R4: keep what was fetched and report missing indices instead of dropping
  // the entire result on the first miss. The downstream pitch-deck PR can
  // inspect `partial: true` and decide whether to rerun or accept partial.
  const parts = [];
  const missingChunkIndices = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = resolve(tmpDir, `chunk-${i}.txt`);
    if (existsSync(chunkPath)) {
      const bytes = await readFile(chunkPath, 'utf8');
      if (bytes.length > 0) {
        parts.push(bytes);
      } else {
        missingChunkIndices.push(i);
      }
    } else {
      missingChunkIndices.push(i);
    }
  }

  if (missingChunkIndices.length > 0) {
    console.warn(
      `[fetchTranslatedChunks] partial result: missing chunks [${missingChunkIndices.join(',')}] of ${totalChunks}`
    );
  }

  if (parts.length === 0) return null;
  return {
    text: parts.join('\n\n'),
    partial: missingChunkIndices.length > 0,
    missingChunkIndices,
  };
}

async function writeQualitySamples({ chapter, sourceText, translation, outDir, partial }) {
  // Pick 5 evenly-spaced "passages" — paragraph-aligned slices from the
  // source and the corresponding offsets in the translation. Side-by-side
  // markdown for native-speaker review (we don't rate ourselves — explicit
  // disclaimer at the top).
  //
  // Paragraph-alignment assumption (R-suggestion): we pair source[i] with
  // translation[i] purely by paragraph index. This works because the
  // translateChunk Lambda preserves paragraph breaks within each chunk and
  // chunks are paragraph-scale (3,500 tokens ≈ several paragraphs each).
  // For documents with very long single paragraphs (e.g., legal contracts)
  // OR where the translator splits paragraphs differently (e.g., into
  // shorter sentences for readability in the target language), index-based
  // alignment can drift. The paragraph-count mismatch in the rendered
  // markdown header is the diagnostic to watch.
  const sourceParagraphs = sourceText.split(/\n\n+/).filter((p) => p.trim().length > 60);
  const translationParagraphs = translation.split(/\n\n+/).filter((p) => p.trim().length > 60);

  const indices = pickSampleIndices(sourceParagraphs.length, translationParagraphs.length, 5);

  const lines = [
    `# Quality samples — ${chapter.label}`,
    '',
    `**Target language**: ${chapter.targetLanguage}`,
    `**Source paragraphs total**: ${sourceParagraphs.length}`,
    `**Translation paragraphs total**: ${translationParagraphs.length}`,
    `**Samples below**: ${indices.length} (paragraph-aligned, evenly distributed)`,
    '',
  ];
  if (partial) {
    lines.push(
      '> **⚠️ Partial translation** — some chunks were missing from S3. Quality samples reflect what was downloadable; drift may be larger than usual.'
    );
    lines.push('');
  }
  lines.push(
    '> **Quality assessment requires native-speaker review (deferred to manual step).**',
    '> The capture script does not rate translation quality; it only pairs source',
    '> and translated paragraphs so a reviewer can rate coherence / context /',
    '> accuracy / formatting on the 1-5 scale described in `demo/TESTING-INSTRUCTIONS.md`.',
    ''
  );

  for (const idx of indices) {
    lines.push(`## Sample paragraph index ${idx}`);
    lines.push('');
    lines.push('### Source (English)');
    lines.push('');
    lines.push('```');
    lines.push(sourceParagraphs[idx].trim());
    lines.push('```');
    lines.push('');
    lines.push(`### Translation (${chapter.targetLanguage})`);
    lines.push('');
    lines.push('```');
    lines.push(translationParagraphs[idx].trim());
    lines.push('```');
    lines.push('');
    lines.push('Reviewer scores (1-5):');
    lines.push('- Coherence: __');
    lines.push('- Context preservation: __');
    lines.push('- Accuracy: __');
    lines.push('- Formatting: __');
    lines.push('');
  }

  await writeFile(resolve(outDir, '..', `${chapter.key}-quality-samples.md`), lines.join('\n'));
}

async function fetchCreatedAtFromDynamo(jobId, userId) {
  if (!userId) return null;
  const out = awsCli([
    'dynamodb',
    'get-item',
    '--table-name',
    'lfmt-jobs-LfmtPocDev',
    '--key',
    JSON.stringify({ jobId: { S: jobId }, userId: { S: userId } }),
    '--projection-expression',
    'createdAt',
  ]);
  if (out.status !== 0) {
    console.warn(`[fetchCreatedAt] aws cli failed: ${out.stderr}`);
    return null;
  }
  try {
    const parsed = JSON.parse(out.stdout);
    return parsed.Item?.createdAt?.S || null;
  } catch {
    return null;
  }
}

async function fetchTokenStatsFromDynamo(jobId, userId) {
  if (!userId) return {};
  const out = awsCli([
    'dynamodb',
    'get-item',
    '--table-name',
    'lfmt-jobs-LfmtPocDev',
    '--key',
    JSON.stringify({ jobId: { S: jobId }, userId: { S: userId } }),
    '--projection-expression',
    'tokensUsed,estimatedCost,totalChunks,translatedChunks',
  ]);
  if (out.status !== 0) return {};
  try {
    const parsed = JSON.parse(out.stdout);
    const item = parsed.Item || {};
    return {
      tokensUsed: item.tokensUsed?.N != null ? Number(item.tokensUsed.N) : null,
      estimatedCost: item.estimatedCost?.N != null ? Number(item.estimatedCost.N) : null,
      totalChunks: item.totalChunks?.N != null ? Number(item.totalChunks.N) : null,
      translatedChunks: item.translatedChunks?.N != null ? Number(item.translatedChunks.N) : null,
    };
  } catch {
    return {};
  }
}

async function discoverJobId(fileId, userId) {
  // R2: previous implementation used `aws dynamodb scan` over the entire
  // jobs table with no pagination — silently misses results once the table
  // grows past one Scan page. New approach: query the UserJobsIndex GSI
  // (userId + createdAt sort key) for THIS test account's jobs only,
  // sorted descending so the most recent job (the one we just created) is
  // first. We then filter for `documentId == fileId` locally. This is
  // bounded by the test account's job count instead of the entire table.
  //
  // Fallback: if we don't have a userId (auth.user?.id missing), fall back
  // to a paginated Scan with a generous page-count cap so we still don't
  // run unbounded.
  for (let attempt = 0; attempt < DISCOVER_JOB_ID_MAX_ATTEMPTS; attempt++) {
    const found = userId
      ? await discoverJobIdViaQuery(fileId, userId)
      : await discoverJobIdViaPaginatedScan(fileId);
    if (found) return found;
    console.log(
      `[discoverJobId] no job row yet for fileId=${fileId} (attempt ${attempt + 1}/${DISCOVER_JOB_ID_MAX_ATTEMPTS}), waiting`
    );
    await sleep(DISCOVER_JOB_ID_RETRY_MS);
  }
  return null;
}

async function discoverJobIdViaQuery(fileId, userId) {
  const out = awsCli([
    'dynamodb',
    'query',
    '--table-name',
    'lfmt-jobs-LfmtPocDev',
    '--index-name',
    'UserJobsIndex',
    '--key-condition-expression',
    'userId = :u',
    '--filter-expression',
    'documentId = :d',
    '--expression-attribute-values',
    JSON.stringify({ ':u': { S: userId }, ':d': { S: fileId } }),
    '--projection-expression',
    'jobId',
    '--scan-index-forward',
    'false', // newest first
    '--limit',
    '50',
  ]);
  if (out.status !== 0) {
    console.warn(`[discoverJobId/query] aws cli stderr: ${out.stderr}`);
    return null;
  }
  try {
    const parsed = JSON.parse(out.stdout);
    if (parsed.Items && parsed.Items.length > 0) {
      return parsed.Items[0].jobId.S;
    }
  } catch (e) {
    console.warn(`[discoverJobId/query] parse error: ${e.message}`);
  }
  return null;
}

async function discoverJobIdViaPaginatedScan(fileId) {
  const MAX_PAGES = 10;
  const PAGE_SIZE = 100;
  let exclusiveStartKey = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const args = [
      'dynamodb',
      'scan',
      '--table-name',
      'lfmt-jobs-LfmtPocDev',
      '--filter-expression',
      'documentId = :d',
      '--expression-attribute-values',
      JSON.stringify({ ':d': { S: fileId } }),
      '--projection-expression',
      'jobId',
      '--limit',
      String(PAGE_SIZE),
    ];
    if (exclusiveStartKey) {
      args.push('--exclusive-start-key', JSON.stringify(exclusiveStartKey));
    }
    const out = awsCli(args);
    if (out.status !== 0) {
      console.warn(`[discoverJobId/scan] aws cli stderr: ${out.stderr}`);
      return null;
    }
    try {
      const parsed = JSON.parse(out.stdout);
      if (parsed.Items && parsed.Items.length > 0) {
        return parsed.Items[0].jobId.S;
      }
      if (!parsed.LastEvaluatedKey) return null;
      exclusiveStartKey = parsed.LastEvaluatedKey;
    } catch (e) {
      console.warn(`[discoverJobId/scan] parse error: ${e.message}`);
      return null;
    }
  }
  console.warn(`[discoverJobId/scan] exhausted ${MAX_PAGES} pages without finding fileId=${fileId}`);
  return null;
}

// ---------- main ----------

async function main() {
  assertTestPasswordSet();
  const arg = process.argv[2];
  const targets = arg ? CHAPTERS.filter((c) => c.key === arg) : CHAPTERS;
  if (targets.length === 0) {
    console.error(`Unknown chapter key: ${arg}. Use one of: ${CHAPTERS.map((c) => c.key).join(', ')}`);
    process.exit(1);
  }

  await checkSameDayRpdGuard();

  const auth = await ensureAuth();
  const summary = [];
  for (const ch of targets) {
    try {
      const result = await processChapter(ch, auth);
      summary.push({ key: ch.key, status: 'ok', metrics: result.metrics });
      // Brief pause between chapters to give the rate limiter slack.
      await sleep(INTER_CHAPTER_PAUSE_MS);
    } catch (err) {
      console.error(`[${ch.key}] FAILED: ${err.message}`);
      summary.push({ key: ch.key, status: 'failed', error: err.message });
    }
  }

  // R11: scrub the test-account email from the committed summary file. The
  // raw email is still available via the runtime LFMT_TEST_EMAIL env var if a
  // human operator needs to correlate; we don't write PII to git-tracked
  // files. (capture-summary.json IS committed because its summary array is
  // useful for diff-driven inspection of run-to-run deltas.)
  await writeFile(
    resolve(REPO_ROOT, 'demo', 'results', 'capture-summary.json'),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        schemaVersion: METRICS_SCHEMA_VERSION,
        testAccount: '<email omitted from committed file — set LFMT_TEST_EMAIL to correlate>',
        summary,
      },
      null,
      2
    )
  );
  console.log('\n=== run complete — see demo/results/ ===');
}

// Skip executing main() when this module is imported (e.g., by the unit
// tests under __tests__/). Node sets import.meta.url to the file URL of the
// importer when imported, vs. the script file when invoked directly.
const isDirectInvocation =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url === `file://${resolve(process.argv[1] || '')}`;
if (isDirectInvocation) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(2);
  });
}
