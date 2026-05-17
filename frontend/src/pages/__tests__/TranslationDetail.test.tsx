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
import { render, screen, waitFor, act } from '@testing-library/react';
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
    // Issue #28: new presigned-URL endpoint for ePub + PDF downloads.
    getDownloadUrl: vi.fn(),
    startTranslation: vi.fn(),
  },
  // Issue #215: updated to match new 4-arg constructor (message, errorCode, statusCode?, originalError?).
  TranslationServiceError: class TranslationServiceError extends Error {
    constructor(
      message: string,
      public errorCode: string,
      public statusCode?: number,
      public originalError?: Error
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
    vi.useRealTimers(); // safety net: restore real timers even if a test throws
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
  // Issue #266 — Status chip near the page header
  // -------------------------------------------------------------------------

  describe('Issue #266 — Status chip', () => {
    // The chip carries the same status the user can otherwise infer only
    // from the buttons and the progress card. Surfacing it near the title
    // makes the page actionable at a glance. Each test asserts the
    // status-status mapping AND the aria-label so colour is not the sole
    // signal (a11y requirement).

    it('renders an aria-labelled status chip for COMPLETED jobs', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      renderComponent();

      const chip = await screen.findByTestId('status-chip');
      expect(chip).toHaveAttribute('aria-label', 'Translation status: Completed');
      expect(chip).toHaveTextContent('Completed');
    });

    it('renders the "Translating…" chip for IN_PROGRESS jobs', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);
      renderComponent();

      const chip = await screen.findByTestId('status-chip');
      expect(chip).toHaveAttribute('aria-label', 'Translation status: Translating…');
    });

    it('renders the "Ready to translate" chip for CHUNKED jobs', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockChunkedJob);
      renderComponent();

      const chip = await screen.findByTestId('status-chip');
      expect(chip).toHaveAttribute('aria-label', 'Translation status: Ready to translate');
    });

    it('renders the "Failed" chip for FAILED jobs', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockFailedJob);
      renderComponent();

      const chip = await screen.findByTestId('status-chip');
      expect(chip).toHaveAttribute('aria-label', 'Translation status: Failed');
    });

    it('does NOT render the chip until the first job fetch resolves', () => {
      // Never resolves — keeps the page in the loading state.
      vi.mocked(translationService.getJobStatus).mockImplementation(() => new Promise(() => {}));
      renderComponent();

      // No chip while status is undefined; the progress skeleton already
      // signals that data is loading.
      expect(screen.queryByTestId('status-chip')).not.toBeInTheDocument();
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
      // #266: Content Type row deliberately removed — the read-path
      // projection does not populate it, so the row was always empty.
      expect(screen.queryByText('Content Type')).not.toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
      });
    });

    it('should not show download button for IN_PROGRESS status', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockInProgressJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Job ID')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Download Markdown/i })).not.toBeInTheDocument();
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
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button', { name: /Download Markdown/i });
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
        new TranslationServiceError('Download failed', 'API_GENERIC', 500)
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button', { name: /Download Markdown/i });
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
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
      });

      const downloadButton = screen.getByRole('button', { name: /Download Markdown/i });
      await user.click(downloadButton);

      await waitFor(() => {
        expect(screen.getByText(/Downloading\.\.\./i)).toBeInTheDocument();
      });
    });

    // ---------------------------------------------------------------
    // Issue #28 — ePub + PDF additional download formats.
    // ---------------------------------------------------------------

    it('renders Markdown, ePub, and PDF download buttons for COMPLETED jobs (#28)', async () => {
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download ePub/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Download PDF/i })).toBeInTheDocument();
      });
    });

    it('downloads ePub via getDownloadUrl + anchor click (#28)', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.getDownloadUrl).mockResolvedValue({
        format: 'epub',
        downloadUrl: 'https://signed.example.com/translation.epub?X-Amz-Signature=abc',
        expiresInSeconds: 900,
        objectKey: 'translated-output/job-123/translation.epub',
      });

      // Spy on anchor click so we can assert the navigation pattern.
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
        // no-op — prevent jsdom from actually navigating.
      });

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download ePub/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Download ePub/i }));

      await waitFor(() => {
        expect(translationService.getDownloadUrl).toHaveBeenCalledWith('job-123', 'epub');
        expect(clickSpy).toHaveBeenCalled();
      });
      // markdown blob path MUST NOT have been touched.
      expect(translationService.downloadTranslation).not.toHaveBeenCalled();

      clickSpy.mockRestore();
    });

    it('downloads PDF via getDownloadUrl (#28)', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.getDownloadUrl).mockResolvedValue({
        format: 'pdf',
        downloadUrl: 'https://signed.example.com/translation.pdf',
        expiresInSeconds: 900,
        objectKey: 'translated-output/job-123/translation.pdf',
      });
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download PDF/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /Download PDF/i }));

      await waitFor(() => {
        expect(translationService.getDownloadUrl).toHaveBeenCalledWith('job-123', 'pdf');
      });
      clickSpy.mockRestore();
    });

    it('shows a per-format loading state and disables siblings during download (#28)', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.getDownloadUrl).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  format: 'epub',
                  downloadUrl: 'https://signed.example.com/x',
                  expiresInSeconds: 900,
                  objectKey: 'k',
                }),
              100
            )
          )
      );
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

      renderComponent();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download ePub/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /Download ePub/i }));

      await waitFor(() => {
        expect(screen.getByText(/Preparing ePub.../i)).toBeInTheDocument();
      });
      // Other download buttons disabled while ePub is in flight.
      expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Download PDF/i })).toBeDisabled();
      clickSpy.mockRestore();
    });

    it('surfaces a format-specific error message when ePub download fails (#28)', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockCompletedJob);
      vi.mocked(translationService.getDownloadUrl).mockRejectedValue(
        new TranslationServiceError('Conversion failed', 'API_GENERIC', 500)
      );

      renderComponent();
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download ePub/i })).toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /Download ePub/i }));

      await waitFor(() => {
        expect(screen.getByText(/Conversion failed/i)).toBeInTheDocument();
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
        new TranslationServiceError('Failed to start', 'API_GENERIC', 500)
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

    // #266: error-message precedence regression tests.
    //
    // The bug: starting a translation on an already-running job rendered the
    // catch-all "An unexpected error occurred" instead of the Lambda's
    // user-readable `message` field. Wiring the catch handler through
    // `getApiErrorMessage` fixes it. These tests pin both the happy path
    // (API message shows verbatim) and the forward-compat fallback
    // (COPY_BY_CODE lookup when no API message is present).
    it('surfaces the API envelope `message` when start translation fails (#266)', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockChunkedJob);

      // Build a TranslationServiceError that mimics what
      // translationService.handleError would produce for an axios-wrapped
      // structured-envelope response.
      const apiError = new TranslationServiceError(
        'Translation already in_progress for this job',
        'TRANSLATION_ALREADY_STARTED',
        409
      );
      vi.mocked(translationService.startTranslation).mockRejectedValue(apiError);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Start Translation/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Start Translation/i }));

      await waitFor(() => {
        expect(
          screen.getByText('Translation already in_progress for this job')
        ).toBeInTheDocument();
      });
      // MUST NOT be the catch-all fallback.
      expect(screen.queryByText(/An unexpected error occurred/i)).not.toBeInTheDocument();
    });

    it('falls back to COPY_BY_CODE when the API message is missing but errorCode is known (#266)', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus).mockResolvedValue(mockChunkedJob);

      // No message body — empty string forces the API-precedence branch
      // to skip and dispatch on errorCode instead.
      const codeOnlyError = new TranslationServiceError('', 'TRANSLATION_ALREADY_STARTED', 409);
      vi.mocked(translationService.startTranslation).mockRejectedValue(codeOnlyError);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Start Translation/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Start Translation/i }));

      await waitFor(() => {
        // Curated copy from translationErrorMessages.COPY_BY_CODE.
        expect(
          screen.getByText(/Translation is already running\. The page will refresh automatically/i)
        ).toBeInTheDocument();
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
      expect(screen.queryByRole('button', { name: /Download Markdown/i })).not.toBeInTheDocument();

      const refreshButton = screen.getByRole('button', { name: /Refresh Status/i });
      await user.click(refreshButton);

      // After refresh, COMPLETED, download button appears
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
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
          // 'Network error' is in GENERIC_MESSAGES, so getApiErrorMessage
          // falls through to the NETWORK_MESSAGE phrase instead of leaking
          // the raw axios string. Asserting this pins the precedence chain.
          expect(
            screen.getByText(/Connection lost — check your internet and try again/i)
          ).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      // MUST NOT be the catch-all fallback.
      expect(screen.queryByText(/An unexpected error occurred/i)).not.toBeInTheDocument();
    });

    // #269: error-message precedence on the PAGE-LOAD failure branch.
    //
    // The bug: navigating to /translation/<invalid-id> rendered the catch-all
    // "An unexpected error occurred" (via raw `queryError.message`) instead of
    // the Lambda's structured `response.data.message` field. Wiring the
    // page-load early-return through `getApiErrorMessage` fixes it.
    //
    // These tests pin both the happy path (structured-envelope `message`
    // shows verbatim) AND the COPY_BY_CODE fallback (curated phrase when
    // the API message is absent but an errorCode is known) on the
    // fatal-load branch, mirroring the action-error precedence tests
    // landed in PR #268.
    it('surfaces the API envelope `message` on page-load failure (#269)', async () => {
      // Mimic what translationService.handleError would emit for an axios
      // call that hit a structured error envelope: the message has already
      // been lifted from response.data.message into err.message.
      const apiError = new TranslationServiceError('Job not found', 'API_GENERIC', 404);
      vi.mocked(translationService.getJobStatus).mockRejectedValue(apiError);

      renderComponent();

      await waitFor(
        () => {
          expect(screen.getByText('Job not found')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      // MUST NOT be the catch-all fallback the user reported in #266 / #269.
      expect(screen.queryByText(/An unexpected error occurred/i)).not.toBeInTheDocument();
      // The "Go to Translation History" recovery action must still render.
      expect(screen.getByRole('link', { name: /Go to Translation History/i })).toBeInTheDocument();
    });

    it('falls back to a curated phrase on page-load 429 with no message (#269)', async () => {
      // 429 with no message body — getApiErrorMessage's API-precedence branch
      // is skipped and dispatch falls through to STATUS_MESSAGES[429].
      const rateLimited = new TranslationServiceError('', 'API_GENERIC', 429);
      vi.mocked(translationService.getJobStatus).mockRejectedValue(rateLimited);

      renderComponent();

      await waitFor(
        () => {
          // Curated phrase from translationErrorMessages.STATUS_MESSAGES[429].
          expect(screen.getByText(/rate limit reached/i)).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
      expect(screen.queryByText(/An unexpected error occurred/i)).not.toBeInTheDocument();
    });

    it('preserves the 403 hardcoded copy on page-load failure (#269 regression guard)', async () => {
      // The 403 special-case override must continue to suppress whatever
      // getApiErrorMessage would otherwise return, because backend 403
      // bodies may leak resource-existence information.
      vi.mocked(translationService.getJobStatus).mockRejectedValue(
        new TranslationServiceError('Resource exists but you cannot see it', 'API_GENERIC', 403)
      );

      renderComponent();

      await waitFor(() => {
        expect(
          screen.getByText('You do not have permission to view this translation')
        ).toBeInTheDocument();
      });
      // Backend prose MUST NOT have been surfaced.
      expect(screen.queryByText(/Resource exists but you cannot see it/i)).not.toBeInTheDocument();
    });

    // ----- #236 regression tests -----

    it('shows 403 message and navigates to /dashboard after 3 s', async () => {
      // shouldAdvanceTime: true lets real async code (React Query, Promises)
      // proceed normally while still giving us control over setTimeout/clearTimeout.
      vi.useFakeTimers({ shouldAdvanceTime: true });

      vi.mocked(translationService.getJobStatus).mockRejectedValue(
        new TranslationServiceError('Forbidden', 'API_GENERIC', 403)
      );

      renderComponent();

      // Wait for the 403 error UI to appear.
      await waitFor(() => {
        expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
      });

      // Timer has not fired yet.
      expect(mockNavigate).not.toHaveBeenCalled();

      // Advance the 3-second redirect timer.
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    });

    it('does NOT navigate when unmounted before the 3 s 403 timer fires (#236)', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      vi.mocked(translationService.getJobStatus).mockRejectedValue(
        new TranslationServiceError('Forbidden', 'API_GENERIC', 403)
      );

      const { unmount } = renderComponent();

      // Wait for the 403 error UI.
      await waitFor(() => {
        expect(screen.getByText(/do not have permission/i)).toBeInTheDocument();
      });

      // Unmount before the timer fires — clearTimeout cleanup cancels it.
      unmount();

      await act(async () => {
        vi.advanceTimersByTime(3000);
      });

      // navigate must NOT have been called after unmount.
      expect(mockNavigate).not.toHaveBeenCalled();
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

    // -----------------------------------------------------------------
    // #271 — In-page alert (post-initial-load polling-error path) must
    // route through getApiErrorMessage just like the fatal-load early
    // return that #270 / #269 fixed. The in-page alert is reached when
    // an initial fetch succeeded (so `job` is defined) and a subsequent
    // refetch fails. The previous implementation surfaced raw
    // `queryError.message`; this verifies the precedence chain instead.
    // -----------------------------------------------------------------
    it('renders structured-envelope `response.data.message` via the in-page alert on refetch failure (#271)', async () => {
      const user = userEvent.setup();
      // First call succeeds — page enters the loaded state with a job.
      // Second call fails — keeps the cached job but adds an error, which
      // is the trigger for the in-page (non-fatal-early-return) alert path.
      vi.mocked(translationService.getJobStatus)
        .mockResolvedValueOnce(mockCompletedJob)
        .mockRejectedValueOnce(
          // Bare-shape AxiosError-like object: no `message` lifted, but a
          // structured envelope in `response.data.message`. getApiErrorMessage
          // MUST extract the envelope message; raw `err.message` would have
          // produced an empty string here.
          Object.assign(new Error(''), {
            response: { data: { message: 'Translation backend unavailable, retry shortly' } },
          })
        );

      renderComponent();

      // Wait for the initial fetch to land — verified by the Markdown
      // download button (COMPLETED-only).
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
      });

      // Trigger the refetch that will reject.
      await user.click(screen.getByRole('button', { name: /Refresh Status/i }));

      // The in-page alert must show the API-envelope message.
      await waitFor(() => {
        expect(
          screen.getByText('Translation backend unavailable, retry shortly')
        ).toBeInTheDocument();
      });
    });

    it('replaces a GENERIC_MESSAGES axios error with NETWORK_MESSAGE in the in-page alert (#271)', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getJobStatus)
        .mockResolvedValueOnce(mockCompletedJob)
        // "Network Error" is in the GENERIC_MESSAGES deny-list — the alert
        // must NOT leak that raw axios string. Old code path (raw
        // err.message) would have rendered "Network Error".
        .mockRejectedValueOnce(new Error('Network Error'));

      renderComponent();

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Download Markdown/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Refresh Status/i }));

      await waitFor(() => {
        // NETWORK_MESSAGE from translationErrorMessages.ts.
        expect(
          screen.getByText(/Connection lost — check your internet and try again/i)
        ).toBeInTheDocument();
      });
      // The raw axios string must NOT have leaked.
      expect(screen.queryByText(/^Network Error$/)).not.toBeInTheDocument();
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
