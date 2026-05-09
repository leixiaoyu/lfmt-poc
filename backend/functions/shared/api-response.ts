/**
 * Shared API Response Utilities
 * Provides consistent response formatting across all Lambda functions.
 *
 * Two helpers — one per envelope convention — so the wire shape is
 * discoverable at the type level (OMC R1 H1-arch on PR #218):
 *
 *   1. `createFlatResponse<T>(statusCode, body, requestId?, origin?)`
 *      Body is serialized as `{ ...body, requestId }`. Use this for the
 *      DOMINANT convention — every endpoint except `uploadRequest`. Field
 *      access on the frontend is `response.data.<field>` directly.
 *
 *   2. `createWrappedResponse<T>(statusCode, { message, data }, requestId?, origin?)`
 *      Body is serialized as `{ message, data, requestId }`. Use this ONLY
 *      when the endpoint intentionally surfaces a user-visible message
 *      alongside a structured payload — currently only `POST /jobs/upload`.
 *
 * Pre-PR-#218 there was a single passthrough `createSuccessResponse` that
 * accepted any spread shape — flat, wrapped, or hybrid — which is exactly
 * what allowed the 2026-05-09 demo blocker (frontend read `response.data.data`,
 * Lambda emitted a flat body). Splitting the function forces every
 * Lambda author to make an explicit, type-checked choice. `createSuccessResponse`
 * remains as a deprecated alias for `createFlatResponse` so existing
 * callers continue to compile while the codebase migrates.
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

/**
 * Body shape accepted by `createFlatResponse`. The index signature lets the
 * caller include any business fields (jobId, user, totalChunks, etc.) and an
 * optional `message`. `requestId` is appended by the helper, not by the
 * caller — duplicating it would silently overwrite the per-request value.
 */
export interface ApiFlatResponseBody {
  message?: string;
  [key: string]: unknown;
}

/**
 * Body shape accepted by `createWrappedResponse`. Both `message` and `data`
 * are REQUIRED — that is the entire reason this helper exists separately
 * from `createFlatResponse`. A future caller that wants only `data` MUST
 * use `createFlatResponse({ data: ... })`; this signature won't compile
 * without `message`.
 */
export interface ApiWrappedResponseBody<T> {
  message: string;
  data: T;
}

/**
 * Get CORS headers based on request origin and environment
 * Supports multiple allowed origins from ALLOWED_ORIGINS environment variable
 */
export function getCorsHeaders(requestOrigin?: string): Record<string, string> {
  // Get allowed origins from environment variable (comma-separated list)
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map((origin) => origin.trim())
    : ['http://localhost:3000']; // Fallback to localhost

  // If requestOrigin matches an allowed origin, use it; otherwise use first allowed origin
  const allowedOrigin =
    requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers':
      'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
}

/**
 * Create a successful API response with the FLAT envelope convention.
 *
 * Wire body shape:
 *   `{ ...body, requestId }`
 *
 * Use this for every endpoint that does NOT need a `data` wrapper — i.e.,
 * the dominant convention across LFMT. The frontend reader accesses fields
 * directly via `response.data.<field>`.
 *
 * Example:
 *   ```ts
 *   return createFlatResponse(
 *     200,
 *     { message: 'OK', user: { id, email } },
 *     requestId,
 *     requestOrigin
 *   );
 *   // → body: { message: 'OK', user: { id, email }, requestId: '...' }
 *   ```
 */
export function createFlatResponse<T extends ApiFlatResponseBody>(
  statusCode: number,
  body: T,
  requestId?: string,
  requestOrigin?: string
): ApiResponse {
  return {
    statusCode,
    headers: getCorsHeaders(requestOrigin),
    body: JSON.stringify({
      ...body,
      requestId,
    }),
  };
}

/**
 * Create a successful API response with the WRAPPED envelope convention.
 *
 * Wire body shape:
 *   `{ message, data, requestId }`
 *
 * Use this ONLY when the endpoint intentionally pairs a user-facing message
 * with a structured payload that callers consume as a unit. Currently the
 * sole live caller is `POST /jobs/upload` (the presigned-URL handoff) — the
 * `data` field carries the entire `PresignedUrlResponse` and the `message`
 * is shown verbatim by the upload UI. The frontend reader accesses fields
 * via `response.data.data.<field>`.
 *
 * Example:
 *   ```ts
 *   return createWrappedResponse(
 *     200,
 *     { message: 'Upload URL generated', data: presignedUrlResponse },
 *     requestId,
 *     requestOrigin
 *   );
 *   // → body: { message: '...', data: { uploadUrl, jobId, ... }, requestId: '...' }
 *   ```
 */
export function createWrappedResponse<T>(
  statusCode: number,
  body: ApiWrappedResponseBody<T>,
  requestId?: string,
  requestOrigin?: string
): ApiResponse {
  return {
    statusCode,
    headers: getCorsHeaders(requestOrigin),
    body: JSON.stringify({
      message: body.message,
      data: body.data,
      requestId,
    }),
  };
}

/**
 * @deprecated Use `createFlatResponse` (or `createWrappedResponse` for the
 * `POST /jobs/upload` style envelope). Kept as an alias for `createFlatResponse`
 * so legacy call sites continue to compile during migration.
 *
 * Background: pre-PR-#218 this function was a passthrough that accepted any
 * spread body — flat, wrapped, or hybrid. That ambiguity was the root cause
 * of the 2026-05-09 demo blocker. New code MUST pick one of the explicit
 * helpers above.
 */
export function createSuccessResponse<T extends ApiFlatResponseBody>(
  statusCode: number,
  body: T,
  requestId?: string,
  requestOrigin?: string
): ApiResponse {
  return createFlatResponse(statusCode, body, requestId, requestOrigin);
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
