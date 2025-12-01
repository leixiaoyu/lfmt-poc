// Set environment variables before importing handlers
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.ENVIRONMENT = 'test';

import { handler as registerHandler } from './register';
import { handler as loginHandler } from './login';
import { handler as refreshTokenHandler } from './refreshToken';
import { handler as resetPasswordHandler } from './resetPassword';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  InitiateAuthCommand,
  ForgotPasswordCommand,
  UsernameExistsException,
  NotAuthorizedException,
  UserNotFoundException,
  UserNotConfirmedException,
  TooManyRequestsException,
  LimitExceededException,
  InvalidPasswordException,
  InvalidParameterException
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

describe('Auth Service', () => {
  beforeEach(() => {
    cognitoMock.reset();
  });

  describe('Register', () => {
    it('should return 201 if registration is successful', async () => {
      cognitoMock.on(SignUpCommand).resolves({});
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
    });

    it('should return 400 if required fields are missing', async () => {
      const event = createMockEvent({});
      const result = await registerHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 if passwords do not match', async () => {
      const event = createMockEvent({
        email: 'test@test.com',
        password: 'Password123!',
        confirmPassword: 'DifferentPassword123!',
        firstName: 'Test',
        lastName: 'User',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      const result = await registerHandler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.errors.confirmPassword).toContain("Passwords don't match");
    });

    it('should return 400 if email is invalid', async () => {
      const event = createMockEvent({
        email: 'invalid-email',
        password: 'Password123!',
        confirmPassword: 'Password123!',
        firstName: 'Test',
        lastName: 'User',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      const result = await registerHandler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.errors.email).toBeDefined();
    });

    it('should return 400 if password is too weak', async () => {
      const event = createMockEvent({
        email: 'test@test.com',
        password: 'weak',
        confirmPassword: 'weak',
        firstName: 'Test',
        lastName: 'User',
        acceptedTerms: true,
        acceptedPrivacy: true,
      });
      const result = await registerHandler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.errors.password).toBeDefined();
    });

    it('should return 409 if user already exists', async () => {
      cognitoMock.on(SignUpCommand).rejects(
        new UsernameExistsException({ $metadata: {}, message: 'User already exists' })
      );
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
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).message).toBe('An account with this email already exists');
    });

    it('should return 500 for unexpected Cognito errors', async () => {
      cognitoMock.on(SignUpCommand).rejects(
        new Error('Service temporarily unavailable')
      );
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
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBe('Registration failed due to an internal error. Please try again later.');
    });

    it('should return 400 for invalid password from Cognito', async () => {
      cognitoMock.on(SignUpCommand).rejects(
        new InvalidPasswordException({ $metadata: {}, message: 'Password does not meet requirements' })
      );
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
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Password does not meet security requirements. Must be at least 8 characters with uppercase, lowercase, numbers, and symbols.');
    });

    it('should return 400 for invalid parameter from Cognito', async () => {
      cognitoMock.on(SignUpCommand).rejects(
        new InvalidParameterException({ $metadata: {}, message: 'Invalid parameter' })
      );
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
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Invalid registration data provided');
    });
  });

  describe('Login', () => {
    it('should return 200 and tokens if login is successful', async () => {
      // Mock JWT token with user claims
      const mockIdToken = Buffer.from(JSON.stringify({ header: 'value' })).toString('base64') + '.' +
        Buffer.from(JSON.stringify({ sub: 'user-123', email: 'test@test.com', given_name: 'Test', family_name: 'User' })).toString('base64') + '.' +
        Buffer.from(JSON.stringify({ signature: 'value' })).toString('base64');

      cognitoMock.on(InitiateAuthCommand).resolves({
        AuthenticationResult: {
          AccessToken: 'accesstoken',
          RefreshToken: 'refreshtoken',
          IdToken: mockIdToken,
          ExpiresIn: 3600,
        },
      });
      const event = createMockEvent({
        email: 'test@test.com',
        password: 'password',
      });
      const result = await loginHandler(event);
      const body = JSON.parse(result.body);
      expect(result.statusCode).toBe(200);
      expect(body.user).toEqual({
        id: 'user-123',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
      });
      expect(body.accessToken).toBe('accesstoken');
      expect(body.refreshToken).toBe('refreshtoken');
    });

    it('should return 401 for incorrect credentials', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new NotAuthorizedException({ $metadata: {}, message: 'Incorrect username or password' })
      );
      const event = createMockEvent({
        email: 'test@test.com',
        password: 'wrongpassword',
      });
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Incorrect email or password');
    });

    it('should return 401 for user not found', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new UserNotFoundException({ $metadata: {}, message: 'User does not exist' })
      );
      const event = createMockEvent({
        email: 'notfound@test.com',
        password: 'password',
      });
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Incorrect email or password');
    });

    it('should return 500 when authentication succeeds but no tokens returned', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({
        AuthenticationResult: undefined,
      });
      const event = createMockEvent({
        email: 'test@test.com',
        password: 'password',
      });
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBe('Authentication failed unexpectedly');
    });

    it('should return 500 for unexpected Cognito errors', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new Error('Service temporarily unavailable')
      );
      const event = createMockEvent({
        email: 'test@test.com',
        password: 'password',
      });
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBe('Login failed due to an internal error. Please try again later.');
    });

    it('should return 400 if required fields are missing', async () => {
      const event = createMockEvent({});
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 403 for user not confirmed', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new UserNotConfirmedException({ $metadata: {}, message: 'User is not confirmed' })
      );
      const event = createMockEvent({
        email: 'unconfirmed@test.com',
        password: 'password',
      });
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(403);
      expect(JSON.parse(result.body).message).toBe('Please verify your email address before logging in. Check your inbox for the verification link.');
    });

    it('should return 429 for too many login attempts', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new TooManyRequestsException({ $metadata: {}, message: 'Too many requests' })
      );
      const event = createMockEvent({
        email: 'test@test.com',
        password: 'password',
      });
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(429);
      expect(JSON.parse(result.body).message).toBe('Too many login attempts. Please try again later.');
    });
  });

  describe('Refresh Token', () => {
    it('should return 200 and new tokens if refresh is successful', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({
        AuthenticationResult: {
          AccessToken: 'newaccesstoken',
          IdToken: 'newidtoken',
          ExpiresIn: 3600,
        },
      });
      const event = createMockEvent({
        refreshToken: 'refreshtoken',
      });
      const result = await refreshTokenHandler(event);
      const body = JSON.parse(result.body);
      expect(result.statusCode).toBe(200);
      expect(body.data.accessToken).toBe('newaccesstoken');
      expect(body.data.idToken).toBe('newidtoken');
    });

    it('should return 401 for an invalid refresh token', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new NotAuthorizedException({ $metadata: {}, message: 'Invalid refresh token' })
      );
      const event = createMockEvent({
        refreshToken: 'invalidtoken',
      });
      const result = await refreshTokenHandler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Invalid or expired refresh token. Please log in again.');
    });

    it('should return 401 for an expired refresh token', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new NotAuthorizedException({ $metadata: {}, message: 'Refresh Token has expired' })
      );
      const event = createMockEvent({
        refreshToken: 'expiredtoken',
      });
      const result = await refreshTokenHandler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Invalid or expired refresh token. Please log in again.');
    });

    it('should return 500 for unexpected Cognito errors', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new Error('Service temporarily unavailable')
      );
      const event = createMockEvent({
        refreshToken: 'refreshtoken',
      });
      const result = await refreshTokenHandler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBe('Token refresh failed due to an internal error. Please try again later.');
    });

    it('should return 400 if refresh token is missing', async () => {
      const event = createMockEvent({});
      const result = await refreshTokenHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 429 for too many refresh attempts', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(
        new TooManyRequestsException({ $metadata: {}, message: 'Too many requests' })
      );
      const event = createMockEvent({
        refreshToken: 'refreshtoken',
      });
      const result = await refreshTokenHandler(event);
      expect(result.statusCode).toBe(429);
      expect(JSON.parse(result.body).message).toBe('Too many refresh attempts. Please try again later.');
    });
  });

  describe('Reset Password', () => {
    it('should return 200 if reset password email is sent', async () => {
      cognitoMock.on(ForgotPasswordCommand).resolves({});
      const event = createMockEvent({
        email: 'test@test.com',
      });
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should return 400 if email is missing', async () => {
      const event = createMockEvent({});
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 if email is invalid', async () => {
      const event = createMockEvent({
        email: 'invalid-email',
      });
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body);
      expect(body.errors.email).toBeDefined();
    });

    it('should return 200 even if user does not exist', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(
        new UserNotFoundException({ $metadata: {}, message: 'User not found' })
      );
      const event = createMockEvent({
        email: 'notfound@test.com',
      });
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should return 500 for unexpected Cognito errors', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(
        new Error('Service temporarily unavailable')
      );
      const event = createMockEvent({
        email: 'test@test.com',
      });
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).message).toBe('Password reset failed due to an internal error. Please try again later.');
    });

    it('should return 400 for invalid parameter from Cognito', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(
        new InvalidParameterException({ $metadata: {}, message: 'Invalid parameter' })
      );
      const event = createMockEvent({
        email: 'test@test.com',
      });
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).message).toBe('Invalid email address provided');
    });

    it('should return 429 for too many reset attempts', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(
        new TooManyRequestsException({ $metadata: {}, message: 'Too many requests' })
      );
      const event = createMockEvent({
        email: 'test@test.com',
      });
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(429);
      expect(JSON.parse(result.body).message).toBe('Too many password reset attempts. Please try again later.');
    });

    it('should return 429 for limit exceeded', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(
        new LimitExceededException({ $metadata: {}, message: 'Limit exceeded' })
      );
      const event = createMockEvent({
        email: 'test@test.com',
      });
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(429);
      expect(JSON.parse(result.body).message).toBe('Password reset limit exceeded. Please try again later.');
    });
  });
});