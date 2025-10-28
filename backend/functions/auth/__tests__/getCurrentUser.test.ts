/**
 * Unit tests for getCurrentUser Lambda function
 *
 * These tests verify:
 * 1. Response format matches API Gateway expectations
 * 2. CORS headers are correctly included
 * 3. Status codes are correct
 * 4. Error handling works properly
 */

// Set environment before importing handler
process.env.ENVIRONMENT = 'test';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../getCurrentUser';
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

// Mock logger
jest.mock('../../shared/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
});

describe('getCurrentUser Lambda Function', () => {
  beforeEach(() => {
    cognitoMock.reset();
    delete process.env.ALLOWED_ORIGIN;
  });

  /**
   * CRITICAL TEST: Verifies response format matches API Gateway expectations
   * This test would have caught the bug where statusCode was missing
   */
  describe('Response Format Validation', () => {
    it('should return a valid API Gateway response with statusCode as number', async () => {
      // Mock successful Cognito response
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'test-user-id',
        UserAttributes: [
          { Name: 'email', Value: 'test@example.com' },
          { Name: 'given_name', Value: 'Test' },
          { Name: 'family_name', Value: 'User' },
        ],
      });

      const event = createMockEvent({
        headers: {
          Authorization: 'Bearer valid-token',
        },
      });

      const response = await handler(event);

      // CRITICAL ASSERTIONS - These would have caught the bug!
      expect(response).toHaveProperty('statusCode');
      expect(typeof response.statusCode).toBe('number');
      expect(response.statusCode).toBe(200);

      expect(response).toHaveProperty('headers');
      expect(typeof response.headers).toBe('object');

      expect(response).toHaveProperty('body');
      expect(typeof response.body).toBe('string');
    });

    it('should have statusCode as 200 for successful requests', async () => {
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'test-user-id',
        UserAttributes: [
          { Name: 'email', Value: 'test@example.com' },
        ],
      });

      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(response.statusCode).not.toBe('200'); // Ensure it's a number, not string
    });

    it('should return parseable JSON body', async () => {
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'user-123',
        UserAttributes: [
          { Name: 'email', Value: 'test@example.com' },
          { Name: 'given_name', Value: 'John' },
          { Name: 'family_name', Value: 'Doe' },
        ],
      });

      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
      });

      const response = await handler(event);

      // Should be able to parse the body
      expect(() => JSON.parse(response.body)).not.toThrow();

      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('user');
      expect(body.user).toHaveProperty('id');
      expect(body.user).toHaveProperty('email');
    });
  });

  /**
   * Tests for CORS headers - critical for browser security
   */
  describe('CORS Headers', () => {
    it('should include required CORS headers', async () => {
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'test-user',
        UserAttributes: [{ Name: 'email', Value: 'test@example.com' }],
      });

      const event = createMockEvent({
        headers: { Authorization: 'Bearer token' },
      });

      const response = await handler(event);

      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Credentials');
      expect(response.headers).toHaveProperty('Content-Type');
      expect(response.headers?.['Content-Type']).toBe('application/json');
    });

    it('should allow localhost origin for development', async () => {
      process.env.ALLOWED_ORIGIN = 'http://localhost:3000';

      cognitoMock.on(GetUserCommand).resolves({
        Username: 'test-user',
        UserAttributes: [{ Name: 'email', Value: 'test@example.com' }],
      });

      const event = createMockEvent({
        headers: { Authorization: 'Bearer token' },
      });

      const response = await handler(event);

      expect(response.headers?.['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
    });
  });

  /**
   * Tests for successful user retrieval
   */
  describe('Successful User Retrieval', () => {
    it('should return user data with all fields', async () => {
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'user-123',
        UserAttributes: [
          { Name: 'email', Value: 'john.doe@example.com' },
          { Name: 'given_name', Value: 'John' },
          { Name: 'family_name', Value: 'Doe' },
        ],
      });

      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.user).toEqual({
        id: expect.any(String),
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should handle users with missing optional fields', async () => {
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'user-456',
        UserAttributes: [
          { Name: 'email', Value: 'minimal@example.com' },
        ],
      });

      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
      });

      const response = await handler(event);
      const body = JSON.parse(response.body);

      expect(body.user).toEqual({
        id: expect.any(String),
        email: 'minimal@example.com',
        firstName: '',
        lastName: '',
      });
    });
  });

  /**
   * Tests for error handling
   */
  describe('Error Handling', () => {
    it('should return 401 for missing Authorization header', async () => {
      const event = createMockEvent({
        headers: {},
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('message');
      expect(body.message).toContain('Authorization');
    });

    it('should return 401 for invalid token format', async () => {
      const event = createMockEvent({
        headers: { Authorization: 'InvalidFormat' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
    });

    it('should return 401 when Cognito rejects the token', async () => {
      cognitoMock.on(GetUserCommand).rejects(
        new NotAuthorizedException({ $metadata: {}, message: 'Invalid Access Token' })
      );

      const event = createMockEvent({
        headers: { Authorization: 'Bearer expired-token' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('invalid or expired');
    });

    it('should return 404 when user not found', async () => {
      cognitoMock.on(GetUserCommand).rejects(
        new UserNotFoundException({ $metadata: {}, message: 'User does not exist' })
      );

      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('not found');
    });

    it('should return 500 for unexpected errors', async () => {
      cognitoMock.on(GetUserCommand).rejects(new Error('Database connection failed'));

      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Failed to retrieve user information');
    });
  });

  /**
   * Tests for request validation
   */
  describe('Request Validation', () => {
    it('should extract Bearer token correctly', async () => {
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'user-123',
        UserAttributes: [{ Name: 'email', Value: 'test@example.com' }],
      });

      const event = createMockEvent({
        headers: { Authorization: 'Bearer my-test-token' },
      });

      await handler(event);

      // Verify the GetUserCommand was called with the correct access token
      const calls = cognitoMock.commandCalls(GetUserCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input).toEqual({
        AccessToken: 'my-test-token',
      });
    });

    it('should be case-insensitive for Authorization header', async () => {
      cognitoMock.on(GetUserCommand).resolves({
        Username: 'user-123',
        UserAttributes: [{ Name: 'email', Value: 'test@example.com' }],
      });

      const event = createMockEvent({
        headers: { authorization: 'Bearer token' }, // lowercase
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
    });
  });
});

/**
 * Helper function to create mock API Gateway events
 */
function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/auth/me',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'GET',
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: '127.0.0.1',
        user: null,
        userAgent: 'test-agent',
        userArn: null,
      },
      path: '/auth/me',
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/auth/me',
    },
    resource: '/auth/me',
    ...overrides,
  } as APIGatewayProxyEvent;
}
