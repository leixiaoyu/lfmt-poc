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
}

/**
 * Get CORS headers based on environment
 */
export function getCorsHeaders(): Record<string, string> {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ||
    (process.env.ENVIRONMENT === 'prod'
      ? 'https://lfmt.yourcompany.com'
      : 'http://localhost:3000');

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
  requestId?: string
): ApiResponse {
  return {
    statusCode,
    headers: getCorsHeaders(),
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
  errors?: Record<string, string[]>
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
    headers: getCorsHeaders(),
    body: JSON.stringify(response),
  };
}
