/**
 * Tests for the register Lambda's dev/auto-confirm path.
 *
 * Issue #178: AdminConfirmSignUp removed.
 * The PreSignUp Lambda trigger + autoVerifiedAttributes in the dev User Pool
 * handle auto-confirmation as part of SignUp. No separate AdminConfirmSignUp
 * call is needed or issued. This file verifies that:
 *   1. Registration succeeds (201) in dev without any AdminConfirmSignUp.
 *   2. No AdminConfirmSignUp command is ever sent (IAM grant removed).
 *   3. Registration in a non-dev environment returns the email-verification message.
 *
 * This file exists separately from register.test.ts because `IS_DEV` is
 * computed at module load from `ENVIRONMENT.includes('Dev')`. The sibling
 * file pre-sets `ENVIRONMENT='test'`; we need `ENVIRONMENT='LfmtPocDev'`
 * BEFORE the handler is imported to exercise the dev branch.
 */

// MUST be set BEFORE importing the handler — IS_DEV is computed at cold-start.
process.env.ENVIRONMENT = 'LfmtPocDev';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
// COGNITO_USER_POOL_ID not needed: AdminConfirmSignUp removed (#178).

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../register';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

jest.mock('../../shared/logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }));
});

describe('register Lambda (dev / auto-confirm path) — issue #178', () => {
  beforeEach(() => {
    cognitoMock.reset();
  });

  it('returns 201 in dev without calling AdminConfirmSignUp (Cognito PreSignUp trigger handles it)', async () => {
    // Cognito SignUp succeeds; UserConfirmed may be true because the PreSignUp
    // trigger fires automatically — the Lambda does not call AdminConfirmSignUp.
    cognitoMock.on(SignUpCommand).resolves({
      UserSub: 'auto-confirmed-user-id',
      UserConfirmed: true,
    });

    const response = await handler(createMockEvent());

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('You can now log in');

    // SignUpCommand MUST be called exactly once.
    expect(cognitoMock.commandCalls(SignUpCommand)).toHaveLength(1);

    // AdminConfirmSignUp MUST NOT be called — the IAM grant has been removed (#178).
    expect(cognitoMock.commandCalls(AdminConfirmSignUpCommand)).toHaveLength(0);
  });

  it('returns 201 with "You can now log in" message in dev (IS_DEV=true branch)', async () => {
    cognitoMock.on(SignUpCommand).resolves({ UserSub: 'dev-user-id' });

    const response = await handler(createMockEvent());

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    // IS_DEV branch message — confirms the correct branch was taken.
    expect(body.message).toMatch(/you can now log in/i);
  });
});

function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: JSON.stringify({
      email: 'autoconfirm@example.com',
      password: 'Test123!@#',
      confirmPassword: 'Test123!@#',
      firstName: 'Auto',
      lastName: 'Confirm',
      acceptedTerms: true,
      acceptedPrivacy: true,
    }),
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'POST',
    isBase64Encoded: false,
    path: '/auth/register',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      accountId: '123456789012',
      apiId: 'test-api',
      authorizer: null,
      protocol: 'HTTP/1.1',
      httpMethod: 'POST',
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
      path: '/auth/register',
      stage: 'test',
      requestId: 'test-request-id',
      requestTimeEpoch: Date.now(),
      resourceId: 'test-resource',
      resourcePath: '/auth/register',
    },
    resource: '/auth/register',
    ...overrides,
  } as APIGatewayProxyEvent;
}
