/**
 * Translation Detail Page
 *
 * Displays detailed information about a translation job with download capability.
 * Implements requirements from OpenSpec: translation-detail/spec.md
 *
 * Data strategy (Issue #225):
 *   useTranslationJob (React Query) is the single source of truth for job state
 *   and drives the adaptive polling loop introduced in PR #125. The previous
 *   pattern maintained a parallel local-state copy via fetchJobDetails() and
 *   only rendered TranslationProgress after that first local fetch settled —
 *   which meant the Progress card was invisible on first paint. Now the page
 *   renders TranslationProgress immediately on mount (React Query fetches in the
 *   background and the component shows its own skeleton until data lands), and
 *   the local "Refresh Status" button calls query.refetch() instead of a
 *   duplicated fetch path.
 */

import React, { useState, useCallback } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Paper,
  Breadcrumbs,
  Link,
  Alert,
  CircularProgress,
  Skeleton,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import {
  translationService,
  TranslationServiceError,
  type TranslationConfig,
} from '../services/translationService';
import { TranslationProgress } from '../components/Translation/TranslationProgress';
import { useTranslationJob } from '../hooks/useTranslationJob';
import { getLanguageLabel, getToneLabel } from '../utils/translationLabels';
import { FEATURE_FLAGS } from '../config/constants';

// ---------------------------------------------------------------------------
// Pure helpers — module-level so they are not recreated on every render.
// ---------------------------------------------------------------------------

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Type predicates that narrow the wire's `string` shape into the strict
// `TranslationConfig` union before we hand the value to startTranslation.
// Keeps the `any`-cast pattern out of this file (#225 / #228 OMC R1 C2).
const SUPPORTED_LANGUAGES: ReadonlyArray<TranslationConfig['targetLanguage']> = [
  'es',
  'fr',
  'de',
  'it',
  'zh',
];
const SUPPORTED_TONES: ReadonlyArray<TranslationConfig['tone']> = ['formal', 'informal', 'neutral'];

function isSupportedLanguage(value: string): value is TranslationConfig['targetLanguage'] {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function isSupportedTone(value: string): value is TranslationConfig['tone'] {
  return (SUPPORTED_TONES as readonly string[]).includes(value);
}

export const TranslationDetail: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Primary data source: React Query adaptive-polling hook (PR #125).
  // Starts fetching immediately on mount — no need for a separate
  // fetchJobDetails() call to "initialise" the page.
  const { job, isLoading, error: queryError, refetch } = useTranslationJob(jobId);

  // Map query error to a user-facing string.
  const queryErrorMessage = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Failed to load translation details'
    : null;

  // Combine query error and action error for display.
  const displayError = actionError ?? queryErrorMessage;

  // ------------------------------------------------------------------
  // Action handlers — mutations that go through translationService.
  // They clear actionError before each attempt and never touch the
  // React Query cache directly; refetch() is called afterward to
  // reconcile UI state.
  // ------------------------------------------------------------------

  const handleDownload = useCallback(async () => {
    if (!jobId || !job) return;

    setActionError(null);
    setDownloading(true);
    try {
      const blob = await translationService.downloadTranslation(jobId);

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `translated_${job.fileName}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof TranslationServiceError) {
        setActionError(err.message);
      } else {
        setActionError('Failed to download translation');
      }
    } finally {
      setDownloading(false);
    }
  }, [jobId, job]);

  const handleStartTranslation = useCallback(async () => {
    if (!jobId || !job) return;

    // OMC R1 C2: targetLanguage and tone are optional on TranslationJob and
    // typed as `string` on the wire. Guard for presence AND narrow to the
    // typed union before calling startTranslation — passing undefined or an
    // out-of-vocab value would send a malformed request to the API.
    if (
      !job.targetLanguage ||
      !isSupportedLanguage(job.targetLanguage) ||
      !job.tone ||
      !isSupportedTone(job.tone)
    ) {
      setActionError('Translation configuration is incomplete or invalid — cannot start.');
      return;
    }

    setActionError(null);
    try {
      await translationService.startTranslation(jobId, {
        targetLanguage: job.targetLanguage,
        tone: job.tone,
      });
      // Invalidate the React Query cache so the progress card picks up the
      // new IN_PROGRESS state immediately.
      await refetch();
    } catch (err) {
      if (err instanceof TranslationServiceError) {
        setActionError(err.message);
      } else {
        setActionError('Failed to start translation');
      }
    }
  }, [jobId, job, refetch]);

  // ------------------------------------------------------------------
  // Derived status booleans — computed from the React Query job, not
  // from a separate local-state copy. Defaults to false when job is
  // still loading so the UI renders sensible skeletons/loading states.
  // ------------------------------------------------------------------

  const status = job?.status;

  // Show TranslationProgress for any non-terminal, non-CHUNKED status plus
  // COMPLETED. CHUNKED means the job is ready to start (user action needed)
  // and has its own action button.
  const showProgress =
    jobId !== undefined &&
    (isLoading ||
      status === 'PENDING' ||
      status === 'CHUNKING' ||
      status === 'IN_PROGRESS' ||
      status === 'COMPLETED');

  const isCompleted = status === 'COMPLETED';
  const isChunked = status === 'CHUNKED';
  // Show Start Translation button ONLY when in CHUNKED state (i.e.,
  // translationStatus effectively 'NOT_STARTED' — chunking done, translate
  // not yet kicked off). Hide it for IN_PROGRESS / COMPLETED / FAILED.
  const isFailed =
    status === 'FAILED' || status === 'CHUNKING_FAILED' || status === 'TRANSLATION_FAILED';

  // ------------------------------------------------------------------
  // Fatal error state: query errored AND we have no job data at all.
  // ------------------------------------------------------------------
  if (queryError && !job && !isLoading) {
    let errorMessage = 'Failed to load translation details';
    if (queryError instanceof Error) {
      errorMessage = queryError.message;
    }

    // Special-case: navigate away from 403 (access denied) after a delay.
    // We detect this by checking TranslationServiceError statusCode.
    if (queryError instanceof TranslationServiceError && queryError.statusCode === 403) {
      errorMessage = 'You do not have permission to view this translation';
      setTimeout(() => navigate('/dashboard'), 3000);
    }

    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {errorMessage}
        </Alert>
        <Button component={RouterLink} to="/translation/history" startIcon={<ArrowBackIcon />}>
          Go to Translation History
        </Button>
      </Container>
    );
  }

  // Missing jobId in the URL — should not happen with correct routing, but
  // guard defensively.
  if (!jobId) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          No job ID provided
        </Alert>
        <Button component={RouterLink} to="/translation/history" startIcon={<ArrowBackIcon />}>
          Go to Translation History
        </Button>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link component={RouterLink} to="/dashboard" underline="hover" color="inherit">
          Dashboard
        </Link>
        <Link component={RouterLink} to="/translation/history" underline="hover" color="inherit">
          Translation History
        </Link>
        <Typography color="text.primary">
          {isLoading ? <Skeleton width={120} /> : job?.fileName}
        </Typography>
      </Breadcrumbs>

      {/* Page Title */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4">Translation Details</Typography>
        <Button
          component={RouterLink}
          to="/translation/history"
          startIcon={<ArrowBackIcon />}
          variant="outlined"
        >
          Back to History
        </Button>
      </Box>

      {/* Error Alert */}
      {displayError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {displayError}
        </Alert>
      )}

      {/* Progress Component — rendered on mount for any in-flight or completed
          job. TranslationProgress owns its own React Query subscription via
          useTranslationJob, so it will start polling immediately regardless of
          whether the parent page has received its first response yet.
          When isLoading=true and job=undefined we show a skeleton card. */}
      {showProgress && (
        <Box sx={{ mb: 4 }}>
          {isLoading && !job ? (
            <Paper elevation={1} sx={{ p: 3 }} data-testid="progress-skeleton">
              <Skeleton variant="text" width="40%" height={32} sx={{ mb: 2 }} />
              <Skeleton variant="rectangular" height={8} sx={{ mb: 1, borderRadius: 4 }} />
              <Skeleton variant="text" width="20%" />
            </Paper>
          ) : (
            <TranslationProgress
              jobId={jobId}
              // onComplete is intentionally omitted: React Query is the
              // authoritative source and will already carry the COMPLETED
              // state by the time this fires. No local reconciliation needed.
              onError={(err) => setActionError(err)}
            />
          )}
        </Box>
      )}

      {/* Job Details */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Job Information
        </Typography>
        {isLoading && !job ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3, mt: 2 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <Box key={i}>
                <Skeleton variant="text" width="40%" />
                <Skeleton variant="text" width="70%" />
              </Box>
            ))}
          </Box>
        ) : job ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3, mt: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Job ID
              </Typography>
              <Typography variant="body2">{job.jobId}</Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">
                File Name
              </Typography>
              <Typography variant="body2">{job.fileName}</Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">
                File Size
              </Typography>
              <Typography variant="body2">{formatFileSize(job.fileSize)}</Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Content Type
              </Typography>
              <Typography variant="body2">{job.contentType}</Typography>
            </Box>

            {job.targetLanguage && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Target Language
                </Typography>
                <Typography variant="body2">{getLanguageLabel(job.targetLanguage)}</Typography>
              </Box>
            )}

            {job.tone && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Tone
                </Typography>
                <Typography variant="body2">{getToneLabel(job.tone)}</Typography>
              </Box>
            )}

            <Box>
              <Typography variant="caption" color="text.secondary">
                Created At
              </Typography>
              <Typography variant="body2">{formatDate(job.createdAt)}</Typography>
            </Box>

            <Box>
              <Typography variant="caption" color="text.secondary">
                Last Updated
              </Typography>
              <Typography variant="body2">{formatDate(job.updatedAt)}</Typography>
            </Box>

            {job.completedAt && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Completed At
                </Typography>
                <Typography variant="body2">{formatDate(job.completedAt)}</Typography>
              </Box>
            )}
          </Box>
        ) : null}
      </Paper>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        {isCompleted && (
          <>
            <Button
              variant="contained"
              startIcon={downloading ? <CircularProgress size={20} /> : <DownloadIcon />}
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? 'Downloading...' : 'Download Translation'}
            </Button>
            {/*
              Compare button gated behind feature flag — the source-pane backend
              API is not yet implemented. See FEATURE_FLAGS.COMPARE_VIEW.
            */}
            {FEATURE_FLAGS.COMPARE_VIEW && (
              <Button
                variant="outlined"
                startIcon={<CompareArrowsIcon />}
                component={RouterLink}
                to={`/translation/${jobId}/compare`}
              >
                Compare Side-by-Side
              </Button>
            )}
          </>
        )}

        {/* Show Start Translation only when status is CHUNKED (translation has
            not been kicked off yet). Hidden during IN_PROGRESS / COMPLETED /
            FAILED so the button cannot be double-triggered. */}
        {isChunked && (
          <Button variant="contained" onClick={handleStartTranslation}>
            Start Translation
          </Button>
        )}

        {isFailed && (
          <Button
            variant="contained"
            color="warning"
            startIcon={<RefreshIcon />}
            onClick={handleStartTranslation}
          >
            Retry Translation
          </Button>
        )}

        <Button variant="outlined" onClick={() => void refetch()} startIcon={<RefreshIcon />}>
          Refresh Status
        </Button>
      </Box>
    </Container>
  );
};
