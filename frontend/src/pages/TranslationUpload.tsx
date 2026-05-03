/**
 * Translation Upload Page
 *
 * Multi-step workflow for uploading documents and initiating translation.
 * Implements requirements from OpenSpec: translation-upload/spec.md
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Container,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  Paper,
  Alert,
  CircularProgress,
} from '@mui/material';
import { LegalAttestation, LegalAttestationData } from '../components/Translation/LegalAttestation';
import {
  TranslationConfig,
  TranslationConfigData,
} from '../components/Translation/TranslationConfig';
import { FileUpload } from '../components/Translation/FileUpload';
import { translationService } from '../services/translationService';
import { getLanguageLabel, getToneLabel } from '../utils/translationLabels';
import { getTranslationErrorMessage } from '../utils/translationErrorMessages';

const STEPS = ['Legal Attestation', 'Translation Settings', 'Upload Document', 'Review & Submit'];

/**
 * Canonical list of fields that must be non-empty for wizard step 1
 * (Translation Settings) to pass validation.
 *
 * Exported as the single source of truth so that:
 *   1. `validateStep(1)` derives its required-field check from this list —
 *      adding a field here automatically gates the Next button.
 *   2. The Vitest contract test in `TranslationUpload.test.tsx` asserts
 *      that each field name has a corresponding entry in
 *      `TRANSLATION_CONFIG_LABEL_PATTERNS` — so a new required field
 *      forces an update to the label module and therefore to the E2E
 *      helper, rather than silently causing a 180 s smoke-test timeout.
 *
 * Background: PR #192 (OMC Rec 3) — the original bug was that the E2E
 * helper omitted tone selection because nothing mechanically linked the
 * required-field list to the helper's selector list.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const STEP_1_REQUIRED_FIELDS = ['targetLanguage', 'tone'] as const;

type Step1Field = (typeof STEP_1_REQUIRED_FIELDS)[number];

interface FormData {
  legalAttestation: LegalAttestationData;
  translationConfig: TranslationConfigData;
  file: File | null;
}

interface FormErrors {
  legalAttestation?: {
    acceptCopyrightOwnership?: string;
    acceptTranslationRights?: string;
    acceptLiabilityTerms?: string;
  };
  translationConfig?: {
    targetLanguage?: string;
    tone?: string;
  };
  file?: string;
}

export const TranslationUpload: React.FC = () => {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [formData, setFormData] = useState<FormData>({
    legalAttestation: {
      acceptCopyrightOwnership: false,
      acceptTranslationRights: false,
      acceptLiabilityTerms: false,
    },
    translationConfig: {
      targetLanguage: '',
      tone: '',
    },
    file: null,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const validateStep = (step: number): boolean => {
    const newErrors: FormErrors = {};

    if (step === 0) {
      // Validate legal attestation
      if (!formData.legalAttestation.acceptCopyrightOwnership) {
        newErrors.legalAttestation = {
          ...newErrors.legalAttestation,
          acceptCopyrightOwnership: 'You must confirm copyright ownership',
        };
      }
      if (!formData.legalAttestation.acceptTranslationRights) {
        newErrors.legalAttestation = {
          ...newErrors.legalAttestation,
          acceptTranslationRights: 'You must confirm translation rights',
        };
      }
      if (!formData.legalAttestation.acceptLiabilityTerms) {
        newErrors.legalAttestation = {
          ...newErrors.legalAttestation,
          acceptLiabilityTerms: 'You must accept liability terms',
        };
      }
    } else if (step === 1) {
      // Validate translation config — derived from STEP_1_REQUIRED_FIELDS so
      // that adding a new required field updates the gate automatically.
      const fieldMessages: Record<Step1Field, string> = {
        targetLanguage: 'Please select a target language',
        tone: 'Please select a translation tone',
      };
      for (const field of STEP_1_REQUIRED_FIELDS) {
        if (!formData.translationConfig[field]) {
          newErrors.translationConfig = {
            ...newErrors.translationConfig,
            [field]: fieldMessages[field],
          };
        }
      }
    } else if (step === 2) {
      // Validate file
      if (!formData.file) {
        newErrors.file = 'Please select a file to upload';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (validateStep(activeStep)) {
      setActiveStep((prevStep) => prevStep + 1);
    }
  };

  const handleBack = () => {
    setActiveStep((prevStep) => prevStep - 1);
    setSubmitError(null);
  };

  const handleSubmit = async () => {
    if (!validateStep(activeStep - 1)) {
      return;
    }

    if (!formData.file) {
      setSubmitError('No file selected');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Create legal attestation with IP and user agent
      const legalAttestation = await translationService.createLegalAttestation(
        formData.legalAttestation.acceptCopyrightOwnership,
        formData.legalAttestation.acceptTranslationRights,
        formData.legalAttestation.acceptLiabilityTerms
      );

      // Upload document
      const job = await translationService.uploadDocument({
        file: formData.file,
        legalAttestation,
      });

      // Start translation immediately
      await translationService.startTranslation(job.jobId, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        targetLanguage: formData.translationConfig.targetLanguage as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tone: formData.translationConfig.tone as any,
      });

      // Navigate to translation detail page
      navigate(`/translation/${job.jobId}`);
    } catch (error) {
      // Issue #147: surface a user-facing message keyed off the HTTP
      // status (or the absence of one, for network failures) rather
      // than passing through the raw backend message or a generic
      // catch-all. `getTranslationErrorMessage` accepts an `unknown`
      // and handles both `TranslationServiceError` (which carries
      // `statusCode`) and bare `Error` shapes — the previous if/else
      // was a refactor leftover. (R4: OMC review follow-up.)
      setSubmitError(getTranslationErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <LegalAttestation
            value={formData.legalAttestation}
            onChange={(data) => setFormData((prev) => ({ ...prev, legalAttestation: data }))}
            errors={errors.legalAttestation}
          />
        );
      case 1:
        return (
          <TranslationConfig
            value={formData.translationConfig}
            onChange={(data) => {
              setFormData((prev) => ({ ...prev, translationConfig: data }));
              // Issue #148: clear stale validation alerts as soon as the
              // user fixes the offending field, instead of waiting for
              // the next "Next" click to revalidate. We selectively clear
              // only the fields whose values are now non-empty so an
              // unfilled second dropdown still surfaces its error.
              setErrors((prev) => {
                if (!prev.translationConfig) return prev;
                const next = { ...prev.translationConfig };
                if (data.targetLanguage) delete next.targetLanguage;
                if (data.tone) delete next.tone;
                return { ...prev, translationConfig: next };
              });
            }}
            errors={errors.translationConfig}
          />
        );
      case 2:
        return (
          <FileUpload
            file={formData.file}
            onChange={(file) => setFormData((prev) => ({ ...prev, file }))}
            error={errors.file}
          />
        );
      case 3:
        return (
          <Paper elevation={0} sx={{ p: 3, backgroundColor: 'background.default' }}>
            <Typography variant="h6" gutterBottom>
              Review Your Submission
            </Typography>
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Document:
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {formData.file?.name}
              </Typography>

              <Typography variant="subtitle2" gutterBottom>
                Target Language:
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {/* Issue #145: show the friendly label, not the raw 'es' code */}
                {getLanguageLabel(formData.translationConfig.targetLanguage)}
              </Typography>

              <Typography variant="subtitle2" gutterBottom>
                Tone:
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {/* Issue #145: 'Formal' instead of 'formal' */}
                {getToneLabel(formData.translationConfig.tone)}
              </Typography>

              <Typography variant="subtitle2" gutterBottom>
                Legal Attestation:
              </Typography>
              <Typography variant="body2" color="success.main">
                ✓ All requirements confirmed
              </Typography>
            </Box>
          </Paper>
        );
      default:
        return null;
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography variant="h4" gutterBottom>
        New Translation
      </Typography>

      <Stepper activeStep={activeStep} sx={{ my: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <Box sx={{ mt: 4, mb: 4 }}>{renderStepContent(activeStep)}</Box>

      {submitError && (
        <Alert severity="error" sx={{ mb: 3 }} role="alert">
          {submitError}
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Button disabled={activeStep === 0 || isSubmitting} onClick={handleBack} variant="outlined">
          Back
        </Button>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {activeStep === STEPS.length - 1 ? (
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={isSubmitting}
              startIcon={isSubmitting ? <CircularProgress size={20} /> : null}
            >
              {isSubmitting ? 'Uploading...' : 'Submit & Start Translation'}
            </Button>
          ) : (
            <Button variant="contained" onClick={handleNext}>
              Next
            </Button>
          )}
        </Box>
      </Box>
    </Container>
  );
};
