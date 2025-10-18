/**
 * User Registration Lambda Function
 * Handles new user registration with Cognito User Pool
 *
 * Improvements from Gemini POC:
 * - Added Zod schema validation
 * - Enhanced error handling with specific error messages
 * - Structured logging with request correlation
 * - CORS headers on all responses
 * - Type-safe error handling
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  UsernameExistsException,
  InvalidPasswordException,
  InvalidParameterException,
} from '@aws-sdk/client-cognito-identity-provider';
import { registerRequestSchema } from '@lfmt/shared-types';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';

const logger = new Logger('lfmt-auth-register');
const cognitoClient = new CognitoIdentityProviderClient({});

// Validate environment variables at cold start
const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;

  logger.info('Processing registration request', { requestId });

  try {
    // Parse and validate request body
    const body = JSON.parse(event.body || '{}');
    const validationResult = registerRequestSchema.safeParse(body);

    if (!validationResult.success) {
      logger.warn('Registration validation failed', {
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

    const { email, password, firstName, lastName } = validationResult.data;

    logger.info('Registering user with Cognito', {
      requestId,
      email: email.toLowerCase(),
    });

    // Register user with Cognito
    // Map frontend field names (firstName, lastName) to Cognito attributes (given_name, family_name)
    const command = new SignUpCommand({
      ClientId: COGNITO_CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        {
          Name: 'email',
          Value: email,
        },
        {
          Name: 'given_name',
          Value: firstName,
        },
        {
          Name: 'family_name',
          Value: lastName,
        },
      ],
    });

    await cognitoClient.send(command);

    logger.info('User registered successfully', {
      requestId,
      email: email.toLowerCase(),
    });

    return createSuccessResponse(
      201,
      {
        message: 'User registered successfully. Please check your email to verify your account.',
      },
      requestId
    );
  } catch (error) {
    // Type-safe error handling
    if (error instanceof UsernameExistsException) {
      logger.warn('Registration failed: user already exists', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        409,
        'An account with this email already exists',
        requestId
      );
    }

    if (error instanceof InvalidPasswordException) {
      logger.warn('Registration failed: invalid password', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        400,
        'Password does not meet security requirements. Must be at least 8 characters with uppercase, lowercase, numbers, and symbols.',
        requestId
      );
    }

    if (error instanceof InvalidParameterException) {
      logger.warn('Registration failed: invalid parameter', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        400,
        'Invalid registration data provided',
        requestId
      );
    }

    // Unknown error - log details but return generic message
    logger.error('Unexpected error during registration', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Registration failed due to an internal error. Please try again later.',
      requestId
    );
  }
};
