/**
 * TranslationCompare page tests
 *
 * Covers:
 * - 404 / 403 / generic error branches
 * - 403 setTimeout navigation cleanup
 * - Integration with useTranslationJob (job-fetch path)
 * - Blob size cap enforcement
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '../../test-utils';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { TranslationCompare } from '../TranslationCompare';
import {
  translationService,
  TranslationServiceError,
  type TranslationJob,
} from '../../services/translationService';

vi.mock('../../services/translationService', async () => {
  const actual = await vi.importActual<typeof import('../../services/translationService')>(
    '../../services/translationService'
  );
  return {
    ...actual,
    translationService: {
      getJobStatus: vi.fn(),
      downloadTranslation: vi.fn(),
    },
  };
});

// Stub Virtuoso so SideBySideViewer renders without layout APIs.
vi.mock('react-virtuoso', () => ({
  Virtuoso: React.forwardRef(
    (
      {
        data,
        itemContent,
      }: {
        data: string[];
        itemContent: (index: number, item: string) => React.ReactNode;
      },
      _ref
    ) => (
      <div data-testid="virtuoso-scroller">
        {data.slice(0, 20).map((item, idx) => (
          <div key={idx}>{itemContent(idx, item)}</div>
        ))}
      </div>
    )
  ),
  VirtuosoHandle: undefined,
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const completedJob: TranslationJob = {
  jobId: 'job-1',
  userId: 'user-1',
  fileName: 'doc.txt',
  fileSize: 1024,
  contentType: 'text/plain',
  status: 'COMPLETED',
  targetLanguage: 'es',
  totalChunks: 5,
  completedChunks: 5,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function renderAt(jobId = 'job-1') {
  return render(
    <MemoryRouter initialEntries={[`/translation/${jobId}/compare`]}>
      <Routes>
        <Route path="/translation/:jobId/compare" element={<TranslationCompare />} />
        <Route path="/dashboard" element={<div>Dashboard</div>} />
        <Route path="/translation/:jobId" element={<div>Detail</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('TranslationCompare page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNavigate.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows 404 message when getJobStatus returns 404', async () => {
    vi.mocked(translationService.getJobStatus).mockRejectedValue(
      new TranslationServiceError('not found', 404)
    );

    renderAt();

    await waitFor(() => {
      expect(screen.getByText('Translation job not found')).toBeInTheDocument();
    });
  });

  it('shows 403 message and navigates to dashboard after timeout', async () => {
    vi.useFakeTimers();
    vi.mocked(translationService.getJobStatus).mockRejectedValue(
      new TranslationServiceError('forbidden', 403)
    );

    renderAt();

    await vi.waitFor(() => {
      expect(
        screen.getByText('You do not have permission to view this translation')
      ).toBeInTheDocument();
    });

    // Advance the 3s timer — should trigger navigation to /dashboard.
    await vi.runOnlyPendingTimersAsync();
    vi.advanceTimersByTime(3000);
    await Promise.resolve();

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard');
    vi.useRealTimers();
  });

  it('cleans up the 403 navigation timer on unmount (no stale navigate)', async () => {
    vi.useFakeTimers();
    vi.mocked(translationService.getJobStatus).mockRejectedValue(
      new TranslationServiceError('forbidden', 403)
    );

    const { unmount } = renderAt();

    await vi.waitFor(() => {
      expect(
        screen.getByText('You do not have permission to view this translation')
      ).toBeInTheDocument();
    });

    unmount();
    vi.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(mockNavigate).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('shows generic message for other API errors', async () => {
    vi.mocked(translationService.getJobStatus).mockRejectedValue(
      new TranslationServiceError('server bork', 500)
    );

    renderAt();

    await waitFor(() => {
      expect(screen.getByText('server bork')).toBeInTheDocument();
    });
  });

  it('integrates with useTranslationJob and renders comparison after blob loads', async () => {
    vi.mocked(translationService.getJobStatus).mockResolvedValue(completedJob);
    // jsdom's Blob does not implement .text(); provide a polyfilled mock.
    const blob = new Blob(['Translated content here.\n\nSecond paragraph.'], {
      type: 'text/plain',
    });
    Object.defineProperty(blob, 'text', {
      value: () => Promise.resolve('Translated content here.\n\nSecond paragraph.'),
    });
    vi.mocked(translationService.downloadTranslation).mockResolvedValue(blob);

    renderAt();

    await waitFor(() => {
      expect(screen.getByText('Translation Comparison')).toBeInTheDocument();
    });

    // SideBySideViewer mounted with stubbed Virtuoso → both scrollers present.
    await waitFor(() => {
      expect(screen.getAllByTestId('virtuoso-scroller')).toHaveLength(2);
    });

    expect(translationService.getJobStatus).toHaveBeenCalledWith('job-1');
    expect(translationService.downloadTranslation).toHaveBeenCalledWith('job-1');
  });

  it('refuses to load translated blob if it exceeds the size cap', async () => {
    vi.mocked(translationService.getJobStatus).mockResolvedValue(completedJob);

    // Build an oversized blob — we don't actually allocate 60MB; we override
    // the `size` getter so the size check fires without big allocations.
    const giantBlob = new Blob(['x'], { type: 'text/plain' });
    Object.defineProperty(giantBlob, 'size', { value: 60 * 1024 * 1024 });
    vi.mocked(translationService.downloadTranslation).mockResolvedValue(giantBlob);

    renderAt();

    await waitFor(() => {
      expect(screen.getByText(/too large to preview/i)).toBeInTheDocument();
    });
  });

  it('shows a "not yet completed" message when job is still in progress', async () => {
    vi.mocked(translationService.getJobStatus).mockResolvedValue({
      ...completedJob,
      status: 'IN_PROGRESS',
    });

    renderAt();

    await waitFor(() => {
      expect(screen.getByText(/translation is not yet completed/i)).toBeInTheDocument();
    });

    // We should NOT have tried to download a blob for an in-progress job.
    expect(translationService.downloadTranslation).not.toHaveBeenCalled();
  });
});
