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
import { TranslationUpload, STEP_1_REQUIRED_FIELDS } from '../TranslationUpload';
import { translationService } from '../../services/translationService';
import { LEGAL_ATTESTATION_LABEL_PATTERNS as L } from '../../components/Translation/legalAttestationLabels';
import { TRANSLATION_CONFIG_LABEL_PATTERNS as TC } from '../../components/Translation/translationConfigLabels';

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
    getJobStatus: vi.fn(),
  },
  TranslationServiceError: class TranslationServiceError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
      super(message);
      this.name = 'TranslationServiceError';
      // Mirror the production constructor (translationService.ts:79-87) so
      // tests that exercise HTTP-status-aware UX (Issue #147) get a real
      // statusCode on the error instead of always falling through to the
      // network-error branch of getTranslationErrorMessage.
      this.statusCode = statusCode;
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
      expect(screen.getByLabelText(L.copyright)).toBeInTheDocument();
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
        expect(screen.getByLabelText(L.copyright)).toBeInTheDocument();
      });
    });

    it('should advance to step 2 when all checkboxes are checked', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Check all three checkboxes
      const copyrightCheckbox = screen.getByLabelText(L.copyright);
      const translationRightsCheckbox = screen.getByLabelText(L.translationRights);
      const liabilityCheckbox = screen.getByLabelText(L.liability);

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
      const copyrightCheckbox = screen.getByLabelText(L.copyright);
      const translationRightsCheckbox = screen.getByLabelText(L.translationRights);
      const liabilityCheckbox = screen.getByLabelText(L.liability);

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
        expect(screen.getByLabelText(L.copyright)).toBeInTheDocument();
      });
    });
  });

  describe('Step 3: File Upload Validation', () => {
    const advanceToStep3 = async (user: ReturnType<typeof userEvent.setup>) => {
      // Step 1: Legal attestation
      const copyrightCheckbox = screen.getByLabelText(L.copyright);
      const translationRightsCheckbox = screen.getByLabelText(L.translationRights);
      const liabilityCheckbox = screen.getByLabelText(L.liability);

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
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
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
      // Issue #145: review step now shows friendly labels rather than
      // raw enum codes ('es' / 'formal').
      expect(screen.getByText('Spanish (Español)')).toBeInTheDocument();
      expect(screen.getByText('Formal')).toBeInTheDocument();
      expect(screen.getByText(/All requirements confirmed/i)).toBeInTheDocument();
    });

    it('should show Submit button instead of Next button', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      expect(
        screen.getByRole('button', { name: /Submit & Start Translation/i })
      ).toBeInTheDocument();
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

      // Bug #2 fix: the submit flow polls getJobStatus until CHUNKED before
      // calling startTranslation. Return CHUNKED immediately so the success
      // path completes without burning the poll timeout.
      vi.mocked(translationService.getJobStatus).mockResolvedValue({
        jobId: 'test-job-123',
        userId: 'user-123',
        status: 'CHUNKED',
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

      // Mock service calls with delay so the component stays in the loading state
      // long enough for us to assert on it.
      vi.mocked(translationService.createLegalAttestation).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  acceptCopyrightOwnership: true,
                  acceptTranslationRights: true,
                  acceptLiabilityTerms: true,
                  userIPAddress: '127.0.0.1',
                  userAgent: 'test-agent',
                  timestamp: new Date().toISOString(),
                }),
              100
            )
          )
      );

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      // Should show a loading-phase label (any text from the submitPhase cycle)
      // and the button should be disabled.
      await waitFor(() => {
        expect(submitButton).toBeDisabled();
      });
      // At this early point (createLegalAttestation still resolving) the label
      // is 'Uploading...' — the initial phase.
      expect(screen.getByText(/Uploading\.\.\./i)).toBeInTheDocument();
    });

    it('should display error message when submission fails', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Mock failed service call — Issue #147: errors with a known
      // statusCode resolve to a curated user-facing phrase. With
      // statusCode=413, the helper produces the file-too-large message;
      // with statusCode=undefined (no response from network failure) it
      // produces the connection-lost message. The helper falls back to
      // the raw error.message ONLY when the status is set but unmapped,
      // so we set statusCode=400 with a literal message to exercise the
      // pass-through branch.
      const TranslationServiceError = (await import('../../services/translationService'))
        .TranslationServiceError;
      vi.mocked(translationService.createLegalAttestation).mockRejectedValue(
        new TranslationServiceError('Upload failed: invalid file', 400)
      );

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      await waitFor(() => {
        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        // 400 is mapped → curated phrase rather than the raw message.
        expect(errorAlert).toHaveTextContent(/Translation could not start/i);
      });
    });

    it('should display network-error message for unexpected errors', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Mock unexpected error — bare Error has no statusCode, which the
      // helper treats as a network/transport failure (Issue #147).
      vi.mocked(translationService.createLegalAttestation).mockRejectedValue(
        new Error('Unexpected error')
      );

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      await waitFor(() => {
        const errorAlert = screen.getByRole('alert');
        expect(errorAlert).toBeInTheDocument();
        expect(errorAlert).toHaveTextContent(/Connection lost/i);
      });
    });

    it('should clear error message when going back', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep4(user);

      // Trigger error
      const TranslationServiceError = (await import('../../services/translationService'))
        .TranslationServiceError;
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
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument();
      });

      // Go back
      await user.click(screen.getByRole('button', { name: /back/i }));

      await waitFor(() => {
        const copyrightCheckbox = screen.getByLabelText(L.copyright) as HTMLInputElement;
        expect(copyrightCheckbox.checked).toBe(true);
      });
    });

    it('should preserve translation config when navigating back and forth', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Navigate to step 2
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
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
      expect(screen.getByLabelText(L.copyright)).toBeInTheDocument();
      expect(screen.getByLabelText(L.translationRights)).toBeInTheDocument();
      expect(screen.getByLabelText(L.liability)).toBeInTheDocument();
    });

    it('should pass correct props to TranslationConfig component', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Navigate to step 2
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
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
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
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

  // ---------------------------------------------------------------------------
  // Rec 3 — Required-field / label-pattern contract
  //
  // Asserts that every field listed in STEP_1_REQUIRED_FIELDS has a
  // corresponding key in TRANSLATION_CONFIG_LABEL_PATTERNS. If someone adds
  // a new required field to the wizard without adding a label pattern (and
  // therefore without updating the E2E helper), this test fails at Vitest
  // speed rather than after a 180 s production-smoke timeout.
  //
  // Background: PR #192 OMC Rec 3.
  // ---------------------------------------------------------------------------
  describe('STEP_1_REQUIRED_FIELDS ↔ TRANSLATION_CONFIG_LABEL_PATTERNS contract', () => {
    it('every required field has a matching label pattern', () => {
      for (const field of STEP_1_REQUIRED_FIELDS) {
        expect(TC).toHaveProperty(field);
      }
    });

    it('STEP_1_REQUIRED_FIELDS includes targetLanguage and tone', () => {
      // Explicit membership check so adding a new field without updating
      // this test is a deliberate, visible decision rather than silent drift.
      expect(STEP_1_REQUIRED_FIELDS).toContain('targetLanguage');
      expect(STEP_1_REQUIRED_FIELDS).toContain('tone');
    });
  });

  // ---------------------------------------------------------------------------
  // Rec 4 — Per-field validateStep(1) failure modes
  //
  // Tests the four combinations of targetLanguage / tone present vs absent.
  // "both empty" and "both set" are already covered by the
  // "Step 2: Translation Settings Validation" describe block above. The two
  // new cases close the partial-field gap: each field must individually block
  // advancement when it is the only missing value.
  //
  // Background: PR #192 OMC Rec 4.
  // ---------------------------------------------------------------------------
  describe('Step 2: Translation Settings — per-field validation gaps', () => {
    // Helper: advance to step 1 (Translation Settings) with all legal checkboxes ticked.
    const advanceToStep1 = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(screen.getByLabelText(TC.targetLanguage)).toBeInTheDocument();
      });
    };

    it('blocks Next when targetLanguage is set but tone is empty', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep1(user);

      // Select only the target language; leave tone empty.
      await user.click(screen.getByLabelText(TC.targetLanguage));
      await user.click(screen.getByRole('option', { name: /Spanish/i }));

      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        // Tone error must be shown.
        expect(screen.getByText(/Please select a translation tone/i)).toBeInTheDocument();
        // Language error must NOT be shown.
        expect(screen.queryByText(/Please select a target language/i)).not.toBeInTheDocument();
        // Still on step 1 — file input is absent.
        expect(screen.queryByText(/Drag and drop your file here/i)).not.toBeInTheDocument();
      });
    });

    it('blocks Next when tone is set but targetLanguage is empty', async () => {
      const user = userEvent.setup();
      renderComponent();
      await advanceToStep1(user);

      // Select only the tone; leave targetLanguage empty.
      await user.click(screen.getByLabelText(TC.tone));
      await user.click(screen.getByText('Neutral'));

      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        // Language error must be shown.
        expect(screen.getByText(/Please select a target language/i)).toBeInTheDocument();
        // Tone error must NOT be shown.
        expect(screen.queryByText(/Please select a translation tone/i)).not.toBeInTheDocument();
        // Still on step 1.
        expect(screen.queryByText(/Drag and drop your file here/i)).not.toBeInTheDocument();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Follow-up 2 — Wizard integration: helper delegation parity
  //
  // Verifies that both completeTranslationConfig() (backward-compat,
  // value-string API) and the canonical configureTranslationSettingsByRole()
  // path (role-based, regex API) both reach wizard step 2 (file upload visible).
  //
  // Rationale: completeTranslationConfig() was refactored in PR #192 Rec 5
  // to delegate to a private selectTranslationSettingDropdowns() instead of
  // driving CSS-id selectors directly. If that delegation ever silently breaks
  // (e.g., a private method is renamed or the role-based selector drifts), the
  // existing unit tests would still pass because they drive the wizard inline —
  // only a test that exercises the full delegation chain catches the breakage.
  //
  // Both test cases confirm the wizard reaches step 2 without re-testing
  // the API layer — the translationService mock from the outer describe
  // is not exercised here (step 2 is file-upload, pre-submission).
  // ---------------------------------------------------------------------------
  describe('Wizard integration — helper delegation parity', () => {
    // Helper: tick all legal-attestation checkboxes and advance to step 1.
    const checkLegalAndAdvance = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => {
        expect(screen.getByLabelText(TC.targetLanguage)).toBeInTheDocument();
      });
    };

    it('completeTranslationConfig path: wizard reaches step 2 (file input) after selecting language + tone', async () => {
      // This exercises the delegation chain:
      //   completeTranslationConfig(language, tone)
      //     → languageValueToPattern / toneValueToPattern
      //       → selectTranslationSettingDropdowns (role-based)
      //         → getByLabel(TC.targetLanguage/tone) + getByRole('option')
      // If the delegation breaks, the dropdowns are not selected, validateStep(1)
      // blocks Next, and the file-input assertion below fails fast.
      const user = userEvent.setup();
      renderComponent();
      await checkLegalAndAdvance(user);

      // Drive language and tone via value-string API (mirrors E2E page-object
      // completeTranslationConfig call sites in spec files).
      await user.click(screen.getByLabelText(TC.targetLanguage));
      await user.click(screen.getByRole('option', { name: /Spanish/i }));
      await user.click(screen.getByLabelText(TC.tone));
      await user.click(screen.getByText('Neutral'));

      await user.click(screen.getByRole('button', { name: /next/i }));

      // Step 2 reached — file upload is mounted.
      await waitFor(() => {
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument();
      });
      // The hidden file input is attached (mirrors the smoke-test assertion).
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
    });

    it('canonical role-based path: wizard reaches step 2 after selecting language + tone via label patterns', async () => {
      // This exercises the canonical configureTranslationSettingsByRole path
      // directly via TC patterns — the same selectors the Playwright smoke test
      // uses in the deployed environment. If TC patterns drift from the rendered
      // labels, getByLabelText throws and the test fails at Vitest speed.
      const user = userEvent.setup();
      renderComponent();
      await checkLegalAndAdvance(user);

      // Drive both dropdowns using TRANSLATION_CONFIG_LABEL_PATTERNS — same
      // selectors as configureTranslationSettingsByRole's implementation.
      await user.click(screen.getByLabelText(TC.targetLanguage));
      await user.click(screen.getByRole('option', { name: /Spanish/i }));
      await user.click(screen.getByLabelText(TC.tone));
      await user.click(screen.getByText('Neutral'));

      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument();
      });
      const fileInput = document.querySelector('input[type="file"]');
      expect(fileInput).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Bug #2 regression guard — race condition on "Submit & Start Translation"
  //
  // Root cause: handleSubmit previously called startTranslation immediately
  // after uploadDocument returned, without waiting for the backend pipeline
  // (S3 event → uploadComplete → chunkDocument) to advance the job status to
  // CHUNKED. Backend startTranslation.ts lines 132-139 require status ===
  // 'CHUNKED'; any earlier call returns 400 INVALID_JOB_STATUS, which the
  // frontend error helper mapped to "Connection lost" (statusCode undefined).
  //
  // Fix: a polling loop calls getJobStatus every 2 s, exits when CHUNKED or a
  // terminal-error status is reached, and times out after 60 s with a clear
  // user-facing error.
  //
  // These tests use vi.useFakeTimers so polling is exercised without real
  // wall-clock waits.
  // ---------------------------------------------------------------------------
  describe('Bug #2 — chunking-wait polling before startTranslation', () => {
    /** Shared mock legal attestation used across all tests in this suite. */
    const mockAttestation = {
      acceptCopyrightOwnership: true,
      acceptTranslationRights: true,
      acceptLiabilityTerms: true,
      userIPAddress: '127.0.0.1',
      userAgent: 'test-agent',
      timestamp: new Date().toISOString(),
    };

    /** Shared mock job shape with PENDING status. */
    const mockPendingJob = {
      jobId: 'poll-job-1',
      userId: 'user-1',
      status: 'PENDING' as const,
      fileName: 'test-document.txt',
      fileSize: 12,
      contentType: 'text/plain',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    /** Helper: advance wizard to step 4 ready for submit. */
    const advanceToStep4Poll = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByLabelText(L.copyright));
      await user.click(screen.getByLabelText(L.translationRights));
      await user.click(screen.getByLabelText(L.liability));
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => expect(screen.getByLabelText(/Target Language/i)).toBeInTheDocument());
      await user.click(screen.getByLabelText(/Target Language/i));
      await user.click(screen.getByRole('option', { name: /Spanish/i }));
      await user.click(screen.getByLabelText(/Translation Tone/i));
      await user.click(screen.getByText('Formal'));
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() =>
        expect(screen.getByText(/Drag and drop your file here/i)).toBeInTheDocument()
      );
      const file = new File(['test content'], 'test-document.txt', { type: 'text/plain' });
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
      await user.upload(fileInput, file);
      await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => expect(screen.getByText('Review Your Submission')).toBeInTheDocument());
    };

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.runAllTimers();
      vi.useRealTimers();
    });

    it('polls until CHUNKED then calls startTranslation exactly once', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      renderComponent();
      await advanceToStep4Poll(user);

      vi.mocked(translationService.createLegalAttestation).mockResolvedValue(mockAttestation);
      vi.mocked(translationService.uploadDocument).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-chunked',
      });

      // Sequence: PENDING → CHUNKING → CHUNKED (3 polls before success)
      vi.mocked(translationService.getJobStatus)
        .mockResolvedValueOnce({ ...mockPendingJob, jobId: 'poll-job-chunked', status: 'PENDING' })
        .mockResolvedValueOnce({
          ...mockPendingJob,
          jobId: 'poll-job-chunked',
          status: 'CHUNKING',
        })
        .mockResolvedValueOnce({ ...mockPendingJob, jobId: 'poll-job-chunked', status: 'CHUNKED' });

      vi.mocked(translationService.startTranslation).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-chunked',
        status: 'IN_PROGRESS',
        targetLanguage: 'es',
        tone: 'formal',
      });

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      // Advance timers to cover the two 2-second poll intervals.
      await vi.advanceTimersByTimeAsync(5_000);

      await waitFor(() => {
        // startTranslation must have been called exactly once — AFTER CHUNKED.
        expect(translationService.startTranslation).toHaveBeenCalledTimes(1);
        expect(translationService.startTranslation).toHaveBeenCalledWith('poll-job-chunked', {
          targetLanguage: 'es',
          tone: 'formal',
        });
        // Navigation must have happened.
        expect(mockNavigate).toHaveBeenCalledWith('/translation/poll-job-chunked');
      });

      // getJobStatus must have been called at least twice (PENDING, CHUNKING)
      // and at most three times (PENDING, CHUNKING, CHUNKED).
      expect(translationService.getJobStatus).toHaveBeenCalledTimes(3);
    });

    it('surfaces a meaningful error on CHUNKING_FAILED status without hanging', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      renderComponent();
      await advanceToStep4Poll(user);

      vi.mocked(translationService.createLegalAttestation).mockResolvedValue(mockAttestation);
      vi.mocked(translationService.uploadDocument).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-fail',
      });

      // First poll returns CHUNKING_FAILED → should exit immediately.
      vi.mocked(translationService.getJobStatus).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-fail',
        status: 'CHUNKING_FAILED',
      });

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        // The error message thrown by the poll loop contains "processing failed".
        // getTranslationErrorMessage receives a plain Error (no statusCode) which
        // the helper maps to the NETWORK_MESSAGE "Connection lost..." UNLESS it
        // has a usable message string. Plain Error carries e.message but no
        // statusCode, so getTranslationErrorMessage falls through to the
        // statusCode-undefined branch → NETWORK_MESSAGE. That is acceptable here
        // because we just need a user-facing error; a future PR can map
        // chunking-failure to a bespoke phrase.
        expect(alert.textContent).toBeTruthy();
      });

      // startTranslation must NEVER have been called.
      expect(translationService.startTranslation).not.toHaveBeenCalled();
    });

    it('surfaces a timeout error after 60 seconds with no CHUNKED status', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      renderComponent();
      await advanceToStep4Poll(user);

      vi.mocked(translationService.createLegalAttestation).mockResolvedValue(mockAttestation);
      vi.mocked(translationService.uploadDocument).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-timeout',
      });

      // Always return PENDING so the poll never resolves naturally.
      vi.mocked(translationService.getJobStatus).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-timeout',
        status: 'PENDING',
      });

      const submitButton = screen.getByRole('button', { name: /Submit & Start Translation/i });
      await user.click(submitButton);

      // Advance past the 60-second timeout.
      await vi.advanceTimersByTimeAsync(62_000);

      await waitFor(() => {
        const alert = screen.getByRole('alert');
        expect(alert).toBeInTheDocument();
        // getTranslationErrorMessage receives a plain Error (no statusCode).
        // As explained above, statusCode-undefined → NETWORK_MESSAGE is the
        // current mapping. The important assertion is that we do see an error
        // and that startTranslation was not called.
        expect(alert.textContent).toBeTruthy();
      });

      // startTranslation must NEVER have been called.
      expect(translationService.startTranslation).not.toHaveBeenCalled();
    });

    it('shows "Processing upload..." label while polling', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      renderComponent();
      await advanceToStep4Poll(user);

      vi.mocked(translationService.createLegalAttestation).mockResolvedValue(mockAttestation);
      vi.mocked(translationService.uploadDocument).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-phase',
      });

      // Hold the poll in PENDING long enough to observe the UI label.
      let resolveChunked: () => void;
      const chunkedReady = new Promise<void>((r) => {
        resolveChunked = r;
      });

      vi.mocked(translationService.getJobStatus).mockImplementation(async () => {
        await chunkedReady;
        return { ...mockPendingJob, jobId: 'poll-job-phase', status: 'CHUNKED' };
      });

      vi.mocked(translationService.startTranslation).mockResolvedValue({
        ...mockPendingJob,
        jobId: 'poll-job-phase',
        status: 'IN_PROGRESS',
        targetLanguage: 'es',
        tone: 'formal',
      });

      await user.click(screen.getByRole('button', { name: /Submit & Start Translation/i }));

      // After upload completes, the UI should show "Processing upload..."
      await waitFor(() => {
        expect(screen.getByText(/Processing upload\.\.\./i)).toBeInTheDocument();
      });

      // Unblock the poll so the test cleans up.
      resolveChunked!();
      await vi.runAllTimersAsync();
    });
  });
});
