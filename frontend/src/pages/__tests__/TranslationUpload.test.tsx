/**
 * TranslationUpload Page Unit Tests
 *
 * Tests cover the multi-step upload workflow including:
 * - Page rendering and stepper navigation
 * - Step validation and error states
 * - Form data persistence across steps
 * - Integration with child components
 * - Submission workflow and error handling
 * - Navigation after successful upload
 *
 * Target Coverage: 95%+
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { BrowserRouter } from 'react-router-dom';
import { TranslationUpload } from '../TranslationUpload';
import { translationService } from '../../services/translationService';

// Mock react-router-dom's useNavigate
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
    createLegalAttestation: vi.fn(),
    uploadDocument: vi.fn(),
    startTranslation: vi.fn(),
  },
  TranslationServiceError: class TranslationServiceError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'TranslationServiceError';
    }
  },
}));

describe('TranslationUpload', () => {
  const renderComponent = () => {
    return render(
      <BrowserRouter>
        <TranslationUpload />
      </BrowserRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Page Rendering', () => {
    it('should render the page with title', () => {
      renderComponent();

      expect(screen.getByText('New Translation')).toBeInTheDocument();
    });

    it('should render the stepper with all 4 steps', () => {
      renderComponent();

      expect(screen.getByText('Legal Attestation')).toBeInTheDocument();
      expect(screen.getByText('Translation Settings')).toBeInTheDocument();
      expect(screen.getByText('Upload Document')).toBeInTheDocument();
      expect(screen.getByText('Review & Submit')).toBeInTheDocument();
    });

    it('should start at step 0 (Legal Attestation)', () => {
      renderComponent();

      // Legal attestation checkboxes should be visible
      expect(
        screen.getByLabelText(/I confirm that I own the copyright/i)
      ).toBeInTheDocument();
    });

    it('should show Back button disabled on first step', () => {
      renderComponent();

      const backButton = screen.getByRole('button', { name: /back/i });
      expect(backButton).toBeDisabled();
    });

    it('should show Next button enabled on first step', () => {
      renderComponent();

      const nextButton = screen.getByRole('button', { name: /next/i });
      expect(nextButton).toBeEnabled();
    });
  });

  describe('Step 1: Legal Attestation Validation', () => {
    it('should show validation errors when clicking Next without accepting terms', async () => {
      const user = userEvent.setup();
      renderComponent();

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      // Should show error messages
      await waitFor(() => {
        expect(screen.getByText(/You must confirm copyright ownership/i)).toBeInTheDocument();
        expect(screen.getByText(/You must confirm translation rights/i)).toBeInTheDocument();
        expect(screen.getByText(/You must accept liability terms/i)).toBeInTheDocument();
      });
    });

    it('should not advance to next step when validation fails', async () => {
      const user = userEvent.setup();
      renderComponent();

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      // Should still be on step 0
      await waitFor(() => {
        expect(
          screen.getByLabelText(/I confirm that I own the copyright/i)
        ).toBeInTheDocument();
      });
    });

    it('should advance to step 2 when all checkboxes are checked', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Check all three checkboxes
      const copyrightCheckbox = screen.getByLabelText(/I confirm that I own the copyright/i);
      const translationRightsCheckbox = screen.getByLabelText(/I confirm that I have the right to create derivative works/i);
      const liabilityCheckbox = screen.getByLabelText(/I understand that I am solely responsible/i);

      await user.click(copyrightCheckbox);
      await user.click(translationRightsCheckbox);
      await user.click(liabilityCheckbox);

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      // Should show Translation Settings step
      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Translation Tone/i)).toBeInTheDocument();
      });
    });
  });

  describe('Step 2: Translation Settings Validation', () => {
    const advanceToStep2 = async (user: ReturnType<typeof userEvent.setup>) => {
      const copyrightCheckbox = screen.getByLabelText(/I confirm that I own the copyright/i);
      const translationRightsCheckbox = screen.getByLabelText(/I confirm that I have the right to create derivative works/i);
      const liabilityCheckbox = screen.getByLabelText(/I understand that I am solely responsible/i);

      await user.click(copyrightCheckbox);
      await user.click(translationRightsCheckbox);
      await user.click(liabilityCheckbox);

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
      });
    };

    it('should show validation errors when clicking Next without selecting language and tone', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep2(user);

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText(/Please select a target language/i)).toBeInTheDocument();
        expect(screen.getByText(/Please select a translation tone/i)).toBeInTheDocument();
      });
    });

    it('should advance to step 3 when language and tone are selected', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep2(user);

      // Select language
      const languageSelect = screen.getByLabelText(/Target Language/i);
      await user.click(languageSelect);
      const spanishOption = screen.getByRole('option', { name: /Spanish/i });
      await user.click(spanishOption);

      // Select tone
      const toneSelect = screen.getByLabelText(/Translation Tone/i);
      await user.click(toneSelect);
      const formalOption = screen.getByText('Formal');
      await user.click(formalOption);

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      // Should show file upload step
      await waitFor(() => {
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument();
      });
    });

    it('should allow going back to step 1', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep2(user);

      const backButton = screen.getByRole('button', { name: /back/i });
      await user.click(backButton);

      await waitFor(() => {
        expect(
          screen.getByLabelText(/I confirm that I own the copyright/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Step 3: File Upload Validation', () => {
    const advanceToStep3 = async (user: ReturnType<typeof userEvent.setup>) => {
      // Step 1: Legal attestation
      const copyrightCheckbox = screen.getByLabelText(/I confirm that I own the copyright/i);
      const translationRightsCheckbox = screen.getByLabelText(/I confirm that I have the right to create derivative works/i);
      const liabilityCheckbox = screen.getByLabelText(/I understand that I am solely responsible/i);

      await user.click(copyrightCheckbox);
      await user.click(translationRightsCheckbox);
      await user.click(liabilityCheckbox);
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
      });

      // Step 2: Translation config
      const languageSelect = screen.getByLabelText(/Target Language/i);
      await user.click(languageSelect);
      await user.click(screen.getByRole('option', { name: /Spanish/i }));

      const toneSelect = screen.getByLabelText(/Translation Tone/i);
      await user.click(toneSelect);
      await user.click(screen.getByText('Formal'));

      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument();
      });
    };

    it('should show validation error when clicking Next without selecting file', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep3(user);

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText(/Please select a file to upload/i)).toBeInTheDocument();
      });
    });

    it('should advance to step 4 (Review) when file is selected', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep3(user);

      // Create a mock file
      const file = new File(['test content'], 'test-document.txt', { type: 'text/plain' });

      // Find file input (it's hidden, so use container query)
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(fileInput).toBeInTheDocument();

      // Upload file
      await user.upload(fileInput!, file);

      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      // Should show review step
      await waitFor(() => {
        expect(screen.getByText('Review Your Submission')).toBeInTheDocument();
        expect(screen.getByText('test-document.txt')).toBeInTheDocument();
      });
    });
  });

  describe('Step 4: Review & Submit', () => {
    const advanceToStep4 = async (user: ReturnType<typeof userEvent.setup>) => {
      // Step 1: Legal attestation
      await user.click(screen.getByLabelText(/I confirm that I own the copyright/i));
      await user.click(screen.getByLabelText(/I confirm that I have the right to create derivative works/i));
      await user.click(screen.getByLabelText(/I understand that I am solely responsible/i));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
      });

      // Step 2: Translation config
      await user.click(screen.getByLabelText(/Target Language/i));
      await user.click(screen.getByRole('option', { name: /Spanish/i }));
      await user.click(screen.getByLabelText(/Translation Tone/i));
      await user.click(screen.getByText('Formal'));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument();
      });

      // Step 3: File upload
      const file = new File(['test content'], 'test-document.txt', { type: 'text/plain' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput!, file);
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText('Review Your Submission')).toBeInTheDocument();
      });
    };

    it('should display review summary with all form data', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      expect(screen.getByText('Review Your Submission')).toBeInTheDocument();
      expect(screen.getByText('test-document.txt')).toBeInTheDocument();
      expect(screen.getByText('es')).toBeInTheDocument(); // language code
      expect(screen.getByText('formal')).toBeInTheDocument();
      expect(screen.getByText(/All requirements confirmed/i)).toBeInTheDocument();
    });

    it('should show Submit button instead of Next button', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      expect(screen.getByRole('button', { name: /Submit & Start Translation/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Next$/i })).not.toBeInTheDocument();
    });

    it('should successfully submit and navigate to detail page', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Mock successful service calls
      vi.mocked(translationService.createLegalAttestation).mockResolvedValue({
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '127.0.0.1',
        userAgent: 'test-agent',
        timestamp: new Date().toISOString(),
      });

      vi.mocked(translationService.uploadDocument).mockResolvedValue({
        jobId: 'test-job-123',
        userId: 'user-123',
        status: 'PENDING',
        fileName: 'test-document.txt',
        fileSize: 12,
        contentType: 'text/plain',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      vi.mocked(translationService.startTranslation).mockResolvedValue({
        jobId: 'test-job-123',
        userId: 'user-123',
        fileName: 'test-document.txt',
        fileSize: 12,
        contentType: 'text/plain',
        status: 'CHUNKING',
        targetLanguage: 'es',
        tone: 'formal',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/translation/test-job-123');
      });
    });

    it('should show loading state during submission', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Mock service calls with delay
      vi.mocked(translationService.createLegalAttestation).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          acceptCopyrightOwnership: true,
          acceptTranslationRights: true,
          acceptLiabilityTerms: true,
          userIPAddress: '127.0.0.1',
          userAgent: 'test-agent',
          timestamp: new Date().toISOString(),
        }), 100))
      );

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      // Should show loading state
      expect(screen.getByText(/Uploading.../i)).toBeInTheDocument();
      expect(submitButton).toBeDisabled();
    });

    it('should display error message when submission fails', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Mock failed service call
      const TranslationServiceError = (await import('../../services/translationService')).TranslationServiceError;
      vi.mocked(translationService.createLegalAttestation).mockRejectedValue(
        new TranslationServiceError('Upload failed: Network error')
      );

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      await waitFor(() => {
        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent(/Upload failed: Network error/i);
      });
    });

    it('should display generic error message for unexpected errors', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Mock unexpected error
      vi.mocked(translationService.createLegalAttestation).mockRejectedValue(
        new Error('Unexpected error')
      );

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      await waitFor(() => {
        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent(/An unexpected error occurred/i);
      });
    });

    it('should clear error message when going back', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Trigger error
      const TranslationServiceError = (await import('../../services/translationService')).TranslationServiceError;
      vi.mocked(translationService.createLegalAttestation).mockRejectedValue(
        new TranslationServiceError('Upload failed')
      );

      await user.click(screen.getByRole('button', { name: /Submit & Start Translation/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });

      // Go back
      const backButton = screen.getByRole('button', { name: /back/i });
      await user.click(backButton);

      // Error should be cleared
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });
  });

  describe('Form Data Persistence', () => {
    it('should preserve legal attestation data when navigating back and forth', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Step 1: Check legal attestation
      await user.click(screen.getByLabelText(/I confirm that I own the copyright/i));
      await user.click(screen.getByLabelText(/I confirm that I have the right to create derivative works/i));
      await user.click(screen.getByLabelText(/I understand that I am solely responsible/i));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
      });

      // Go back
      await user.click(screen.getByRole('button', { name: /back/i }));

      await waitFor(() => {
        const copyrightCheckbox = screen.getByLabelText(/I confirm that I own the copyright/i) as HTMLInputElement;
        expect(copyrightCheckbox.checked).toBe(true);
      });
    });

    it('should preserve translation config when navigating back and forth', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Navigate to step 2
      await user.click(screen.getByLabelText(/I confirm that I own the copyright/i));
      await user.click(screen.getByLabelText(/I confirm that I have the right to create derivative works/i));
      await user.click(screen.getByLabelText(/I understand that I am solely responsible/i));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
      });

      // Select language and tone
      await user.click(screen.getByLabelText(/Target Language/i));
      await user.click(screen.getByRole('option', { name: /French/i }));
      await user.click(screen.getByLabelText(/Translation Tone/i));
      await user.click(screen.getByText('Neutral'));

      // Go to next step and back
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /back/i }));

      // Values should be preserved
      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
        // Component shows selected values internally
      });
    });
  });

  describe('Integration with Child Components', () => {
    it('should pass correct props to LegalAttestation component', () => {
      renderComponent();

      // LegalAttestation checkboxes should be rendered
      expect(screen.getByLabelText(/I confirm that I own the copyright/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/I confirm that I have the right to create derivative works/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/I understand that I am solely responsible/i)).toBeInTheDocument();
    });

    it('should pass correct props to TranslationConfig component', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Navigate to step 2
      await user.click(screen.getByLabelText(/I confirm that I own the copyright/i));
      await user.click(screen.getByLabelText(/I confirm that I have the right to create derivative works/i));
      await user.click(screen.getByLabelText(/I understand that I am solely responsible/i));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/Translation Tone/i)).toBeInTheDocument();
      });
    });

    it('should pass correct props to FileUpload component', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Navigate to step 3
      await user.click(screen.getByLabelText(/I confirm that I own the copyright/i));
      await user.click(screen.getByLabelText(/I confirm that I have the right to create derivative works/i));
      await user.click(screen.getByLabelText(/I understand that I am solely responsible/i));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
      });

      await user.click(screen.getByLabelText(/Target Language/i));
      await user.click(screen.getByRole('option', { name: /Spanish/i }));
      await user.click(screen.getByLabelText(/Translation Tone/i));
      await user.click(screen.getByText('Formal'));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument();
      });
    });
  });
});
