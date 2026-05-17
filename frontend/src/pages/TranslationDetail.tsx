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

import React, { useState, useCallback, useEffect } from 'react';
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
  Chip,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import {
  translationService,
  TranslationServiceError,
  type TranslationConfig,
  type OutputFormat,
  type TranslationJobStatus,
} from '../services/translationService';
import { TranslationProgress } from '../components/Translation/TranslationProgress';
import { useTranslationJob } from '../hooks/useTranslationJob';
import { getLanguageLabel, getToneLabel } from '../utils/translationLabels';
import { getApiErrorMessage } from '../utils/translationErrorMessages';
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

/**
 * Status-chip descriptor — semantic color + human label for a given
 * TranslationJobStatus (#266). Keeps the JSX site DRY and the mapping
 * easy to extend; defaulting unknown statuses to the raw value with the
 * neutral 'default' color means a future backend status flows through
 * without crashing.
 */
type StatusChipColor = 'default' | 'info' | 'warning' | 'success' | 'error';
interface StatusChipDescriptor {
  label: string;
  color: StatusChipColor;
}

function describeStatusChip(status: TranslationJobStatus | undefined): StatusChipDescriptor {
  switch (status) {
    case 'PENDING':
      return { label: 'Pending', color: 'default' };
    case 'CHUNKING':
      return { label: 'Preparing chunks…', color: 'info' };
    case 'CHUNKED':
      return { label: 'Ready to translate', color: 'default' };
    case 'IN_PROGRESS':
      return { label: 'Translating…', color: 'info' };
    case 'COMPLETED':
      return { label: 'Completed', color: 'success' };
    case 'FAILED':
    case 'CHUNKING_FAILED':
    case 'TRANSLATION_FAILED':
      return { label: 'Failed', color: 'error' };
    default:
      // Unknown / future status — render the raw value so the user has
      // SOMETHING to see, and our backend log will surface the mismatch.
      return { label: status ?? 'Unknown', color: 'default' };
  }
}

export const TranslationDetail: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [actionError, setActionError] = useState<string | null>(null);
  // Tracks which format download is currently in-flight (if any), so the
  // three download buttons can each show their own loading state without
  // disabling the others. `null` means no download is running.
  const [downloadingFormat, setDownloadingFormat] = useState<OutputFormat | null>(null);

  // Primary data source: React Query adaptive-polling hook (PR #125).
  // Starts fetching immediately on mount — no need for a separate
  // fetchJobDetails() call to "initialise" the page.
  const { job, isLoading, error: queryError, refetch } = useTranslationJob(jobId);

  // Map query error to a user-facing string.
  // #271: route through getApiErrorMessage so the in-page alert respects the
  // API-envelope precedence chain (GENERIC_MESSAGES filter → response.data.message
  // → COPY_BY_CODE → STATUS_MESSAGES → fallback). Prior implementation surfaced
  // raw `err.message` which leaked terse axios strings ("Network Error",
  // "Request failed") and bypassed curated copy.
  const queryErrorMessage = queryError ? getApiErrorMessage(queryError) : null;

  // Combine query error and action error for display.
  const displayError = actionError ?? queryErrorMessage;

  // ------------------------------------------------------------------
  // Action handlers — mutations that go through translationService.
  // They clear actionError before each attempt and never touch the
  // React Query cache directly; refetch() is called afterward to
  // reconcile UI state.
  // ------------------------------------------------------------------

  /**
   * Download dispatcher (issue #28).
   *
   * - Markdown: existing blob path — fetch the text inline, build an
   *   object URL, and trigger an anchor click. Unchanged behaviour from
   *   the pre-#28 download flow.
   * - ePub / PDF: presigned-URL envelope path — the backend returns
   *   `{ downloadUrl, ... }` and we set `window.location` to it so the
   *   browser fetches the bytes directly from S3 (avoiding the 6 MB
   *   API Gateway response cap). The presigned URL carries the
   *   Content-Disposition filename so the saved file is named correctly.
   */
  const handleDownload = useCallback(
    async (format: OutputFormat) => {
      if (!jobId || !job) return;

      setActionError(null);
      setDownloadingFormat(format);
      try {
        if (format === 'markdown') {
          const blob = await translationService.downloadTranslation(jobId);
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `translated_${job.fileName}`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        } else {
          // ePub / PDF — presigned-URL envelope.
          const envelope = await translationService.getDownloadUrl(jobId, format);
          // Use an anchor click rather than `window.location =` so the
          // current SPA page is not navigated away from. The browser
          // honours the presigned URL's Content-Disposition and saves
          // the file under the suggested name.
          const link = document.createElement('a');
          link.href = envelope.downloadUrl;
          // `download` attribute is advisory when the URL is
          // cross-origin (S3); the Content-Disposition header from the
          // presigned URL is the authoritative source.
          link.rel = 'noopener noreferrer';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        }
      } catch (err) {
        if (err instanceof TranslationServiceError) {
          // #266: route through the API-precedence extractor so the
          // user sees `response.data.message` when present, then any
          // curated COPY_BY_CODE phrase, then a fallback.
          setActionError(getApiErrorMessage(err));
        } else {
          setActionError(`Failed to download translation as ${format.toUpperCase()}`);
        }
      } finally {
        setDownloadingFormat(null);
      }
    },
    [jobId, job]
  );

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
        // #266: API-envelope-aware extraction.
        //   1. `response.data.message` (the Lambda-emitted prose).
        //   2. COPY_BY_CODE lookup keyed by `errorCode` (forward-compat)
        //      or `requestId` (current buggy backend, #267).
        //   3. FALLBACK_MESSAGE.
        // This fixes the demo blocker where attempting to start a
        // translation that is already running surfaced "An unexpected
        // error occurred" instead of the backend's user-readable copy.
        setActionError(getApiErrorMessage(err));
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
  // Derived outside the conditional return so hooks are called
  // unconditionally (Rules of Hooks).
  // ------------------------------------------------------------------
  const is403 = queryError instanceof TranslationServiceError && queryError.statusCode === 403;

  // #236: move the 403 navigation side-effect into useEffect so the timer
  // is cleared if the component unmounts before the 3 s elapse (avoids the
  // stale-closure navigate call on manual early navigation).
  useEffect(() => {
    if (!is403) return;
    const timer = setTimeout(() => navigate('/dashboard'), 3000);
    return () => clearTimeout(timer);
  }, [is403, navigate]);

  if (queryError && !job && !isLoading) {
    let errorMessage = 'Failed to load translation details';
    if (queryError instanceof Error) {
      errorMessage = queryError.message;
    }

    // Special-case: 403 error message override (navigation handled by useEffect above).
    if (is403) {
      errorMessage = 'You do not have permission to view this translation';
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h4">Translation Details</Typography>
          {/* #266: prominent status chip — semantic color carries the same
              signal that the surrounding text describes, so colour-blind /
              high-contrast users still get the explicit aria-label.
              Mounting only once `status` is defined avoids a flash of
              "Unknown" between the React Query skeleton and the first
              successful fetch. The chip updates IN PLACE as the auto-
              poll cycles status (PR #238); no remount, no focus loss. */}
          {status !== undefined &&
            (() => {
              const { label, color } = describeStatusChip(status);
              return (
                <Chip
                  label={label}
                  color={color}
                  size="small"
                  data-testid="status-chip"
                  aria-label={`Translation status: ${label}`}
                />
              );
            })()}
        </Box>
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

            {/* #266: Content Type field was always empty on the read-path
                projection (it lives in the upload payload, not the projection)
                so the row rendered as "Content Type: —" noise. Removed; a
                separate issue should add it back if/when the projection
                includes it. */}

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
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {isCompleted && (
          <>
            {/*
              Issue #28: three independent download buttons — Markdown
              (primary, original behaviour), ePub (e-reader friendly,
              primary use case for casual readers), PDF (universal).
              Each button shows its own spinner when in-flight; the
              others remain enabled so the user can re-trigger another
              format if e.g. the ePub takes longer than expected.
            */}
            <Button
              variant="contained"
              startIcon={
                downloadingFormat === 'markdown' ? <CircularProgress size={20} /> : <DownloadIcon />
              }
              onClick={() => void handleDownload('markdown')}
              disabled={downloadingFormat !== null}
              aria-label="Download Markdown"
            >
              {downloadingFormat === 'markdown' ? 'Downloading...' : 'Download Markdown'}
            </Button>
            <Button
              variant="contained"
              color="secondary"
              startIcon={
                downloadingFormat === 'epub' ? <CircularProgress size={20} /> : <DownloadIcon />
              }
              onClick={() => void handleDownload('epub')}
              disabled={downloadingFormat !== null}
              aria-label="Download ePub"
            >
              {downloadingFormat === 'epub' ? 'Preparing ePub...' : 'Download ePub'}
            </Button>
            <Button
              variant="outlined"
              startIcon={
                downloadingFormat === 'pdf' ? <CircularProgress size={20} /> : <DownloadIcon />
              }
              onClick={() => void handleDownload('pdf')}
              disabled={downloadingFormat !== null}
              aria-label="Download PDF"
            >
              {downloadingFormat === 'pdf' ? 'Preparing PDF...' : 'Download PDF'}
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
