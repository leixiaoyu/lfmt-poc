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
 *   - This script targets <= 20 total Gemini requests across all chapters
 *
 * No backend code changes — pure data capture. The script is intentionally
 * dependency-free (only Node's built-in https/fs/crypto) so it can run
 * straight from a fresh checkout without `npm install`.
 *
 * Usage:
 *   node demo/scripts/capture-chapter-metrics.mjs [chapter-key]
 *   - With no arg: runs all 3 chapters serially (recommended).
 *   - With a key (sherlock|pride|wp): runs just that one.
 */

import { request as httpsRequest } from 'node:https';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const API_HOST = '8brwlwf68h.execute-api.us-east-1.amazonaws.com';
const API_BASE_PATH = '/v1';

// Fresh test account per the Track B brief. Auto-confirmed in dev env.
const TEST_EMAIL = process.env.LFMT_TEST_EMAIL || 'claude-track-b-2026-04-25@lfmt-poc.dev';
// Strong password meeting Cognito policy (>=8 char, upper, lower, digit, symbol).
const TEST_PASSWORD = process.env.LFMT_TEST_PASSWORD || 'TrackBDemo!2026';

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

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1000; // 10 min ceiling per chapter

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
  const uploadComplete = new Date().toISOString();
  console.log(`[${chapter.key}] S3 upload OK in ${(new Date(uploadComplete) - new Date(uploadStart))}ms`);

  // 3) Find the jobId. uploadRequest.ts created a job at the same time as the
  //    presigned URL but didn't echo its jobId in the response; we re-derive
  //    it by polling the job's status via documentId. Simpler: poll the
  //    user's job list. But there's no list endpoint exposed; instead, we
  //    rely on chunking to produce a CHUNKED job and poll status by attempting
  //    /jobs/{jobId}/translation-status using the jobId we'll discover via
  //    the upload-complete S3 event landing in DynamoDB.
  //
  //    HACK: upload-complete needs the jobId from S3 metadata. We CAN'T
  //    list jobs through the API. Workaround: backend stamps jobId into S3
  //    metadata, but the only way to recover it on the client is to inspect
  //    DynamoDB. Since we don't want to add an SDK dependency to this
  //    capture script, we:
  //     a) wait for the chunking flow to populate the job
  //     b) discover the jobId via the AWS CLI (always available — see
  //        CLAUDE.md). We shell out to `aws dynamodb scan` filtered by
  //        documentId, which is the fileId we already have.
  const jobId = await discoverJobId(fileId);
  if (!jobId) {
    throw new Error(`[${chapter.key}] could not discover jobId for fileId=${fileId}`);
  }
  console.log(`[${chapter.key}] discovered jobId=${jobId}`);

  // 4) Wait for status to reach CHUNKED before starting translation.
  await waitForStatus(jobId, idToken, 'CHUNKED', 4 * 60 * 1000);

  // 5) Start translation
  const translationStart = new Date().toISOString();
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

  // 6) Poll until COMPLETED
  const finalStatus = await pollUntilComplete(jobId, idToken);
  const wallEnd = new Date();

  // 7) Save metrics. The deployed `getTranslationStatus` Lambda may not echo
  //    `createdAt` (the source field exists but the live build is older), so
  //    we backfill via DynamoDB if the API didn't return it.
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
  const translationOnlyMs = new Date(translationCompletedAt).getTime() - new Date(translationStartedAtServer).getTime();
  const wallClockMs = wallEnd.getTime() - new Date(uploadStart).getTime();
  const dynamoTokenStats = await fetchTokenStatsFromDynamo(jobId, auth.user?.id);

  const metrics = {
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
  await writeFile(resolve(outDir, '..', `${chapter.key}-metrics.json`), JSON.stringify(metrics, null, 2));
  await writeFile(resolve(outDir, 'raw-status.json'), JSON.stringify(finalStatus, null, 2));
  await writeFile(resolve(outDir, 'source.txt'), fileBytes);

  // Pull translated chunks from S3 so we can produce side-by-side quality samples.
  const translation = await fetchTranslatedChunks(jobId, metrics.chunks.totalChunks);
  if (translation) {
    await writeFile(resolve(outDir, 'translation.txt'), translation);
    await writeQualitySamples({
      chapter,
      sourceText: fileBytes.toString('utf8'),
      translation,
      outDir,
    });
  } else {
    console.warn(`[${chapter.key}] could not fetch translated chunks; quality samples skipped`);
  }

  console.log(`[${chapter.key}] metrics written to demo/results/${chapter.key}-metrics.json`);
  console.log(`[${chapter.key}] DONE — durationMs(server)=${durationMs} chunks=${metrics.chunks.totalChunks}`);

  return { chapter, metrics, jobId };
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
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
      if (status === 'VALIDATION_FAILED' || status === 'CHUNKING_FAILED') {
        throw new Error(`Job moved to terminal status ${status}: ${JSON.stringify(body)}`);
      }
      console.log(`[wait] job=${jobId} status=${status} waiting for ${target}`);
    } else {
      console.log(`[wait] status endpoint returned ${res.status} (job not yet visible?), retrying`);
    }
    await sleep(POLL_INTERVAL_MS);
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
      if (ts === 'COMPLETED') return body;
      if (ts === 'TRANSLATION_FAILED') {
        throw new Error(`Translation FAILED: ${body?.error || JSON.stringify(body)}`);
      }
    } else {
      console.log(`[poll] status endpoint returned ${res.status}`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Polling timed out for job ${jobId}`);
}

// ---------- jobId discovery via AWS CLI ----------

import { spawnSync } from 'node:child_process';

async function fetchTranslatedChunks(jobId, totalChunks) {
  if (!totalChunks || totalChunks < 1) return null;
  const RESULT_BUCKET = 'lfmt-results-lfmtpocdev';
  // Try results bucket first, then documents bucket — translateChunk writes to
  // `translated/<jobId>/chunk-<i>.txt`. Bucket choice is environment-dependent.
  const candidates = ['lfmt-documents-lfmtpocdev', RESULT_BUCKET];
  const parts = [];
  for (let i = 0; i < totalChunks; i++) {
    let bytes = null;
    for (const bucket of candidates) {
      const out = spawnSync(
        'aws',
        ['s3', 'cp', `s3://${bucket}/translated/${jobId}/chunk-${i}.txt`, '-'],
        { encoding: 'utf8' }
      );
      if (out.status === 0 && out.stdout && out.stdout.length > 0) {
        bytes = out.stdout;
        break;
      }
    }
    if (!bytes) {
      console.warn(`[fetchTranslatedChunks] missing chunk ${i} for jobId=${jobId}`);
      return null;
    }
    parts.push(bytes);
  }
  return parts.join('\n\n');
}

async function writeQualitySamples({ chapter, sourceText, translation, outDir }) {
  // Pick 5 evenly-spaced "passages" — paragraph-aligned slices from the
  // source and the corresponding offsets in the translation. Side-by-side
  // markdown for native-speaker review (we don't rate ourselves — explicit
  // disclaimer at the top).
  const sourceParagraphs = sourceText.split(/\n\n+/).filter((p) => p.trim().length > 60);
  const translationParagraphs = translation.split(/\n\n+/).filter((p) => p.trim().length > 60);

  // Select 5 evenly distributed indices, but no more than min(source,translation) length.
  const samplesWanted = 5;
  const maxIdx = Math.min(sourceParagraphs.length, translationParagraphs.length);
  const indices = [];
  for (let n = 0; n < samplesWanted && n < maxIdx; n++) {
    const idx = Math.floor((n / Math.max(samplesWanted - 1, 1)) * (maxIdx - 1));
    if (!indices.includes(idx)) indices.push(idx);
  }

  const lines = [
    `# Quality samples — ${chapter.label}`,
    '',
    `**Target language**: ${chapter.targetLanguage}`,
    `**Source paragraphs total**: ${sourceParagraphs.length}`,
    `**Translation paragraphs total**: ${translationParagraphs.length}`,
    `**Samples below**: ${indices.length} (paragraph-aligned, evenly distributed)`,
    '',
    '> **Quality assessment requires native-speaker review (deferred to manual step).**',
    '> The capture script does not rate translation quality; it only pairs source',
    '> and translated paragraphs so a reviewer can rate coherence / context /',
    '> accuracy / formatting on the 1-5 scale described in `demo/TESTING-INSTRUCTIONS.md`.',
    '',
  ];

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
  const out = spawnSync(
    'aws',
    [
      'dynamodb',
      'get-item',
      '--table-name',
      'lfmt-jobs-LfmtPocDev',
      '--key',
      JSON.stringify({ jobId: { S: jobId }, userId: { S: userId } }),
      '--projection-expression',
      'createdAt',
    ],
    { encoding: 'utf8' }
  );
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
  const out = spawnSync(
    'aws',
    [
      'dynamodb',
      'get-item',
      '--table-name',
      'lfmt-jobs-LfmtPocDev',
      '--key',
      JSON.stringify({ jobId: { S: jobId }, userId: { S: userId } }),
      '--projection-expression',
      'tokensUsed,estimatedCost,totalChunks,translatedChunks',
    ],
    { encoding: 'utf8' }
  );
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

async function discoverJobId(fileId) {
  // Wait briefly for upload-complete Lambda to write the row, then scan
  // Jobs table for documentId == fileId.
  for (let attempt = 0; attempt < 30; attempt++) {
    const out = spawnSync(
      'aws',
      [
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
      ],
      { encoding: 'utf8' }
    );
    if (out.status === 0) {
      try {
        const parsed = JSON.parse(out.stdout);
        if (parsed.Items && parsed.Items.length > 0) {
          return parsed.Items[0].jobId.S;
        }
      } catch (e) {
        console.warn(`[discoverJobId] parse error: ${e.message}`);
      }
    } else {
      console.warn(`[discoverJobId] aws cli stderr: ${out.stderr}`);
    }
    console.log(`[discoverJobId] no job row yet for fileId=${fileId} (attempt ${attempt + 1}/30), waiting`);
    await sleep(2000);
  }
  return null;
}

// ---------- main ----------

async function main() {
  const arg = process.argv[2];
  const targets = arg ? CHAPTERS.filter((c) => c.key === arg) : CHAPTERS;
  if (targets.length === 0) {
    console.error(`Unknown chapter key: ${arg}. Use one of: ${CHAPTERS.map((c) => c.key).join(', ')}`);
    process.exit(1);
  }

  const auth = await ensureAuth();
  const summary = [];
  for (const ch of targets) {
    try {
      const result = await processChapter(ch, auth);
      summary.push({ key: ch.key, status: 'ok', metrics: result.metrics });
      // Brief pause between chapters to give the rate limiter slack.
      await sleep(15_000);
    } catch (err) {
      console.error(`[${ch.key}] FAILED: ${err.message}`);
      summary.push({ key: ch.key, status: 'failed', error: err.message });
    }
  }
  await writeFile(
    resolve(REPO_ROOT, 'demo', 'results', 'capture-summary.json'),
    JSON.stringify({ runAt: new Date().toISOString(), email: TEST_EMAIL, summary }, null, 2)
  );
  console.log('\n=== run complete — see demo/results/ ===');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(2);
});
