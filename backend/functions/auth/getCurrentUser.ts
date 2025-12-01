/**
 * Get Current User Lambda Function
 * Verifies JWT access token and returns user information
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  GetUserCommand,
  GetUserCommandOutput,
  NotAuthorizedException,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';

const logger = new Logger('lfmt-auth-getCurrentUser');
const cognitoClient = new CognitoIdentityProviderClient({});

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Decode JWT payload (without verification - for extracting claims only)
 * In production, use a proper JWT library with signature verification
 */
function decodeJwtPayload(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    return JSON.parse(payload);
  } catch (error) {
    logger.error('Failed to decode JWT payload', { error });
    throw new Error('Invalid JWT token');
  }
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Processing getCurrentUser request', { requestId });

  try {
    // Extract access token from Authorization header
    const authHeader = event.headers.Authorization || event.headers.authorization;
    const accessToken = extractBearerToken(authHeader);

    if (!accessToken) {
      logger.warn('Missing or invalid Authorization header', { requestId });

      return createErrorResponse(
        401,
        'Missing or invalid Authorization header. Expected format: "Bearer <token>"',
        requestId,
        undefined,
        requestOrigin
      );
    }

    logger.info('Verifying access token with Cognito', { requestId });

    // Verify token and get user attributes from Cognito
    const command = new GetUserCommand({
      AccessToken: accessToken,
    });

    const response: GetUserCommandOutput = await cognitoClient.send(command);

    // Extract user attributes
    const attributes = response.UserAttributes || [];
    const getAttribute = (name: string): string => {
      const attr = attributes.find((a) => a.Name === name);
      return attr?.Value || '';
    };

    // Build user object
    const user = {
      id: response.Username || '', // Cognito username is the user ID (sub claim)
      email: getAttribute('email'),
      firstName: getAttribute('given_name'),
      lastName: getAttribute('family_name'),
    };

    // Also decode the token to get the sub (user ID) if Username is not reliable
    try {
      const payload = decodeJwtPayload(accessToken);
      if (payload.sub) {
        user.id = payload.sub;
      }
    } catch (error) {
      // Continue with Username if decode fails
      logger.warn('Failed to decode JWT for sub claim, using Username', { requestId });
    }

    logger.info('User retrieved successfully', {
      requestId,
      userId: user.id,
      email: user.email,
    });

    // Return user object
    return createSuccessResponse(
      200,
      {
        user,
      },
      requestId,
      requestOrigin
    );
  } catch (error) {
    if (error instanceof NotAuthorizedException) {
      logger.warn('getCurrentUser failed: token invalid or expired', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        401,
        'Access token is invalid or expired',
        requestId,
        undefined,
        requestOrigin
      );
    }

    if (error instanceof UserNotFoundException) {
      logger.warn('getCurrentUser failed: user not found', {
        requestId,
        error: error.message,
      });

      return createErrorResponse(
        404,
        'User not found',
        requestId,
        undefined,
        requestOrigin
      );
    }

    logger.error('Unexpected error during getCurrentUser', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Failed to retrieve user information. Please try again later.',
      requestId,
      undefined,
      requestOrigin
    );
  }
};
