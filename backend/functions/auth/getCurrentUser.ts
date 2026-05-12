/**
 * Get Current User Lambda Function
 * Verifies JWT access token and returns user information
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createFlatResponse, createErrorResponse } from '../shared/api-response';
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

    // Issue #188: the full shared UserProfile interface requires many fields that
    // Cognito authorizer claims don't provide (createdAt, mfaEnabled, role, etc.).
    // The wire contract for GET /me is the subset the frontend consumes:
    // { id, email, firstName, lastName }. A future PR should add a
    // CurrentUserApiResponse interface to shared-types that exactly matches this
    // subset — for now, the object literal is locally typed to prevent accidental
    // field removal.
    const user: { id: string; email: string; firstName: string; lastName: string } = {
      id: authorizerClaims.sub,
      email: authorizerClaims.email || '',
      firstName: authorizerClaims.given_name || '',
      lastName: authorizerClaims.family_name || '',
    };

    return createFlatResponse(200, { user }, requestId, requestOrigin);
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
