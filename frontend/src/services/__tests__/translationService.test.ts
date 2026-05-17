/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Translation Service Unit Tests
 *
 * Tests cover all API integration points, error handling,
 * and authentication flows for the translation service.
 *
 * Testing Strategy:
 * - Mock apiClient for backend API calls
 * - Mock uploadService.uploadToS3 for the S3 PUT step (#230 SRP refactor)
 * - Test success paths AND error paths
 * - Verify error messages and status codes
 *
 * Coverage Target: 90%+ for P0 (Critical) code
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AxiosError } from 'axios';
import {
  uploadDocument,
  uploadAndAwaitChunked,
  startTranslation,
  getJobStatus,
  getTranslationJobs,
  downloadTranslation,
  getDownloadUrl,
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

// Mock uploadService so translationService.uploadDocument delegates to a
// controlled stub rather than an XHR-based S3 PUT (#230 SRP refactor).
// Browser-safe-header filtering and XHR lifecycle are uploadService's
// responsibility and are covered by uploadService.test.ts.
vi.mock('../uploadService', () => ({
  uploadToS3: vi.fn(),
}));

import { uploadToS3 } from '../uploadService';

// Keep axios mock for wrapS3UploadError's axios.isAxiosError() path and for
// tests that verify AxiosError-shaped S3 errors are handled correctly.
vi.mock('axios', () => {
  return {
    default: {
      isAxiosError: vi.fn((error: any) => error && error.isAxiosError === true),
    },
    AxiosError: class AxiosError extends Error {},
  };
});

const mockedApiClient = apiClient as unknown as {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
};

const mockedUploadToS3 = uploadToS3 as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Shared helpers for uploadDocument tests
// ---------------------------------------------------------------------------

function buildAttestation(): LegalAttestation {
  return {
    acceptCopyrightOwnership: true,
    acceptTranslationRights: true,
    acceptLiabilityTerms: true,
    userIPAddress: 'captured-by-backend',
    userAgent: 'Mozilla/5.0',
    timestamp: '2024-10-31T12:00:00Z',
  };
}

function mockPresignedUrl(overrides?: {
  jobId?: string;
  requiredHeaders?: Record<string, string>;
}) {
  mockedApiClient.post.mockResolvedValueOnce({
    data: {
      data: {
        uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
        fileId: 'file-1',
        jobId: overrides?.jobId ?? 'job-1',
        requiredHeaders: overrides?.requiredHeaders ?? { 'Content-Type': 'text/plain' },
      },
    },
  });
}

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
      const mockLegalAttestation = buildAttestation();

      // Mock presigned URL response from backend (#230: legalAttestation bundled here).
      mockedApiClient.post.mockResolvedValueOnce({
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
      });

      // uploadToS3 is the shared XHR helper (#230 SRP refactor).
      mockedUploadToS3.mockResolvedValueOnce(undefined);

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      // Act
      const result = await uploadDocument(request);

      // Assert - Step 1: Request presigned URL (includes legal attestation).
      expect(mockedApiClient.post).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.post).toHaveBeenCalledWith('/jobs/upload', {
        fileName: 'test.txt',
        fileSize: mockFile.size,
        contentType: 'text/plain',
        legalAttestation: mockLegalAttestation,
      });

      // Assert - Step 2: Delegated to uploadToS3 with the correct
      // file + URL + requiredHeaders. Browser-safe-header filtering is
      // uploadToS3's responsibility and is covered in uploadService.test.ts.
      expect(mockedUploadToS3).toHaveBeenCalledTimes(1);
      expect(mockedUploadToS3).toHaveBeenCalledWith(
        mockFile,
        'https://s3.amazonaws.com/bucket/presigned-url',
        {
          'Content-Type': 'text/plain',
          'x-amz-server-side-encryption': 'AES256',
        }
      );

      // Assert - Result shape
      expect(result.jobId).toBe('job-123');
      expect(result.fileName).toBe('test.txt');
      expect(result.status).toBe('PENDING');
    });

    // ---------------------------------------------------------------------------
    // Regression guard — requiredHeaders are passed verbatim to uploadToS3.
    //
    // translationService.uploadDocument must forward the requiredHeaders from
    // the presigned-URL response unchanged to uploadToS3 — no extra keys,
    // no Content-Type override. Header filtering (Content-Length, etc.) is
    // uploadToS3's responsibility and is covered in uploadService.test.ts.
    // ---------------------------------------------------------------------------
    it('forwards requiredHeaders verbatim to uploadToS3 — no extra Content-Type', async () => {
      // Backend signed for 'text/x-rst'; the browser File type is 'text/plain'.
      // translationService must NOT override the signed Content-Type.
      const mockFile = new File(['content'], 'document.rst', { type: 'text/plain' });

      mockedApiClient.post.mockResolvedValueOnce({
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
      });
      mockedUploadToS3.mockResolvedValueOnce(undefined);

      await uploadDocument({ file: mockFile, legalAttestation: buildAttestation() });

      // uploadToS3 must receive the exact requiredHeaders — no additional keys,
      // no Content-Type override from File.type ('text/plain').
      // Content-Length filtering is handled inside uploadToS3, not here.
      const [, , sentHeaders] = mockedUploadToS3.mock.calls[0] as [
        File,
        string,
        Record<string, string>,
      ];
      expect(sentHeaders['Content-Type']).toBe('text/x-rst');
      expect(sentHeaders['Content-Type']).not.toBe('text/plain');
      expect(sentHeaders['Content-Length']).toBe('7'); // forwarded; uploadToS3 filters it
    });

    // -------------------------------------------------------------------------
    // Issue #98 regression guard — accurate UI error when S3 PUT is blocked.
    //
    // uploadToS3 (XHR path) throws "Network error during file upload" when the
    // XHR `error` event fires. wrapS3UploadError maps this sentinel message to
    // S3_UPLOAD_BLOCKED_MESSAGE so the page mapper surfaces a targeted phrase.
    // See translationErrorMessages — statusCode undefined → message surfaced
    // verbatim (PR #202 Round 2 Code-3).
    // -------------------------------------------------------------------------
    it('throws TranslationServiceError(S3_UPLOAD_BLOCKED_MESSAGE) on XHR network failure', async () => {
      const { S3_UPLOAD_BLOCKED_MESSAGE } = await import('../translationService');
      mockPresignedUrl();
      mockedUploadToS3.mockRejectedValueOnce(new Error('Network error during file upload'));

      try {
        await uploadDocument({
          file: new File(['content'], 'doc.txt', { type: 'text/plain' }),
          legalAttestation: buildAttestation(),
        });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (err) {
        expect(err).toBeInstanceOf(TranslationServiceError);
        // Issue #215: assert on the stable errorCode discriminator, not
        // on the user-visible copy that can be reworded independently.
        expect((err as TranslationServiceError).errorCode).toBe('S3_UPLOAD_BLOCKED');
        expect((err as TranslationServiceError).message).toBe(S3_UPLOAD_BLOCKED_MESSAGE);
        expect((err as TranslationServiceError).statusCode).toBeUndefined();
      }
    });

    it('throws S3_UPLOAD_BLOCKED_MESSAGE on XHR abort', async () => {
      const { S3_UPLOAD_BLOCKED_MESSAGE } = await import('../translationService');
      mockPresignedUrl();
      mockedUploadToS3.mockRejectedValueOnce(new Error('Upload was cancelled'));

      try {
        await uploadDocument({
          file: new File(['content'], 'doc.txt', { type: 'text/plain' }),
          legalAttestation: buildAttestation(),
        });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (err) {
        expect(err).toBeInstanceOf(TranslationServiceError);
        expect((err as TranslationServiceError).errorCode).toBe('S3_UPLOAD_BLOCKED');
        expect((err as TranslationServiceError).message).toBe(S3_UPLOAD_BLOCKED_MESSAGE);
        expect((err as TranslationServiceError).statusCode).toBeUndefined();
      }
    });

    it('preserves S3 HTTP status when XHR reports an HTTP error (e.g. 403)', async () => {
      mockPresignedUrl();
      const xhrError = new Error('Upload failed with status 403: Forbidden');
      mockedUploadToS3.mockRejectedValueOnce(xhrError);

      try {
        await uploadDocument({
          file: new File(['content'], 'doc.txt', { type: 'text/plain' }),
          legalAttestation: buildAttestation(),
        });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (err) {
        expect(err).toBeInstanceOf(TranslationServiceError);
        expect((err as TranslationServiceError).errorCode).toBe('S3_HTTP_ERROR');
        expect((err as TranslationServiceError).statusCode).toBe(403);
        expect((err as TranslationServiceError).originalError).toBe(xhrError);
      }
    });

    // wrapS3UploadError axios-error path: still reachable if an AxiosError
    // escapes from a future fetch-based S3 implementation.
    it('wrapS3UploadError: AxiosError without response → S3_UPLOAD_BLOCKED_MESSAGE', async () => {
      const { S3_UPLOAD_BLOCKED_MESSAGE } = await import('../translationService');
      mockPresignedUrl();

      mockedUploadToS3.mockRejectedValueOnce({
        isAxiosError: true,
        message: 'Network Error',
        request: {},
      } as unknown as AxiosError);

      try {
        await uploadDocument({
          file: new File(['content'], 'doc.txt', { type: 'text/plain' }),
          legalAttestation: buildAttestation(),
        });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (err) {
        expect(err).toBeInstanceOf(TranslationServiceError);
        // Issue #215: stable errorCode discriminator asserted alongside message.
        expect((err as TranslationServiceError).errorCode).toBe('S3_UPLOAD_BLOCKED');
        expect((err as TranslationServiceError).message).toBe(S3_UPLOAD_BLOCKED_MESSAGE);
        expect((err as TranslationServiceError).statusCode).toBeUndefined();
      }
    });

    it('wrapS3UploadError: AxiosError with response preserves statusCode + originalError', async () => {
      mockPresignedUrl();
      const rejectedAxiosError = {
        isAxiosError: true,
        message: 'Request failed with status code 403',
        response: {
          status: 403,
          statusText: 'Forbidden',
          data: '<Error>SignatureDoesNotMatch</Error>',
        },
      } as unknown as AxiosError;

      mockedUploadToS3.mockRejectedValueOnce(rejectedAxiosError);

      try {
        await uploadDocument({
          file: new File(['content'], 'doc.txt', { type: 'text/plain' }),
          legalAttestation: buildAttestation(),
        });
        expect.fail('Should have thrown TranslationServiceError');
      } catch (err) {
        expect(err).toBeInstanceOf(TranslationServiceError);
        expect((err as TranslationServiceError).errorCode).toBe('S3_HTTP_ERROR');
        expect((err as TranslationServiceError).statusCode).toBe(403);
        expect((err as TranslationServiceError).originalError).toBe(rejectedAxiosError);
      }
    });

    // -------------------------------------------------------------------------
    // wrapS3UploadError — non-Error / non-Axios rejected values.
    //
    // These test the last branch in wrapS3UploadError: when uploadToS3
    // rejects with something that's neither an Error nor an AxiosError.
    // -------------------------------------------------------------------------
    describe('wrapS3UploadError — non-Error rejected values', () => {
      it('handles a thrown string gracefully — errorCode S3_HTTP_ERROR (does not crash)', async () => {
        mockPresignedUrl();
        mockedUploadToS3.mockRejectedValueOnce('boom');

        try {
          await uploadDocument({
            file: new File(['content'], 'doc.txt', { type: 'text/plain' }),
            legalAttestation: buildAttestation(),
          });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (err) {
          expect(err).toBeInstanceOf(TranslationServiceError);
          expect((err as TranslationServiceError).errorCode).toBe('S3_HTTP_ERROR');
          expect((err as TranslationServiceError).message).toBe('S3 upload failed');
          const original = (err as TranslationServiceError).originalError as Error | undefined;
          expect(original).toBeInstanceOf(Error);
          expect(original?.message).toBe('boom');
        }
      });

      it('handles a thrown undefined gracefully — errorCode S3_HTTP_ERROR (does not crash)', async () => {
        mockPresignedUrl();
        mockedUploadToS3.mockRejectedValueOnce(undefined);

        try {
          await uploadDocument({
            file: new File(['content'], 'doc.txt', { type: 'text/plain' }),
            legalAttestation: buildAttestation(),
          });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (err) {
          expect(err).toBeInstanceOf(TranslationServiceError);
          expect((err as TranslationServiceError).errorCode).toBe('S3_HTTP_ERROR');
          expect((err as TranslationServiceError).message).toBe('S3 upload failed');
          const original = (err as TranslationServiceError).originalError as Error | undefined;
          expect(original).toBeInstanceOf(Error);
          expect(original?.message).toBe('undefined');
        }
      });
    });

    it('should include legal attestation in JSON payload to backend', async () => {
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation = buildAttestation();

      mockedApiClient.post.mockResolvedValueOnce({
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/presigned-url',
            fileId: 'job-123',
            jobId: 'job-123',
            requiredHeaders: {},
          },
        },
      });

      mockedUploadToS3.mockResolvedValueOnce(undefined);

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

      // Wire shape mirrors the real `startTranslation` Lambda
      // (StartTranslationApiResponse): FLAT body, no `data` wrapper.
      // #229: field renamed from `chunksTranslated` → `translatedChunks`
      // to match DDB column. Frontend model uses `completedChunks` — the
      // mapper translates at the ACL seam.
      const mockResponse = {
        data: {
          message: 'Translation started successfully',
          jobId: 'job-123',
          translationStatus: 'IN_PROGRESS',
          targetLanguage: 'es',
          totalChunks: 4,
          translatedChunks: 0,
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
      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.targetLanguage).toBe('es');
      expect(result.totalChunks).toBe(4);
      expect(result.completedChunks).toBe(0);
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

    // #266: handleError now extracts a typed errorCode from the API envelope.
    // These tests pin both extraction branches (errorCode vs requestId
    // fallback) and the known-vs-unknown narrowing logic so refactors to the
    // envelope shape contract can't silently regress.
    describe('Issue #266 — typed errorCode extraction in handleError', () => {
      it('extracts errorCode from response.data.errorCode (forward-compat with #267)', async () => {
        // Arrange: envelope carries the forward-looking `errorCode` field.
        const mockError = {
          isAxiosError: true,
          response: {
            status: 409,
            data: {
              message: 'Translation already in_progress for this job',
              errorCode: 'TRANSLATION_ALREADY_STARTED',
            },
          },
          message: 'Conflict',
        } as AxiosError;

        mockedApiClient.post.mockRejectedValueOnce(mockError);

        // Act & Assert
        try {
          await startTranslation('job-123', { targetLanguage: 'es', tone: 'neutral' });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (error) {
          expect(error).toBeInstanceOf(TranslationServiceError);
          expect((error as TranslationServiceError).errorCode).toBe('TRANSLATION_ALREADY_STARTED');
          expect((error as TranslationServiceError).statusCode).toBe(409);
          expect((error as TranslationServiceError).message).toBe(
            'Translation already in_progress for this job'
          );
        }
      });

      it('falls back to response.data.requestId when errorCode is absent (current buggy backend shape)', async () => {
        // Arrange: today's backend reuses the requestId slot to carry the
        // error-category string. The frontend must accept that shape until
        // backend issue #267 ships the rename.
        const mockError = {
          isAxiosError: true,
          response: {
            status: 409,
            data: {
              message: 'Translation already in_progress for this job',
              requestId: 'TRANSLATION_ALREADY_STARTED',
            },
          },
          message: 'Conflict',
        } as AxiosError;

        mockedApiClient.post.mockRejectedValueOnce(mockError);

        // Act & Assert
        try {
          await startTranslation('job-123', { targetLanguage: 'es', tone: 'neutral' });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (error) {
          expect(error).toBeInstanceOf(TranslationServiceError);
          expect((error as TranslationServiceError).errorCode).toBe('TRANSLATION_ALREADY_STARTED');
          expect((error as TranslationServiceError).statusCode).toBe(409);
        }
      });

      it('prefers errorCode over requestId when both are present', async () => {
        // Arrange: belt-and-suspenders precedence — once #267 lands, the
        // forward-looking field wins even if the legacy slot is still set.
        const mockError = {
          isAxiosError: true,
          response: {
            status: 409,
            data: {
              message: 'Translation already in_progress for this job',
              errorCode: 'TRANSLATION_ALREADY_STARTED',
              requestId: '550e8400-e29b-41d4-a716-446655440000', // proper UUID
            },
          },
          message: 'Conflict',
        } as AxiosError;

        mockedApiClient.post.mockRejectedValueOnce(mockError);

        try {
          await startTranslation('job-123', { targetLanguage: 'es', tone: 'neutral' });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (error) {
          expect(error).toBeInstanceOf(TranslationServiceError);
          // Comes from errorCode, NOT the UUID-shaped requestId.
          expect((error as TranslationServiceError).errorCode).toBe('TRANSLATION_ALREADY_STARTED');
        }
      });

      it('falls back to API_GENERIC for unknown errorCode strings', async () => {
        // Arrange: an arbitrary string in errorCode must not poison the
        // discriminator union — type-guard narrows to API_GENERIC.
        const mockError = {
          isAxiosError: true,
          response: {
            status: 500,
            data: {
              message: 'Something blew up',
              errorCode: 'SOMETHING_NEW_WE_HAVENT_ENUMERATED',
            },
          },
          message: 'Server error',
        } as AxiosError;

        mockedApiClient.post.mockRejectedValueOnce(mockError);

        try {
          await startTranslation('job-123', { targetLanguage: 'es', tone: 'neutral' });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (error) {
          expect(error).toBeInstanceOf(TranslationServiceError);
          expect((error as TranslationServiceError).errorCode).toBe('API_GENERIC');
        }
      });

      it('falls back to API_GENERIC when neither errorCode nor requestId is a string', async () => {
        // Arrange: a UUID-shaped requestId (the eventual correct shape) is
        // still a string — but here we feed non-string types to exercise the
        // type-guard's `typeof === 'string'` negative branch.
        const mockError = {
          isAxiosError: true,
          response: {
            status: 500,
            data: {
              message: 'Server error',
              errorCode: 42, // number, not string
              requestId: { nested: 'object' }, // not string
            },
          },
          message: 'Server error',
        } as AxiosError;

        mockedApiClient.post.mockRejectedValueOnce(mockError);

        try {
          await startTranslation('job-123', { targetLanguage: 'es', tone: 'neutral' });
          expect.fail('Should have thrown TranslationServiceError');
        } catch (error) {
          expect(error).toBeInstanceOf(TranslationServiceError);
          expect((error as TranslationServiceError).errorCode).toBe('API_GENERIC');
        }
      });
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
      // Arrange — wire shape mirrors the real getTranslationStatus Lambda
      // (TranslationStatusApiResponse from @lfmt/shared-types): FLAT body
      // (no `data` wrapper). #229: field renamed from `chunksTranslated` →
      // `translatedChunks` to match DDB column. Frontend service projects to
      // `completedChunks` at the ACL seam (toTranslationJob).
      const jobId = 'job-123';
      const mockWire = {
        jobId: 'job-123',
        userId: 'user-456',
        status: 'IN_PROGRESS',
        translationStatus: 'IN_PROGRESS',
        fileName: 'test.txt',
        fileSize: 1024,
        contentType: 'text/plain',
        targetLanguage: 'es',
        tone: 'neutral' as const,
        totalChunks: 10,
        translatedChunks: 5,
        progressPercentage: 50,
        createdAt: '2024-10-31T12:00:00Z',
      };

      mockedApiClient.get.mockResolvedValueOnce({ data: mockWire });

      // Act
      const result = await getJobStatus(jobId);

      // Assert
      expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.get).toHaveBeenCalledWith(
        expect.stringContaining(`/jobs/${jobId}/translation-status`)
      );
      expect(result.jobId).toBe('job-123');
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.completedChunks).toBe(5);
      expect(result.totalChunks).toBe(10);
      expect(result.fileSize).toBe(1024);
      expect(result.tone).toBe('neutral');
    });

    it('should handle COMPLETED status', async () => {
      // Arrange
      const jobId = 'job-123';
      const mockWire = {
        jobId: 'job-123',
        userId: 'user-456',
        status: 'COMPLETED',
        translationStatus: 'COMPLETED',
        fileName: 'test.txt',
        fileSize: 1024,
        contentType: 'text/plain',
        targetLanguage: 'es',
        tone: 'neutral' as const,
        totalChunks: 10,
        translatedChunks: 10,
        progressPercentage: 100,
        createdAt: '2024-10-31T12:00:00Z',
        translationCompletedAt: '2024-10-31T12:30:00Z',
      };

      mockedApiClient.get.mockResolvedValueOnce({ data: mockWire });

      // Act
      const result = await getJobStatus(jobId);

      // Assert
      expect(result.status).toBe('COMPLETED');
      expect(result.completedAt).toBe('2024-10-31T12:30:00Z');
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

  // Wire shape produced by GET /jobs (PR #226+#229): { jobs: [...], count: N }
  // Each item in `jobs` uses the backend field names (`translatedChunks` — DDB
  // column name, renamed from `chunksTranslated` in issue #229) and gets
  // mapped through toTranslationJob before returning.
  const makeWireItem = (jobId: string, overrides: Record<string, unknown> = {}) => ({
    jobId,
    userId: 'user-456',
    status: 'COMPLETED',
    fileName: 'test.txt',
    fileSize: 1024,
    contentType: 'text/plain',
    targetLanguage: 'es',
    translatedChunks: 2,
    totalChunks: 4,
    createdAt: '2024-10-31T12:00:00Z',
    ...overrides,
  });

  describe('Success Scenarios', () => {
    it('projects flat { jobs, count } response into TranslationJob array', async () => {
      // Arrange — new wire shape: { jobs: [...], count: N }
      const wireItems = [makeWireItem('job-1'), makeWireItem('job-2', { status: 'IN_PROGRESS' })];
      mockedApiClient.get.mockResolvedValueOnce({ data: { jobs: wireItems, count: 2 } });

      // Act
      const result = await getTranslationJobs();

      // Assert
      expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
      expect(mockedApiClient.get).toHaveBeenCalledWith(expect.stringContaining('/jobs'));
      expect(result).toHaveLength(2);
      expect(result[0].jobId).toBe('job-1');
      expect(result[1].jobId).toBe('job-2');
    });

    it('maps translatedChunks (wire, DDB column) to completedChunks (frontend)', async () => {
      // Contract test (#229): the wire field `translatedChunks` must be projected
      // to `completedChunks` by the mapper, matching getJobStatus behaviour.
      const wireItem = makeWireItem('job-x', { translatedChunks: 3, totalChunks: 10 });
      mockedApiClient.get.mockResolvedValueOnce({ data: { jobs: [wireItem], count: 1 } });

      const result = await getTranslationJobs();

      expect(result[0].completedChunks).toBe(3);
      expect(result[0].totalChunks).toBe(10);
    });

    it('translatedChunks: number is preserved as number through the mapper', async () => {
      // Regression guard for #227/#229: if the API returns translatedChunks as a number,
      // the mapper must not coerce it to a string.
      const wireItem = makeWireItem('job-num', { translatedChunks: 5 });
      mockedApiClient.get.mockResolvedValueOnce({ data: { jobs: [wireItem], count: 1 } });

      const result = await getTranslationJobs();

      expect(typeof result[0].completedChunks).toBe('number');
      expect(result[0].completedChunks).toBe(5);
    });

    it('returns empty array when jobs array is empty', async () => {
      // Arrange
      mockedApiClient.get.mockResolvedValueOnce({ data: { jobs: [], count: 0 } });

      // Act
      const result = await getTranslationJobs();

      // Assert
      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('handles missing jobs key gracefully (defensive fallback)', async () => {
      // If the backend omits the `jobs` key, the service should return []
      // rather than crashing.
      mockedApiClient.get.mockResolvedValueOnce({ data: { count: 0 } });

      const result = await getTranslationJobs();

      expect(result).toEqual([]);
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

  // Build the flat TranslationStatusApiResponse wire shape that the real
  // `getTranslationStatus` Lambda emits. The 2026-05-09 hotfix collapsed
  // the previous `{data: { data: TranslationJob }}` envelope to a flat
  // body. #229: field renamed from `chunksTranslated` → `translatedChunks`
  // to match the DDB column; mapped to `completedChunks` at the ACL seam.
  const buildWireStatus = (status: string) => ({
    jobId: baseJob.jobId,
    userId: baseJob.userId,
    fileName: baseJob.fileName,
    fileSize: baseJob.fileSize,
    contentType: baseJob.contentType,
    status,
    translationStatus: status,
    targetLanguage: baseJob.targetLanguage,
    tone: baseJob.tone,
    totalChunks: 0,
    translatedChunks: 0,
    progressPercentage: 0,
    createdAt: baseJob.createdAt,
  });

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
    mockedUploadToS3.mockResolvedValueOnce(undefined);

    mockedApiClient.get.mockResolvedValueOnce({ data: buildWireStatus('CHUNKED') });

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
    mockedUploadToS3.mockResolvedValueOnce(undefined);

    // Three polls: PENDING, CHUNKING, CHUNKED — flat wire shape per
    // TranslationStatusApiResponse (the 2026-05-09 hotfix contract).
    mockedApiClient.get
      .mockResolvedValueOnce({ data: buildWireStatus('PENDING') })
      .mockResolvedValueOnce({ data: buildWireStatus('CHUNKING') })
      .mockResolvedValueOnce({ data: buildWireStatus('CHUNKED') });

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
    mockedUploadToS3.mockResolvedValueOnce(undefined);

    mockedApiClient.get.mockResolvedValueOnce({
      data: buildWireStatus('CHUNKING_FAILED'),
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
    mockedUploadToS3.mockResolvedValueOnce(undefined);

    mockedApiClient.get.mockResolvedValueOnce({
      data: buildWireStatus('FAILED'),
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
    mockedUploadToS3.mockResolvedValueOnce(undefined);

    // Always return PENDING so the loop never exits via success.
    mockedApiClient.get.mockResolvedValue({
      data: buildWireStatus('PENDING'),
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
    mockedUploadToS3.mockResolvedValueOnce(undefined);

    mockedApiClient.get
      .mockResolvedValueOnce({ data: buildWireStatus('CHUNKING') })
      .mockResolvedValueOnce({ data: buildWireStatus('CHUNKED') });

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
    mockedUploadToS3.mockResolvedValueOnce(undefined);

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

// ---------------------------------------------------------------------------
// PR #218 OMC R1 follow-ups
//
// C1 (merge blocker): exhaustive coverage of the nullish-coalescing
//   fallback paths inside `getJobStatus` (and the equivalent shape
//   handling in `startTranslation`). The hotfix introduced these
//   fallbacks and they were not branch-covered, dropping the per-file
//   threshold below the project minimum.
//
// H1-cq: pin the narrow `StartTranslationResult` return shape to lock
//   out a future regression that re-introduces hollow sentinel fields.
//
// C4-test: assert mid-translation (non-zero, non-terminal)
//   `translatedChunks → completedChunks` translation works correctly
//   (field renamed from `chunksTranslated` in issue #229),
//   so the seam doesn't drop intermediate progress.
// ---------------------------------------------------------------------------

describe('TranslationService - getJobStatus — wire fallback coverage (C1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  // The wire shape the real Lambda emits is intentionally permissive:
  // `userId`, `fileName`, `fileSize`, `contentType`, `tone`,
  // `translatedChunks` (renamed from `chunksTranslated` in #229), `totalChunks`, `targetLanguage`, `createdAt`,
  // `translationCompletedAt`, and `error` are all optional. The mapper
  // (`toTranslationJob`) defends against each omission individually —
  // each branch is covered below.

  it('falls back to "" when wire omits userId / fileName / contentType', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-1',
        status: 'PENDING',
        // userId, fileName, contentType all absent.
      },
    });
    const job = await getJobStatus('job-1');
    expect(job.userId).toBe('');
    expect(job.fileName).toBe('');
    expect(job.contentType).toBe('');
  });

  it('falls back to 0 when wire omits fileSize', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      data: { jobId: 'job-1', status: 'PENDING' },
    });
    const job = await getJobStatus('job-1');
    expect(job.fileSize).toBe(0);
  });

  it('falls back to a synthesized ISO timestamp when wire omits createdAt', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      data: { jobId: 'job-1', status: 'PENDING' },
    });
    const job = await getJobStatus('job-1');
    // The exact value depends on wall-clock; assert shape only.
    expect(job.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(job.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('uses createdAt as updatedAt when wire omits translationCompletedAt', async () => {
    const created = '2026-05-08T20:00:00.000Z';
    mockedApiClient.get.mockResolvedValueOnce({
      data: { jobId: 'job-1', status: 'PENDING', createdAt: created },
    });
    const job = await getJobStatus('job-1');
    expect(job.updatedAt).toBe(created);
    expect(job.completedAt).toBeUndefined();
  });

  it('reads errorMessage from the wire `error` field when present', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-1',
        status: 'TRANSLATION_FAILED',
        error: 'Gemini API rate limit exceeded',
      },
    });
    const job = await getJobStatus('job-1');
    expect(job.errorMessage).toBe('Gemini API rate limit exceeded');
  });

  it('leaves errorMessage undefined when wire omits the error field', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      data: { jobId: 'job-1', status: 'COMPLETED' },
    });
    const job = await getJobStatus('job-1');
    expect(job.errorMessage).toBeUndefined();
  });

  it('translates translatedChunks (wire, DDB) → completedChunks (frontend) for mid-translation values (C4)', async () => {
    // Pre-fix C4: the seam was previously only exercised at the
    // boundary values (0 and totalChunks). A regression that swapped
    // the field names mid-translation would silently render
    // "Translating: 0 / 7" until the job hit 100%. Lock the
    // intermediate-progress contract. #229: renamed from `chunksTranslated`.
    mockedApiClient.get.mockResolvedValueOnce({
      data: {
        jobId: 'job-1',
        status: 'IN_PROGRESS',
        translationStatus: 'IN_PROGRESS',
        totalChunks: 7,
        translatedChunks: 3,
      },
    });
    const job = await getJobStatus('job-1');
    expect(job.completedChunks).toBe(3);
    expect(job.totalChunks).toBe(7);
    // Anti-assertions: neither backend field name must leak through to the
    // frontend type — that would be the regression we are guarding.
    expect(job).not.toHaveProperty('translatedChunks');
    expect(job).not.toHaveProperty('chunksTranslated');
  });
});

describe('TranslationService - startTranslation — narrow return shape (H1-cq)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  it('returns ONLY the narrow StartTranslationResult fields (no hollow sentinels)', async () => {
    // Pre-fix H1-cq: the result was a fabricated TranslationJob with
    // five hollow sentinel fields (`userId: ''`, `fileName: ''`,
    // `fileSize: 0`, `contentType: ''`, ...). Narrowing the return type
    // removes the lie at the type level — assert at runtime that the
    // sentinels are gone so a future maintainer cannot bring them back
    // without breaking this test.
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        message: 'Translation started successfully',
        jobId: 'job-abc',
        translationStatus: 'IN_PROGRESS',
        targetLanguage: 'es',
        totalChunks: 5,
        // #229: renamed from `chunksTranslated` → `translatedChunks`.
        translatedChunks: 0,
        executionArn: 'arn:aws:states:us-east-1:000:execution:lfmt:abc',
      },
    });

    const result = await startTranslation('job-abc', { targetLanguage: 'es', tone: 'neutral' });

    // Exact-match contract: no hollow sentinels permitted.
    expect(Object.keys(result).sort()).toEqual(
      [
        'jobId',
        'status',
        'targetLanguage',
        'totalChunks',
        'completedChunks',
        'message',
        'executionArn',
      ].sort()
    );
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('fileName');
    expect(result).not.toHaveProperty('fileSize');
    expect(result).not.toHaveProperty('contentType');
    expect(result).not.toHaveProperty('createdAt');

    // And the values themselves are the wire values, mapped by name.
    expect(result.jobId).toBe('job-abc');
    expect(result.status).toBe('IN_PROGRESS');
    expect(result.targetLanguage).toBe('es');
    expect(result.totalChunks).toBe(5);
    expect(result.completedChunks).toBe(0);
    expect(result.message).toBe('Translation started successfully');
    expect(result.executionArn).toBe('arn:aws:states:us-east-1:000:execution:lfmt:abc');
  });

  it('omits executionArn when the wire response does not include it', async () => {
    // The Lambda includes executionArn in dev for tracing but the field
    // is optional in the shared DTO (StartTranslationApiResponse). The
    // narrow result must not synthesize a placeholder value.
    mockedApiClient.post.mockResolvedValueOnce({
      data: {
        message: 'Translation started successfully',
        jobId: 'job-xyz',
        translationStatus: 'IN_PROGRESS',
        targetLanguage: 'fr',
        totalChunks: 2,
        // #229: renamed from `chunksTranslated` → `translatedChunks`.
        translatedChunks: 0,
        // executionArn intentionally absent
      },
    });

    const result = await startTranslation('job-xyz', {
      targetLanguage: 'fr',
      tone: 'neutral',
    });

    expect(result.executionArn).toBeUndefined();
  });
});

describe('TranslationService - getDownloadUrl (#28)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  it('forwards the format query parameter and returns the envelope', async () => {
    const jobId = 'job-123';
    const envelope = {
      format: 'epub' as const,
      downloadUrl: 'https://signed.example.com/path',
      expiresInSeconds: 900,
      objectKey: 'translated-output/job-123/translation.epub',
    };
    mockedApiClient.get.mockResolvedValueOnce({ data: envelope });

    const result = await getDownloadUrl(jobId, 'epub');

    expect(mockedApiClient.get).toHaveBeenCalledTimes(1);
    expect(mockedApiClient.get).toHaveBeenCalledWith(
      expect.stringContaining(`/jobs/${jobId}/download`),
      expect.objectContaining({ params: { format: 'epub' } })
    );
    expect(result).toEqual(envelope);
  });

  it('threads PDF format through to the backend', async () => {
    mockedApiClient.get.mockResolvedValueOnce({
      data: {
        format: 'pdf',
        downloadUrl: 'https://signed.example.com/path.pdf',
        expiresInSeconds: 900,
        objectKey: 'translated-output/job-pdf/translation.pdf',
      },
    });

    const result = await getDownloadUrl('job-pdf', 'pdf');

    expect(mockedApiClient.get).toHaveBeenCalledWith(
      expect.stringContaining('/jobs/job-pdf/download'),
      expect.objectContaining({ params: { format: 'pdf' } })
    );
    expect(result.format).toBe('pdf');
  });

  it('wraps backend errors as TranslationServiceError', async () => {
    const mockError = {
      isAxiosError: true,
      response: {
        status: 500,
        data: { message: 'Failed to generate EPUB output' },
      },
      message: 'Server error',
    } as AxiosError;

    mockedApiClient.get.mockRejectedValueOnce(mockError);

    await expect(getDownloadUrl('job-x', 'epub')).rejects.toThrow('Failed to generate EPUB output');
  });
});
