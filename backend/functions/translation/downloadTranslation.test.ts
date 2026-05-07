/**
 * Unit tests for the Download Translation endpoint
 * GET /jobs/{jobId}/download
 */

// Set required environment variables BEFORE any imports so that getRequiredEnv()
// succeeds at module-evaluation time (same pattern as getJob.test.ts).
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.DOCUMENT_BUCKET = 'test-documents-bucket';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { marshall } from '@aws-sdk/util-dynamodb';
import { sdkStreamMixin } from '@smithy/util-stream';
import { Readable } from 'stream';
import { handler } from './downloadTranslation';

const dynamoMock = mockClient(DynamoDBClient);
const s3Mock = mockClient(S3Client);

/** Wrap a plain string as an S3-compatible SDK stream body. */
function makeS3Stream(content: string) {
  return sdkStreamMixin(Readable.from([content]));
}

// Standard test UUIDs — all test-event defaults use these so the UUID
// validation guard in the handler doesn't reject before we get to the logic
// under test.
const TEST_JOB_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Build a minimal COMPLETED DynamoDB job item. */
function makeCompletedJobItem(overrides: Record<string, unknown> = {}) {
  // removeUndefinedValues: true prevents marshall from throwing when an
  // override explicitly sets a field to undefined (e.g., { filename: undefined }).
  return marshall(
    {
      jobId: TEST_JOB_ID,
      userId: TEST_USER_ID,
      status: 'COMPLETED',
      translationStatus: 'COMPLETED',
      filename: 'original.txt',
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:05:00.000Z',
      ...overrides,
    },
    { removeUndefinedValues: true }
  );
}

/** Build a minimal APIGateway event for GET /jobs/{jobId}/download */
const createEvent = (
  jobId = TEST_JOB_ID,
  userId = TEST_USER_ID
): Partial<APIGatewayProxyEvent> => ({
  httpMethod: 'GET',
  path: `/jobs/${jobId}/download`,
  pathParameters: { jobId },
  headers: { origin: 'http://localhost:3000' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestContext: {
    requestId: 'req-001',
    authorizer: { claims: { sub: userId, email: 'user@example.com' } },
  } as any,
});

/** Create an event with no authorizer (simulates unauthenticated request). */
const createUnauthenticatedEvent = (jobId = TEST_JOB_ID): Partial<APIGatewayProxyEvent> => ({
  httpMethod: 'GET',
  path: `/jobs/${jobId}/download`,
  pathParameters: { jobId },
  headers: { origin: 'http://localhost:3000' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestContext: {
    requestId: 'req-unauth',
  } as any,
});

describe('downloadTranslation handler', () => {
  beforeEach(() => {
    dynamoMock.reset();
    s3Mock.reset();
  });

  // -------------------------------------------------------------------------
  // Happy path — single chunk
  // -------------------------------------------------------------------------

  it('returns 200 with raw text content for a single-chunk completed job', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: makeCompletedJobItem() });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({
      Body: makeS3Stream('Bonjour le monde'),
    } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('Bonjour le monde');
    expect(result.headers?.['Content-Type']).toContain('text/plain');
    expect(result.headers?.['Content-Disposition']).toContain('translated_original.txt');
    expect(result.isBase64Encoded).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Happy path — multi-chunk (order must be correct)
  // -------------------------------------------------------------------------

  it('returns chunks concatenated in numeric order (not lexicographic)', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: makeCompletedJobItem() });

    // S3 ListObjectsV2 returns keys in lexicographic order — chunk-10 comes
    // before chunk-2 lexicographically. The handler must sort numerically.
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: `translated/${TEST_JOB_ID}/chunk-0.txt` },
        { Key: `translated/${TEST_JOB_ID}/chunk-10.txt` },
        { Key: `translated/${TEST_JOB_ID}/chunk-2.txt` },
      ],
      IsTruncated: false,
    });

    // Return different content per key so we can verify ordering.
    s3Mock
      .on(GetObjectCommand, { Key: `translated/${TEST_JOB_ID}/chunk-0.txt` })
      .resolves({ Body: makeS3Stream('chunk0') } as any)
      .on(GetObjectCommand, { Key: `translated/${TEST_JOB_ID}/chunk-2.txt` })
      .resolves({ Body: makeS3Stream('chunk2') } as any)
      .on(GetObjectCommand, { Key: `translated/${TEST_JOB_ID}/chunk-10.txt` })
      .resolves({ Body: makeS3Stream('chunk10') } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    // Numeric order: 0, 2, 10 — NOT lexicographic 0, 10, 2
    expect(result.body).toBe('chunk0\nchunk2\nchunk10');
  });

  // -------------------------------------------------------------------------
  // Auth failures
  // -------------------------------------------------------------------------

  it('returns 401 when the Cognito authorizer claims are absent', async () => {
    const result = await handler(createUnauthenticatedEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body);
    expect(body.message).toMatch(/Unauthorized/i);
  });

  // -------------------------------------------------------------------------
  // Path parameter validation
  // -------------------------------------------------------------------------

  it('returns 400 when jobId path parameter is missing', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      httpMethod: 'GET',
      path: '/translation//download',
      pathParameters: null,
      headers: { origin: 'http://localhost:3000' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      requestContext: {
        requestId: 'req-bad',
        authorizer: { claims: { sub: TEST_USER_ID } },
      } as any,
    };

    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('jobId');
  });

  // -------------------------------------------------------------------------
  // Not found + BOLA (Broken Object Level Authorization)
  // -------------------------------------------------------------------------

  it('returns 404 when job does not exist', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    // Use a valid UUID that doesn't match any seeded job.
    const result = await handler(
      createEvent('99999999-9999-9999-9999-999999999999') as APIGatewayProxyEvent
    );

    expect(result.statusCode).toBe(404);
  });

  it('returns 404 when job belongs to a different user (BOLA prevention) — non-vacuous', async () => {
    // Non-vacuous ownership test: the DDB mock returns the real job ONLY when
    // queried with the owner's composite key (jobId + ownerUserId). A request from
    // attackerUserId queries a different composite key and gets Item: undefined.
    //
    // This test FAILS if you remove the ownership check from the handler because
    // without it the handler would fetch the job item unconditionally (or skip
    // the DDB call entirely), returning 200 instead of 404.
    // Must be valid UUIDs so the UUID-format guard doesn't reject early.
    const ownerUserId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const attackerUserId = 'bbbbbbbb-0000-0000-0000-000000000002';
    const jobId = 'cccccccc-0000-0000-0000-000000000003';

    const ownerKey = marshall({ jobId, userId: ownerUserId });
    const attackerKey = marshall({ jobId, userId: attackerUserId });

    // Seed: owner's key → real job record; attacker's key → not found.
    dynamoMock
      .on(GetItemCommand, { Key: ownerKey })
      .resolves({ Item: makeCompletedJobItem({ jobId, userId: ownerUserId }) })
      .on(GetItemCommand, { Key: attackerKey })
      .resolves({ Item: undefined });

    // Attacker's request — must get 404, not the job content.
    const attackerResult = await handler(
      createEvent(jobId, attackerUserId) as APIGatewayProxyEvent
    );
    expect(attackerResult.statusCode).toBe(404);
    const attackerBody = JSON.parse(attackerResult.body);
    expect(attackerBody).not.toHaveProperty('userId');
    expect(attackerBody).not.toHaveProperty('translationStatus');

    // Sanity-check: owner's request returns 200 (proves the mock is set up correctly).
    // Without this, a mock that ALWAYS returns undefined would also pass the attacker test,
    // making it a vacuous green.
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${jobId}/chunk-0.txt` }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('content') } as any);

    const ownerResult = await handler(createEvent(jobId, ownerUserId) as APIGatewayProxyEvent);
    expect(ownerResult.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Status guard — 409 for non-COMPLETED jobs
  // -------------------------------------------------------------------------

  it('returns 409 with current status when job is IN_PROGRESS', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({ translationStatus: 'IN_PROGRESS', status: 'IN_PROGRESS' }),
    });

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('IN_PROGRESS');
  });

  it('returns 409 with current status when job is CHUNKED (not yet started)', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({ translationStatus: 'NOT_STARTED', status: 'CHUNKED' }),
    });

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(409);
  });

  it('returns 409 when job translationStatus is TRANSLATION_FAILED', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({
        translationStatus: 'TRANSLATION_FAILED',
        status: 'TRANSLATION_FAILED',
      }),
    });

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(409);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('TRANSLATION_FAILED');
  });

  // -------------------------------------------------------------------------
  // Data integrity — no chunks in S3 for a COMPLETED job
  // -------------------------------------------------------------------------

  it('returns 500 when job is COMPLETED but S3 has no chunk objects', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: makeCompletedJobItem() });

    s3Mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('no translated chunks');
  });

  // -------------------------------------------------------------------------
  // S3 GetObject failure
  // -------------------------------------------------------------------------

  it('returns 500 when S3 GetObject fails for a chunk', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: makeCompletedJobItem() });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).rejects(new Error('S3 unavailable'));

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
  });

  // -------------------------------------------------------------------------
  // DynamoDB failure
  // -------------------------------------------------------------------------

  it('returns 500 on an unexpected DynamoDB error', async () => {
    dynamoMock.on(GetItemCommand).rejects(new Error('DynamoDB unavailable'));

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toContain('Failed to download translation');
  });

  // -------------------------------------------------------------------------
  // Filename derivation
  // -------------------------------------------------------------------------

  it('prefixes the original filename with "translated_" in Content-Disposition', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({ filename: 'my-document.txt' }),
    });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('text') } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Disposition']).toContain('translated_my-document.txt');
  });

  it('falls back to "translated_translation.txt" when filename is absent from job record', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      // Omit the filename field
      Item: makeCompletedJobItem({ filename: undefined }),
    });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('text') } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Content-Disposition']).toContain('translated_translation.txt');
  });

  // -------------------------------------------------------------------------
  // CORS headers present on all responses
  // -------------------------------------------------------------------------

  it('includes CORS Access-Control-Allow-Origin header on 200 response', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: makeCompletedJobItem() });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('text') } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBeDefined();
  });

  it('includes CORS Access-Control-Allow-Origin header on 404 error response', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    expect(result.headers?.['Access-Control-Allow-Origin']).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // X-Content-Type-Options (OMC security — response header)
  // -------------------------------------------------------------------------

  it('includes X-Content-Type-Options: nosniff on 200 response', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: makeCompletedJobItem() });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('text') } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(result.headers?.['X-Content-Type-Options']).toBe('nosniff');
  });

  // -------------------------------------------------------------------------
  // UUID validation on jobId (OMC security #13)
  // -------------------------------------------------------------------------

  it('returns 400 for non-UUID jobId (path-traversal guard)', async () => {
    const event = createEvent('../secrets', TEST_USER_ID);
    const result = await handler(event as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toMatch(/UUID/i);
  });

  it('accepts a valid UUID-format jobId', async () => {
    const uuidJobId = '550e8400-e29b-41d4-a716-446655440000';
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({ jobId: uuidJobId }),
    });
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${uuidJobId}/chunk-0.txt` }],
      IsTruncated: false,
    });
    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('ok') } as any);

    const event = createEvent(uuidJobId);
    const result = await handler(event as APIGatewayProxyEvent);

    // Should not be rejected on UUID format (may fail chunk count check if totalChunks set)
    expect(result.statusCode).not.toBe(400);
  });

  // -------------------------------------------------------------------------
  // Chunk count integrity (OMC security #11)
  // -------------------------------------------------------------------------

  it('returns 500 when S3 chunk count does not match job.totalChunks', async () => {
    // Job says 3 chunks; S3 only has 2 — partial document guard.
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({ totalChunks: 3 }),
    });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: `translated/${TEST_JOB_ID}/chunk-0.txt` },
        { Key: `translated/${TEST_JOB_ID}/chunk-1.txt` },
      ],
      IsTruncated: false,
    });

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toMatch(/incomplete/i);
    expect(body.message).toContain('3');
    expect(body.message).toContain('2');
  });

  it('returns 200 when S3 chunk count exactly matches job.totalChunks', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({ totalChunks: 1 }),
    });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('ok') } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Extended numeric ordering edge case (OMC test #19 — chunk-0..chunk-12)
  // Forces lexicographic-vs-numeric divergence across two digit-length groups.
  // -------------------------------------------------------------------------

  it('correctly orders chunk-0 through chunk-12 (not lexicographic)', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: makeCompletedJobItem({ totalChunks: 13 }) });

    // S3 returns in lexicographic order (0, 1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9)
    const lexOrder = [0, 1, 10, 11, 12, 2, 3, 4, 5, 6, 7, 8, 9];
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: lexOrder.map((n) => ({ Key: `translated/${TEST_JOB_ID}/chunk-${n}.txt` })),
      IsTruncated: false,
    });

    // Each chunk returns its index as content
    for (const n of lexOrder) {
      s3Mock
        .on(GetObjectCommand, { Key: `translated/${TEST_JOB_ID}/chunk-${n}.txt` })
        .resolves({ Body: makeS3Stream(`c${n}`) } as any);
    }

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    // Numeric order: c0,c1,c2,...,c12
    const expected = Array.from({ length: 13 }, (_, i) => `c${i}`).join('\n');
    expect(result.body).toBe(expected);
  });

  // -------------------------------------------------------------------------
  // Filename sanitization (OMC security #10)
  // -------------------------------------------------------------------------

  it('falls back to generic name when filename contains header-injection characters', async () => {
    // Newlines/quotes in Content-Disposition could smuggle extra headers.
    dynamoMock.on(GetItemCommand).resolves({
      Item: makeCompletedJobItem({ filename: 'evil\r\nX-Injected: bad.txt' }),
    });

    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: `translated/${TEST_JOB_ID}/chunk-0.txt` }],
      IsTruncated: false,
    });

    s3Mock.on(GetObjectCommand).resolves({ Body: makeS3Stream('text') } as any);

    const result = await handler(createEvent() as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    const contentDisposition = result.headers?.['Content-Disposition'] ?? '';
    // Must NOT contain the injection payload
    expect(contentDisposition).not.toContain('X-Injected');
    // Must contain a safe fallback name
    expect(contentDisposition).toContain('translated_document.txt');
  });
});
