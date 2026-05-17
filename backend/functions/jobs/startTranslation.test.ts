/**
 * Unit tests for Start Translation endpoint
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.STATE_MACHINE_NAME = 'test-state-machine'; // State machine name (ARN constructed dynamically)
process.env.AWS_REGION = 'us-east-1';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { handler } from './startTranslation';

// Create mocks
const dynamoMock = mockClient(DynamoDBClient);
const sfnMock = mockClient(SFNClient);
const stsMock = mockClient(STSClient);

// No need to mock getCurrentUser since we're using requestContext directly

describe('startTranslation endpoint', () => {
  beforeEach(() => {
    dynamoMock.reset();
    sfnMock.reset();
    stsMock.reset();
    jest.clearAllMocks();

    // Mock STS GetCallerIdentity to return test account ID
    stsMock.on(GetCallerIdentityCommand).resolves({
      Account: '123456789012',
      UserId: 'test-user-id',
      Arn: 'arn:aws:iam::123456789012:user/test-user',
    });
  });

  // The UUID-shape regex used by the live contract spec and by the
  // backend unit assertions added in #267. Keep this in sync with
  // `frontend/e2e/tests/contract/api-envelope-live.spec.ts` — if the
  // shape ever changes (e.g. API Gateway switches to ULID), update
  // both sites in the same PR.
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const STUB_REQUEST_ID = '11111111-2222-4333-8444-555555555555';

  const createEvent = (jobId: string, body: any): Partial<APIGatewayProxyEvent> => ({
    httpMethod: 'POST',
    path: `/jobs/${jobId}/translate`,
    pathParameters: { jobId },
    body: JSON.stringify(body),
    headers: {
      Authorization: 'Bearer mock-token',
    },
    requestContext: {
      // #267 — every event MUST carry a `requestContext.requestId` UUID so
      // the Lambda can echo it back on both success and error paths.
      // API Gateway populates this in production; the tests stub it.
      requestId: STUB_REQUEST_ID,
      authorizer: {
        claims: {
          sub: 'user-123',
          email: 'test@example.com',
        },
      },
    } as any,
  });

  describe('successful translation start', () => {
    it('should start translation for a chunked job', async () => {
      // Mock job data
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '10' },
        },
      } as any);

      dynamoMock.on(UpdateItemCommand).resolves({} as any);
      sfnMock.on(StartExecutionCommand).resolves({
        executionArn:
          'arn:aws:states:us-east-1:123456789012:execution:test-state-machine:test-execution',
      } as any);

      const event = createEvent('job-123', {
        targetLanguage: 'es',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.message).toContain('Translation started successfully');
      expect(body.jobId).toBe('job-123');
      expect(body.translationStatus).toBe('IN_PROGRESS');
      expect(body.targetLanguage).toBe('es');
      expect(body.totalChunks).toBe(10);
      // #229: renamed from `chunksTranslated` → `translatedChunks` to match DDB column.
      expect(body.translatedChunks).toBe(0);
      // Regression guard: old field name MUST NOT appear on the wire.
      expect(body).not.toHaveProperty('chunksTranslated');
      expect(body.estimatedCompletion).toBeDefined();
      expect(body.estimatedCost).toBeGreaterThan(0);
      expect(body.executionArn).toBeDefined();
      // #267 — success responses must echo the API Gateway request UUID
      // verbatim. Pre-#267 this slot was being filled with an error-code
      // string on the error path (broken wire contract).
      expect(body.requestId).toBe(STUB_REQUEST_ID);
      expect(body.requestId).toMatch(UUID_REGEX);
      // #267 — success responses MUST NOT carry an `errorCode` field.
      expect(body).not.toHaveProperty('errorCode');

      // Verify DynamoDB update was called
      const dynamoCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(dynamoCalls.length).toBe(1);

      // Verify Step Functions execution started
      const sfnCalls = sfnMock.commandCalls(StartExecutionCommand);
      expect(sfnCalls.length).toBe(1);
      // Check that state machine ARN is correctly constructed from STATE_MACHINE_NAME
      const expectedArn = `arn:aws:states:${process.env.AWS_REGION}:123456789012:stateMachine:${process.env.STATE_MACHINE_NAME}`;
      expect(sfnCalls[0].args[0].input.stateMachineArn).toBe(expectedArn);
    });

    it('should start translation with custom tone', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '5' },
        },
      } as any);

      dynamoMock.on(UpdateItemCommand).resolves({} as any);
      sfnMock.on(StartExecutionCommand).resolves({} as any);

      const event = createEvent('job-123', {
        targetLanguage: 'fr',
        tone: 'formal',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.targetLanguage).toBe('fr');
    });

    it('should start translation with custom contextChunks', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '5' },
        },
      } as any);

      dynamoMock.on(UpdateItemCommand).resolves({} as any);
      sfnMock.on(StartExecutionCommand).resolves({} as any);

      const event = createEvent('job-123', {
        targetLanguage: 'de',
        contextChunks: 3,
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);
    });
  });

  describe('validation errors', () => {
    it('should reject missing jobId', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'POST',
        path: '/jobs/translate',
        pathParameters: {},
        body: JSON.stringify({ targetLanguage: 'es' }),
        headers: {
          origin: 'http://localhost:3000',
        },
        requestContext: {
          authorizer: {
            claims: { sub: 'user-123' },
          },
        } as any,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Missing jobId');
    });

    it('should reject missing targetLanguage', async () => {
      const event = createEvent('job-123', {});

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('targetLanguage is required');
    });

    it('should reject invalid targetLanguage', async () => {
      const event = createEvent('job-123', {
        targetLanguage: 'invalid',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Invalid targetLanguage');
    });

    it('should accept all valid target languages', async () => {
      const validLanguages = ['es', 'fr', 'it', 'de', 'zh'];

      for (const lang of validLanguages) {
        dynamoMock.on(GetItemCommand).resolves({
          Item: {
            jobId: { S: 'job-123' },
            userId: { S: 'user-123' },
            status: { S: 'CHUNKED' },
            totalChunks: { N: '5' },
          },
        } as any);

        dynamoMock.on(UpdateItemCommand).resolves({} as any);
        sfnMock.on(StartExecutionCommand).resolves({} as any);

        const event = createEvent('job-123', {
          targetLanguage: lang,
        });

        const result = await handler(event as APIGatewayProxyEvent);

        expect(result.statusCode).toBe(200);
      }
    });

    it('should reject invalid tone', async () => {
      const event = createEvent('job-123', {
        targetLanguage: 'es',
        tone: 'invalid',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Invalid tone');
    });

    it('should reject contextChunks out of range', async () => {
      const event = createEvent('job-123', {
        targetLanguage: 'es',
        contextChunks: 10,
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('contextChunks must be between 0 and 5');
    });
  });

  describe('authorization and permissions', () => {
    it('should reject job not found', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: undefined,
      } as any);

      const event = createEvent('nonexistent', {
        targetLanguage: 'es',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Job not found');
    });

    it('should reject job owned by different user', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'other-user' },
          status: { S: 'CHUNKED' },
        },
      } as any);

      const event = createEvent('job-123', {
        targetLanguage: 'es',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('permission');
    });
  });

  describe('job status validation', () => {
    it('should reject job not in CHUNKED status', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'PENDING_UPLOAD' },
        },
      } as any);

      const event = createEvent('job-123', {
        targetLanguage: 'es',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('must be in CHUNKED status');
    });

    it('should reject already in-progress translation', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
        },
      } as any);

      const event = createEvent('job-123', {
        targetLanguage: 'es',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('already');
    });

    it('should reject already completed translation', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'COMPLETED' },
        },
      } as any);

      const event = createEvent('job-123', {
        targetLanguage: 'es',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('already completed');
    });

    it('should reject job with no chunks', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '0' },
        },
      } as any);

      const event = createEvent('job-123', {
        targetLanguage: 'es',
      });

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('no chunks');
    });
  });

  // -------------------------------------------------------------------------
  // #267 — error envelope wire-contract guard.
  //
  // Pre-#267 the Lambda emitted `{ message, requestId: '<ERROR_CODE>' }` —
  // stuffing the machine-readable status-code string into the slot reserved
  // for the API Gateway correlation UUID. The fix separates the two concerns:
  //
  //   - `requestId` MUST be the UUID echoed from `event.requestContext.requestId`.
  //   - `errorCode` MUST be the status-code discriminator (new field).
  //
  // These assertions pin the contract against future drift. If a maintainer
  // accidentally reverts to the pre-#267 shape, the relevant test below
  // fails loudly.
  // -------------------------------------------------------------------------
  describe('error envelope shape (#267)', () => {
    const assertErrorEnvelope = (
      body: Record<string, unknown>,
      expectedErrorCode: string,
      expectedMessageFragment: string
    ): void => {
      // `requestId` must be the UUID (NOT the error code string).
      expect(typeof body.requestId).toBe('string');
      expect(body.requestId).toBe(STUB_REQUEST_ID);
      expect(body.requestId as string).toMatch(UUID_REGEX);
      // `errorCode` must carry the machine-readable status-code signal.
      expect(body.errorCode).toBe(expectedErrorCode);
      // Anti-regression: the error code MUST NOT leak into `requestId`.
      expect(body.requestId).not.toBe(expectedErrorCode);
      // `message` should remain human-readable prose, not the status-code.
      expect(typeof body.message).toBe('string');
      expect(body.message as string).toContain(expectedMessageFragment);
      expect(body.message).not.toBe(expectedErrorCode);
    };

    it('emits errorCode=TRANSLATION_ALREADY_STARTED with UUID requestId on IN_PROGRESS conflict', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
        },
      } as any);

      const event = createEvent('job-123', { targetLanguage: 'es' });
      const result = await handler(event as APIGatewayProxyEvent);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      assertErrorEnvelope(body, 'TRANSLATION_ALREADY_STARTED', 'already in_progress');
    });

    it('emits errorCode=TRANSLATION_ALREADY_STARTED on COMPLETED conflict', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'COMPLETED' },
        },
      } as any);

      const event = createEvent('job-123', { targetLanguage: 'es' });
      const result = await handler(event as APIGatewayProxyEvent);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      assertErrorEnvelope(body, 'TRANSLATION_ALREADY_STARTED', 'already completed');
    });

    it('emits errorCode=JOB_NOT_FOUND with UUID requestId when job is missing', async () => {
      dynamoMock.on(GetItemCommand).resolves({ Item: undefined } as any);

      const event = createEvent('missing', { targetLanguage: 'es' });
      const result = await handler(event as APIGatewayProxyEvent);
      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      assertErrorEnvelope(body, 'JOB_NOT_FOUND', 'Job not found');
    });

    it('emits errorCode=FORBIDDEN when the caller does not own the job', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'other-user' },
          status: { S: 'CHUNKED' },
        },
      } as any);

      const event = createEvent('job-123', { targetLanguage: 'es' });
      const result = await handler(event as APIGatewayProxyEvent);
      expect(result.statusCode).toBe(403);
      const body = JSON.parse(result.body);
      assertErrorEnvelope(body, 'FORBIDDEN', 'permission');
    });

    it('emits errorCode=INVALID_JOB_STATUS when job is not in CHUNKED status', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'PENDING_UPLOAD' },
        },
      } as any);

      const event = createEvent('job-123', { targetLanguage: 'es' });
      const result = await handler(event as APIGatewayProxyEvent);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      assertErrorEnvelope(body, 'INVALID_JOB_STATUS', 'must be in CHUNKED status');
    });

    it('emits errorCode=NO_CHUNKS_AVAILABLE when job has 0 chunks', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '0' },
        },
      } as any);

      const event = createEvent('job-123', { targetLanguage: 'es' });
      const result = await handler(event as APIGatewayProxyEvent);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      assertErrorEnvelope(body, 'NO_CHUNKS_AVAILABLE', 'no chunks');
    });

    it('emits errorCode=INVALID_REQUEST for validation failures (e.g. invalid targetLanguage)', async () => {
      const event = createEvent('job-123', { targetLanguage: 'klingon' });
      const result = await handler(event as APIGatewayProxyEvent);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      assertErrorEnvelope(body, 'INVALID_REQUEST', 'Invalid targetLanguage');
    });

    it('does NOT stuff the error code into requestId — anti-regression guard for the pre-#267 bug', async () => {
      // This is the EXACT failure mode #267 describes. If anyone reverts
      // `createErrorResponse` arg-order or re-introduces the legacy call
      // pattern in startTranslation.ts, this test fires.
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
        },
      } as any);

      const event = createEvent('job-123', { targetLanguage: 'es' });
      const result = await handler(event as APIGatewayProxyEvent);
      const body = JSON.parse(result.body);
      // The pre-#267 shape: requestId === 'TRANSLATION_ALREADY_STARTED'.
      expect(body.requestId).not.toBe('TRANSLATION_ALREADY_STARTED');
      // The pre-#267 shape also did NOT include errorCode.
      expect(body).toHaveProperty('errorCode');
    });
  });
});
