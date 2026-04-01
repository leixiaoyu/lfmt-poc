/**
 * JWT Utility Functions
 * Shared utilities for JWT token handling
 */

import Logger from './logger';

const logger = new Logger('jwt-utils');

/**
 * Decode JWT payload (without verification - for extracting claims only)
 * WARNING: This does NOT verify the signature. Use only for extracting claims
 * from tokens already verified by AWS Cognito or API Gateway authorizer.
 *
 * @param token - JWT token to decode
 * @returns Decoded JWT payload
 * @throws Error if token format is invalid
 */
export function decodeJwtPayload(token: string): any {
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
