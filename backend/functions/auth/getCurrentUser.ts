/**
 * Get Current User Lambda Function
 * Verifies JWT access token and returns user information
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';

const logger = new Logger('lfmt-auth-getCurrentUser');

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Processing getCurrentUser request', { requestId });

  try {
    // User is authenticated via API Gateway Cognito authorizer
    // The user information is available in the authorizer context
    const authorizerClaims = event.requestContext.authorizer?.claims;

    if (!authorizerClaims || !authorizerClaims.sub) {
      logger.error(
        'Missing authorizer claims - endpoint should be protected by Cognito authorizer',
        {
          requestId,
          hasAuthorizer: !!event.requestContext.authorizer,
          hasClaims: !!authorizerClaims,
        }
      );

      return createErrorResponse(
        401,
        'Authentication required',
        requestId,
        undefined,
        requestOrigin
      );
    }

    logger.info('User authenticated via Cognito authorizer', {
      requestId,
      userId: authorizerClaims.sub,
    });

    const user = {
      id: authorizerClaims.sub,
      email: authorizerClaims.email || '',
      firstName: authorizerClaims.given_name || '',
      lastName: authorizerClaims.family_name || '',
    };

    return createSuccessResponse(
      200,
      {
        user,
      },
      requestId,
      requestOrigin
    );
  } catch (error) {
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
