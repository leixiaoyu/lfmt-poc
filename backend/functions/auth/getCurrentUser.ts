/**
 * Get Current User Lambda Function
 * Verifies JWT access token and returns user information
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { UserProfile } from '@lfmt/shared-types';
import { createFlatResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';

/**
 * Wire contract for GET /me.
 *
 * Issue #188: locally narrow the response shape to the subset of UserProfile
 * that the Cognito authorizer actually provides (id/email/firstName/lastName).
 * Using `satisfies` on this type catches any drift between the wire and the
 * (broader) shared UserProfile — see comment block in the handler. A future
 * PR should promote this to a `CurrentUserApiResponse` interface in
 * shared-types/src/auth.ts so the frontend can `import` and type-share it.
 */
type CurrentUserApiBody = {
  user: Pick<UserProfile, 'email' | 'firstName' | 'lastName'> & { id: string };
};

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
    // { id, email, firstName, lastName }. `satisfies CurrentUserApiBody` is the
    // load-bearing check — it mirrors the pattern in login.ts:123 and catches
    // field removal/rename at compile time. A future PR should promote
    // CurrentUserApiBody to shared-types so the frontend can import the same
    // contract (rather than the wider UserProfile it currently consumes).
    const responseBody = {
      user: {
        id: authorizerClaims.sub,
        email: authorizerClaims.email || '',
        firstName: authorizerClaims.given_name || '',
        lastName: authorizerClaims.family_name || '',
      },
    } satisfies CurrentUserApiBody;

    return createFlatResponse(200, responseBody, requestId, requestOrigin);
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
