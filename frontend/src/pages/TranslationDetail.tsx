/**
 * Translation Detail Page
 *
 * Displays detailed information about a translation job with download capability.
 * Implements requirements from OpenSpec: translation-detail/spec.md
 */

import React, { useEffect, useState } from 'react';
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
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  TranslationJob,
  translationService,
  TranslationServiceError,
} from '../services/translationService';
import { TranslationProgress } from '../components/Translation/TranslationProgress';

export const TranslationDetail: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<TranslationJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const fetchJobDetails = async () => {
    if (!jobId) {
      setError('No job ID provided');
      setLoading(false);
      return;
    }

    try {
      const jobData = await translationService.getJobStatus(jobId);
      setJob(jobData);
      setError(null);
    } catch (err) {
      if (err instanceof TranslationServiceError) {
        if (err.statusCode === 404) {
          setError('Translation job not found');
        } else if (err.statusCode === 403) {
          setError('You do not have permission to view this translation');
          setTimeout(() => navigate('/dashboard'), 3000);
        } else {
          setError(err.message);
        }
      } else {
        setError('Failed to load translation details');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobDetails();
  }, [jobId]);

  const handleDownload = async () => {
    if (!jobId || !job) return;

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
        setError(err.message);
      } else {
        setError('Failed to download translation');
      }
    } finally {
      setDownloading(false);
    }
  };

  const handleStartTranslation = async () => {
    if (!jobId || !job) return;

    try {
      await translationService.startTranslation(jobId, {
        targetLanguage: job.targetLanguage as any,
        tone: job.tone as any,
      });
      // Refresh job details
      await fetchJobDetails();
    } catch (err) {
      if (err instanceof TranslationServiceError) {
        setError(err.message);
      } else {
        setError('Failed to start translation');
      }
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading translation details...</Typography>
      </Container>
    );
  }

  if (error && !job) {
    return (
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
        <Button
          component={RouterLink}
          to="/translation/history"
          startIcon={<ArrowBackIcon />}
        >
          Go to Translation History
        </Button>
      </Container>
    );
  }

  if (!job) {
    return null;
  }

  const isInProgress =
    job.status === 'PENDING' ||
    job.status === 'CHUNKING' ||
    job.status === 'IN_PROGRESS';
  const isCompleted = job.status === 'COMPLETED';
  const isChunked = job.status === 'CHUNKED';
  const isFailed =
    job.status === 'FAILED' ||
    job.status === 'CHUNKING_FAILED' ||
    job.status === 'TRANSLATION_FAILED';

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
        <Typography color="text.primary">{job.fileName}</Typography>
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
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Progress Component */}
      {(isInProgress || isCompleted) && jobId && (
        <Box sx={{ mb: 4 }}>
          <TranslationProgress
            jobId={jobId}
            onComplete={(updatedJob) => setJob(updatedJob)}
            onError={(err) => setError(err)}
          />
        </Box>
      )}

      {/* Job Details */}
      <Paper elevation={1} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Job Information
        </Typography>
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
              <Typography variant="body2">{job.targetLanguage}</Typography>
            </Box>
          )}

          {job.tone && (
            <Box>
              <Typography variant="caption" color="text.secondary">
                Tone
              </Typography>
              <Typography variant="body2">{job.tone}</Typography>
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
      </Paper>

      {/* Action Buttons */}
      <Box sx={{ display: 'flex', gap: 2 }}>
        {isCompleted && (
          <Button
            variant="contained"
            startIcon={downloading ? <CircularProgress size={20} /> : <DownloadIcon />}
            onClick={handleDownload}
            disabled={downloading}
          >
            {downloading ? 'Downloading...' : 'Download Translation'}
          </Button>
        )}

        {isChunked && (
          <Button variant="contained" onClick={handleStartTranslation}>
            Start Translation
          </Button>
        )}

        {isFailed && (
          <Button variant="contained" color="warning" startIcon={<RefreshIcon />} onClick={handleStartTranslation}>
            Retry Translation
          </Button>
        )}

        <Button variant="outlined" onClick={fetchJobDetails} startIcon={<RefreshIcon />}>
          Refresh Status
        </Button>
      </Box>
    </Container>
  );
};
