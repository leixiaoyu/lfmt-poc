/**
 * TranslationProgress Component Tests
 *
 * Tests cover polling logic, progress calculation, status display, and callbacks.
 * Complex component with adaptive polling - focus on critical paths.
 *
 * Target Coverage: 80%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../../../test-utils';
import { TranslationProgress } from '../TranslationProgress';
import { translationService } from '../../../services/translationService';
import type { TranslationJob } from '@lfmt/shared-types';

// Mock the translation service
vi.mock('../../../services/translationService', () => ({
  translationService: {
    getJobStatus: vi.fn(),
  },
}));

describe('TranslationProgress Component', () => {
  const mockJob: TranslationJob = {
    jobId: 'job-123',
    userId: 'user-456',
    status: 'IN_PROGRESS',
    sourceLanguage: 'en',
    targetLanguage: 'es',
    tone: 'neutral',
    filename: 'test-document.txt',
    fileName: 'test-document.txt',
    originalFileKey: 's3://bucket/test.txt',
    fileSize: 1024,
    totalChunks: 10,
    completedChunks: 5,
    legalAttestation: {} as any,
    createdAt: '2024-10-31T12:00:00Z',
    updatedAt: '2024-10-31T12:05:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initial Loading', () => {
    it('should show loading state initially', () => {
      // Arrange
      vi.mocked(translationService.getJobStatus).mockImplementation(() => new Promise(() => {}));

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      expect(screen.getByText('Loading translation status...')).toBeInTheDocument();
    });

    it('should fetch job status on mount', async () => {
      // Arrange
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(mockJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(translationService.getJobStatus).toHaveBeenCalledWith('job-123');
      });
    });
  });

  describe('Progress Display', () => {
    it('should display job details after loading', async () => {
      // Arrange
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(mockJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Translation Progress')).toBeInTheDocument();
        expect(screen.getByText('test-document.txt')).toBeInTheDocument();
        expect(screen.getByText('es')).toBeInTheDocument();
      });
    });

    it('should display chunk progress', async () => {
      // Arrange
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(mockJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('5 / 10')).toBeInTheDocument();
        expect(screen.getByText('10')).toBeInTheDocument(); // Total chunks
      });
    });

    it('should show correct status chip for IN_PROGRESS', async () => {
      // Arrange
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(mockJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Translating')).toBeInTheDocument();
      });
    });

    it('should show correct status chip for COMPLETED', async () => {
      // Arrange
      const completedJob: TranslationJob = {
        ...mockJob,
        status: 'COMPLETED',
        completedChunks: 10,
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(completedJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Completed')).toBeInTheDocument();
        expect(screen.getByText(/Translation completed successfully/i)).toBeInTheDocument();
      });
    });
  });

  describe('Progress Calculation', () => {
    it('should calculate 100% for COMPLETED status', async () => {
      // Arrange
      const completedJob: TranslationJob = {
        ...mockJob,
        status: 'COMPLETED',
        completedChunks: 10,
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(completedJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('100% complete')).toBeInTheDocument();
      });
    });

    it('should calculate progress based on completed chunks', async () => {
      // Arrange - 5 out of 10 chunks = 50% of 85% = 42.5% + 15% base = 57.5%
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(mockJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('58% complete')).toBeInTheDocument(); // Rounded
      });
    });

    it('should show 5% for PENDING status', async () => {
      // Arrange
      const pendingJob: TranslationJob = {
        ...mockJob,
        status: 'PENDING',
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(pendingJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('5% complete')).toBeInTheDocument();
      });
    });

    it('should show 0% for FAILED status', async () => {
      // Arrange
      const failedJob: TranslationJob = {
        ...mockJob,
        status: 'FAILED',
        errorMessage: 'Translation failed',
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(failedJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('0% complete')).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error when fetch fails', async () => {
      // Arrange
      vi.mocked(translationService.getJobStatus).mockRejectedValueOnce(
        new Error('Network error')
      );

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('should call onError callback when fetch fails', async () => {
      // Arrange
      const mockOnError = vi.fn();
      vi.mocked(translationService.getJobStatus).mockRejectedValueOnce(
        new Error('API error')
      );

      // Act
      render(<TranslationProgress jobId="job-123" onError={mockOnError} />);

      // Assert
      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('API error');
      });
    });

    it('should display error message from job', async () => {
      // Arrange
      const failedJob: TranslationJob = {
        ...mockJob,
        status: 'FAILED',
        errorMessage: 'Chunking failed: Invalid format',
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(failedJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Chunking failed: Invalid format')).toBeInTheDocument();
      });
    });

    it('should display failed chunks count', async () => {
      // Arrange
      const jobWithFailedChunks: TranslationJob = {
        ...mockJob,
        failedChunks: 2,
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(jobWithFailedChunks);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Failed Chunks')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
      });
    });
  });

  describe('Callbacks', () => {
    it('should call onComplete when job reaches COMPLETED status', async () => {
      // Arrange
      const mockOnComplete = vi.fn();
      const completedJob: TranslationJob = {
        ...mockJob,
        status: 'COMPLETED',
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(completedJob);

      // Act
      render(<TranslationProgress jobId="job-123" onComplete={mockOnComplete} />);

      // Assert
      await waitFor(() => {
        expect(mockOnComplete).toHaveBeenCalledWith(completedJob);
      });
    });

    it('should call onError when job reaches FAILED status', async () => {
      // Arrange
      const mockOnError = vi.fn();
      const failedJob: TranslationJob = {
        ...mockJob,
        status: 'FAILED',
        errorMessage: 'Translation failed',
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(failedJob);

      // Act
      render(<TranslationProgress jobId="job-123" onError={mockOnError} />);

      // Assert
      await waitFor(() => {
        expect(mockOnError).toHaveBeenCalledWith('Translation failed');
      });
    });
  });

  describe('Status Labels and Colors', () => {
    it('should display correct label for CHUNKING status', async () => {
      // Arrange
      const chunkingJob: TranslationJob = {
        ...mockJob,
        status: 'CHUNKING',
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(chunkingJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Chunking Document')).toBeInTheDocument();
      });
    });

    it('should display correct label for CHUNKED status', async () => {
      // Arrange
      const chunkedJob: TranslationJob = {
        ...mockJob,
        status: 'CHUNKED',
      };
      vi.mocked(translationService.getJobStatus).mockResolvedValueOnce(chunkedJob);

      // Act
      render(<TranslationProgress jobId="job-123" />);

      // Assert
      await waitFor(() => {
        expect(screen.getByText('Ready to Translate')).toBeInTheDocument();
      });
    });
  });
});
