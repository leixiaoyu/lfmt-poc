/**
 * Translation Configuration Component
 *
 * Allows users to select target language and tone for translation.
 * Implements requirements from OpenSpec: translation-upload/spec.md
 */

import React from 'react';
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Paper,
  SelectChangeEvent,
} from '@mui/material';

// LANGUAGE_OPTIONS / TONE_OPTIONS are exported as the canonical source of
// truth for both (a) the dropdown rendered below AND (b) the read-only
// label maps consumed by `utils/translationLabels.ts`. Keeping the option
// arrays here (next to the form) preserves the component-local layout the
// dropdown wants, while the label helpers derive their tables from these
// same arrays — so adding a language requires exactly one edit, and the
// TypeScript compiler catches drift via `LanguageCode` / `ToneCode` (R2).
//
// `as const` is load-bearing: it narrows the literal types so we can
// derive `LanguageCode` / `ToneCode` unions below.
//
// We deliberately export non-component values from this `.tsx` file —
// the alternative (a separate `translationOptions.ts` module) would
// have churned 4+ test files for no functional gain. React Fast Refresh
// will still rebuild the whole module on edit, which is fine for a
// rarely-touched options table.
// eslint-disable-next-line react-refresh/only-export-components
export const LANGUAGE_OPTIONS = [
  { value: 'es', label: 'Spanish (Español)' },
  { value: 'fr', label: 'French (Français)' },
  { value: 'de', label: 'German (Deutsch)' },
  { value: 'it', label: 'Italian (Italiano)' },
  { value: 'zh', label: 'Chinese (中文)' },
] as const;

// eslint-disable-next-line react-refresh/only-export-components
export const TONE_OPTIONS = [
  { value: 'formal', label: 'Formal', description: 'Professional and respectful language' },
  { value: 'neutral', label: 'Neutral', description: 'Balanced and standard language' },
  { value: 'informal', label: 'Informal', description: 'Casual and conversational language' },
] as const;

export type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]['value'];
export type ToneCode = (typeof TONE_OPTIONS)[number]['value'];

export interface TranslationConfigData {
  targetLanguage: LanguageCode | '';
  tone: ToneCode | '';
}

export interface TranslationConfigProps {
  value: TranslationConfigData;
  onChange: (data: TranslationConfigData) => void;
  errors?: {
    targetLanguage?: string;
    tone?: string;
  };
}

export const TranslationConfig: React.FC<TranslationConfigProps> = ({
  value,
  onChange,
  errors = {},
}) => {
  const handleLanguageChange = (event: SelectChangeEvent) => {
    onChange({
      ...value,
      targetLanguage: event.target.value as TranslationConfigData['targetLanguage'],
    });
  };

  const handleToneChange = (event: SelectChangeEvent) => {
    onChange({
      ...value,
      tone: event.target.value as TranslationConfigData['tone'],
    });
  };

  return (
    <Paper elevation={0} sx={{ p: 3, backgroundColor: 'background.default' }}>
      <Typography variant="h6" gutterBottom>
        Translation Settings
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Choose the target language and desired tone for your translation.
      </Typography>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {/* Target Language */}
        <FormControl fullWidth error={!!errors.targetLanguage} required>
          <InputLabel id="target-language-label">Target Language</InputLabel>
          <Select
            labelId="target-language-label"
            id="target-language"
            name="targetLanguage"
            value={value.targetLanguage}
            onChange={handleLanguageChange}
            label="Target Language"
            aria-required="true"
            aria-invalid={!!errors.targetLanguage}
            aria-describedby={errors.targetLanguage ? 'target-language-error' : undefined}
          >
            <MenuItem value="">
              <em>Select a language</em>
            </MenuItem>
            {LANGUAGE_OPTIONS.map((lang) => (
              <MenuItem key={lang.value} value={lang.value}>
                {lang.label}
              </MenuItem>
            ))}
          </Select>
          {errors.targetLanguage && (
            <FormHelperText id="target-language-error" role="alert">
              {errors.targetLanguage}
            </FormHelperText>
          )}
        </FormControl>

        {/* Tone */}
        <FormControl fullWidth error={!!errors.tone} required>
          <InputLabel id="tone-label">Translation Tone</InputLabel>
          <Select
            labelId="tone-label"
            id="tone"
            name="tone"
            value={value.tone}
            onChange={handleToneChange}
            label="Translation Tone"
            aria-required="true"
            aria-invalid={!!errors.tone}
            aria-describedby={errors.tone ? 'tone-error' : undefined}
          >
            <MenuItem value="">
              <em>Select a tone</em>
            </MenuItem>
            {TONE_OPTIONS.map((tone) => (
              <MenuItem key={tone.value} value={tone.value}>
                <Box>
                  <Typography>{tone.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {tone.description}
                  </Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
          {errors.tone && (
            <FormHelperText id="tone-error" role="alert">
              {errors.tone}
            </FormHelperText>
          )}
        </FormControl>
      </Box>
    </Paper>
  );
};
