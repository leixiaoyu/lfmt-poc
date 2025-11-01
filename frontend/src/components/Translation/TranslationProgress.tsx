/**
 * Translation Progress Component
 *
 * Displays real-time translation progress with adaptive polling.
 * Implements requirements from OpenSpec: translation-progress/spec.md
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  LinearProgress,
  Paper,
  Chip,
  Alert,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { TranslationJob, translationService } from '../../services/translationService';

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
  const [job, setJob] = useState<TranslationJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingInterval, setPollingInterval] = useState(15000); // Start at 15 seconds
  const [elapsedTime, setElapsedTime] = useState(0);

  const isTerminalState = (status: string) => {
    return status === 'COMPLETED' || status === 'FAILED' ||
           status === 'CHUNKING_FAILED' || status === 'TRANSLATION_FAILED';
  };

  const calculateProgress = (job: TranslationJob): number => {
    if (job.status === 'COMPLETED') return 100;
    if (job.status === 'FAILED' || job.status === 'CHUNKING_FAILED' ||
        job.status === 'TRANSLATION_FAILED') return 0;
    if (job.status === 'PENDING') return 5;
    if (job.status === 'CHUNKING') return 10;
    if (job.status === 'CHUNKED') return 15;

    // IN_PROGRESS - calculate based on completed chunks
    if (job.totalChunks && job.completedChunks !== undefined) {
      const chunkProgress = (job.completedChunks / job.totalChunks) * 85; // 85% of progress bar
      return 15 + chunkProgress; // Add 15% for pre-translation steps
    }

    return 20; // Default for IN_PROGRESS without chunk info
  };

  const fetchJobStatus = useCallback(async () => {
    try {
      const updatedJob = await translationService.getJobStatus(jobId);
      setJob(updatedJob);
      setLoading(false);
      setError(null);

      // Check if terminal state
      if (isTerminalState(updatedJob.status)) {
        if (updatedJob.status === 'COMPLETED' && onComplete) {
          onComplete(updatedJob);
        } else if (updatedJob.status !== 'COMPLETED' && onError) {
          onError(updatedJob.errorMessage || 'Translation failed');
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch job status');
      setLoading(false);
      if (onError) {
        onError(err.message || 'Failed to fetch job status');
      }
    }
  }, [jobId, onComplete, onError]);

  // Adaptive polling logic
  useEffect(() => {
    fetchJobStatus(); // Initial fetch

    const timer = setInterval(() => {
      setElapsedTime((prev) => prev + pollingInterval);
    }, pollingInterval);

    return () => clearInterval(timer);
  }, [fetchJobStatus, pollingInterval]);

  // Adjust polling interval based on elapsed time
  useEffect(() => {
    if (job && isTerminalState(job.status)) {
      return; // Stop adjusting if in terminal state
    }

    // Adaptive intervals: 15s → 30s after 2min → 60s after 5min
    if (elapsedTime > 300000 && pollingInterval < 60000) {
      setPollingInterval(60000); // 60 seconds
    } else if (elapsedTime > 120000 && pollingInterval < 30000) {
      setPollingInterval(30000); // 30 seconds
    }
  }, [elapsedTime, pollingInterval, job]);

  // Polling effect
  useEffect(() => {
    if (!job || isTerminalState(job.status)) {
      return;
    }

    const interval = setInterval(fetchJobStatus, pollingInterval);
    return () => clearInterval(interval);
  }, [job, pollingInterval, fetchJobStatus]);

  if (loading) {
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
    return (
      <Alert severity="error" icon={<ErrorIcon />}>
        {error}
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
          icon={
            isComplete ? (
              <CheckCircleIcon />
            ) : isError ? (
              <ErrorIcon />
            ) : (
              <HourglassEmptyIcon />
            )
          }
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
