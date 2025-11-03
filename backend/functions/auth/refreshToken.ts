/**
 * Token Refresh Lambda Function
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  InitiateAuthCommandOutput,
  NotAuthorizedException,
  TooManyRequestsException,
} from '@aws-sdk/client-cognito-identity-provider';
import { refreshTokenRequestSchema } from '@lfmt/shared-types';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';

const logger = new Logger('lfmt-auth-refresh');
const cognitoClient = new CognitoIdentityProviderClient({});

const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Processing token refresh request', { requestId });

  try {
    const body = JSON.parse(event.body || '{}');
    const validationResult = refreshTokenRequestSchema.safeParse(body);

    if (!validationResult.success) {
      logger.warn('Refresh token validation failed', {
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

    const { refreshToken } = validationResult.data;

    logger.info('Refreshing tokens with Cognito', { requestId });

    const command = new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const response: InitiateAuthCommandOutput = await cognitoClient.send(command);

    if (!response.AuthenticationResult) {
      logger.error('Token refresh succeeded but no tokens returned', {
        requestId,
      });

      return createErrorResponse(
        500,
        'Token refresh failed unexpectedly',
        requestId
      );
    }

    logger.info('Tokens refreshed successfully', { requestId });

    return createSuccessResponse(
      200,
      {
        message: 'Tokens refreshed successfully',
        data: {
          accessToken: response.AuthenticationResult.AccessToken,
          idToken: response.AuthenticationResult.IdToken,
          expiresIn: response.AuthenticationResult.ExpiresIn,
        },
      },
      requestId
    );
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      logger.warn('Token refresh failed: invalid or expired refresh token', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        401,
        'Invalid or expired refresh token. Please log in again.',
        requestId
      );
    }

    if (error instanceof TooManyRequestsException) {
      logger.warn('Token refresh failed: rate limit exceeded', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        429,
        'Too many refresh attempts. Please try again later.',
        requestId
      );
    }

    logger.error('Unexpected error during token refresh', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Token refresh failed due to an internal error. Please try again later.',
      requestId
    );
  }
};
