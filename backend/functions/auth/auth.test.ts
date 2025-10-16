import { handler as registerHandler } from './register';
import { handler as loginHandler } from './login';
import { handler as refreshTokenHandler } from './refreshToken';
import { handler as resetPasswordHandler } from './resetPassword';
import { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand, ForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { mockClient } from 'aws-sdk-client-mock';

const cognitoMock = mockClient(CognitoIdentityProviderClient);

describe('Auth Service', () => {
  beforeEach(() => {
    cognitoMock.reset();
  });

  describe('Register', () => {
    it('should return 201 if registration is successful', async () => {
      cognitoMock.on(SignUpCommand).resolves({});
      const event = {
        body: JSON.stringify({
          email: 'test@test.com',
          password: 'password',
          given_name: 'test',
          family_name: 'user',
        }),
      } as any;
      const result = await registerHandler(event);
      expect(result.statusCode).toBe(201);
    });

    it('should return 400 if required fields are missing', async () => {
      const event = { body: JSON.stringify({}) } as any;
      const result = await registerHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 409 if user already exists', async () => {
      cognitoMock.on(SignUpCommand).rejects(new Error('UsernameExistsException'));
      const event = {
        body: JSON.stringify({
          email: 'test@test.com',
          password: 'password',
          given_name: 'test',
          family_name: 'user',
        }),
      } as any;
      const result = await registerHandler(event);
      expect(result.statusCode).toBe(409);
      expect(JSON.parse(result.body).message).toBe('User already exists');
    });
  });

  describe('Login', () => {
    it('should return 200 and tokens if login is successful', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({
        AuthenticationResult: {
          AccessToken: 'accesstoken',
          RefreshToken: 'refreshtoken',
          IdToken: 'idtoken',
        },
      });
      const event = {
        body: JSON.stringify({
          email: 'test@test.com',
          password: 'password',
        }),
      } as any;
      const result = await loginHandler(event);
      const body = JSON.parse(result.body);
      expect(result.statusCode).toBe(200);
      expect(body.accessToken).toBe('accesstoken');
      expect(body.refreshToken).toBe('refreshtoken');
      expect(body.idToken).toBe('idtoken');
    });

    it('should return 401 for incorrect credentials', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(new Error('NotAuthorizedException'));
      const event = {
        body: JSON.stringify({
          email: 'test@test.com',
          password: 'wrongpassword',
        }),
      } as any;
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Incorrect email or password');
    });

    it('should return 400 if required fields are missing', async () => {
      const event = { body: JSON.stringify({}) } as any;
      const result = await loginHandler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('Refresh Token', () => {
    it('should return 200 and new tokens if refresh is successful', async () => {
      cognitoMock.on(InitiateAuthCommand).resolves({
        AuthenticationResult: {
          AccessToken: 'newaccesstoken',
          IdToken: 'newidtoken',
        },
      });
      const event = {
        body: JSON.stringify({
          refreshToken: 'refreshtoken',
        }),
      } as any;
      const result = await refreshTokenHandler(event);
      const body = JSON.parse(result.body);
      expect(result.statusCode).toBe(200);
      expect(body.accessToken).toBe('newaccesstoken');
      expect(body.idToken).toBe('newidtoken');
    });

    it('should return 401 for an invalid refresh token', async () => {
      cognitoMock.on(InitiateAuthCommand).rejects(new Error('NotAuthorizedException'));
      const event = {
        body: JSON.stringify({
          refreshToken: 'invalidtoken',
        }),
      } as any;
      const result = await refreshTokenHandler(event);
      expect(result.statusCode).toBe(401);
      expect(JSON.parse(result.body).message).toBe('Invalid refresh token');
    });

    it('should return 400 if refresh token is missing', async () => {
      const event = { body: JSON.stringify({}) } as any;
      const result = await refreshTokenHandler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('Reset Password', () => {
    it('should return 200 if reset password email is sent', async () => {
      cognitoMock.on(ForgotPasswordCommand).resolves({});
      const event = {
        body: JSON.stringify({
          email: 'test@test.com',
        }),
      } as any;
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(200);
    });

    it('should return 400 if email is missing', async () => {
      const event = { body: JSON.stringify({}) } as any;
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 200 even if user does not exist', async () => {
      cognitoMock.on(ForgotPasswordCommand).rejects(new Error('UserNotFoundException'));
      const event = {
        body: JSON.stringify({
          email: 'notfound@test.com',
        }),
      } as any;
      const result = await resetPasswordHandler(event);
      expect(result.statusCode).toBe(200);
    });
  });
});