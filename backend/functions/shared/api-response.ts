/**
 * Shared API Response Utilities
 * Provides consistent response formatting across all Lambda functions
 */

export interface ApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface ApiErrorResponse {
  message: string;
  requestId?: string;
  errors?: Record<string, string[]>;
}

export interface ApiSuccessResponse<T = any> {
  message?: string;
  data?: T;
  requestId?: string;
  [key: string]: any; // Allow additional properties
}

/**
 * Get CORS headers based on request origin and environment
 * Supports multiple allowed origins from ALLOWED_ORIGINS environment variable
 */
export function getCorsHeaders(requestOrigin?: string): Record<string, string> {
  // Get allowed origins from environment variable (comma-separated list)
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map(origin => origin.trim())
    : ['http://localhost:3000']; // Fallback to localhost

  // If requestOrigin matches an allowed origin, use it; otherwise use first allowed origin
  const allowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
}

/**
 * Create a successful API response
 */
export function createSuccessResponse<T = any>(
  statusCode: number,
  data: ApiSuccessResponse<T>,
  requestId?: string,
  requestOrigin?: string
): ApiResponse {
  return {
    statusCode,
    headers: getCorsHeaders(requestOrigin),
    body: JSON.stringify({
      ...data,
      requestId,
    }),
  };
}

/**
 * Create an error API response
 */
export function createErrorResponse(
  statusCode: number,
  message: string,
  requestId?: string,
  errors?: Record<string, string[]>,
  requestOrigin?: string
): ApiResponse {
  const response: ApiErrorResponse = {
    message,
    requestId,
  };

  if (errors) {
    response.errors = errors;
  }

  return {
    statusCode,
    headers: getCorsHeaders(requestOrigin),
    body: JSON.stringify(response),
  };
}
