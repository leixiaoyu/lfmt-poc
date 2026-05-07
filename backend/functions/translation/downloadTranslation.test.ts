/**
 * Unit tests for the Download Translation endpoint
 * GET /translation/{jobId}/download
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

/** Build a minimal COMPLETED DynamoDB job item. */
function makeCompletedJobItem(overrides: Record<string, unknown> = {}) {
  // removeUndefinedValues: true prevents marshall from throwing when an
  // override explicitly sets a field to undefined (e.g., { filename: undefined }).
  return marshall(
    {
      jobId: 'job-123',
      userId: 'user-abc',
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

/** Build a minimal APIGateway event for GET /translation/{jobId}/download */
const createEvent = (jobId = 'job-123', userId = 'user-abc'): Partial<APIGatewayProxyEvent> => ({
  httpMethod: 'GET',
  path: `/translation/${jobId}/download`,
  pathParameters: { jobId },
  headers: { origin: 'http://localhost:3000' },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requestContext: {
    requestId: 'req-001',
    authorizer: { claims: { sub: userId, email: 'user@example.com' } },
  } as any,
});

/** Create an event with no authorizer (simulates unauthenticated request). */
const createUnauthenticatedEvent = (jobId = 'job-123'): Partial<APIGatewayProxyEvent> => ({
  httpMethod: 'GET',
  path: `/translation/${jobId}/download`,
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
      Contents: [{ Key: 'translated/job-123/chunk-0.txt' }],
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
        { Key: 'translated/job-123/chunk-0.txt' },
        { Key: 'translated/job-123/chunk-10.txt' },
        { Key: 'translated/job-123/chunk-2.txt' },
      ],
      IsTruncated: false,
    });

    // Return different content per key so we can verify ordering.
    s3Mock
      .on(GetObjectCommand, { Key: 'translated/job-123/chunk-0.txt' })
      .resolves({ Body: makeS3Stream('chunk0') } as any)
      .on(GetObjectCommand, { Key: 'translated/job-123/chunk-2.txt' })
      .resolves({ Body: makeS3Stream('chunk2') } as any)
      .on(GetObjectCommand, { Key: 'translated/job-123/chunk-10.txt' })
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
        authorizer: { claims: { sub: 'user-abc' } },
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

    const result = await handler(createEvent('missing-job') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
  });

  it('returns 404 when job belongs to a different user (BOLA prevention)', async () => {
    // The DynamoDB composite key query for the attacker's userId returns
    // no Item — the handler cannot distinguish "not found" from
    // "belongs to someone else", so both produce 404.
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const result = await handler(createEvent('job-123', 'attacker-xyz') as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(404);
    // Response body must not contain the job's actual userId or jobId data
    const body = JSON.parse(result.body);
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('translationStatus');
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
      Contents: [{ Key: 'translated/job-123/chunk-0.txt' }],
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
      Contents: [{ Key: 'translated/job-123/chunk-0.txt' }],
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
      Contents: [{ Key: 'translated/job-123/chunk-0.txt' }],
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
      Contents: [{ Key: 'translated/job-123/chunk-0.txt' }],
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
});
