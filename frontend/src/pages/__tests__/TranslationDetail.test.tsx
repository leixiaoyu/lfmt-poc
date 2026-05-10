/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Unit tests for TranslationDetail page component
 *
 * Tests cover:
 * - Page rendering and loading states (skeleton while React Query fetches)
 * - Job details display
 * - Route parameter parsing (jobId)
 * - TranslationProgress component integration
 * - Download button (enabled/disabled based on status)
 * - Start/Retry translation buttons
 * - Refresh functionality (via React Query refetch)
 * - Error handling (query errors, 403 redirect, general errors)
 * - Breadcrumb navigation
 * - Date and file size formatting
 *
 * Regression tests for:
 *   Issue #225: Progress card materialises on first paint (before Refresh Status click)
 *   Issue #225: Start Translation button hidden during IN_PROGRESS / COMPLETED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TranslationDetail } from '../TranslationDetail';
import {
  translationService,
  TranslationServiceError,
  TranslationJob,
} from '../../services/translationService';

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock translation service — React Query (useTranslationJob) calls this,
// so mocking at the service boundary covers both the hook and the page.
vi.mock('../../services/translationService', () => ({
  translationService: {
    getJobStatus: vi.fn(),
    downloadTranslation: vi.fn(),
    startTranslation: vi.fn(),
  },
  TranslationServiceError: class TranslationServiceError extends Error {
    constructor(
      message: string,
      public statusCode?: number,
      public code?: string
    ) {
      super(message);
      this.name = 'TranslationServiceError';
    }
  },
}));

// Mock TranslationProgress — it has its own React Query subscription.
// Stub it so we can assert whether it was mounted without dealing with
// its internal polling.
vi.mock('../../components/Translation/TranslationProgress', () => ({
  TranslationProgress: ({ jobId }: { jobId: string }) => (
    <div data-testid="translation-progress">TranslationProgress Component (jobId: {jobId})</div>
  ),
}));

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

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
  completedChunks: 5,
};

const mockInProgressJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'IN_PROGRESS',
  completedAt: undefined,
  completedChunks: 3,
};

const mockChunkedJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'CHUNKED',
  completedAt: undefined,
  completedChunks: 0,
};

const mockFailedJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'FAILED',
  completedAt: undefined,
  completedChunks: 0,
};

const mockPendingJob: TranslationJob = {
  ...mockCompletedJob,
  status: 'PENDING',
  completedAt: undefined,
  completedChunks: 0,
  totalChunks: 0,
};

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
}

function renderComponent(jobId = 'job-123') {
  // Fresh QueryClient per test — prevents cross-test cache contamination.
  const queryClient = makeQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/translation/${jobId}`]}>
        <Routes>
          <Route path="/translation/:jobId" element={<TranslationDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TranslationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Issue #225 regression tests — must be at the top and clearly labelled
  // -------------------------------------------------------------------------

  describe('Issue #225 — Progress card on first paint', () => {
    it('renders a progress skeleton while the first React Query fetch is in-flight', () => {
      // Never resolves — keeps the component in the loading state.
      vi.mocked(translationService.getJobStatus).mockImplementation(() => new Promise(() => {}));

      renderComponent();

      // The skeleton placeholder should appear immediately — before any
      // data has landed — so the user sees feedback on first paint.
      expect(screen.getByTestId('progress-skeleton')).toBeInTheDocument();
      // The "Refresh Status" button is always present.
      expect(screen.getByRole('button', { name: /Refresh Status/i })).toBeInTheDocument();
    });

    it('replaces the skeleton with TranslationProgress once the first fetch resolves for an IN_PROGRESS job', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      // Skeleton appears while loading.
      expect(screen.getByTestId('progress-skeleton')).toBeInTheDocument();

      // After the query settles, the real component renders — no Refresh
      // Status click required.
      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('progress-skeleton')).not.toBeInTheDocument();
    });

    it('replaces the skeleton with TranslationProgress once the first fetch resolves for a PENDING job', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockPendingJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });
    });

    it('hides Start Translation button when job is IN_PROGRESS (not shown during translation)', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });

      // Button must NOT appear for an already-running translation.
      expect(screen.queryByRole('button', { name: /Start Translation/i })).not.toBeInTheDocument();
    });

    it('hides Start Translation button when job is COMPLETED', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Start Translation/i })).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Page Rendering
  // -------------------------------------------------------------------------

  describe('Page Rendering', () => {
    it('should show progress skeleton initially', () => {
      vi.mocked(translationService.getJobStatus).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderComponent();

      // Skeleton replaces the old full-page spinner.
      expect(screen.getByTestId('progress-skeleton')).toBeInTheDocument();
    });

    it('should render page with job details', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      // Wait for data-dependent content, not the always-visible page title.
      await waitFor(() => {
        expect(screen.getByText('job-123')).toBeInTheDocument();
      });

      expect(screen.getByText('Job Information')).toBeInTheDocument();

      // Verify filename appears (breadcrumb and job details)
      const fileNames = screen.getAllByText('document.txt');
      expect(fileNames.length).toBeGreaterThan(0);
    });

    it('should display breadcrumbs with correct navigation', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      // Wait for the filename to appear in the breadcrumb — it is behind
      // a Skeleton while the React Query fetch is in-flight.
      await waitFor(() => {
        const breadcrumbNav = screen.getByRole('navigation');
        expect(breadcrumbNav).toHaveTextContent('document.txt');
      });

      const historyLink = screen.getByRole('link', { name: /Translation History/i });
      expect(historyLink).toBeInTheDocument();

      const dashboardLink = screen.getByRole('link', { name: /Dashboard/i });
      expect(dashboardLink).toHaveAttribute('href', '/dashboard');
      expect(historyLink).toHaveAttribute('href', '/translation/history');
    });
  });

  // -------------------------------------------------------------------------
  // Job Details Display
  // -------------------------------------------------------------------------

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
        expect(screen.getByText('Spanish (Español)')).toBeInTheDocument();
        expect(screen.getByText('Formal')).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // TranslationProgress Integration
  // -------------------------------------------------------------------------

  describe('TranslationProgress Integration', () => {
    it('should show progress component for IN_PROGRESS status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByTestId('translation-progress')).toBeInTheDocument();
      });

      expect(
        screen.getByText(/TranslationProgress Component \(jobId: job-123\)/i)
      ).toBeInTheDocument();
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

  // -------------------------------------------------------------------------
  // Download Functionality
  // -------------------------------------------------------------------------

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

      expect(
        screen.queryByRole('button', { name: /Download Translation/i })
      ).not.toBeInTheDocument();
    });

    it('should download translation when clicking download button', async () => {
      const user = userEvent.setup();
      const mockBlob = new Blob(['translated content'], { type: 'text/plain' });
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.downloadTranslation).mockResolvedValue(mockBlob);

      const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
      const mockRevokeObjectURL = vi.fn();
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      URL.createObjectURL = mockCreateObjectURL;
      URL.revokeObjectURL = mockRevokeObjectURL;

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

      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
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

      await waitFor(() => {
        expect(screen.getByText(/Downloading\.\.\./i)).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Start / Retry Translation
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Refresh Functionality
  // -------------------------------------------------------------------------

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
      expect(
        screen.queryByRole('button', { name: /Download Translation/i })
      ).not.toBeInTheDocument();

      const refreshButton = screen.getByRole('button', { name: /Refresh Status/i });
      await user.click(refreshButton);

      // After refresh, COMPLETED, download button appears
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Translation/i })).toBeInTheDocument();
      });

      expect(translationService.getJobStatus).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling
  // -------------------------------------------------------------------------

  describe('Error Handling', () => {
    it('should show error when query fails with a generic error', async () => {
      vi.mocked(translationService.getJobStatus).mockRejectedValue(new Error('Network error'));

      renderComponent();

      await waitFor(
        () => {
          expect(screen.getByText('Network error')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });

    it('should show error when no jobId provided', () => {
      render(
        <QueryClientProvider client={makeQueryClient()}>
          <MemoryRouter initialEntries={['/translation/']}>
            <Routes>
              <Route path="/translation/:jobId?" element={<TranslationDetail />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      );

      // Missing jobId guard renders inline (no async fetch needed).
      expect(screen.getByText('No job ID provided')).toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('No job ID provided');
    });
  });

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  describe('Navigation', () => {
    it('should have Back to History button', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(
        () => {
          expect(screen.getByText('Translation Details')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      const backButton = screen.getByRole('link', { name: /Back to History/i });
      expect(backButton).toHaveAttribute('href', '/translation/history');
    });
  });

  // -------------------------------------------------------------------------
  // File Size Formatting
  // -------------------------------------------------------------------------

  describe('File Size Formatting', () => {
    it('should format 0 bytes correctly', async () => {
      const jobWithZeroSize = { ...mockCompletedJob, fileSize: 0 };
      vi.mocked(translationService.getJobStatus).mockResolvedValue(jobWithZeroSize);

      renderComponent();

      await waitFor(
        () => {
          expect(screen.getByText('0 Bytes')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('should format KB correctly', async () => {
      const jobWithKB = { ...mockCompletedJob, fileSize: 2048 };
      vi.mocked(translationService.getJobStatus).mockResolvedValue(jobWithKB);

      renderComponent();

      await waitFor(
        () => {
          expect(screen.getByText('2 KB')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('should format MB correctly', async () => {
      const jobWithMB = { ...mockCompletedJob, fileSize: 2097152 };
      vi.mocked(translationService.getJobStatus).mockResolvedValue(jobWithMB);

      renderComponent();

      await waitFor(
        () => {
          expect(screen.getByText('2 MB')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });
});
