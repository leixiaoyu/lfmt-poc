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
 *
 * Issue #178: AdminConfirmSignUp call removed.
 * The dev User Pool is configured with `autoVerify: { email: true }` PLUS a
 * PreSignUp Lambda trigger that sets `autoConfirmUser = true` and
 * `autoVerifyEmail = true` (lfmt-infrastructure-stack.ts:321 + 365-368).
 * Cognito confirms the user as part of SignUp itself, so a separate
 * AdminConfirmSignUp call is a no-op that races and fails with
 * "Current status is CONFIRMED". Keeping it required `cognito-idp:AdminConfirmSignUp`
 * on the authRole IAM policy — an unnecessary privileged grant. Both are removed.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  SignUpCommand,
  UsernameExistsException,
  InvalidPasswordException,
  InvalidParameterException,
} from '@aws-sdk/client-cognito-identity-provider';
import { registerRequestSchema, RegisterResponse } from '@lfmt/shared-types';
import { createFlatResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';
import { getRequiredEnv, getOptionalEnv } from '../shared/env';

const logger = new Logger('lfmt-auth-register');
const cognitoClient = new CognitoIdentityProviderClient({});

// Validate environment variables at cold start
const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');
const ENVIRONMENT = getOptionalEnv('ENVIRONMENT', 'dev');

// Determines which success message to return; auto-confirm is handled by
// the Cognito PreSignUp trigger and pool configuration — no Lambda call needed.
const IS_DEV = ENVIRONMENT.includes('Dev');

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Processing registration request', { requestId });

  try {
    // Parse and validate request body.
    // A SyntaxError from JSON.parse must return 400 (client error), not 500.
    logger.info('Request body debug', {
      requestId,
      bodyType: typeof event.body,
      bodyLength: event.body ? event.body.length : 0,
      bodyPreview: event.body ? event.body.substring(0, 100) : 'null',
    });

    let body: unknown;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body || {};
    } catch {
      logger.warn('Registration request body is not valid JSON', { requestId });
      return createErrorResponse(400, 'Malformed JSON body', requestId, undefined, requestOrigin);
    }
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
        validationResult.error.flatten().fieldErrors,
        requestOrigin
      );
    }

    const { email, password, firstName, lastName } = validationResult.data;

    logger.info('Registering user with Cognito', {
      requestId,
      email: email.toLowerCase(),
    });

    // Register user with Cognito.
    // Map frontend field names (firstName, lastName) to Cognito attributes (given_name, family_name).
    // In dev, the PreSignUp Lambda trigger auto-confirms the user — no extra API call required.
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
      isDev: IS_DEV,
    });

    // Issue #188: `satisfies` against the wire contract to catch field
    // drift at compile time, mirroring the pattern in login.ts:123.
    //
    // Narrowed via Pick<> because the actual wire contract is `{ message }`
    // only — the frontend (`authService.register`) consumes a
    // `MessageResponse` shape (see frontend/src/services/authService.ts:171
    // and the comment block at 160). The full RegisterResponse interface
    // (userId/verificationRequired/verificationExpiresAt) is aspirational
    // and not yet wired through. Narrowing here, rather than padding the
    // response with stub fields, keeps the wire contract truthful and the
    // type check load-bearing — a follow-up that broadens the response
    // must widen the Pick<> here in the same change.
    return createFlatResponse(
      201,
      {
        message: IS_DEV
          ? 'User registered successfully. You can now log in.'
          : 'User registered successfully. Please check your email to verify your account.',
      } satisfies Pick<RegisterResponse, 'message'>,
      requestId,
      requestOrigin
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
        requestId,
        undefined,
        requestOrigin
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
        requestId,
        undefined,
        requestOrigin
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
        requestId,
        undefined,
        requestOrigin
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
      requestId,
      undefined,
      requestOrigin
    );
  }
};
