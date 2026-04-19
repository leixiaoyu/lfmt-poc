/**
 * Translation Compare Page
 *
 * Displays side-by-side comparison of source and translated documents.
 * Implements requirements from GitHub Issue #27.
 *
 * Notes (post-OMC review):
 * - Source-pane retrieval requires a backend API that does not yet exist;
 *   this page is gated behind FEATURE_FLAGS.COMPARE_VIEW (default OFF in
 *   production). The route still exists so users with the flag enabled can
 *   exercise the viewer end-to-end against the translation blob.
 * - Job state is sourced from `useTranslationJob` (React Query) so we share
 *   the cache with TranslationDetail and avoid duplicate fetching code.
 * - Translated blob size is capped (50MB) to prevent multi-GB Blob.text()
 *   loads from blowing up the renderer.
 */

import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Container,
  Box,
  Typography,
  Button,
  Breadcrumbs,
  Link,
  Alert,
  CircularProgress,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { SideBySideViewer } from '../components/Translation/SideBySideViewer';
import { translationService, TranslationServiceError } from '../services/translationService';
import { useTranslationJob } from '../hooks/useTranslationJob';

/**
 * Maximum translated blob size we will load fully into memory via Blob.text().
 * Above this we show an error rather than freeze the renderer on a multi-GB
 * download. 50MB ≈ ~12M characters of UTF-8 text — well above any expected
 * translation output (400K words ≈ 2-4MB).
 */
const MAX_BLOB_SIZE_BYTES = 50 * 1024 * 1024;

export const TranslationCompare: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const { job, isLoading: jobLoading, error: jobError } = useTranslationJob(jobId);

  const [sourceText, setSourceText] = useState<string>('');
  const [translatedText, setTranslatedText] = useState<string>('');
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Derived error message (job fetch error → friendly message + optional redirect).
  const fetchError = (() => {
    if (!jobError) return null;
    if (jobError instanceof TranslationServiceError) {
      if (jobError.statusCode === 404) return 'Translation job not found';
      if (jobError.statusCode === 403) return 'You do not have permission to view this translation';
      return jobError.message;
    }
    return 'Failed to load translation data';
  })();

  // Redirect on 403 after 3s, with proper cleanup so a fast-unmount doesn't
  // navigate from a stale timer.
  useEffect(() => {
    if (jobError instanceof TranslationServiceError && jobError.statusCode === 403) {
      const timer = setTimeout(() => navigate('/dashboard'), 3000);
      return () => clearTimeout(timer);
    }
  }, [jobError, navigate]);

  // Once the job is COMPLETED, download and read the translated blob.
  useEffect(() => {
    let cancelled = false;

    if (!jobId || !job || job.status !== 'COMPLETED') return;

    const loadTranslation = async () => {
      setDownloadLoading(true);
      setDownloadError(null);
      try {
        const translatedBlob = await translationService.downloadTranslation(jobId);

        // Guard against multi-GB blobs being read into memory.
        if (translatedBlob.size > MAX_BLOB_SIZE_BYTES) {
          if (!cancelled) {
            setDownloadError(
              `Translated document is too large to preview (${Math.round(
                translatedBlob.size / 1024 / 1024
              )}MB). Please download the file instead.`
            );
            setDownloadLoading(false);
          }
          return;
        }

        const translatedTextContent = await translatedBlob.text();
        if (cancelled) return;
        setTranslatedText(translatedTextContent);

        // TODO: Implement source text retrieval from backend.
        // The page is feature-flagged off by default (see FEATURE_FLAGS.COMPARE_VIEW)
        // precisely because of this. When the source-fetch API ships, replace this
        // placeholder with the real fetch call.
        setSourceText(
          'Note: Source text display requires backend implementation.\n\nThe original source document would appear here for comparison with the translation.'
        );
        setDownloadLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof TranslationServiceError) {
          setDownloadError(err.message);
        } else {
          setDownloadError('Failed to load translation data');
        }
        setDownloadLoading(false);
      }
    };

    loadTranslation();
    return () => {
      cancelled = true;
    };
  }, [jobId, job]);

  // No jobId in URL → render error directly.
  if (!jobId) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          No job ID provided
        </Alert>
        <Button component={RouterLink} to="/dashboard" startIcon={<ArrowBackIcon />}>
          Back to Dashboard
        </Button>
      </Container>
    );
  }

  // Loading job from React Query OR loading the translated blob.
  if (jobLoading || (job?.status === 'COMPLETED' && downloadLoading)) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading translation comparison...</Typography>
      </Container>
    );
  }

  // Error from job fetch or blob download.
  const error = fetchError ?? downloadError;
  if (error) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button component={RouterLink} to={`/translation/${jobId}`} startIcon={<ArrowBackIcon />}>
          Back to Translation Details
        </Button>
      </Container>
    );
  }

  // Job loaded but not yet COMPLETED.
  if (job && job.status !== 'COMPLETED') {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="warning" sx={{ mb: 3 }}>
          Translation is not yet completed. Please wait for the translation to finish.
        </Alert>
        <Button component={RouterLink} to={`/translation/${jobId}`} startIcon={<ArrowBackIcon />}>
          Back to Translation Details
        </Button>
      </Container>
    );
  }

  return (
    <Container
      maxWidth="xl"
      sx={{ py: 4, height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link component={RouterLink} to="/dashboard" underline="hover" color="inherit">
          Dashboard
        </Link>
        <Link component={RouterLink} to="/translation/history" underline="hover" color="inherit">
          Translation History
        </Link>
        <Link component={RouterLink} to={`/translation/${jobId}`} underline="hover" color="inherit">
          {job?.fileName || 'Translation Details'}
        </Link>
        <Typography color="text.primary">Compare</Typography>
      </Breadcrumbs>

      {/* Page Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4">Translation Comparison</Typography>
        <Button
          component={RouterLink}
          to={`/translation/${jobId}`}
          startIcon={<ArrowBackIcon />}
          variant="outlined"
        >
          Back to Details
        </Button>
      </Box>

      {/* Side-by-Side Viewer */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <SideBySideViewer
          sourceText={sourceText}
          translatedText={translatedText}
          sourceLanguage="Source"
          targetLanguage={job?.targetLanguage}
        />
      </Box>
    </Container>
  );
};
