/**
 * API Response Helpers — wire-shape contract tests.
 *
 * These tests pin the exact JSON body produced by `createFlatResponse`
 * and `createWrappedResponse`. The split into two helpers (PR #218 OMC R1
 * H1-arch) makes the envelope discoverable at the type level — these
 * tests make it discoverable at the runtime level too: any future change
 * to the body shape will fail here BEFORE the change can ship a
 * `Cannot read properties of undefined (reading 'data')` regression
 * (the 2026-05-09 demo blocker class).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createFlatResponse,
  createWrappedResponse,
  createSuccessResponse,
  createErrorResponse,
  getCorsHeaders,
} from '../api-response';

describe('api-response — envelope helpers', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Reset CORS env so tests are deterministic regardless of host shell.
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ALLOWED_ORIGINS;
    delete process.env.ALLOWED_ORIGIN;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('createFlatResponse', () => {
    it('serializes the body as `{...body, requestId}` with no `data` wrapper', () => {
      const response = createFlatResponse(
        200,
        {
          message: 'OK',
          user: { id: 'u1', email: 'a@b.com' },
        },
        'req-123'
      );

      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body);
      // Critical contract: flat shape — fields live at the top level.
      expect(parsed).toEqual({
        message: 'OK',
        user: { id: 'u1', email: 'a@b.com' },
        requestId: 'req-123',
      });
      // Explicit anti-assertion: no nested `data` wrapper. This is the
      // exact failure mode of the 2026-05-09 demo blocker — a frontend
      // reader that expected `response.data.data.foo` would crash on
      // this shape.
      expect(parsed).not.toHaveProperty('data');
    });

    it('omits requestId when not provided (no spurious "requestId":undefined key in output)', () => {
      const response = createFlatResponse(200, { message: 'OK' });
      const parsed = JSON.parse(response.body);
      // JSON.stringify drops undefined values — so the key is absent
      // from the wire. Lock that contract: omitting requestId must NOT
      // surface as `"requestId": null` to the frontend.
      expect(parsed).toEqual({ message: 'OK' });
      expect(parsed).not.toHaveProperty('requestId');
    });

    it('includes CORS + Content-Type headers', () => {
      const response = createFlatResponse(200, { message: 'OK' });
      expect(response.headers['Content-Type']).toBe('application/json');
      expect(response.headers['Access-Control-Allow-Origin']).toBe('http://localhost:3000');
      expect(response.headers['Access-Control-Allow-Credentials']).toBe('true');
    });

    it('echoes the request origin when allowed by ALLOWED_ORIGINS env', () => {
      process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://other.example.com';
      const response = createFlatResponse(
        200,
        { message: 'OK' },
        undefined,
        'https://app.example.com'
      );
      expect(response.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    });

    it('falls back to the first allowed origin when request origin is not whitelisted', () => {
      process.env.ALLOWED_ORIGINS = 'https://app.example.com';
      const response = createFlatResponse(
        200,
        { message: 'OK' },
        undefined,
        'https://attacker.example'
      );
      expect(response.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
    });
  });

  describe('createWrappedResponse', () => {
    it('serializes the body as `{message, data, requestId}` with `data` containing the payload', () => {
      const payload = { uploadUrl: 'https://s3/bucket/key', jobId: 'job-1' };
      const response = createWrappedResponse(
        200,
        { message: 'Upload URL generated', data: payload },
        'req-456'
      );

      const parsed = JSON.parse(response.body);
      // Critical contract: nested `data` wrapper. The frontend reader
      // for `POST /jobs/upload` (translationService.uploadDocument)
      // expects this exact shape — `response.data.data.uploadUrl`.
      expect(parsed).toEqual({
        message: 'Upload URL generated',
        data: payload,
        requestId: 'req-456',
      });
      // Anti-assertion: the payload must NOT be spread to the top level
      // (which would be the flat envelope and break the upload reader).
      expect(parsed).not.toHaveProperty('uploadUrl');
      expect(parsed).not.toHaveProperty('jobId');
    });

    it('preserves nested object identity inside `data`', () => {
      // Locks the wire shape: `data` carries the payload verbatim,
      // including nested objects. A future maintainer who replaces
      // `body.data` with a spread would break the upload reader and
      // this test would fail loudly.
      const data = {
        uploadUrl: 'https://s3/k',
        requiredHeaders: { 'Content-Type': 'text/plain', 'x-amz-foo': 'bar' },
      };
      const response = createWrappedResponse(200, { message: 'OK', data }, 'r1');
      const parsed = JSON.parse(response.body);
      expect(parsed.data).toEqual(data);
    });
  });

  describe('createSuccessResponse (deprecated alias)', () => {
    it('produces the same wire shape as createFlatResponse for legacy callers', () => {
      const flat = createFlatResponse(200, { message: 'OK' }, 'r1');
      const legacy = createSuccessResponse(200, { message: 'OK' }, 'r1');
      expect(legacy.body).toBe(flat.body);
      expect(legacy.statusCode).toBe(flat.statusCode);
    });
  });

  describe('createErrorResponse', () => {
    it('serializes a flat error body', () => {
      const response = createErrorResponse(400, 'Validation failed', 'r1', {
        email: ['Invalid'],
      });
      const parsed = JSON.parse(response.body);
      expect(response.statusCode).toBe(400);
      expect(parsed).toEqual({
        message: 'Validation failed',
        requestId: 'r1',
        errors: { email: ['Invalid'] },
      });
    });

    it('omits the errors field when none are supplied', () => {
      const response = createErrorResponse(500, 'Server error');
      const parsed = JSON.parse(response.body);
      expect(parsed).toEqual({ message: 'Server error' });
    });

    // ---------------------------------------------------------------------
    // #267 — `errorCode` parameter is the new canonical home for the
    // machine-readable status-code discriminator. Pre-#267 some handlers
    // (notably startTranslation.ts) misused the `requestId` slot for this
    // signal — these tests pin the new contract so the bug cannot reappear.
    // ---------------------------------------------------------------------
    it('includes errorCode when supplied alongside the UUID requestId', () => {
      const response = createErrorResponse(
        409,
        'Translation already in_progress for this job',
        '11111111-2222-4333-8444-555555555555',
        undefined,
        undefined,
        'TRANSLATION_ALREADY_STARTED'
      );
      const parsed = JSON.parse(response.body);
      expect(response.statusCode).toBe(409);
      expect(parsed).toEqual({
        message: 'Translation already in_progress for this job',
        requestId: '11111111-2222-4333-8444-555555555555',
        errorCode: 'TRANSLATION_ALREADY_STARTED',
      });
      // The error code MUST NOT be smuggled into `requestId`.
      expect(parsed.requestId).not.toBe('TRANSLATION_ALREADY_STARTED');
    });

    it('omits errorCode when not provided (legacy callers stay unchanged)', () => {
      const response = createErrorResponse(500, 'Server error', 'r1');
      const parsed = JSON.parse(response.body);
      expect(parsed).toEqual({
        message: 'Server error',
        requestId: 'r1',
      });
      expect(parsed).not.toHaveProperty('errorCode');
    });

    it('supports the full 6-arg signature (status, message, requestId, errors, origin, errorCode)', () => {
      process.env.ALLOWED_ORIGINS = 'https://app.example.com';
      const response = createErrorResponse(
        400,
        'Validation failed',
        'r1',
        { email: ['Invalid'] },
        'https://app.example.com',
        'INVALID_REQUEST'
      );
      expect(response.headers['Access-Control-Allow-Origin']).toBe('https://app.example.com');
      const parsed = JSON.parse(response.body);
      expect(parsed).toEqual({
        message: 'Validation failed',
        requestId: 'r1',
        errorCode: 'INVALID_REQUEST',
        errors: { email: ['Invalid'] },
      });
    });
  });

  describe('getCorsHeaders', () => {
    it('parses comma-separated origins, trimming whitespace', () => {
      process.env.ALLOWED_ORIGINS = ' https://a.com ,  https://b.com ';
      const headers = getCorsHeaders('https://b.com');
      expect(headers['Access-Control-Allow-Origin']).toBe('https://b.com');
    });
  });
});
