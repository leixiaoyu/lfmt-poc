/**
 * Translation Progress Component
 *
 * Displays real-time translation progress with adaptive polling.
 * Uses React Query for optimized polling with background sync.
 * Implements requirements from OpenSpec: translation-progress/spec.md
 */

import React, { useEffect } from 'react';
import { Box, Typography, LinearProgress, Paper, Chip, Alert } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { TranslationJob } from '../../services/translationService';
import { useTranslationJob, calculateProgress } from '../../hooks/useTranslationJob';

export interface TranslationProgressProps {
  jobId: string;
  onComplete?: (job: TranslationJob) => void;
  onError?: (error: string) => void;
}

const STATUS_COLORS: Record<string, 'default' | 'primary' | 'success' | 'error' | 'warning'> = {
  PENDING: 'default',
  CHUNKING: 'primary',
  CHUNKED: 'primary',
  IN_PROGRESS: 'primary',
  COMPLETED: 'success',
  FAILED: 'error',
  CHUNKING_FAILED: 'error',
  TRANSLATION_FAILED: 'error',
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  CHUNKING: 'Chunking Document',
  CHUNKED: 'Ready to Translate',
  IN_PROGRESS: 'Translating',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CHUNKING_FAILED: 'Chunking Failed',
  TRANSLATION_FAILED: 'Translation Failed',
};

export const TranslationProgress: React.FC<TranslationProgressProps> = ({
  jobId,
  onComplete,
  onError,
}) => {
  const { job, isLoading, error, isTerminal } = useTranslationJob(jobId);

  // Handle callbacks when job reaches terminal state
  useEffect(() => {
    if (!job || !isTerminal) return;

    if (job.status === 'COMPLETED' && onComplete) {
      onComplete(job);
    } else if (job.status !== 'COMPLETED' && onError) {
      onError(job.errorMessage || 'Translation failed');
    }
  }, [job, isTerminal, onComplete, onError]);

  // Handle query errors
  useEffect(() => {
    if (error && onError) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to fetch job status';
      onError(errorMessage);
    }
  }, [error, onError]);

  if (isLoading) {
    return (
      <Paper elevation={1} sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <HourglassEmptyIcon />
          <Typography>Loading translation status...</Typography>
        </Box>
      </Paper>
    );
  }

  if (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch job status';
    return (
      <Alert severity="error" icon={<ErrorIcon />}>
        {errorMessage}
      </Alert>
    );
  }

  if (!job) {
    return null;
  }

  const progress = calculateProgress(job);
  const isError = job.status.includes('FAILED');
  const isComplete = job.status === 'COMPLETED';

  return (
    <Paper elevation={1} sx={{ p: 3 }}>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Translation Progress</Typography>
        <Chip
          label={STATUS_LABELS[job.status]}
          color={STATUS_COLORS[job.status]}
          icon={isComplete ? <CheckCircleIcon /> : isError ? <ErrorIcon /> : <HourglassEmptyIcon />}
        />
      </Box>

      <Box sx={{ mb: 3 }}>
        <LinearProgress
          variant="determinate"
          value={progress}
          color={isError ? 'error' : isComplete ? 'success' : 'primary'}
          sx={{ height: 8, borderRadius: 4 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {progress.toFixed(0)}% complete
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
        <Box>
          <Typography variant="caption" color="text.secondary">
            File Name
          </Typography>
          <Typography variant="body2">{job.fileName}</Typography>
        </Box>

        {job.targetLanguage && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Target Language
            </Typography>
            <Typography variant="body2">{job.targetLanguage}</Typography>
          </Box>
        )}

        {job.totalChunks !== undefined && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Total Chunks
            </Typography>
            <Typography variant="body2">{job.totalChunks}</Typography>
          </Box>
        )}

        {job.completedChunks !== undefined && (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Completed Chunks
            </Typography>
            <Typography variant="body2">
              {job.completedChunks} / {job.totalChunks}
            </Typography>
          </Box>
        )}

        {job.failedChunks !== undefined && job.failedChunks > 0 && (
          <Box>
            <Typography variant="caption" color="error">
              Failed Chunks
            </Typography>
            <Typography variant="body2" color="error">
              {job.failedChunks}
            </Typography>
          </Box>
        )}
      </Box>

      {job.errorMessage && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {job.errorMessage}
        </Alert>
      )}

      {isComplete && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Translation completed successfully! You can now download your translated document.
        </Alert>
      )}
    </Paper>
  );
};
