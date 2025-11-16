/**
 * Unit tests for Get Translation Status endpoint
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { handler } from './getTranslationStatus';

// Create mocks
const dynamoMock = mockClient(DynamoDBClient);

describe('getTranslationStatus endpoint', () => {
  beforeEach(() => {
    dynamoMock.reset();
    jest.clearAllMocks();
  });

  const createEvent = (jobId: string): Partial<APIGatewayProxyEvent> => ({
    httpMethod: 'GET',
    path: `/jobs/${jobId}/translation-status`,
    pathParameters: { jobId },
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

  describe('successful status retrieval', () => {
    it('should return status for translation not started', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '10' },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.jobId).toBe('job-123');
      expect(body.status).toBe('CHUNKED');
      expect(body.translationStatus).toBe('NOT_STARTED');
      expect(body.totalChunks).toBe(10);
      expect(body.chunksTranslated).toBe(0);
      expect(body.progressPercentage).toBe(0);
      expect(body.estimatedCompletion).toBeUndefined();
    });

    it('should return status for in-progress translation', async () => {
      const startedAt = new Date('2025-10-30T10:00:00Z').toISOString();

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
          targetLanguage: { S: 'es' },
          translationTone: { S: 'formal' },
          totalChunks: { N: '10' },
          translatedChunks: { N: '5' },
          tokensUsed: { N: '15000' },
          estimatedCost: { N: '0.001125' },
          translationStartedAt: { S: startedAt },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.jobId).toBe('job-123');
      expect(body.status).toBe('CHUNKED');
      expect(body.translationStatus).toBe('IN_PROGRESS');
      expect(body.targetLanguage).toBe('es');
      expect(body.tone).toBe('formal');
      expect(body.totalChunks).toBe(10);
      expect(body.chunksTranslated).toBe(5);
      expect(body.progressPercentage).toBe(50);
      expect(body.tokensUsed).toBe(15000);
      expect(body.estimatedCost).toBe(0.001125);
      expect(body.translationStartedAt).toBe(startedAt);
      expect(body.estimatedCompletion).toBeDefined();
    });

    it('should return status for completed translation', async () => {
      const startedAt = new Date('2025-10-30T10:00:00Z').toISOString();
      const completedAt = new Date('2025-10-30T10:30:00Z').toISOString();

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'COMPLETED' },
          targetLanguage: { S: 'fr' },
          totalChunks: { N: '10' },
          translatedChunks: { N: '10' },
          tokensUsed: { N: '35000' },
          estimatedCost: { N: '0.002625' },
          translationStartedAt: { S: startedAt },
          translationCompletedAt: { S: completedAt },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.jobId).toBe('job-123');
      expect(body.status).toBe('CHUNKED');
      expect(body.translationStatus).toBe('COMPLETED');
      expect(body.targetLanguage).toBe('fr');
      expect(body.totalChunks).toBe(10);
      expect(body.chunksTranslated).toBe(10);
      expect(body.progressPercentage).toBe(100);
      expect(body.tokensUsed).toBe(35000);
      expect(body.estimatedCost).toBe(0.002625);
      expect(body.translationStartedAt).toBe(startedAt);
      expect(body.translationCompletedAt).toBe(completedAt);
      expect(body.estimatedCompletion).toBeUndefined();
    });

    it('should return status for failed translation', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'TRANSLATION_FAILED' },
          targetLanguage: { S: 'de' },
          totalChunks: { N: '10' },
          translatedChunks: { N: '3' },
          tokensUsed: { N: '10000' },
          translationError: { S: 'API rate limit exceeded' },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body.jobId).toBe('job-123');
      expect(body.status).toBe('CHUNKED');
      expect(body.translationStatus).toBe('TRANSLATION_FAILED');
      expect(body.targetLanguage).toBe('de');
      expect(body.totalChunks).toBe(10);
      expect(body.chunksTranslated).toBe(3);
      expect(body.progressPercentage).toBe(30);
      expect(body.error).toBe('API rate limit exceeded');
    });

    it('should calculate progress correctly with various chunk counts', async () => {
      const testCases = [
        { translated: 0, total: 10, expected: 0 },
        { translated: 1, total: 10, expected: 10 },
        { translated: 5, total: 10, expected: 50 },
        { translated: 7, total: 10, expected: 70 },
        { translated: 10, total: 10, expected: 100 },
        { translated: 3, total: 7, expected: 43 }, // 3/7 = 42.857... rounds to 43
        { translated: 0, total: 0, expected: 0 }, // Edge case: no chunks
      ];

      for (const testCase of testCases) {
        dynamoMock.on(GetItemCommand).resolves({
          Item: {
            jobId: { S: 'job-123' },
            userId: { S: 'user-123' },
            status: { S: 'CHUNKED' },
            translationStatus: { S: 'IN_PROGRESS' },
            totalChunks: { N: testCase.total.toString() },
            translatedChunks: { N: testCase.translated.toString() },
          },
        } as any);

        const event = createEvent('job-123');
        const result = await handler(event as APIGatewayProxyEvent);

        const body = JSON.parse(result.body);
        expect(body.progressPercentage).toBe(testCase.expected);
      }
    });
  });

  describe('authentication and authorization', () => {
    it('should reject request without authentication', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/jobs/job-123/translation-status',
        pathParameters: { jobId: 'job-123' },
        requestContext: {} as any,
      };

      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(401);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Unauthorized');
    });

    it('should return 404 for job owned by different user (composite key security)', async () => {
      // With composite key (jobId + userId), accessing another user's job returns no item
      // This is better security - doesn't leak information about whether job exists
      dynamoMock.on(GetItemCommand).resolves({
        Item: undefined, // DynamoDB returns no item when key doesn't match
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Job not found');
    });
  });

  describe('error handling', () => {
    it('should reject missing jobId', async () => {
      const event: Partial<APIGatewayProxyEvent> = {
        httpMethod: 'GET',
        path: '/jobs//translation-status',
        pathParameters: {},
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

    it('should handle job not found', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: undefined,
      } as any);

      const event = createEvent('nonexistent-job');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(404);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Job not found');
    });

    it('should handle DynamoDB errors gracefully', async () => {
      dynamoMock
        .on(GetItemCommand)
        .rejects(new Error('DynamoDB connection timeout'));

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(500);
      const body = JSON.parse(result.body);
      expect(body.message).toContain('Failed to get translation status');
    });
  });

  describe('estimated completion calculation', () => {
    it('should calculate estimated completion for in-progress translation', async () => {
      // Started 10 minutes ago, completed 5 out of 10 chunks
      // Should estimate 10 more minutes (5 chunks at 2 min/chunk)
      const startedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
          totalChunks: { N: '10' },
          translatedChunks: { N: '5' },
          translationStartedAt: { S: startedAt },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      const body = JSON.parse(result.body);
      expect(body.estimatedCompletion).toBeDefined();

      // Verify it's a valid ISO timestamp
      const estimatedTime = new Date(body.estimatedCompletion);
      expect(estimatedTime.getTime()).toBeGreaterThan(Date.now());

      // Should be roughly 10 minutes from now (5 remaining chunks * 2 min/chunk)
      const expectedTime = Date.now() + 10 * 60 * 1000;
      const timeDiff = Math.abs(estimatedTime.getTime() - expectedTime);
      expect(timeDiff).toBeLessThan(5000); // Allow 5 second tolerance
    });

    it('should not calculate estimated completion when no progress yet', async () => {
      const startedAt = new Date().toISOString();

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
          totalChunks: { N: '10' },
          translatedChunks: { N: '0' },
          translationStartedAt: { S: startedAt },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      const body = JSON.parse(result.body);
      expect(body.estimatedCompletion).toBeUndefined();
    });

    it('should not calculate estimated completion when not started', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '10' },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      const body = JSON.parse(result.body);
      expect(body.estimatedCompletion).toBeUndefined();
    });
  });

  describe('response format', () => {
    it('should include all required fields in response', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          translationStatus: { S: 'IN_PROGRESS' },
          targetLanguage: { S: 'es' },
          translationTone: { S: 'neutral' },
          totalChunks: { N: '5' },
          translatedChunks: { N: '2' },
          tokensUsed: { N: '7000' },
          estimatedCost: { N: '0.000525' },
          translationStartedAt: { S: new Date().toISOString() },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body);
      expect(body).toHaveProperty('jobId');
      expect(body).toHaveProperty('translationStatus');
      expect(body).toHaveProperty('targetLanguage');
      expect(body).toHaveProperty('tone');
      expect(body).toHaveProperty('totalChunks');
      expect(body).toHaveProperty('chunksTranslated');
      expect(body).toHaveProperty('progressPercentage');
      expect(body).toHaveProperty('tokensUsed');
      expect(body).toHaveProperty('estimatedCost');
      expect(body).toHaveProperty('translationStartedAt');
    });

    it('should have CORS headers in response', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          jobId: { S: 'job-123' },
          userId: { S: 'user-123' },
          status: { S: 'CHUNKED' },
          totalChunks: { N: '5' },
        },
      } as any);

      const event = createEvent('job-123');
      const result = await handler(event as APIGatewayProxyEvent);

      expect(result.headers).toBeDefined();
      expect(result.headers?.['Access-Control-Allow-Origin']).toBeDefined();
      expect(result.headers?.['Content-Type']).toBe('application/json');
    });
  });
});
