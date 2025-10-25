/**
 * Upload Service Tests
 *
 * Comprehensive test suite for uploadService module
 * Tests presigned URL requests, S3 uploads, and complete upload workflow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { uploadService } from '../uploadService';
import * as api from '../../utils/api';

// Mock API client
vi.mock('../../utils/api', () => ({
  apiClient: {
    post: vi.fn(),
    get: vi.fn(),
  },
}));

describe('uploadService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('requestUploadUrl', () => {
    it('should request presigned URL with correct payload', async () => {
      // Arrange
      const mockFile = new File(['test content'], 'test.txt', {
        type: 'text/plain',
      });

      const mockResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/key?signature',
            fileId: 'test-file-id-123',
            expiresIn: 900,
            requiredHeaders: {
              'Content-Type': 'text/plain',
              'Content-Length': '12',
            },
          },
        },
      };

      vi.spyOn(api.apiClient, 'post').mockResolvedValue(mockResponse);

      // Act
      const result = await uploadService.requestUploadUrl(mockFile);

      // Assert
      expect(api.apiClient.post).toHaveBeenCalledWith('/jobs/upload', {
        fileName: 'test.txt',
        fileSize: mockFile.size,
        contentType: 'text/plain',
      });

      expect(result).toEqual({
        uploadUrl: 'https://s3.amazonaws.com/bucket/key?signature',
        fileId: 'test-file-id-123',
        expiresIn: 900,
        requiredHeaders: {
          'Content-Type': 'text/plain',
          'Content-Length': '12',
        },
      });
    });

    it('should handle API errors', async () => {
      // Arrange
      const mockFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const mockError = new Error('API request failed');

      vi.spyOn(api.apiClient, 'post').mockRejectedValue(mockError);

      // Act & Assert
      await expect(uploadService.requestUploadUrl(mockFile)).rejects.toThrow(
        'API request failed'
      );
    });

    it('should handle large files', async () => {
      // Arrange
      const largeContent = 'x'.repeat(50 * 1024 * 1024); // 50MB
      const mockFile = new File([largeContent], 'large.txt', {
        type: 'text/plain',
      });

      const mockResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/key',
            fileId: 'large-file-id',
            expiresIn: 900,
            requiredHeaders: {
              'Content-Type': 'text/plain',
              'Content-Length': mockFile.size.toString(),
            },
          },
        },
      };

      vi.spyOn(api.apiClient, 'post').mockResolvedValue(mockResponse);

      // Act
      const result = await uploadService.requestUploadUrl(mockFile);

      // Assert
      expect(result.fileId).toBe('large-file-id');
      expect(api.apiClient.post).toHaveBeenCalledWith(
        '/jobs/upload',
        expect.objectContaining({
          fileSize: mockFile.size,
        })
      );
    });
  });

  describe('uploadToS3', () => {
    let mockXHR: {
      open: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      setRequestHeader: ReturnType<typeof vi.fn>;
      upload: {
        addEventListener: ReturnType<typeof vi.fn>;
      };
      addEventListener: ReturnType<typeof vi.fn>;
      status: number;
      statusText: string;
    };

    beforeEach(() => {
      // Mock XMLHttpRequest
      mockXHR = {
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        upload: {
          addEventListener: vi.fn(),
        },
        addEventListener: vi.fn(),
        status: 200,
        statusText: 'OK',
      };

      (globalThis as any).XMLHttpRequest = vi.fn(() => mockXHR);
    });

    it('should upload file to S3 with required headers', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt', {
        type: 'text/plain',
      });
      const uploadUrl = 'https://s3.amazonaws.com/bucket/key';
      const requiredHeaders = {
        'Content-Type': 'text/plain',
        'Content-Length': '7',
      };

      // Setup XHR to trigger success
      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'load') {
          setTimeout(() => handler(), 0);
        }
      });

      // Act
      const uploadPromise = uploadService.uploadToS3(
        mockFile,
        uploadUrl,
        requiredHeaders
      );

      await uploadPromise;

      // Assert
      expect(mockXHR.open).toHaveBeenCalledWith('PUT', uploadUrl);
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
        'Content-Type',
        'text/plain'
      );
      expect(mockXHR.setRequestHeader).toHaveBeenCalledWith(
        'Content-Length',
        '7'
      );
      expect(mockXHR.send).toHaveBeenCalledWith(mockFile);
    });

    it('should track upload progress', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt');
      const uploadUrl = 'https://s3.amazonaws.com/bucket/key';
      const onProgress = vi.fn();

      // Setup progress event
      mockXHR.upload.addEventListener.mockImplementation((event, handler) => {
        if (event === 'progress') {
          setTimeout(() => {
            handler({ lengthComputable: true, loaded: 50, total: 100 });
            handler({ lengthComputable: true, loaded: 100, total: 100 });
          }, 0);
        }
      });

      // Setup completion
      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'load') {
          setTimeout(() => handler(), 10);
        }
      });

      // Act
      await uploadService.uploadToS3(mockFile, uploadUrl, {}, onProgress);

      // Assert
      expect(onProgress).toHaveBeenCalledWith({
        loaded: 50,
        total: 100,
        percentage: 50,
      });
      expect(onProgress).toHaveBeenCalledWith({
        loaded: 100,
        total: 100,
        percentage: 100,
      });
    });

    it('should handle upload errors', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt');
      const uploadUrl = 'https://s3.amazonaws.com/bucket/key';

      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => handler(), 0);
        }
      });

      // Act & Assert
      await expect(
        uploadService.uploadToS3(mockFile, uploadUrl, {})
      ).rejects.toThrow('Network error during file upload');
    });

    it('should handle upload abort', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt');
      const uploadUrl = 'https://s3.amazonaws.com/bucket/key';

      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'abort') {
          setTimeout(() => handler(), 0);
        }
      });

      // Act & Assert
      await expect(
        uploadService.uploadToS3(mockFile, uploadUrl, {})
      ).rejects.toThrow('Upload was cancelled');
    });

    it('should handle HTTP error responses', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt');
      const uploadUrl = 'https://s3.amazonaws.com/bucket/key';

      mockXHR.status = 403;
      mockXHR.statusText = 'Forbidden';

      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'load') {
          setTimeout(() => handler(), 0);
        }
      });

      // Act & Assert
      await expect(
        uploadService.uploadToS3(mockFile, uploadUrl, {})
      ).rejects.toThrow('Upload failed with status 403: Forbidden');
    });
  });

  describe('uploadDocument', () => {
    let mockXHR: {
      open: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      setRequestHeader: ReturnType<typeof vi.fn>;
      upload: { addEventListener: ReturnType<typeof vi.fn> };
      addEventListener: ReturnType<typeof vi.fn>;
      status: number;
      statusText: string;
    };

    beforeEach(() => {
      mockXHR = {
        open: vi.fn(),
        send: vi.fn(),
        setRequestHeader: vi.fn(),
        upload: { addEventListener: vi.fn() },
        addEventListener: vi.fn(),
        status: 200,
        statusText: 'OK',
      };

      (globalThis as any).XMLHttpRequest = vi.fn(() => mockXHR);
    });

    it('should complete full upload workflow', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt', {
        type: 'text/plain',
      });

      const mockUrlResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/key',
            fileId: 'test-file-id',
            expiresIn: 900,
            requiredHeaders: {
              'Content-Type': 'text/plain',
            },
          },
        },
      };

      vi.spyOn(api.apiClient, 'post').mockResolvedValue(mockUrlResponse);

      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'load') {
          setTimeout(() => handler(), 0);
        }
      });

      // Act
      const result = await uploadService.uploadDocument(mockFile);

      // Assert
      expect(result).toEqual({
        fileId: 'test-file-id',
        success: true,
      });

      expect(api.apiClient.post).toHaveBeenCalledWith('/jobs/upload', {
        fileName: 'test.txt',
        fileSize: mockFile.size,
        contentType: 'text/plain',
      });

      expect(mockXHR.send).toHaveBeenCalledWith(mockFile);
    });

    it('should track progress during complete workflow', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt');
      const onProgress = vi.fn();

      const mockUrlResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/key',
            fileId: 'test-file-id',
            expiresIn: 900,
            requiredHeaders: {},
          },
        },
      };

      vi.spyOn(api.apiClient, 'post').mockResolvedValue(mockUrlResponse);

      mockXHR.upload.addEventListener.mockImplementation((event, handler) => {
        if (event === 'progress') {
          setTimeout(() => {
            handler({ lengthComputable: true, loaded: 100, total: 100 });
          }, 0);
        }
      });

      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'load') {
          setTimeout(() => handler(), 10);
        }
      });

      // Act
      await uploadService.uploadDocument(mockFile, onProgress);

      // Assert
      expect(onProgress).toHaveBeenCalledWith({
        loaded: 100,
        total: 100,
        percentage: 100,
      });
    });

    it('should handle presigned URL request failure', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt');
      const mockError = new Error('Failed to get presigned URL');

      vi.spyOn(api.apiClient, 'post').mockRejectedValue(mockError);

      // Act
      const result = await uploadService.uploadDocument(mockFile);

      // Assert
      expect(result).toEqual({
        fileId: '',
        success: false,
        error: 'Failed to get presigned URL',
      });
    });

    it('should handle S3 upload failure', async () => {
      // Arrange
      const mockFile = new File(['content'], 'test.txt');

      const mockUrlResponse = {
        data: {
          data: {
            uploadUrl: 'https://s3.amazonaws.com/bucket/key',
            fileId: 'test-file-id',
            expiresIn: 900,
            requiredHeaders: {},
          },
        },
      };

      vi.spyOn(api.apiClient, 'post').mockResolvedValue(mockUrlResponse);

      mockXHR.addEventListener.mockImplementation((event, handler) => {
        if (event === 'error') {
          setTimeout(() => handler(), 0);
        }
      });

      // Act
      const result = await uploadService.uploadDocument(mockFile);

      // Assert
      expect(result).toEqual({
        fileId: '',
        success: false,
        error: 'Network error during file upload',
      });
    });
  });
});
