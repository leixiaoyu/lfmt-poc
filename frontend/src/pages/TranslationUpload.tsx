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
import { TranslationConfig, TranslationConfigData } from '../components/Translation/TranslationConfig';
import { FileUpload } from '../components/Translation/FileUpload';
import {
  translationService,
  TranslationServiceError,
} from '../services/translationService';

const STEPS = [
  'Legal Attestation',
  'Translation Settings',
  'Upload Document',
  'Review & Submit',
];

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
      // Validate translation config
      if (!formData.translationConfig.targetLanguage) {
        newErrors.translationConfig = {
          ...newErrors.translationConfig,
          targetLanguage: 'Please select a target language',
        };
      }
      if (!formData.translationConfig.tone) {
        newErrors.translationConfig = {
          ...newErrors.translationConfig,
          tone: 'Please select a translation tone',
        };
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
        targetLanguage: formData.translationConfig.targetLanguage as any,
        tone: formData.translationConfig.tone as any,
      });

      // Navigate to translation detail page
      navigate(`/translation/${job.jobId}`);
    } catch (error) {
      if (error instanceof TranslationServiceError) {
        setSubmitError(error.message);
      } else {
        setSubmitError('An unexpected error occurred. Please try again.');
      }
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
            onChange={(data) =>
              setFormData((prev) => ({ ...prev, legalAttestation: data }))
            }
            errors={errors.legalAttestation}
          />
        );
      case 1:
        return (
          <TranslationConfig
            value={formData.translationConfig}
            onChange={(data) =>
              setFormData((prev) => ({ ...prev, translationConfig: data }))
            }
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
                {formData.translationConfig.targetLanguage}
              </Typography>

              <Typography variant="subtitle2" gutterBottom>
                Tone:
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {formData.translationConfig.tone}
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

      <Box sx={{ mt: 4, mb: 4 }}>
        {renderStepContent(activeStep)}
      </Box>

      {submitError && (
        <Alert severity="error" sx={{ mb: 3 }} role="alert">
          {submitError}
        </Alert>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Button
          disabled={activeStep === 0 || isSubmitting}
          onClick={handleBack}
          variant="outlined"
        >
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
