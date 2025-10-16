/**
 * Password Reset Lambda Function
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  ForgotPasswordCommand,
  UserNotFoundException,
  InvalidParameterException,
  TooManyRequestsException,
  LimitExceededException,
} from '@aws-sdk/client-cognito-identity-provider';
import { forgotPasswordRequestSchema } from '@lfmt/shared-types';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';

const logger = new Logger('lfmt-auth-reset-password');
const cognitoClient = new CognitoIdentityProviderClient({});

const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Processing password reset request', { requestId });

  try {
    const body = JSON.parse(event.body || '{}');
    const validationResult = forgotPasswordRequestSchema.safeParse(body);

    if (!validationResult.success) {
      logger.warn('Password reset validation failed', {
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

    const { email } = validationResult.data;

    logger.info('Initiating password reset with Cognito', {
      requestId,
      email: email.toLowerCase(),
    });

    const command = new ForgotPasswordCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
    });

    await cognitoClient.send(command);

    logger.info('Password reset initiated successfully', {
      requestId,
      email: email.toLowerCase(),
    });

    return createSuccessResponse(
      200,
      {
        message: 'If an account with this email exists, a password reset link has been sent.',
      },
      requestId
    );
  } catch (error) {
    if (error instanceof UserNotFoundException) {
      logger.warn('Password reset requested for non-existent user', {
        requestId,
        error: error.message,
      });

      return createSuccessResponse(
        200,
        {
          message: 'If an account with this email exists, a password reset link has been sent.',
        },
        requestId
      );
    }

    if (error instanceof InvalidParameterException) {
      logger.warn('Password reset failed: invalid parameter', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        400,
        'Invalid email address provided',
        requestId
      );
    }

    if (error instanceof TooManyRequestsException) {
      logger.warn('Password reset failed: rate limit exceeded', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        429,
        'Too many password reset attempts. Please try again later.',
        requestId
      );
    }

    if (error instanceof LimitExceededException) {
      logger.warn('Password reset failed: attempt limit exceeded', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        429,
        'Password reset limit exceeded. Please try again later.',
        requestId
      );
    }

    logger.error('Unexpected error during password reset', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Password reset failed due to an internal error. Please try again later.',
      requestId
    );
  }
};
