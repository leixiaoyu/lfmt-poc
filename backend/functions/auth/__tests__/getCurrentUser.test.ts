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
      const event = createMockEvent({
        headers: {
          Authorization: 'Bearer valid-token',
        },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'test-user-id',
              email: 'test@example.com',
              given_name: 'Test',
              family_name: 'User',
            },
          },
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
      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'test-user-id',
              email: 'test@example.com',
            },
          },
        },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(200);
      expect(response.statusCode).not.toBe('200'); // Ensure it's a number, not string
    });

    it('should return parseable JSON body', async () => {
      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              email: 'test@example.com',
              given_name: 'John',
              family_name: 'Doe',
            },
          },
        },
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
      const event = createMockEvent({
        headers: { Authorization: 'Bearer token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'test-user',
              email: 'test@example.com',
            },
          },
        },
      });

      const response = await handler(event);

      expect(response.headers).toHaveProperty('Access-Control-Allow-Origin');
      expect(response.headers).toHaveProperty('Access-Control-Allow-Credentials');
      expect(response.headers).toHaveProperty('Content-Type');
      expect(response.headers?.['Content-Type']).toBe('application/json');
    });

    it('should allow localhost origin for development', async () => {
      process.env.ALLOWED_ORIGIN = 'http://localhost:3000';

      const event = createMockEvent({
        headers: { Authorization: 'Bearer token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'test-user',
              email: 'test@example.com',
            },
          },
        },
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
      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              email: 'john.doe@example.com',
              given_name: 'John',
              family_name: 'Doe',
            },
          },
        },
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
      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-456',
              email: 'minimal@example.com',
            },
          },
        },
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
    it('should return 401 when authorizer claims are missing', async () => {
      const event = createMockEvent({
        headers: { Authorization: 'Bearer token' },
        // No authorizer claims - simulates unauthorized request
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('message');
      expect(body.message).toContain('Authentication required');
    });

    it('should return 401 when authorizer claims missing sub field', async () => {
      const event = createMockEvent({
        headers: { Authorization: 'Bearer token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              // Missing 'sub' field
              email: 'test@example.com',
            },
          },
        },
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Authentication required');
    });

    it('should return 500 for unexpected errors', async () => {
      // Create event with valid authorizer claims but force an error in processing
      const event = createMockEvent({
        headers: { Authorization: 'Bearer valid-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              email: 'test@example.com',
            },
          },
        },
      });

      // Mock an error in createSuccessResponse or somewhere else
      jest.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
        throw new Error('Unexpected error');
      });

      const response = await handler(event);

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Failed to retrieve user information');

      jest.restoreAllMocks();
    });
  });

  /**
   * Tests for authorizer integration
   */
  describe('Cognito Authorizer Integration', () => {
    it('should use authorizer claims without calling Cognito API', async () => {
      const event = createMockEvent({
        headers: { Authorization: 'Bearer my-test-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'user-123',
              email: 'test@example.com',
            },
          },
        },
      });

      await handler(event);

      // Verify the GetUserCommand was NOT called (authorizer path is used)
      const calls = cognitoMock.commandCalls(GetUserCommand);
      expect(calls).toHaveLength(0);
    });
  });

  /**
   * Tests for Cognito Authorizer Code Path
   * This code path is triggered when API Gateway includes authorizer claims in the event
   */
  describe('Cognito Authorizer Code Path', () => {
    it('should return user from authorizer claims without calling GetUserCommand (happy path)', async () => {
      // Create event with authorizer claims (simulating API Gateway Cognito authorizer)
      const event = createMockEvent({
        headers: { Authorization: 'Bearer some-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'authorizer-user-id-123',
              email: 'authorizer@example.com',
              given_name: 'John',
              family_name: 'Authorizer',
            },
          },
        },
      });

      const response = await handler(event);

      // Verify response is successful
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify user data comes from authorizer claims
      expect(body.user).toEqual({
        id: 'authorizer-user-id-123',
        email: 'authorizer@example.com',
        firstName: 'John',
        lastName: 'Authorizer',
      });

      // CRITICAL: Verify GetUserCommand was NOT called (optimization achieved)
      const calls = cognitoMock.commandCalls(GetUserCommand);
      expect(calls).toHaveLength(0);
    });

    it('should handle authorizer claims with partial data gracefully', async () => {
      // Create event with authorizer claims containing only some fields
      const event = createMockEvent({
        headers: { Authorization: 'Bearer partial-token' },
        requestContext: {
          ...createMockEvent().requestContext,
          authorizer: {
            claims: {
              sub: 'partial-user-id-456',
              email: 'partial@example.com',
              // Missing given_name and family_name
            },
          },
        },
      });

      const response = await handler(event);

      // Verify response is successful
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);

      // Verify user data with empty strings for missing fields
      expect(body.user).toEqual({
        id: 'partial-user-id-456',
        email: 'partial@example.com',
        firstName: '', // Should default to empty string
        lastName: '', // Should default to empty string
      });

      // Verify GetUserCommand was NOT called (authorizer path used)
      const calls = cognitoMock.commandCalls(GetUserCommand);
      expect(calls).toHaveLength(0);
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
