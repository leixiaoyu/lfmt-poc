/**
 * Unit tests for TranslationDetail page component
 *
 * Tests cover:
 * - Page rendering and loading states
 * - Job details display
 * - Route parameter parsing (jobId)
 * - TranslationProgress component integration
 * - Download button (enabled/disabled based on status)
 * - Start/Retry translation buttons
 * - Refresh functionality
 * - Error handling (404, 403, general errors)
 * - Breadcrumb navigation
 * - Date and file size formatting
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { TranslationDetail } from '../TranslationDetail';
import {
  translationService,
  TranslationServiceError,
  TranslationJob,
} from '../../services/translationService';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock translation service
vi.mock('../../services/translationService', () => ({
  translationService: {
    getJobStatus: vi.fn(),
    downloadTranslation: vi.fn(),
    startTranslation: vi.fn(),
  },
  TranslationServiceError: class TranslationServiceError extends Error {
    constructor(message: string, public statusCode?: number, public code?: string) {
      super(message);
      this.name = 'TranslationServiceError';
    }
  },
}));

// Mock TranslationProgress component
vi.mock('../../components/Translation/TranslationProgress', () => ({
  TranslationProgress: ({ jobId, onComplete, onError }: any) => (
    <div data-testid="translation-progress">
      TranslationProgress Component (jobId: {jobId})
    </div>
  ),
}));

// Mock job data
const mockCompletedJob: TranslationJob = {
  jobId: 'job-123',
  userId: 'user-1',
  fileName: 'document.txt',
  status: 'COMPLETED',
  targetLanguage: 'es',
  tone: 'formal',
  createdAt: '2025-01-15T10:00:00Z',
  updatedAt: '2025-01-15T10:30:00Z',
  completedAt: '2025-01-15T10:30:00Z',
  fileSize: 2048,
  contentType: 'text/plain',
  totalChunks: 5,
  translatedChunks: 5,
  estimatedCost: 0.50,
  tokensUsed: 1000,
};

const mockInProgressJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'IN_PROGRESS',
  completedAt: undefined,
  translatedChunks: 3,
};

const mockChunkedJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'CHUNKED',
  completedAt: undefined,
  translatedChunks: 0,
};

const mockFailedJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'FAILED',
  completedAt: undefined,
  translatedChunks: 0,
};

const mockPendingJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'PENDING',
  completedAt: undefined,
  translatedChunks: 0,
  totalChunks: 0,
};

describe('TranslationDetail', () => {
  const renderComponent = (jobId = 'job-123') => {
    return render(
      <MemoryRouter initialEntries={[`/translation/${jobId}`]}>
        <Routes>
          <Route path="/translation/:jobId" element={<TranslationDetail />} />
        </Routes>
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Page Rendering', () => {
    it('should show loading state initially', () => {
      vi.mocked(translationService.getJobStatus).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderComponent();

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByText(/Loading translation details/i)).toBeInTheDocument();
    });

    it('should render page with job details', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Translation Details')).toBeInTheDocument();
      });

      expect(screen.getByText('Job Information')).toBeInTheDocument();
      expect(screen.getByText('job-123')).toBeInTheDocument();

      // Verify filename appears (will be in multiple places - breadcrumb and job details)
      const fileNames = screen.getAllByText('document.txt');
      expect(fileNames.length).toBeGreaterThan(0);
    });

    it('should display breadcrumbs with correct navigation', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        const dashboardLink = screen.getByRole('link', { name: /Dashboard/i });
        expect(dashboardLink).toBeInTheDocument();
      });

      const historyLink = screen.getByRole('link', { name: /Translation History/i });
      expect(historyLink).toBeInTheDocument();

      // Breadcrumb shows filename as plain text (not a link)
      const breadcrumbNav = screen.getByRole('navigation');
      expect(breadcrumbNav).toHaveTextContent('document.txt');

      const dashboardLink = screen.getByRole('link', { name: /Dashboard/i });
      expect(dashboardLink).toHaveAttribute('href', '/dashboard');
      expect(historyLink).toHaveAttribute('href', '/translation/history');
    });
  });

  describe('Job Details Display', () => {
    it('should display all job metadata fields', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Job ID')).toBeInTheDocument();
      });

      expect(screen.getByText('File Name')).toBeInTheDocument();
      expect(screen.getByText('File Size')).toBeInTheDocument();
      expect(screen.getByText('Content Type')).toBeInTheDocument();
      expect(screen.getByText('Target Language')).toBeInTheDocument();
      expect(screen.getByText('Tone')).toBeInTheDocument();
      expect(screen.getByText('Created At')).toBeInTheDocument();
      expect(screen.getByText('Last Updated')).toBeInTheDocument();
      expect(screen.getByText('Completed At')).toBeInTheDocument();
    });

    it('should format file size correctly', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('2 KB')).toBeInTheDocument();
      });
    });

    it('should format dates correctly', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Job ID')).toBeInTheDocument();
      });

      // Check that dates are present (format depends on locale)
      const dateElements = screen.getAllByText(/2025|1\/15/i);
      expect(dateElements.length).toBeGreaterThan(0);
    });

    it('should not display completed date for in-progress jobs', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Job ID')).toBeInTheDocument();
      });

      expect(screen.queryByText('Completed At')).not.toBeInTheDocument();
    });

    it('should display target language and tone when available', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('es')).toBeInTheDocument();
        expect(screen.getByText('formal')).toBeInTheDocument();
      });
    });
  });

  describe('TranslationProgress Integration', () => {
    it('should show progress component for IN_PROGRESS status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });

      expect(screen.getByText(/TranslationProgress Component \(jobId: job-123\)/i)).toBeInTheDocument();
    });

    it('should show progress component for COMPLETED status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });
    });

    it('should show progress component for PENDING status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockPendingJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });
    });

    it('should not show progress component for CHUNKED status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockChunkedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Job ID')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('translation-progress')).not.toBeInTheDocument();
    });

    it('should not show progress component for FAILED status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockFailedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Job ID')).toBeInTheDocument();
      });

      expect(screen.queryByTestId('translation-progress')).not.toBeInTheDocument();
    });
  });

  describe('Download Functionality', () => {
    it('should show download button only for COMPLETED status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Translation/i })).toBeInTheDocument();
      });
    });

    it('should not show download button for IN_PROGRESS status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Job ID')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Download Translation/i })).not.toBeInTheDocument();
    });

    it('should download translation when clicking download button', async () => {
      const user = userEvent.setup();
      const mockBlob = new Blob(['translated content'], { type: 'text/plain' });
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.downloadTranslation).mockResolvedValue(mockBlob);

      // Mock URL methods
      const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
      const mockRevokeObjectURL = vi.fn();
      const originalCreateObjectURL = global.URL.createObjectURL;
      const originalRevokeObjectURL = global.URL.revokeObjectURL;
      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Translation/i })).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button', { name: /Download Translation/i });
      await user.click(downloadButton);

      await waitFor(() => {
        expect(translationService.downloadTranslation).toHaveBeenCalledWith('job-123');
        expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
      });

      // Cleanup
      global.URL.createObjectURL = originalCreateObjectURL;
      global.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('should show error when download fails', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.downloadTranslation).mockRejectedValue(
        new TranslationServiceError('Download failed', 500)
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Translation/i })).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button', { name: /Download Translation/i });
      await user.click(downloadButton);

      await waitFor(() => {
        expect(screen.getByText('Download failed')).toBeInTheDocument();
      });
    });

    it('should show downloading state while downloading', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.downloadTranslation).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(new Blob()), 100))
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Translation/i })).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button', { name: /Download Translation/i });
      await user.click(downloadButton);

      // Should show "Downloading..." immediately
      await waitFor(() => {
        expect(screen.getByText(/Downloading\.\.\./i)).toBeInTheDocument();
      });
    });
  });

  describe('Start/Retry Translation', () => {
    it('should show Start Translation button for CHUNKED status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockChunkedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Start Translation/i })).toBeInTheDocument();
      });
    });

    it('should show Retry Translation button for FAILED status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockFailedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Retry Translation/i })).toBeInTheDocument();
      });
    });

    it('should start translation when clicking Start Translation button', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus)
        .mockResolvedValueOnce(mockChunkedJob)
        .mockResolvedValueOnce(mockInProgressJob); // After start
      vi.mocked(translationService.startTranslation).mockResolvedValue(undefined as any);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Start Translation/i })).toBeInTheDocument();
      });

      const startButton = screen.getByRole('button', { name: /Start Translation/i });
      await user.click(startButton);

      await waitFor(() => {
        expect(translationService.startTranslation).toHaveBeenCalledWith('job-123', {
          targetLanguage: 'es',
          tone: 'formal',
        });
      });
    });

    it('should retry translation when clicking Retry button', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus)
        .mockResolvedValueOnce(mockFailedJob)
        .mockResolvedValueOnce(mockInProgressJob); // After retry
      vi.mocked(translationService.startTranslation).mockResolvedValue(undefined as any);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Retry Translation/i })).toBeInTheDocument();
      });

      const retryButton = screen.getByRole('button', { name: /Retry Translation/i });
      await user.click(retryButton);

      await waitFor(() => {
        expect(translationService.startTranslation).toHaveBeenCalledWith('job-123', {
          targetLanguage: 'es',
          tone: 'formal',
        });
      });
    });

    it('should show error when start translation fails', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockChunkedJob);
      vi.mocked(translationService.startTranslation).mockRejectedValue(
        new TranslationServiceError('Failed to start', 500)
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Start Translation/i })).toBeInTheDocument();
      });

      const startButton = screen.getByRole('button', { name: /Start Translation/i });
      await user.click(startButton);

      await waitFor(() => {
        expect(screen.getByText('Failed to start')).toBeInTheDocument();
      });
    });
  });

  describe('Refresh Functionality', () => {
    it('should have refresh status button', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Refresh Status/i })).toBeInTheDocument();
      });
    });

    it('should refresh job details when clicking refresh button', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus)
        .mockResolvedValueOnce(mockInProgressJob)
        .mockResolvedValueOnce(mockCompletedJob); // After refresh

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Refresh Status/i })).toBeInTheDocument();
      });

      // Initially IN_PROGRESS, no download button
      expect(screen.queryByRole('button', { name: /Download Translation/i })).not.toBeInTheDocument();

      const refreshButton = screen.getByRole('button', { name: /Refresh Status/i });
      await user.click(refreshButton);

      // After refresh, COMPLETED, download button appears
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Translation/i })).toBeInTheDocument();
      });

      expect(translationService.getJobStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should show 404 error when job not found', async () => {
      vi.mocked(translationService.getJobStatus).mockRejectedValue(
        new TranslationServiceError('Job not found', 404)
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Translation job not found')).toBeInTheDocument();
      });

      expect(screen.getByRole('link', { name: /Go to Translation History/i })).toBeInTheDocument();
    });

    it('should show 403 error and navigate to dashboard', async () => {
      vi.useFakeTimers();
      vi.mocked(translationService.getJobStatus).mockRejectedValue(
        new TranslationServiceError('Forbidden', 403)
      );

      renderComponent();

      // Wait for error message using real timers context
      await vi.waitFor(() => {
        expect(screen.getByText('You do not have permission to view this translation')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Fast-forward time to trigger navigation (setTimeout in component)
      await vi.advanceTimersByTimeAsync(3000);

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');

      vi.useRealTimers();
    });

    it('should show generic error for service errors', async () => {
      vi.mocked(translationService.getJobStatus).mockRejectedValue(
        new TranslationServiceError('Server error', 500)
      );

      renderComponent();

      // Wait for error message to appear
      await waitFor(() => {
        expect(screen.getByText('Server error')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Verify alert is shown
      expect(screen.getByRole('alert')).toHaveTextContent('Server error');
    });

    it('should show fallback error for unknown errors', async () => {
      vi.mocked(translationService.getJobStatus).mockRejectedValue(
        new Error('Network error')
      );

      renderComponent();

      // Wait for error message to appear
      await waitFor(() => {
        expect(screen.getByText('Failed to load translation details')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Verify alert is shown
      expect(screen.getByRole('alert')).toHaveTextContent('Failed to load translation details');
    });

    it('should show error when no jobId provided', async () => {
      // Render with empty jobId (simulating missing URL parameter)
      render(
        <MemoryRouter initialEntries={['/translation/']}>
          <Routes>
            <Route path="/translation/:jobId?" element={<TranslationDetail />} />
          </Routes>
        </MemoryRouter>
      );

      // Wait for error message to appear
      await waitFor(() => {
        expect(screen.getByText('No job ID provided')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Verify alert is shown
      expect(screen.getByRole('alert')).toHaveTextContent('No job ID provided');
    });
  });

  describe('Navigation', () => {
    it('should have Back to History button', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      // Wait for job details to load
      await waitFor(() => {
        expect(screen.getByText('Translation Details')).toBeInTheDocument();
      }, { timeout: 3000 });

      const backButton = screen.getByRole('link', { name: /Back to History/i });
      expect(backButton).toHaveAttribute('href', '/translation/history');
    });
  });

  describe('File Size Formatting', () => {
    it('should format 0 bytes correctly', async () => {
      const jobWithZeroSize = { ...mockCompletedJob, fileSize: 0 };
      vi.mocked(translationService.getJobStatus).mockResolvedValue(jobWithZeroSize);

      renderComponent();

      // Wait for job details to load
      await waitFor(() => {
        expect(screen.getByText('0 Bytes')).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should format KB correctly', async () => {
      const jobWithKB = { ...mockCompletedJob, fileSize: 2048 };
      vi.mocked(translationService.getJobStatus).mockResolvedValue(jobWithKB);

      renderComponent();

      // Wait for job details to load
      await waitFor(() => {
        expect(screen.getByText('2 KB')).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should format MB correctly', async () => {
      const jobWithMB = { ...mockCompletedJob, fileSize: 2097152 }; // 2 MB
      vi.mocked(translationService.getJobStatus).mockResolvedValue(jobWithMB);

      renderComponent();

      // Wait for job details to load
      await waitFor(() => {
        expect(screen.getByText('2 MB')).toBeInTheDocument();
      }, { timeout: 3000 });
    });
  });
});
