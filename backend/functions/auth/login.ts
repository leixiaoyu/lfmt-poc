/**
 * User Login Lambda Function
 * Handles user authentication with Cognito User Pool
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  NotAuthorizedException,
  UserNotFoundException,
  UserNotConfirmedException,
  TooManyRequestsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { loginRequestSchema } from '@lfmt/shared-types';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';

const logger = new Logger('lfmt-auth-login');
const cognitoClient = new CognitoIdentityProviderClient({});

const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Processing login request', { requestId });

  try {
    const body = JSON.parse(event.body || '{}');
    const validationResult = loginRequestSchema.safeParse(body);

    if (!validationResult.success) {
      logger.warn('Login validation failed', {
        requestId,
        errors: validationResult.error.flatten().fieldErrors,
      });

      return createErrorResponse(
        400,
        'Validation failed',
        requestId,
        validationResult.error.flatten().fieldErrors
      );
    }

    const { email, password } = validationResult.data;

    logger.info('Authenticating user with Cognito', {
      requestId,
      email: email.toLowerCase(),
    });

    const command = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await cognitoClient.send(command);

    if (!response.AuthenticationResult) {
      logger.error('Authentication succeeded but no tokens returned', {
        requestId,
        email: email.toLowerCase(),
      });

      return createErrorResponse(
        500,
        'Authentication failed unexpectedly',
        requestId
      );
    }

    logger.info('User logged in successfully', {
      requestId,
      email: email.toLowerCase(),
    });

    return createSuccessResponse(
      200,
      {
        message: 'Login successful',
        data: {
          accessToken: response.AuthenticationResult.AccessToken,
          refreshToken: response.AuthenticationResult.RefreshToken,
          idToken: response.AuthenticationResult.IdToken,
          expiresIn: response.AuthenticationResult.ExpiresIn,
        },
      },
      requestId
    );
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      logger.warn('Login failed: invalid credentials', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        401,
        'Incorrect email or password',
        requestId
      );
    }

    if (error instanceof UserNotFoundException) {
      logger.warn('Login failed: user not found', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        401,
        'Incorrect email or password',
        requestId
      );
    }

    if (error instanceof UserNotConfirmedException) {
      logger.warn('Login failed: user not confirmed', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        403,
        'Please verify your email address before logging in. Check your inbox for the verification link.',
        requestId
      );
    }

    if (error instanceof TooManyRequestsException) {
      logger.warn('Login failed: rate limit exceeded', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        429,
        'Too many login attempts. Please try again later.',
        requestId
      );
    }

    logger.error('Unexpected error during login', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Login failed due to an internal error. Please try again later.',
      requestId
    );
  }
};
