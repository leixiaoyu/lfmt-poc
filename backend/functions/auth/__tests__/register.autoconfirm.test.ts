/**
 * Regression tests for issue #169 — auto-confirm race in the register
 * Lambda's dev path.
 *
 * Bug: when AUTO_CONFIRM_USERS is on (dev environment), the User Pool's
 * PreSignUp Lambda trigger / autoVerifiedAttributes already confirms the
 * user as part of SignUp itself. The Lambda's redundant
 * `AdminConfirmSignUp` call then throws
 * `NotAuthorizedException: User cannot be confirmed. Current status is
 * CONFIRMED`. The catch-all turned that into a 500 to the client even
 * though the user IS successfully created — this is the same root cause
 * as the post-deploy `Run Backend Integration Tests` failures that have
 * tripped on every main deploy since 2026-04-29.
 *
 * Fix (in register.ts): catch `NotAuthorizedException` from
 * `AdminConfirmSignUp` and treat the "already confirmed" variant as a
 * non-error. Other variants (e.g. legitimately disabled users) MUST
 * still propagate.
 *
 * This file exists separately from register.test.ts because
 * `AUTO_CONFIRM_USERS` is computed at module load from
 * `ENVIRONMENT.includes('Dev')`. The sibling file pre-sets
 * `ENVIRONMENT='test'`; we need `ENVIRONMENT='LfmtPocDev'` BEFORE the
 * handler is imported to exercise the dev branch — and module isolation
 * hacks don't compose cleanly with aws-sdk-client-mock's
 * middleware-level interception.
 */

// MUST be set BEFORE importing the handler — AUTO_CONFIRM_USERS is
// computed at cold-start.
process.env.ENVIRONMENT = 'LfmtPocDev';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.COGNITO_USER_POOL_ID = 'test-user-pool-id';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { handler } from '../register';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  NotAuthorizedException,
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

describe('register Lambda (dev / auto-confirm path) — issue #169', () => {
  beforeEach(() => {
    cognitoMock.reset();
  });

  it('returns 201 (NOT 500) when AdminConfirmSignUp says user already CONFIRMED', async () => {
    cognitoMock.on(SignUpCommand).resolves({
      UserSub: 'auto-confirmed-user-id',
      UserConfirmed: true,
    });

    // Simulate Cognito having already auto-confirmed the user via the
    // PreSignUp Lambda trigger — this is the EXACT message Cognito returns
    // in production (see CloudWatch /aws/lambda/lfmt-register-LfmtPocDev).
    cognitoMock.on(AdminConfirmSignUpCommand).rejects(
      new NotAuthorizedException({
        message: 'User cannot be confirmed. Current status is CONFIRMED',
        $metadata: {},
      })
    );

    const event = createMockEvent({
      body: JSON.stringify({
        email: 'autoconfirm-race@example.com',
        password: 'Test123!@#',
        confirmPassword: 'Test123!@#',
        firstName: 'Auto',
        lastName: 'Confirm',
        acceptedTerms: true,
        acceptedPrivacy: true,
      }),
    });

    const response = await handler(event);

    // CRITICAL: must be 201, not 500. The user IS created — the redundant
    // confirm step's failure is benign.
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.message).toContain('You can now log in');

    // Both Cognito calls should have been attempted (redundant call is
    // kept as defense-in-depth for older deployments).
    expect(cognitoMock.commandCalls(SignUpCommand)).toHaveLength(1);
    expect(cognitoMock.commandCalls(AdminConfirmSignUpCommand)).toHaveLength(1);
  });

  it('still propagates NotAuthorizedException for non-already-confirmed cases', async () => {
    // Defense: we MUST NOT swallow every NotAuthorizedException — only
    // the "already confirmed" variant. A legitimately disabled user must
    // still surface as a 500 (caught by the generic handler), so the
    // operator sees the real failure mode.
    cognitoMock.on(SignUpCommand).resolves({
      UserSub: 'disabled-user-id',
    });

    cognitoMock.on(AdminConfirmSignUpCommand).rejects(
      new NotAuthorizedException({
        message: 'User is disabled.',
        $metadata: {},
      })
    );

    const event = createMockEvent({
      body: JSON.stringify({
        email: 'disabled@example.com',
        password: 'Test123!@#',
        confirmPassword: 'Test123!@#',
        firstName: 'Dis',
        lastName: 'Abled',
        acceptedTerms: true,
        acceptedPrivacy: true,
      }),
    });

    const response = await handler(event);

    expect(response.statusCode).toBe(500);
  });

  /**
   * OMC-followup C4 — borderline NotAuthorizedException must propagate.
   *
   * The swallow predicate in register.ts uses:
   *   /already confirmed|status is CONFIRMED/i
   *
   * This regex matches BOTH branches of the documented Cognito message
   * variants, but the test suite only proved that "User is disabled."
   * propagates. There's a class of borderline cases that should NOT
   * match — e.g., a NotAuthorizedException whose message references a
   * different, real authorization failure mode (account lockout, MFA
   * pending, etc.). Without an explicit test, a future regex tightening
   * could silently drop the propagate-on-other-NotAuthorized contract.
   *
   * This test asserts the negative-branch contract: a NotAuthorized whose
   * message does NOT match the swallow regex MUST surface as a failure.
   * (The "User is disabled." case above happens to satisfy this; this
   * test adds a second, distinct borderline message so a single-message
   * regex tightening can't accidentally narrow the propagate set to one.)
   */
  it('propagates a NotAuthorizedException with an unrelated message (OMC-followup C4)', async () => {
    cognitoMock.on(SignUpCommand).resolves({
      UserSub: 'borderline-user-id',
    });

    // A message that intentionally does NOT contain 'already confirmed'
    // or 'status is CONFIRMED' — must NOT be swallowed.
    cognitoMock.on(AdminConfirmSignUpCommand).rejects(
      new NotAuthorizedException({
        message: 'User account is locked due to too many failed attempts.',
        $metadata: {},
      })
    );

    const event = createMockEvent({
      body: JSON.stringify({
        email: 'locked@example.com',
        password: 'Test123!@#',
        confirmPassword: 'Test123!@#',
        firstName: 'Lock',
        lastName: 'Out',
        acceptedTerms: true,
        acceptedPrivacy: true,
      }),
    });

    const response = await handler(event);

    // Must NOT be 201 — silently swallowing this error would hide a real
    // auth failure mode from the client AND from CloudWatch alarms.
    expect(response.statusCode).not.toBe(201);
    // Generic-handler path returns 500 (the message variants the handler
    // recognizes — UsernameExistsException, InvalidPasswordException,
    // InvalidParameterException — are different exception classes).
    expect(response.statusCode).toBe(500);
  });

  it('returns 201 normally when AdminConfirmSignUp succeeds (control case)', async () => {
    cognitoMock.on(SignUpCommand).resolves({
      UserSub: 'happy-path-user-id',
    });
    cognitoMock.on(AdminConfirmSignUpCommand).resolves({});

    const event = createMockEvent({
      body: JSON.stringify({
        email: 'happy@example.com',
        password: 'Test123!@#',
        confirmPassword: 'Test123!@#',
        firstName: 'Happy',
        lastName: 'Path',
        acceptedTerms: true,
        acceptedPrivacy: true,
      }),
    });

    const response = await handler(event);
    expect(response.statusCode).toBe(201);
    expect(cognitoMock.commandCalls(AdminConfirmSignUpCommand)).toHaveLength(1);
  });
});

function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
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
