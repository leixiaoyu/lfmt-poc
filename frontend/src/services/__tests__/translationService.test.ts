/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Translation Service Unit Tests
 *
 * Tests cover all API integration points, error handling,
 * and authentication flows for the translation service.
 *
 * Testing Strategy:
 * - Mock apiClient for backend API calls
 * - Mock axios for direct S3 uploads
 * - Test success paths AND error paths
 * - Verify error messages and status codes
 *
 * Coverage Target: 90%+ for P0 (Critical) code
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import {
  uploadDocument,
  uploadAndAwaitChunked,
  startTranslation,
  getJobStatus,
  getTranslationJobs,
  downloadTranslation,
  createLegalAttestation,
  TranslationServiceError,
  UPLOAD_AWAIT_CHUNKED_POLL_INTERVAL_MS,
  UPLOAD_AWAIT_CHUNKED_TIMEOUT_MS,
  type TranslationJob,
  type LegalAttestation,
  type UploadDocumentRequest,
  type TranslationConfig,
} from '../translationService';

// Mock auth token utility and apiClient
vi.mock('../../utils/api', () => ({
  getAuthToken: vi.fn(),
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  },
}));

import { getAuthToken, apiClient } from '../../utils/api';

// Mock axios module (only for S3 uploads which bypass apiClient)
vi.mock('axios', () => {
  return {
    default: {
      put: vi.fn(),
      isAxiosError: vi.fn((error: any) => error && error.isAxiosError === true),
    },
  };
});

const mockedApiClient = apiClient as unknown as {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const mockedAxios = axios as unknown as {
  put: ReturnType<typeof vi.fn>;
  isAxiosError: (error: any) => boolean;
};

describe('TranslationService - uploadDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Success Scenarios', () => {
    it('should upload document successfully with presigned URL flow', async () => {
      // Arrange
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: 'captured-by-backend',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      // Mock presigned URL response from backend.
      // The backend now includes both `fileId` (the S3 object key component)
      // and `jobId` (the DynamoDB record key) in the response envelope.
      // requiredHeaders mirrors what uploadRequest.ts lines 224-227 returns:
      // Content-Type (already normalised server-side to match the signed value)
      // plus any additional S3 metadata headers.
      const mockPresignedResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
            fileId: 'file-abc',
            jobId: 'job-123',
            requiredHeaders: {
              'Content-Type': 'text/plain',
              'x-amz-server-side-encryption': 'AES256',
            },
          },
        },
      };

      // Step 1: Mock POST to /jobs/upload (request presigned URL via apiClient)
      mockedApiClient.post.mockResolvedValueOnce(mockPresignedResponse);

      // Step 2: Mock PUT to S3 presigned URL (upload file via axios)
      mockedAxios.put.mockResolvedValueOnce({ data: null });

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      // Act
      const result = await uploadDocument(request);

      // Assert - Step 1: Request presigned URL
      expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.post).toHaveBeenCalledWith('/jobs/upload', {
        fileName: 'test.txt',
        fileSize: mockFile.size,
        contentType: 'text/plain',
        legalAttestation: mockLegalAttestation,
      });

      // Assert - Step 2: Upload to S3.
      // Bug #1 fix (SignatureDoesNotMatch): the PUT must use ONLY the headers
      // supplied by the backend in requiredHeaders — no extra Content-Type
      // override from request.file.type. The backend already places Content-Type
      // in requiredHeaders with the value it signed.
      //
      // Code-4 (OMC Round 2): use strict toEqual at the outer level (not
      // objectContaining) so a future stray config key in the axios options
      // object is caught rather than silently passing through.
      expect(mockedAxios.put).toHaveBeenCalledTimes(1);
      expect(mockedAxios.put).toHaveBeenCalledWith(
        'https://s3.amazonaws.com/bucket/presigned-url',
        mockFile,
        {
          headers: {
            'Content-Type': 'text/plain',
            'x-amz-server-side-encryption': 'AES256',
          },
        }
      );

      // Assert - Result
      expect(result.jobId).toBe('job-123');
      expect(result.fileName).toBe('test.txt');
      expect(result.status).toBe('PENDING');
    });

    // ---------------------------------------------------------------------------
    // Bug #1 regression guard — SignatureDoesNotMatch on S3 PUT
    //
    // Root cause: translationService previously spread requiredHeaders AND then
    // overrode Content-Type with request.file.type. If the browser's File.type
    // differs from what the backend normalised when signing the presigned URL,
    // S3 rejects the PUT with SignatureDoesNotMatch.
    //
    // Fix: rely exclusively on requiredHeaders from the backend.
    //
    // This test verifies the exact headers object forwarded to axios.put:
    //   • No extra Content-Type key beyond what the backend sent.
    //   • Additional backend headers (e.g. server-side encryption) are preserved.
    //   • When browser File.type diverges from what the backend signed, the
    //     backend value takes precedence.
    // ---------------------------------------------------------------------------
    it('should send only requiredHeaders to S3 — no extra Content-Type override', async () => {
      // Arrange: browser File has 'text/plain' but backend signed for 'text/x-rst'
      // (simulating a normalisation step on the server side).
      const mockFile = new File(['content'], 'document.rst', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: 'captured-by-backend',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      // Backend signed for 'text/x-rst' — note: intentionally different from
      // the browser File.type ('text/plain') to expose the old double-set bug.
      const mockPresignedResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
            fileId: 'file-rst',
            jobId: 'job-rst',
            requiredHeaders: {
              'Content-Type': 'text/x-rst',
              'Content-Length': '7',
            },
          },
        },
      };

      mockedApiClient.post.mockResolvedValueOnce(mockPresignedResponse);
      mockedAxios.put.mockResolvedValueOnce({ data: null });

      // Act
      await uploadDocument({ file: mockFile, legalAttestation: mockLegalAttestation });

      // Assert: the PUT headers object must contain Content-Type from the
      // backend ('text/x-rst'), NOT the browser File.type ('text/plain').
      // Content-Length is intentionally filtered out before reaching axios —
      // see Bug #2 (browser-forbidden-header) regression guard below.
      expect(mockedAxios.put).toHaveBeenCalledWith(
        'https://s3.amazonaws.com/bucket/presigned-url',
        mockFile,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'text/x-rst',
          }),
        })
      );

      // Explicit guard: the browser MIME type must NOT override the signed value.
      const sentHeaders = mockedAxios.put.mock.calls[0][2].headers as Record<string, string>;
      expect(sentHeaders['Content-Type']).toBe('text/x-rst');
      expect(sentHeaders['Content-Type']).not.toBe('text/plain');
    });

    // -------------------------------------------------------------------------
    // Bug #2 regression guard — "Refused to set unsafe header 'Content-Length'"
    //
    // Root cause: translationService previously spread requiredHeaders directly
    // into axios.put({ headers }). When the backend included Content-Length
    // (which it does — uploadRequest.ts:226 sets it for documentation), axios
    // tried to forward it to XHR. Browsers reject Content-Length per Fetch
    // spec §forbidden-header-name and emit "Refused to set unsafe header" to
    // the console. The XHR still proceeded (browser computes Content-Length
    // from the body), but the noisy log obscured the actual demo blocker (a
    // CSP block — see Fix 1 in this PR).
    //
    // Fix: stripBrowserForbiddenHeaders() filters Content-Length (case-
    // insensitive) before the headers reach axios. The backend keeps the
    // header in PresignedUrlResponse for documentation / non-browser callers
    // (curl honours it) — we don't change the API contract, we just stop the
    // browser path from trying to send a header it can't.
    // -------------------------------------------------------------------------
    it('should NOT forward Content-Length to axios.put (browser-forbidden header)', async () => {
      const mockFile = new File(['content'], 'document.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: 'captured-by-backend',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      const mockPresignedResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
            fileId: 'file-1',
            jobId: 'job-1',
            requiredHeaders: {
              'Content-Type': 'text/plain',
              'Content-Length': '7',
              // Lowercase variant — backend doesn't currently send this, but
              // the filter is case-insensitive and we lock that contract here
              // so a future header-name normalisation doesn't silently leak it.
              'content-length': '7',
            },
          },
        },
      };

      mockedApiClient.post.mockResolvedValueOnce(mockPresignedResponse);
      mockedAxios.put.mockResolvedValueOnce({ data: null });

      await uploadDocument({ file: mockFile, legalAttestation: mockLegalAttestation });

      const sentHeaders = mockedAxios.put.mock.calls[0][2].headers as Record<string, string>;
      // Content-Length must not be present in either casing.
      const headerNames = Object.keys(sentHeaders).map((n) => n.toLowerCase());
      expect(headerNames).not.toContain('content-length');
      // Content-Type must still be forwarded.
      expect(sentHeaders['Content-Type']).toBe('text/plain');
    });

    // -------------------------------------------------------------------------
    // Issue #98 regression guard — accurate UI error when S3 PUT is blocked.
    //
    // When the browser blocks the S3 PUT (CSP, network outage), axios reports
    // the failure with `error.response === undefined`. translationService now
    // catches this and re-throws a TranslationServiceError carrying
    // S3_UPLOAD_BLOCKED_MESSAGE so the page mapper surfaces a targeted phrase
    // instead of the misleading generic "Connection lost" text. See
    // translationErrorMessages — when statusCode is undefined and message is
    // non-generic, the message is surfaced verbatim (PR #202 Round 2 Code-3).
    // -------------------------------------------------------------------------
    it('throws TranslationServiceError(S3_UPLOAD_BLOCKED_MESSAGE) when S3 PUT has no response', async () => {
      const { S3_UPLOAD_BLOCKED_MESSAGE } = await import('../translationService');
      const mockFile = new File(['content'], 'doc.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: 'captured-by-backend',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      mockedApiClient.post.mockResolvedValueOnce({
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
            fileId: 'file-1',
            jobId: 'job-1',
            requiredHeaders: { 'Content-Type': 'text/plain' },
          },
        },
      });

      // Simulate a CSP-block / network failure: axios error with no response.
      mockedAxios.put.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Network Error',
        // response intentionally omitted — this is the CSP-block signature.
        request: {},
      } as unknown as AxiosError);

      try {
        await uploadDocument({ file: mockFile, legalAttestation: mockLegalAttestation });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (err) {
        expect(err).toBeInstanceOf(TranslationServiceError);
        expect((err as TranslationServiceError).message).toBe(S3_UPLOAD_BLOCKED_MESSAGE);
        // statusCode is undefined for transport-level failures; the page
        // mapper relies on this to surface the message verbatim.
        expect((err as TranslationServiceError).statusCode).toBeUndefined();
      }
    });

    it('preserves S3 HTTP status when S3 PUT returns an error response (e.g. 403)', async () => {
      const mockFile = new File(['content'], 'doc.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: 'captured-by-backend',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      mockedApiClient.post.mockResolvedValueOnce({
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
            fileId: 'file-1',
            jobId: 'job-1',
            requiredHeaders: { 'Content-Type': 'text/plain' },
          },
        },
      });

      // Hold the rejected axios error in a named local so the test can
      // assert reference equality on `originalError` below — without
      // that, a future refactor that wraps the cause (losing the chain)
      // would silently pass the bare instanceOf check.
      const rejectedAxiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 403',
        response: {
          status: 403,
          statusText: 'Forbidden',
          data: '<Error>SignatureDoesNotMatch</Error>',
        },
      } as unknown as AxiosError;

      mockedAxios.put.mockRejectedValueOnce(rejectedAxiosError);

      try {
        await uploadDocument({ file: mockFile, legalAttestation: mockLegalAttestation });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (err) {
        expect(err).toBeInstanceOf(TranslationServiceError);
        expect((err as TranslationServiceError).statusCode).toBe(403);
        // C-test-3 (PR #214 OMC): lock originalError preservation. The
        // wrap path MUST forward the rejected axios error verbatim so
        // monitoring tools (Sentry, Rollbar) can introspect `.response`
        // on the cause chain. If a future refactor wraps the cause
        // (e.g. `new Error(err.message)`), this assertion breaks.
        expect((err as TranslationServiceError).originalError).toBe(rejectedAxiosError);
      }
    });

    // -------------------------------------------------------------------------
    // C-test-2 (PR #214 OMC): wrapS3UploadError non-axios branch.
    //
    // When axios.put rejects with a value that ISN'T an AxiosError (a
    // plain Error, a string, undefined), the wrap path must still:
    //   1. Throw TranslationServiceError (not the raw value).
    //   2. Preserve the original message (when one exists).
    //   3. Preserve `originalError` so the cause chain survives — this
    //      was the gap R-arch-2 closed.
    // -------------------------------------------------------------------------
    describe('wrapS3UploadError — non-axios rejected values', () => {
      const buildAttestation = (): LegalAttestation => ({
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: 'captured-by-backend',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      });

      const mockPresigned = () => {
        mockedApiClient.post.mockResolvedValueOnce({
          data: {
            data: {
              uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
              fileId: 'file-1',
              jobId: 'job-1',
              requiredHeaders: { 'Content-Type': 'text/plain' },
            },
          },
        });
      };

      it('re-throws TranslationServiceError preserving plain Error message + cause', async () => {
        const mockFile = new File(['content'], 'doc.txt', { type: 'text/plain' });
        mockPresigned();

        const plainError = new Error('disk full while reading body');
        mockedAxios.put.mockRejectedValueOnce(plainError);

        try {
          await uploadDocument({ file: mockFile, legalAttestation: buildAttestation() });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (err) {
          expect(err).toBeInstanceOf(TranslationServiceError);
          expect((err as TranslationServiceError).message).toBe('disk full while reading body');
          // statusCode is undefined for non-axios failures.
          expect((err as TranslationServiceError).statusCode).toBeUndefined();
          // R-arch-2: the cause chain must be intact so monitoring tools
          // can see the underlying disk-full Error rather than just the
          // wrapped service error.
          expect((err as TranslationServiceError).originalError).toBe(plainError);
        }
      });

      it('handles a thrown string gracefully (does not crash)', async () => {
        const mockFile = new File(['content'], 'doc.txt', { type: 'text/plain' });
        mockPresigned();

        // axios shouldn't reject with a string in practice, but the
        // wrap path must not crash on `error.message` access if it does.
        mockedAxios.put.mockRejectedValueOnce('boom');

        try {
          await uploadDocument({ file: mockFile, legalAttestation: buildAttestation() });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (err) {
          expect(err).toBeInstanceOf(TranslationServiceError);
          // Falls back to the generic message — but does NOT throw a
          // TypeError accessing .message on a string.
          expect((err as TranslationServiceError).message).toBe('S3 upload failed');
          // R-arch-2: even non-Error rejections produce a synthetic
          // cause so the monitoring path always has SOMETHING to log.
          const original = (err as TranslationServiceError).originalError as Error | undefined;
          expect(original).toBeInstanceOf(Error);
          expect(original?.message).toBe('boom');
        }
      });

      it('handles a thrown undefined gracefully (does not crash)', async () => {
        const mockFile = new File(['content'], 'doc.txt', { type: 'text/plain' });
        mockPresigned();

        mockedAxios.put.mockRejectedValueOnce(undefined);

        try {
          await uploadDocument({ file: mockFile, legalAttestation: buildAttestation() });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (err) {
          expect(err).toBeInstanceOf(TranslationServiceError);
          expect((err as TranslationServiceError).message).toBe('S3 upload failed');
          // The synthetic cause stringifies undefined to "undefined" —
          // not pretty, but provably non-crashing and non-empty.
          const original = (err as TranslationServiceError).originalError as Error | undefined;
          expect(original).toBeInstanceOf(Error);
          expect(original?.message).toBe('undefined');
        }
      });

      // -----------------------------------------------------------------
      // M-1 (PR #214 OMC R2): proper type-guard narrowing — no
      // `as unknown as AxiosError` lie.
      //
      // Pre-fix, the non-axios branch cast its synthetic cause through
      // `as unknown as AxiosError` to satisfy `originalError`'s field
      // type. Post-fix, the field is widened to `Error | undefined`,
      // and `axios.isAxiosError()` is the only narrowing path used
      // inside the wrap. This test pins the contract: the narrowed
      // branch (axios.isAxiosError() === true) IS reachable, AND the
      // non-axios branch produces a plain Error instance whose
      // properties (message, name) survive intact — i.e. the cast is
      // structurally unnecessary because the runtime type already
      // matches the (now-widened) compile-time type.
      // -----------------------------------------------------------------
      it('M-1: axios-error branch IS reachable (narrowed via axios.isAxiosError)', async () => {
        const mockFile = new File(['content'], 'doc.txt', { type: 'text/plain' });
        mockPresigned();

        const axiosError: AxiosError = {
          isAxiosError: true,
          message: 'Request failed with status code 500',
          response: {
            status: 500,
            statusText: 'Internal Server Error',
            data: '<Error>InternalError</Error>',
            headers: {},
            config: {} as AxiosError['config'],
          },
        } as unknown as AxiosError;

        mockedAxios.put.mockRejectedValueOnce(axiosError);

        try {
          await uploadDocument({ file: mockFile, legalAttestation: buildAttestation() });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (err) {
          expect(err).toBeInstanceOf(TranslationServiceError);
          // Reaching this expectation proves the axios-narrowed branch
          // executed (statusCode is set ONLY in that branch).
          expect((err as TranslationServiceError).statusCode).toBe(500);
          expect((err as TranslationServiceError).originalError).toBe(axiosError);
        }
      });

      it('M-1: non-axios branch yields plain Error (no AxiosError cast)', async () => {
        const mockFile = new File(['content'], 'doc.txt', { type: 'text/plain' });
        mockPresigned();

        // Use a TypeError to maximise the divergence from AxiosError —
        // it has no `.response`, no `isAxiosError` flag, etc. The wrap
        // must still preserve it byte-for-byte (instanceof + same
        // reference) without coercing through AxiosError.
        const typeError = new TypeError('cannot read property of undefined');
        mockedAxios.put.mockRejectedValueOnce(typeError);

        try {
          await uploadDocument({ file: mockFile, legalAttestation: buildAttestation() });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (err) {
          expect(err).toBeInstanceOf(TranslationServiceError);
          const original = (err as TranslationServiceError).originalError;
          // Pre-fix: `originalError` was typed `AxiosError` and TS
          // couldn't tell us the runtime type was actually TypeError.
          // Post-fix: typed as `Error`, so the instanceof check is
          // direct and reflects reality.
          expect(original).toBeInstanceOf(TypeError);
          expect(original).toBe(typeError);
          // No `isAxiosError` flag — confirms we did NOT silently
          // coerce the cause into the AxiosError shape.
          expect((original as unknown as { isAxiosError?: unknown }).isAxiosError).toBeUndefined();
        }
      });
    });

    it('should include legal attestation in JSON payload to backend', async () => {
      // Arrange
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: 'captured-by-backend',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      mockedApiClient.post.mockResolvedValueOnce({
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
            fileId: 'job-123',
            requiredHeaders: {},
          },
        },
      });

      mockedAxios.put.mockResolvedValueOnce({ data: null });

      // Act
      await uploadDocument({
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      });

      // Assert - Legal attestation is sent in JSON payload
      const callArgs = mockedApiClient.post.mock.calls[0];
      const payload = callArgs[1];

      expect(payload).toEqual({
        fileName: 'test.txt',
        fileSize: mockFile.size,
        contentType: 'text/plain',
        legalAttestation: mockLegalAttestation,
      });
    });
  });

  describe('Error Scenarios', () => {
    it('should throw TranslationServiceError when not authenticated', async () => {
      // Arrange
      // Note: In the new implementation, auth is handled by apiClient interceptors.
      // However, the service has a check `if (error instanceof TranslationServiceError)`.
      // If getAuthToken returns null (which happens inside apiClient interceptor logic usually,
      // but here we mock apiClient), we simulate apiClient throwing a 401 error.

      // Simulate apiClient 401 error
      const mockError = {
        isAxiosError: true,
        response: {
          status: 401,
          data: { message: 'Not authenticated' },
        },
        message: 'Request failed with status code 401',
      } as AxiosError;

      mockedApiClient.post.mockRejectedValueOnce(mockError);

      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      // Act & Assert
      try {
        await uploadDocument({
          file: mockFile,
          legalAttestation: mockLegalAttestation,
        });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationServiceError);
        // The actual message depends on how handleError processes the AxiosError
        expect((error as TranslationServiceError).statusCode).toBe(401);
      }
    });

    it('should throw TranslationServiceError with status code on 400 Bad Request', async () => {
      // Arrange
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      const mockError = {
        isAxiosError: true,
        response: {
          status: 400,
          data: {
            message: 'Invalid file format',
          },
        },
        message: 'Request failed',
      } as AxiosError;

      mockedApiClient.post.mockRejectedValueOnce(mockError);

      // Act & Assert
      try {
        await uploadDocument({
          file: mockFile,
          legalAttestation: mockLegalAttestation,
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationServiceError);
        expect((error as TranslationServiceError).message).toBe('Invalid file format');
        expect((error as TranslationServiceError).statusCode).toBe(400);
      }
    });

    it('should handle network errors gracefully', async () => {
      // Arrange
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      const mockError = {
        isAxiosError: true,
        message: 'Network Error',
      } as AxiosError;

      mockedApiClient.post.mockRejectedValueOnce(mockError);

      // Act & Assert
      await expect(
        uploadDocument({
          file: mockFile,
          legalAttestation: mockLegalAttestation,
        })
      ).rejects.toThrow('Network Error');
    });

    it('should handle 500 Internal Server Error', async () => {
      // Arrange
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      const mockError = {
        isAxiosError: true,
        response: {
          status: 500,
          data: {
            message: 'Internal Server Error',
          },
        },
        message: 'Request failed',
      } as AxiosError;

      mockedApiClient.post.mockRejectedValueOnce(mockError);

      // Act & Assert
      try {
        await uploadDocument({
          file: mockFile,
          legalAttestation: mockLegalAttestation,
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationServiceError);
        expect((error as TranslationServiceError).statusCode).toBe(500);
      }
    });

    it('should handle non-Axios errors with generic message', async () => {
      // Arrange
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      mockedApiClient.post.mockRejectedValueOnce(new Error('Unexpected error'));

      // Act & Assert
      await expect(
        uploadDocument({
          file: mockFile,
          legalAttestation: mockLegalAttestation,
        })
      ).rejects.toThrow('An unexpected error occurred');
    });
  });
});

describe('TranslationService - startTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  describe('Success Scenarios', () => {
    it('should start translation with correct payload', async () => {
      // Arrange
      const jobId = 'job-123';
      const request: TranslationConfig = {
        targetLanguage: 'es',
        tone: 'formal',
      };

      const mockResponse = {
        data: {
          data: {
            jobId: 'job-123',
            userId: 'user-456',
            status: 'CHUNKING' as const,
            targetLanguage: 'es' as const,
            tone: 'formal' as const,
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
            createdAt: '2024-10-31T12:00:00Z',
            updatedAt: '2024-10-31T12:00:00Z',
          },
        },
      };

      mockedApiClient.post.mockResolvedValueOnce(mockResponse);

      // Act
      const result = await startTranslation(jobId, request);

      // Assert
      expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.post).toHaveBeenCalledWith(
        expect.stringContaining(`/jobs/${jobId}/translate`),
        request
      );
      expect(result.status).toBe('CHUNKING');
      expect(result.targetLanguage).toBe('es');
      expect(result.tone).toBe('formal');
    });
  });

  describe('Error Scenarios', () => {
    it('should throw error on 404 Job Not Found', async () => {
      // Arrange
      const jobId = 'non-existent-job';
      const request: TranslationConfig = {
        targetLanguage: 'es',
        tone: 'neutral',
      };

      const mockError = {
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            message: 'Translation job not found',
          },
        },
        message: 'Not found',
      } as AxiosError;

      mockedApiClient.post.mockRejectedValueOnce(mockError);

      // Act & Assert
      await expect(startTranslation(jobId, request)).rejects.toThrow('Translation job not found');
    });

    it('should throw error when not authenticated', async () => {
      // Arrange
      // Simulate apiClient 401
      const mockError = {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Not authenticated' } },
        message: 'Not authenticated',
      } as AxiosError;

      mockedApiClient.post.mockRejectedValueOnce(mockError);

      const jobId = 'job-123';
      const request: TranslationConfig = {
        targetLanguage: 'es',
        tone: 'neutral',
      };

      // Act & Assert
      try {
        await startTranslation(jobId, request);
        expect.fail('Should have thrown TranslationServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationServiceError);
        // The message comes from the mocked error response data
        expect((error as TranslationServiceError).message).toBe('Not authenticated');
      }
    });
  });
});

describe('TranslationService - getJobStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  describe('Success Scenarios', () => {
    it('should fetch job status successfully', async () => {
      // Arrange
      const jobId = 'job-123';
      const mockJob: TranslationJob = {
        jobId: 'job-123',
        userId: 'user-456',
        status: 'IN_PROGRESS',
        fileName: 'test.txt',
        fileSize: 1024,
        contentType: 'text/plain',
        targetLanguage: 'es',
        tone: 'neutral',
        totalChunks: 10,
        completedChunks: 5,
        createdAt: '2024-10-31T12:00:00Z',
        updatedAt: '2024-10-31T12:05:00Z',
      };

      mockedApiClient.get.mockResolvedValueOnce({
        data: { data: mockJob },
      });

      // Act
      const result = await getJobStatus(jobId);

      // Assert
      expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining(`/jobs/${jobId}/translation-status`)
      );
      expect(result).toEqual(mockJob);
      expect(result.completedChunks).toBe(5);
      expect(result.totalChunks).toBe(10);
    });

    it('should handle COMPLETED status', async () => {
      // Arrange
      const jobId = 'job-123';
      const mockJob: TranslationJob = {
        jobId: 'job-123',
        userId: 'user-456',
        status: 'COMPLETED',
        fileName: 'test.txt',
        fileSize: 1024,
        contentType: 'text/plain',
        targetLanguage: 'es',
        tone: 'neutral',
        totalChunks: 10,
        completedChunks: 10,
        createdAt: '2024-10-31T12:00:00Z',
        updatedAt: '2024-10-31T12:30:00Z',
        completedAt: '2024-10-31T12:30:00Z',
      };

      mockedApiClient.get.mockResolvedValueOnce({
        data: { data: mockJob },
      });

      // Act
      const result = await getJobStatus(jobId);

      // Assert
      expect(result.status).toBe('COMPLETED');
      expect(result.completedAt).toBeDefined();
    });
  });

  describe('Error Scenarios', () => {
    it('should throw error on 404 Job Not Found', async () => {
      // Arrange
      const jobId = 'non-existent-job';

      const mockError = {
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            message: 'Translation job not found',
          },
        },
        message: 'Not found',
      } as AxiosError;

      mockedApiClient.get.mockRejectedValueOnce(mockError);

      // Act & Assert
      await expect(getJobStatus(jobId)).rejects.toThrow('Translation job not found');
    });
  });
});

describe('TranslationService - getTranslationJobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  describe('Success Scenarios', () => {
    it('should fetch all translation jobs successfully', async () => {
      // Arrange
      const mockJobs: TranslationJob[] = [
        {
          jobId: 'job-1',
          userId: 'user-456',
          status: 'COMPLETED',
          fileName: 'test1.txt',
          fileSize: 1024,
          contentType: 'text/plain',
          targetLanguage: 'es',
          tone: 'neutral',
          createdAt: '2024-10-31T12:00:00Z',
          updatedAt: '2024-10-31T12:30:00Z',
        },
        {
          jobId: 'job-2',
          userId: 'user-456',
          status: 'IN_PROGRESS',
          fileName: 'test2.txt',
          fileSize: 2048,
          contentType: 'text/plain',
          targetLanguage: 'fr',
          tone: 'formal',
          createdAt: '2024-10-31T13:00:00Z',
          updatedAt: '2024-10-31T13:15:00Z',
        },
      ];

      mockedApiClient.get.mockResolvedValueOnce({
        data: { data: mockJobs },
      });

      // Act
      const result = await getTranslationJobs();

      // Assert
      expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.get).toHaveBeenCalledWith(expect.stringContaining('/jobs'));
      expect(result).toEqual(mockJobs);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no jobs exist', async () => {
      // Arrange
      mockedApiClient.get.mockResolvedValueOnce({
        data: { data: [] },
      });

      // Act
      const result = await getTranslationJobs();

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });

  describe('Error Scenarios', () => {
    it('should throw error when not authenticated', async () => {
      // Arrange
      // Simulate apiClient 401
      const mockError = {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Not authenticated' } },
        message: 'Not authenticated',
      } as AxiosError;

      mockedApiClient.get.mockRejectedValueOnce(mockError);

      // Act & Assert
      try {
        await getTranslationJobs();
        expect.fail('Should have thrown TranslationServiceError');
      } catch (error) {
        expect(error).toBeInstanceOf(TranslationServiceError);
        expect((error as TranslationServiceError).message).toBe('Not authenticated');
      }
    });
  });
});

describe('TranslationService - downloadTranslation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  describe('Success Scenarios', () => {
    it('should download translation as blob', async () => {
      // Arrange
      const jobId = 'job-123';
      const mockBlob = new Blob(['translated content'], { type: 'text/plain' });

      mockedApiClient.get.mockResolvedValueOnce({
        data: mockBlob,
      });

      // Act
      const result = await downloadTranslation(jobId);

      // Assert
      expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining(`/jobs/${jobId}/download`),
        expect.objectContaining({
          responseType: 'blob',
        })
      );
      expect(result).toBeInstanceOf(Blob);
      expect(result.type).toBe('text/plain');
    });
  });

  describe('Error Scenarios', () => {
    it('should throw error on 404 Translation Not Found', async () => {
      // Arrange
      const jobId = 'job-without-translation';

      const mockError = {
        isAxiosError: true,
        response: {
          status: 404,
          data: {
            message: 'Translation not available for download',
          },
        },
        message: 'Not found',
      } as AxiosError;

      mockedApiClient.get.mockRejectedValueOnce(mockError);

      // Act & Assert
      await expect(downloadTranslation(jobId)).rejects.toThrow(
        'Translation not available for download'
      );
    });

    it('should throw error on 409 Translation Not Yet Complete (OMC #17)', async () => {
      // Arrange — 409 means job exists but is IN_PROGRESS / not yet downloadable.
      // The frontend must surface this to the user rather than swallowing it.
      const jobId = 'job-still-in-progress';

      const mockError = {
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            message: 'Translation not yet complete; current status: IN_PROGRESS',
          },
        },
        message: 'Conflict',
      } as AxiosError;

      mockedApiClient.get.mockRejectedValueOnce(mockError);

      // Act & Assert
      await expect(downloadTranslation(jobId)).rejects.toThrow(
        'Translation not yet complete; current status: IN_PROGRESS'
      );
    });
  });
});

describe('TranslationService - createLegalAttestation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // NOTE: The refactored service no longer calls axios to get IP.
    // It just returns a placeholder that backend will replace.
    // So we don't need to mock axios.get here anymore for IP check.
  });

  it('should create legal attestation with all required fields', async () => {
    // Arrange
    const acceptCopyrightOwnership = true;
    const acceptTranslationRights = true;
    const acceptLiabilityTerms = true;

    // Act
    const result = await createLegalAttestation(
      acceptCopyrightOwnership,
      acceptTranslationRights,
      acceptLiabilityTerms
    );

    // Assert
    expect(result.acceptCopyrightOwnership).toBe(true);
    expect(result.acceptTranslationRights).toBe(true);
    expect(result.acceptLiabilityTerms).toBe(true);
    expect(result.userIPAddress).toBe('captured-by-backend'); // Backend captures IP
    expect(result.userAgent).toBe(navigator.userAgent);
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp)).toBeInstanceOf(Date);
  });

  // ... other legal attestation tests ...
  it('should create attestation with false values', async () => {
    // Arrange
    const acceptCopyrightOwnership = false;
    const acceptTranslationRights = false;
    const acceptLiabilityTerms = false;

    // Act
    const result = await createLegalAttestation(
      acceptCopyrightOwnership,
      acceptTranslationRights,
      acceptLiabilityTerms
    );

    // Assert
    expect(result.acceptCopyrightOwnership).toBe(false);
    expect(result.acceptTranslationRights).toBe(false);
    expect(result.acceptLiabilityTerms).toBe(false);
  });

  it('should use current timestamp in ISO format', async () => {
    // Arrange
    const beforeTime = Date.now();

    // Act
    const result = await createLegalAttestation(true, true, true);

    // Assert
    const afterTime = Date.now();
    const resultTime = new Date(result.timestamp).getTime();

    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(resultTime).toBeGreaterThanOrEqual(beforeTime);
    expect(resultTime).toBeLessThanOrEqual(afterTime);
  });
});

// ---------------------------------------------------------------------------
// uploadAndAwaitChunked — polling state machine (Arch-1, OMC Round 2)
//
// The polling logic was extracted from the page component into the service
// layer so the UI has a single awaitable. These tests exercise the full
// state machine (PENDING → CHUNKING → CHUNKED, terminal errors, timeout)
// using vi.useFakeTimers to avoid real wall-clock waits.
//
// We spy on uploadDocument and getJobStatus so the tests verify the
// internal collaboration without re-mocking the entire module.
// ---------------------------------------------------------------------------
describe('TranslationService - uploadAndAwaitChunked', () => {
  const mockFile = new File(['hello'], 'doc.txt', { type: 'text/plain' });
  const mockLegalAttestation: LegalAttestation = {
    acceptCopyrightOwnership: true,
    acceptTranslationRights: true,
    acceptLiabilityTerms: true,
    userIPAddress: 'captured-by-backend',
    userAgent: 'Mozilla/5.0',
    timestamp: '2024-10-31T12:00:00Z',
  };

  const baseJob: TranslationJob = {
    jobId: 'await-job',
    userId: 'user-1',
    fileName: 'doc.txt',
    fileSize: 5,
    contentType: 'text/plain',
    status: 'PENDING',
    createdAt: '2024-10-31T12:00:00Z',
    updatedAt: '2024-10-31T12:00:00Z',
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('exports UPLOAD_AWAIT_CHUNKED_POLL_INTERVAL_MS as 1000ms (Perf-5: 1 s default)', () => {
    // The poll interval was reduced from 2 s to 1 s in OMC Round 2 (Perf-5)
    // to halve perceived "Processing upload..." dwell time.
    expect(UPLOAD_AWAIT_CHUNKED_POLL_INTERVAL_MS).toBe(1_000);
  });

  it('exports UPLOAD_AWAIT_CHUNKED_TIMEOUT_MS as 60000ms', () => {
    expect(UPLOAD_AWAIT_CHUNKED_TIMEOUT_MS).toBe(60_000);
  });

  it('resolves with CHUNKED job immediately when first poll returns CHUNKED', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        data: {
          uploadUrl: 'https://s3.example.com/presigned',
          fileId: 'f1',
          jobId: 'await-job',
          requiredHeaders: { 'Content-Type': 'text/plain' },
        },
      },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: null });

    mockedApiClient.get.mockResolvedValueOnce({
      data: { data: { ...baseJob, status: 'CHUNKED' } },
    });

    const result = await uploadAndAwaitChunked(
      { file: mockFile, legalAttestation: mockLegalAttestation },
      { pollIntervalMs: 100, timeoutMs: 5_000 }
    );

    expect(result.status).toBe('CHUNKED');
    expect(result.jobId).toBe('await-job');
  });

  it('polls PENDING → CHUNKING → CHUNKED then resolves', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        data: {
          uploadUrl: 'https://s3.example.com/presigned',
          fileId: 'f1',
          jobId: 'await-job',
          requiredHeaders: { 'Content-Type': 'text/plain' },
        },
      },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: null });

    // Three polls: PENDING, CHUNKING, CHUNKED
    mockedApiClient.get
      .mockResolvedValueOnce({ data: { data: { ...baseJob, status: 'PENDING' } } })
      .mockResolvedValueOnce({ data: { data: { ...baseJob, status: 'CHUNKING' } } })
      .mockResolvedValueOnce({ data: { data: { ...baseJob, status: 'CHUNKED' } } });

    const resultPromise = uploadAndAwaitChunked(
      { file: mockFile, legalAttestation: mockLegalAttestation },
      { pollIntervalMs: 100, timeoutMs: 5_000 }
    );

    // Advance timers to cover the two 100ms poll intervals.
    await vi.advanceTimersByTimeAsync(400);

    const result = await resultPromise;
    expect(result.status).toBe('CHUNKED');
    expect(mockedApiClient.get).toHaveBeenCalledTimes(3);
  });

  it('rejects immediately on CHUNKING_FAILED with descriptive message', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        data: {
          uploadUrl: 'https://s3.example.com/presigned',
          fileId: 'f1',
          jobId: 'await-job',
          requiredHeaders: { 'Content-Type': 'text/plain' },
        },
      },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: null });

    mockedApiClient.get.mockResolvedValueOnce({
      data: { data: { ...baseJob, status: 'CHUNKING_FAILED' } },
    });

    await expect(
      uploadAndAwaitChunked(
        { file: mockFile, legalAttestation: mockLegalAttestation },
        { pollIntervalMs: 100, timeoutMs: 5_000 }
      )
    ).rejects.toThrow(/Document processing failed with status: CHUNKING_FAILED/);

    // Only one poll call — terminal error exits immediately.
    expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately on FAILED status', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        data: {
          uploadUrl: 'https://s3.example.com/presigned',
          fileId: 'f1',
          jobId: 'await-job',
          requiredHeaders: { 'Content-Type': 'text/plain' },
        },
      },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: null });

    mockedApiClient.get.mockResolvedValueOnce({
      data: { data: { ...baseJob, status: 'FAILED' } },
    });

    await expect(
      uploadAndAwaitChunked(
        { file: mockFile, legalAttestation: mockLegalAttestation },
        { pollIntervalMs: 100, timeoutMs: 5_000 }
      )
    ).rejects.toThrow(/Document processing failed with status: FAILED/);
  });

  it('rejects with timeout message after timeoutMs elapses', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        data: {
          uploadUrl: 'https://s3.example.com/presigned',
          fileId: 'f1',
          jobId: 'await-job',
          requiredHeaders: { 'Content-Type': 'text/plain' },
        },
      },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: null });

    // Always return PENDING so the loop never exits via success.
    mockedApiClient.get.mockResolvedValue({
      data: { data: { ...baseJob, status: 'PENDING' } },
    });

    const resultPromise = uploadAndAwaitChunked(
      { file: mockFile, legalAttestation: mockLegalAttestation },
      { pollIntervalMs: 100, timeoutMs: 500 }
    );

    // Attach the rejection handler BEFORE advancing timers so the promise is
    // never considered "unhandled" — an unhandled rejection emitted between
    // the reject() call and the await below causes a spurious Vitest error.
    const expectation = expect(resultPromise).rejects.toThrow(/Document processing timed out/);

    // Advance past the 500ms timeout.
    await vi.advanceTimersByTimeAsync(700);

    await expectation;
  });

  it('calls onPollTick callback with each status', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        data: {
          uploadUrl: 'https://s3.example.com/presigned',
          fileId: 'f1',
          jobId: 'await-job',
          requiredHeaders: { 'Content-Type': 'text/plain' },
        },
      },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: null });

    mockedApiClient.get
      .mockResolvedValueOnce({ data: { data: { ...baseJob, status: 'CHUNKING' } } })
      .mockResolvedValueOnce({ data: { data: { ...baseJob, status: 'CHUNKED' } } });

    const onPollTick = vi.fn();

    const resultPromise = uploadAndAwaitChunked(
      { file: mockFile, legalAttestation: mockLegalAttestation },
      { pollIntervalMs: 100, timeoutMs: 5_000, onPollTick }
    );

    await vi.advanceTimersByTimeAsync(300);
    await resultPromise;

    // onPollTick called for CHUNKING tick (CHUNKED tick also fires before resolve).
    expect(onPollTick).toHaveBeenCalledWith('CHUNKING');
    expect(onPollTick).toHaveBeenCalledWith('CHUNKED');
  });

  it('propagates getJobStatus network errors', async () => {
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        data: {
          uploadUrl: 'https://s3.example.com/presigned',
          fileId: 'f1',
          jobId: 'await-job',
          requiredHeaders: { 'Content-Type': 'text/plain' },
        },
      },
    });
    mockedAxios.put.mockResolvedValueOnce({ data: null });

    const networkError = {
      isAxiosError: true,
      message: 'Network Error',
    } as AxiosError;
    mockedApiClient.get.mockRejectedValueOnce(networkError);

    await expect(
      uploadAndAwaitChunked(
        { file: mockFile, legalAttestation: mockLegalAttestation },
        { pollIntervalMs: 100, timeoutMs: 5_000 }
      )
    ).rejects.toThrow('Network Error');
  });
});
