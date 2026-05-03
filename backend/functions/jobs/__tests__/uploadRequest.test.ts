/**
 * Unit tests for uploadRequest Lambda function
 *
 * These tests verify the response shape and validation paths of the
 * presigned-URL handler. The CORS slice is covered separately in
 * `uploadRequest.cors.test.ts`; this file focuses on:
 *
 *   1. Successful response carries `jobId` in `body.data.jobId`
 *      (the contract surface PR #184 fixed — previously the handler
 *      built a `jobId` and silently discarded it before responding).
 *   2. Validation errors return 400 when required fields are missing.
 *   3. Auth context missing returns 401.
 *
 * The fixture is intentionally minimal: every test path must exercise the
 * full handler so type/contract regressions are caught at the handler
 * boundary, not buried inside helpers.
 */

// Required environment must be set BEFORE importing the handler — the
// module reads them at load time via getRequiredEnv().
process.env.DOCUMENT_BUCKET = 'test-bucket';
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.ATTESTATIONS_TABLE_NAME = 'test-attestations-table';
process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://d39xcun7144jgl.cloudfront.net';

// Mock AWS SDK clients BEFORE importing the handler so the module-scoped
// `S3Client` / `DynamoDBClient` instances pick up our test doubles.
const mockS3Send = jest.fn();
const mockDynamoSend = jest.fn();
const mockGetSignedUrl = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockDynamoSend })),
  PutItemCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

import { handler } from '../uploadRequest';
import { APIGatewayProxyEvent } from 'aws-lambda';

/**
 * Build a baseline mock event. Override any field via `overrides` —
 * shallow merge is intentional so per-test assertions stay readable.
 */
const buildEvent = (overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent =>
  ({
    headers: {
      origin: 'https://d39xcun7144jgl.cloudfront.net',
      Authorization: 'Bearer mock-token',
      'Content-Type': 'application/json',
    },
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: {
          sub: 'test-user-123',
        },
      },
      identity: {
        sourceIp: '127.0.0.1',
        userAgent: 'jest-test-agent',
      },
    } as unknown as APIGatewayProxyEvent['requestContext'],
    body: JSON.stringify({
      fileName: 'test.txt',
      fileSize: 1024,
      contentType: 'text/plain',
      legalAttestation: {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: new Date().toISOString(),
      },
    }),
    ...overrides,
  }) as APIGatewayProxyEvent;

describe('uploadRequest Lambda Function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://test-bucket.s3.amazonaws.com/test-presigned-url');
    mockDynamoSend.mockResolvedValue({});
  });

  describe('Successful response shape (PR #184 contract)', () => {
    it('should include jobId in response body data envelope', async () => {
      const response = await handler(buildEvent());

      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body);

      // The full envelope: { message, data: PresignedUrlResponse, requestId }.
      // PR #184's fix put `jobId` on `data` — assert it survives the round-trip.
      expect(parsed).toHaveProperty('data');
      expect(parsed.data).toHaveProperty('jobId');
      expect(typeof parsed.data.jobId).toBe('string');
      expect(parsed.data.jobId.length).toBeGreaterThan(0);

      // Companion fields the type contract (PresignedUrlResponse) requires.
      expect(parsed.data).toHaveProperty('uploadUrl');
      expect(parsed.data).toHaveProperty('fileId');
      expect(parsed.data).toHaveProperty('expiresIn', 900);
      expect(parsed.data).toHaveProperty('requiredHeaders');
      expect(parsed.data.requiredHeaders).toMatchObject({
        'Content-Type': 'text/plain',
        'Content-Length': '1024',
      });
    });

    it('should generate distinct jobId and fileId values', async () => {
      // jobId addresses the *job record* (status polling, deletion).
      // fileId addresses the *uploaded blob* (S3 key segment). They are
      // separate UUIDs by design — collapsing them would break job-deletion
      // semantics. Catch any future refactor that aliases them.
      const response = await handler(buildEvent());
      const parsed = JSON.parse(response.body);

      expect(parsed.data.jobId).not.toBe(parsed.data.fileId);
    });
  });

  describe('Validation error paths', () => {
    it('should return 400 when fileName is missing', async () => {
      const response = await handler(
        buildEvent({
          body: JSON.stringify({
            // fileName intentionally omitted
            fileSize: 1024,
            contentType: 'text/plain',
            legalAttestation: {
              acceptCopyrightOwnership: true,
              acceptTranslationRights: true,
              acceptLiabilityTerms: true,
            },
          }),
        })
      );

      expect(response.statusCode).toBe(400);
      const parsed = JSON.parse(response.body);
      expect(parsed.message).toMatch(/file validation failed/i);
    });

    it('should return 400 when legal attestation is missing', async () => {
      // Defense-in-depth: silently dropping consent is the OWASP A09 bug
      // closed in OpenSpec task 3.8.0. A request with no attestation MUST
      // be rejected at the handler boundary before any S3 / DynamoDB call.
      const response = await handler(
        buildEvent({
          body: JSON.stringify({
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
            // legalAttestation intentionally omitted
          }),
        })
      );

      expect(response.statusCode).toBe(400);
      const parsed = JSON.parse(response.body);
      expect(parsed.message).toMatch(/legal attestation is required/i);
      // No S3 presign / DynamoDB write should occur on validation failure.
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
      expect(mockDynamoSend).not.toHaveBeenCalled();
    });
  });

  describe('Auth context', () => {
    it('should return 401 when Cognito sub claim is absent', async () => {
      const response = await handler(
        buildEvent({
          requestContext: {
            requestId: 'test-request-id',
            authorizer: { claims: {} },
            identity: { sourceIp: '127.0.0.1', userAgent: 'jest-test-agent' },
          } as unknown as APIGatewayProxyEvent['requestContext'],
        })
      );

      expect(response.statusCode).toBe(401);
      const parsed = JSON.parse(response.body);
      expect(parsed.message).toMatch(/unauthorized/i);
    });
  });
});
