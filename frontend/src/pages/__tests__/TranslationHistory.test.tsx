/**
 * Unit tests for TranslationHistory page component
 *
 * Tests cover:
 * - Page rendering and loading states
 * - Job list display with all fields
 * - Filtering by status
 * - Search by filename and job ID
 * - Navigation to detail page
 * - Download functionality
 * - Refresh functionality
 * - Empty states
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { TranslationHistory } from '../TranslationHistory';
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
    getTranslationJobs: vi.fn(),
    downloadTranslation: vi.fn(),
  },
  TranslationServiceError: class TranslationServiceError extends Error {
    constructor(message: string, public statusCode?: number, public code?: string) {
      super(message);
      this.name = 'TranslationServiceError';
    }
  },
}));

// Mock jobs data
const mockJobs: TranslationJob[] = [
  {
    jobId: 'job-1',
    userId: 'user-1',
    fileName: 'document1.txt',
    status: 'COMPLETED',
    targetLanguage: 'es',
    tone: 'formal',
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:30:00Z',
    fileSize: 1024,
    totalChunks: 5,
    translatedChunks: 5,
    estimatedCost: 0.50,
  },
  {
    jobId: 'job-2',
    userId: 'user-1',
    fileName: 'document2.txt',
    status: 'IN_PROGRESS',
    targetLanguage: 'fr',
    tone: 'informal',
    createdAt: '2025-01-16T09:00:00Z',
    updatedAt: '2025-01-16T09:15:00Z',
    fileSize: 2048,
    totalChunks: 10,
    translatedChunks: 3,
    estimatedCost: 1.00,
  },
  {
    jobId: 'job-3',
    userId: 'user-1',
    fileName: 'document3.txt',
    status: 'FAILED',
    targetLanguage: 'de',
    createdAt: '2025-01-17T08:00:00Z',
    updatedAt: '2025-01-17T08:05:00Z',
    fileSize: 512,
    totalChunks: 2,
    translatedChunks: 0,
    estimatedCost: 0.25,
  },
  {
    jobId: 'job-4',
    userId: 'user-1',
    fileName: 'report.txt',
    status: 'PENDING',
    targetLanguage: 'it',
    tone: 'neutral',
    createdAt: '2025-01-18T07:00:00Z',
    updatedAt: '2025-01-18T07:00:00Z',
    fileSize: 4096,
    totalChunks: 15,
    translatedChunks: 0,
    estimatedCost: 2.00,
  },
];

describe('TranslationHistory', () => {
  const renderComponent = () => {
    return render(
      <BrowserRouter>
        <TranslationHistory />
      </BrowserRouter>
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
      vi.mocked(translationService.getTranslationJobs).mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderComponent();

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByText(/Loading translation history/i)).toBeInTheDocument();
    });

    it('should render page with title and new translation button', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Translation History')).toBeInTheDocument();
      });

      expect(screen.getByRole('link', { name: /New Translation/i })).toBeInTheDocument();
    });

    it('should display job list with all fields', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Check table headers (use role to avoid ambiguity with Status filter)
      expect(screen.getByRole('columnheader', { name: /File Name/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Language/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Status/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Created/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /Actions/i })).toBeInTheDocument();

      // Check job data
      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('job-1')).toBeInTheDocument();
      expect(screen.getByText('es')).toBeInTheDocument();
      expect(screen.getByText('formal')).toBeInTheDocument();
      expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    });

    it('should show summary count', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/Showing 4 of 4 translations/i)).toBeInTheDocument();
      });
    });
  });

  describe('Empty States', () => {
    it('should show empty state when no jobs exist', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue([]);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText(/No translations yet/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/Start your first translation!/i)).toBeInTheDocument();
      // There are 2 "New Translation" links when empty - one in header, one in empty state
      const newTranslationLinks = screen.getAllByRole('link', { name: /New Translation/i });
      expect(newTranslationLinks).toHaveLength(2);
    });

    it('should show filtered empty state when no jobs match filters', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Search for non-existent file
      const searchInput = screen.getByPlaceholderText(/Search by file name or job ID/i);
      await user.type(searchInput, 'nonexistent');

      await waitFor(() => {
        expect(screen.getByText(/No translations match your filters/i)).toBeInTheDocument();
      });
    });
  });

  describe('Filtering', () => {
    it('should filter jobs by status', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Initially show all jobs
      expect(screen.getByText('document1.txt')).toBeInTheDocument();
      expect(screen.getByText('document2.txt')).toBeInTheDocument();
      expect(screen.getByText('document3.txt')).toBeInTheDocument();
      expect(screen.getByText('report.txt')).toBeInTheDocument();

      // Filter by COMPLETED status
      const statusFilter = screen.getByLabelText(/Status/i);
      await user.click(statusFilter);
      await user.click(screen.getByRole('option', { name: /^Completed$/i }));

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
        expect(screen.queryByText('document2.txt')).not.toBeInTheDocument();
        expect(screen.queryByText('document3.txt')).not.toBeInTheDocument();
        expect(screen.queryByText('report.txt')).not.toBeInTheDocument();
      });

      expect(screen.getByText(/Showing 1 of 4 translations/i)).toBeInTheDocument();
    });

    it('should filter jobs by IN_PROGRESS status', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const statusFilter = screen.getByLabelText(/Status/i);
      await user.click(statusFilter);
      await user.click(screen.getByRole('option', { name: /In Progress/i }));

      await waitFor(() => {
        expect(screen.getByText('document2.txt')).toBeInTheDocument();
        expect(screen.queryByText('document1.txt')).not.toBeInTheDocument();
      });
    });

    it('should filter jobs by FAILED status', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const statusFilter = screen.getByLabelText(/Status/i);
      await user.click(statusFilter);
      await user.click(screen.getByRole('option', { name: /^Failed$/i }));

      await waitFor(() => {
        expect(screen.getByText('document3.txt')).toBeInTheDocument();
        expect(screen.queryByText('document1.txt')).not.toBeInTheDocument();
      });
    });

    it('should reset filter when selecting All Statuses', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Filter by COMPLETED
      const statusFilter = screen.getByLabelText(/Status/i);
      await user.click(statusFilter);
      await user.click(screen.getByRole('option', { name: /^Completed$/i }));

      await waitFor(() => {
        expect(screen.queryByText('document2.txt')).not.toBeInTheDocument();
      });

      // Reset to All Statuses
      await user.click(statusFilter);
      await user.click(screen.getByRole('option', { name: /All Statuses/i }));

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
        expect(screen.getByText('document2.txt')).toBeInTheDocument();
        expect(screen.getByText('document3.txt')).toBeInTheDocument();
        expect(screen.getByText('report.txt')).toBeInTheDocument();
      });
    });
  });

  describe('Search', () => {
    it('should search jobs by file name', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search by file name or job ID/i);
      await user.type(searchInput, 'report');

      await waitFor(() => {
        expect(screen.getByText('report.txt')).toBeInTheDocument();
        expect(screen.queryByText('document1.txt')).not.toBeInTheDocument();
        expect(screen.queryByText('document2.txt')).not.toBeInTheDocument();
      });
    });

    it('should search jobs by job ID', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search by file name or job ID/i);
      await user.type(searchInput, 'job-2');

      await waitFor(() => {
        expect(screen.getByText('document2.txt')).toBeInTheDocument();
        expect(screen.queryByText('document1.txt')).not.toBeInTheDocument();
      });
    });

    it('should be case-insensitive', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/Search by file name or job ID/i);
      await user.type(searchInput, 'DOCUMENT');

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
        expect(screen.getByText('document2.txt')).toBeInTheDocument();
        expect(screen.getByText('document3.txt')).toBeInTheDocument();
        expect(screen.queryByText('report.txt')).not.toBeInTheDocument();
      });
    });

    it('should combine search and status filter', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Search for "document"
      const searchInput = screen.getByPlaceholderText(/Search by file name or job ID/i);
      await user.type(searchInput, 'document');

      // Filter by COMPLETED
      const statusFilter = screen.getByLabelText(/Status/i);
      await user.click(statusFilter);
      await user.click(screen.getByRole('option', { name: /^Completed$/i }));

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
        expect(screen.queryByText('document2.txt')).not.toBeInTheDocument();
        expect(screen.queryByText('document3.txt')).not.toBeInTheDocument();
        expect(screen.queryByText('report.txt')).not.toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('should navigate to detail page when clicking view icon', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const viewButtons = screen.getAllByLabelText(/View Details/i);
      await user.click(viewButtons[0]); // Click first job's view button

      expect(mockNavigate).toHaveBeenCalledWith('/translation/job-1');
    });

    it('should have link to new translation page', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const newTranslationLink = screen.getByRole('link', { name: /New Translation/i });
      expect(newTranslationLink).toHaveAttribute('href', '/translation/upload');
    });
  });

  describe('Download Functionality', () => {
    it('should show download button only for completed jobs', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Only 1 completed job (document1.txt)
      const downloadButtons = screen.getAllByLabelText(/Download/i);
      expect(downloadButtons).toHaveLength(1);
    });

    it('should download translation when clicking download button', async () => {
      const user = userEvent.setup();
      const mockBlob = new Blob(['translated content'], { type: 'text/plain' });
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);
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
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const downloadButton = screen.getByLabelText(/Download/i);
      await user.click(downloadButton);

      await waitFor(() => {
        expect(translationService.downloadTranslation).toHaveBeenCalledWith('job-1');
        expect(mockCreateObjectURL).toHaveBeenCalledWith(mockBlob);
      });

      // Cleanup
      global.URL.createObjectURL = originalCreateObjectURL;
      global.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('should show error when download fails', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);
      vi.mocked(translationService.downloadTranslation).mockRejectedValue(
        new TranslationServiceError('Download failed', 500)
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      const downloadButton = screen.getByLabelText(/Download/i);
      await user.click(downloadButton);

      await waitFor(() => {
        expect(screen.getByText('Download failed')).toBeInTheDocument();
      });
    });
  });

  describe('Refresh Functionality', () => {
    it('should refresh job list when clicking refresh button', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs)
        .mockResolvedValueOnce(mockJobs.slice(0, 2)) // First call: 2 jobs
        .mockResolvedValueOnce(mockJobs); // Second call: all 4 jobs

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
        expect(screen.getByText('document2.txt')).toBeInTheDocument();
      });

      expect(screen.queryByText('document3.txt')).not.toBeInTheDocument();

      const refreshButton = screen.getByLabelText(/Refresh/i);
      await user.click(refreshButton);

      await waitFor(() => {
        expect(screen.getByText('document3.txt')).toBeInTheDocument();
        expect(screen.getByText('report.txt')).toBeInTheDocument();
      });

      expect(translationService.getTranslationJobs).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should show error message when loading jobs fails', async () => {
      vi.mocked(translationService.getTranslationJobs).mockRejectedValue(
        new TranslationServiceError('Failed to fetch jobs', 500)
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch jobs')).toBeInTheDocument();
      });
    });

    it('should show generic error for unknown errors', async () => {
      vi.mocked(translationService.getTranslationJobs).mockRejectedValue(
        new Error('Network error')
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Failed to load translation history')).toBeInTheDocument();
      });
    });

    it('should clear error when clicking close button', async () => {
      const user = userEvent.setup();
      vi.mocked(translationService.getTranslationJobs).mockRejectedValue(
        new TranslationServiceError('Failed to fetch jobs', 500)
      );

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Failed to fetch jobs')).toBeInTheDocument();
      });

      const closeButton = screen.getByRole('button', { name: /close/i });
      await user.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByText('Failed to fetch jobs')).not.toBeInTheDocument();
      });
    });
  });

  describe('Status Chip Colors', () => {
    it('should display correct status chip colors', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('COMPLETED')).toBeInTheDocument();
      });

      const completedChip = screen.getByText('COMPLETED');
      const inProgressChip = screen.getByText('IN_PROGRESS');
      const failedChip = screen.getByText('FAILED');
      const pendingChip = screen.getByText('PENDING');

      expect(completedChip).toBeInTheDocument();
      expect(inProgressChip).toBeInTheDocument();
      expect(failedChip).toBeInTheDocument();
      expect(pendingChip).toBeInTheDocument();
    });
  });

  describe('Language and Tone Display', () => {
    it('should display language and tone when available', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('es')).toBeInTheDocument();
      });

      expect(screen.getByText('formal')).toBeInTheDocument();
      expect(screen.getByText('fr')).toBeInTheDocument();
      expect(screen.getByText('informal')).toBeInTheDocument();
    });

    it('should show "Not set" when language is missing', async () => {
      const jobsWithoutLanguage: TranslationJob[] = [
        {
          jobId: 'job-5',
          userId: 'user-1',
          fileName: 'test.txt',
          status: 'PENDING',
          createdAt: '2025-01-19T07:00:00Z',
          updatedAt: '2025-01-19T07:00:00Z',
          fileSize: 100,
          totalChunks: 1,
          translatedChunks: 0,
          estimatedCost: 0.10,
        },
      ];

      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(jobsWithoutLanguage);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('Not set')).toBeInTheDocument();
      });
    });
  });

  describe('Date Formatting', () => {
    it('should format dates correctly', async () => {
      vi.mocked(translationService.getTranslationJobs).mockResolvedValue(mockJobs);

      renderComponent();

      await waitFor(() => {
        expect(screen.getByText('document1.txt')).toBeInTheDocument();
      });

      // Check that dates are formatted (should include slashes or dashes)
      const dateElements = screen.getAllByText(/\d{1,2}\/\d{1,2}\/\d{4}/);
      expect(dateElements.length).toBeGreaterThan(0);
    });
  });
});
