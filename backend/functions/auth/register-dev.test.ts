// Test for dev environment auto-confirm functionality
// This file is separate because ENVIRONMENT must be set before module import

process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.COGNITO_USER_POOL_ID = 'test-user-pool-id';
process.env.ENVIRONMENT = 'LfmtPocDev'; // Dev environment for auto-confirm

import { handler as registerHandler } from './register';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

// Helper function to create a mock API Gateway event
const createMockEvent = (body: any): any => ({
  body: JSON.stringify(body),
  headers: {
    origin: 'http://localhost:3000',
  },
  requestContext: {
    requestId: 'test-request-id',
  },
});

describe('Register - Dev Environment Auto-Confirm', () => {
  beforeEach(() => {
    cognitoMock.reset();
  });

  it('should auto-confirm user in dev environment', async () => {
    cognitoMock.on(SignUpCommand).resolves({});
    cognitoMock.on(AdminConfirmSignUpCommand).resolves({});

    const event = createMockEvent({
      email: 'test@test.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      firstName: 'Test',
      lastName: 'User',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });

    const result = await registerHandler(event);
    expect(result.statusCode).toBe(201);

    const body = JSON.parse(result.body);
    expect(body.message).toBe('User registered successfully. You can now log in.');
  });

  it('should handle AdminConfirmSignUpCommand failure in dev environment', async () => {
    cognitoMock.on(SignUpCommand).resolves({});
    cognitoMock.on(AdminConfirmSignUpCommand).rejects(new Error('Auto-confirm failed'));

    const event = createMockEvent({
      email: 'test@test.com',
      password: 'Password123!',
      confirmPassword: 'Password123!',
      firstName: 'Test',
      lastName: 'User',
      acceptedTerms: true,
      acceptedPrivacy: true,
    });

    const result = await registerHandler(event);
    // Should fail with 500 when auto-confirm fails
    expect(result.statusCode).toBe(500);
  });
});
