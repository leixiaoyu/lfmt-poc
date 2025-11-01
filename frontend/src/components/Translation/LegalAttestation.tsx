/**
 * Legal Attestation Component
 *
 * Handles copyright and legal rights attestation before document upload.
 * Implements requirements from OpenSpec: legal-attestation/spec.md
 */

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Alert,
  Paper,
  IconButton,
  Tooltip,
  FormHelperText,
} from '@mui/material';
import InfoIcon from '@mui/icons-material/Info';

export interface LegalAttestationData {
  acceptCopyrightOwnership: boolean;
  acceptTranslationRights: boolean;
  acceptLiabilityTerms: boolean;
}

export interface LegalAttestationProps {
  value: LegalAttestationData;
  onChange: (data: LegalAttestationData) => void;
  errors?: {
    acceptCopyrightOwnership?: string;
    acceptTranslationRights?: string;
    acceptLiabilityTerms?: string;
  };
}

export const LegalAttestation: React.FC<LegalAttestationProps> = ({
  value,
  onChange,
  errors = {},
}) => {
  const [tooltipOpen, setTooltipOpen] = useState<string | null>(null);

  const handleCheckboxChange = (field: keyof LegalAttestationData) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    onChange({
      ...value,
      [field]: event.target.checked,
    });
  };

  const handleTooltipToggle = (field: string) => {
    setTooltipOpen(tooltipOpen === field ? null : field);
  };

  return (
    <Paper elevation={0} sx={{ p: 3, backgroundColor: 'background.default' }}>
      <Box component="fieldset" sx={{ border: 'none', p: 0, m: 0 }}>
        <Typography component="legend" variant="h6" gutterBottom>
          Legal Attestation and Copyright Confirmation
        </Typography>

        <Alert severity="info" sx={{ mb: 3 }}>
          Before uploading your document, you must confirm that you have the legal right to
          translate it. This attestation is required to protect both you and our service from
          copyright infringement claims.
        </Alert>

        <FormGroup>
          {/* Copyright Ownership */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={value.acceptCopyrightOwnership}
                    onChange={handleCheckboxChange('acceptCopyrightOwnership')}
                    name="acceptCopyrightOwnership"
                    required
                    aria-required="true"
                    aria-invalid={!!errors.acceptCopyrightOwnership}
                    aria-describedby="copyright-ownership-help"
                  />
                }
                label={
                  <Typography>
                    I confirm that I own the copyright to this document or have authorization from
                    the copyright holder to translate it
                  </Typography>
                }
                sx={{ flex: 1 }}
              />
              <Tooltip
                title="You must either be the original author of the document, or have written permission from the copyright holder to create translations. Public domain and Creative Commons works may also be eligible."
                open={tooltipOpen === 'copyright'}
                onClose={() => setTooltipOpen(null)}
                disableFocusListener
                disableHoverListener
                disableTouchListener
              >
                <IconButton
                  size="small"
                  onClick={() => handleTooltipToggle('copyright')}
                  aria-label="Learn more about copyright ownership"
                >
                  <InfoIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {errors.acceptCopyrightOwnership && (
              <FormHelperText error role="alert">
                {errors.acceptCopyrightOwnership}
              </FormHelperText>
            )}
          </Box>

          {/* Translation Rights */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={value.acceptTranslationRights}
                    onChange={handleCheckboxChange('acceptTranslationRights')}
                    name="acceptTranslationRights"
                    required
                    aria-required="true"
                    aria-invalid={!!errors.acceptTranslationRights}
                    aria-describedby="translation-rights-help"
                  />
                }
                label={
                  <Typography>
                    I confirm that I have the right to create derivative works (translations) from
                    this document
                  </Typography>
                }
                sx={{ flex: 1 }}
              />
              <Tooltip
                title="Translation is considered a derivative work under copyright law. You must have explicit permission to create translations, which may be granted through a license, contract, or copyright ownership."
                open={tooltipOpen === 'translation'}
                onClose={() => setTooltipOpen(null)}
                disableFocusListener
                disableHoverListener
                disableTouchListener
              >
                <IconButton
                  size="small"
                  onClick={() => handleTooltipToggle('translation')}
                  aria-label="Learn more about translation rights"
                >
                  <InfoIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {errors.acceptTranslationRights && (
              <FormHelperText error role="alert">
                {errors.acceptTranslationRights}
              </FormHelperText>
            )}
          </Box>

          {/* Liability Terms */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={value.acceptLiabilityTerms}
                    onChange={handleCheckboxChange('acceptLiabilityTerms')}
                    name="acceptLiabilityTerms"
                    required
                    aria-required="true"
                    aria-invalid={!!errors.acceptLiabilityTerms}
                    aria-describedby="liability-terms-help"
                  />
                }
                label={
                  <Typography>
                    I understand that I am solely responsible for ensuring I have the legal right
                    to translate this document, and I indemnify LFMT from any copyright claims
                  </Typography>
                }
                sx={{ flex: 1 }}
              />
              <Tooltip
                title="By checking this box, you agree to take full legal responsibility for the copyright status of your document. LFMT will not be held liable for any copyright infringement claims arising from your upload."
                open={tooltipOpen === 'liability'}
                onClose={() => setTooltipOpen(null)}
                disableFocusListener
                disableHoverListener
                disableTouchListener
              >
                <IconButton
                  size="small"
                  onClick={() => handleTooltipToggle('liability')}
                  aria-label="Learn more about liability terms"
                >
                  <InfoIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
            {errors.acceptLiabilityTerms && (
              <FormHelperText error role="alert">
                {errors.acceptLiabilityTerms}
              </FormHelperText>
            )}
          </Box>
        </FormGroup>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Your attestation will be recorded along with your IP address, browser information, and
          timestamp for legal compliance purposes. This information will be retained for 7 years.
        </Typography>
      </Box>
    </Paper>
  );
};
