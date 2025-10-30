/**
 * Unit tests for Start Translation endpoint
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.TRANSLATE_CHUNK_FUNCTION_NAME = 'test-translate-chunk-function';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { handler } from './startTranslation';

// Create mocks
const dynamoMock = mockClient(DynamoDBClient);
const lambdaMock = mockClient(LambdaClient);

// No need to mock getCurrentUser since we're using requestContext directly

describe('startTranslation endpoint', () => {
  beforeEach(() => {
    dynamoMock.reset();
    lambdaMock.reset();
    jest.clearAllMocks();
  });

  const createEvent = (
    jobId: string,
    body: any
  ): Partial<APIGatewayProxyEvent> => ({
    httpMethod: 'POST',
    path: `/jobs/${jobId}/translate`,
    pathParameters: { jobId },
    body: JSON.stringify(body),
    headers: {
      Authorization: 'Bearer mock-token',
    },
    requestContext: {
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
      lambdaMock.on(InvokeCommand).resolves({} as any);

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
      expect(body.chunksTranslated).toBe(0);
      expect(body.estimatedCompletion).toBeDefined();
      expect(body.estimatedCost).toBeGreaterThan(0);

      // Verify DynamoDB update was called
      const dynamoCalls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(dynamoCalls.length).toBe(1);

      // Verify Lambda invocation
      const lambdaCalls = lambdaMock.commandCalls(InvokeCommand);
      expect(lambdaCalls.length).toBe(1);
      expect(lambdaCalls[0].args[0].input.InvocationType).toBe('Event');
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
      lambdaMock.on(InvokeCommand).resolves({} as any);

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
      lambdaMock.on(InvokeCommand).resolves({} as any);

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
        lambdaMock.on(InvokeCommand).resolves({} as any);

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
});
