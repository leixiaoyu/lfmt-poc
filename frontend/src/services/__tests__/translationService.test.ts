/**
 * Translation Service Unit Tests
 *
 * Tests cover all API integration points, error handling,
 * and authentication flows for the translation service.
 *
 * Testing Strategy:
 * - Mock axios for controlled testing
 * - Test success paths AND error paths
 * - Verify error messages and status codes
 * - Test authentication header injection
 *
 * Coverage Target: 90%+ for P0 (Critical) code
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios, { AxiosError } from 'axios';
import {
  uploadDocument,
  startTranslation,
  getJobStatus,
  getTranslationJobs,
  downloadTranslation,
  createLegalAttestation,
  TranslationServiceError,
  type TranslationJob,
  type LegalAttestation,
  type UploadDocumentRequest,
  type TranslationConfig,
} from '../translationService';

// Mock auth token utility
vi.mock('../../utils/api', () => ({
  getAuthToken: vi.fn(),
}));

import { getAuthToken } from '../../utils/api';

// Mock axios module
vi.mock('axios', () => {
  return {
    default: {
      post: vi.fn(),
      get: vi.fn(),
      isAxiosError: vi.fn((error: any) => error && error.isAxiosError === true),
    },
  };
});

const mockedAxios = axios as unknown as { post: ReturnType<typeof vi.fn>, get: ReturnType<typeof vi.fn>, isAxiosError: (error: any) => boolean };

describe('TranslationService - uploadDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValue('mock-token-123');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Success Scenarios', () => {
    it('should upload document successfully with correct form data', async () => {
      // Arrange
      const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
      const mockLegalAttestation: LegalAttestation = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        timestamp: '2024-10-31T12:00:00Z',
      };

      const mockResponse = {
        data: {
          data: {
            jobId: 'job-123',
            userId: 'user-456',
            status: 'PENDING' as const,
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
            createdAt: '2024-10-31T12:00:00Z',
            updatedAt: '2024-10-31T12:00:00Z',
          },
        },
      };

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      // Act
      const result = await uploadDocument(request);

      // Assert
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/translation/upload'),
        expect.any(FormData),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-123',
            'Content-Type': 'multipart/form-data',
          }),
        })
      );
      expect(result).toEqual(mockResponse.data.data);
      expect(result.jobId).toBe('job-123');
      expect(result.fileName).toBe('test.txt');
    });

    it('should include legal attestation in form data', async () => {
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

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            jobId: 'job-123',
            userId: 'user-456',
            status: 'PENDING' as const,
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
            createdAt: '2024-10-31T12:00:00Z',
            updatedAt: '2024-10-31T12:00:00Z',
          },
        },
      });

      // Act
      await uploadDocument({
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      });

      // Assert
      const callArgs = mockedAxios.post.mock.calls[0];
      const formData = callArgs[1] as FormData;

      expect(formData.get('file')).toBe(mockFile);
      expect(formData.get('legalAttestation')).toBe(
        JSON.stringify(mockLegalAttestation)
      );
    });
  });

  describe('Error Scenarios', () => {
    it('should throw TranslationServiceError when not authenticated', async () => {
      // Arrange
      (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

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
        expect((error as TranslationServiceError).message).toBe('Not authenticated');
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

      mockedAxios.post.mockRejectedValueOnce(mockError);

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

      mockedAxios.post.mockRejectedValueOnce(mockError);

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

      mockedAxios.post.mockRejectedValueOnce(mockError);

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

      mockedAxios.post.mockRejectedValueOnce(new Error('Unexpected error'));

      // Act & Assert
      await expect(
        uploadDocument({
          file: mockFile,
          legalAttestation: mockLegalAttestation,
        })
      ).rejects.toThrow('An unexpected error occurred');
    });
  });

  describe('Authentication', () => {
    it('should include Bearer token in Authorization header', async () => {
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

      (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValueOnce('specific-token-456');

      mockedAxios.post.mockResolvedValueOnce({
        data: {
          data: {
            jobId: 'job-123',
            userId: 'user-456',
            status: 'PENDING' as const,
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
            createdAt: '2024-10-31T12:00:00Z',
            updatedAt: '2024-10-31T12:00:00Z',
          },
        },
      });

      // Act
      await uploadDocument({
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      });

      // Assert
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(FormData),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer specific-token-456',
          }),
        })
      );
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

      mockedAxios.post.mockResolvedValueOnce(mockResponse);

      // Act
      const result = await startTranslation(jobId, request);

      // Assert
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining(`/translation/${jobId}/start`),
        request,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-123',
          }),
        })
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

      mockedAxios.post.mockRejectedValueOnce(mockError);

      // Act & Assert
      await expect(startTranslation(jobId, request)).rejects.toThrow(
        'Translation job not found'
      );
    });

    it('should throw error when not authenticated', async () => {
      // Arrange
      (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      const jobId = 'job-123';
      const request: TranslationConfig = {
        targetLanguage: 'es',
        tone: 'neutral',
      };

      // Act & Assert
      await expect(startTranslation(jobId, request)).rejects.toThrow(
        'Not authenticated'
      );
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

      mockedAxios.get.mockResolvedValueOnce({
        data: { data: mockJob },
      });

      // Act
      const result = await getJobStatus(jobId);

      // Assert
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(`/translation/${jobId}`),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-123',
          }),
        })
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

      mockedAxios.get.mockResolvedValueOnce({
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

      mockedAxios.get.mockRejectedValueOnce(mockError);

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

      mockedAxios.get.mockResolvedValueOnce({
        data: { data: mockJobs },
      });

      // Act
      const result = await getTranslationJobs();

      // Assert
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/translation'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-123',
          }),
        })
      );
      expect(result).toEqual(mockJobs);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no jobs exist', async () => {
      // Arrange
      mockedAxios.get.mockResolvedValueOnce({
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
      (getAuthToken as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);

      // Act & Assert
      await expect(getTranslationJobs()).rejects.toThrow('Not authenticated');
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

      mockedAxios.get.mockResolvedValueOnce({
        data: mockBlob,
      });

      // Act
      const result = await downloadTranslation(jobId);

      // Assert
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining(`/translation/${jobId}/download`),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token-123',
          }),
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

      mockedAxios.get.mockRejectedValueOnce(mockError);

      // Act & Assert
      await expect(downloadTranslation(jobId)).rejects.toThrow(
        'Translation not available for download'
      );
    });
  });
});

describe('TranslationService - createLegalAttestation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock the IP address fetch
    mockedAxios.get.mockResolvedValue({
      data: { ip: '192.168.1.1' },
    });
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
    expect(result.userIPAddress).toBe('192.168.1.1'); // Mocked value
    expect(result.userAgent).toBe(navigator.userAgent);
    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp)).toBeInstanceOf(Date);
  });

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

  it('should fallback to "unknown" IP if service fails', async () => {
    // Arrange
    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    // Act
    const result = await createLegalAttestation(true, true, true);

    // Assert
    expect(result.userIPAddress).toBe('unknown');
  });
});
