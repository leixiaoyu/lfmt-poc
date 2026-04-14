/**
 * Translation Compare Page
 *
 * Displays side-by-side comparison of source and translated documents.
 * Implements requirements from GitHub Issue #27
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

export const TranslationCompare: React.FC = () => {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [sourceText, setSourceText] = useState<string>('');
  const [translatedText, setTranslatedText] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobData, setJobData] = useState<{
    fileName: string;
    sourceLanguage?: string;
    targetLanguage?: string;
  } | null>(null);

  useEffect(() => {
    const fetchTranslationData = async () => {
      if (!jobId) {
        setError('No job ID provided');
        setLoading(false);
        return;
      }

      try {
        // Get job details
        const job = await translationService.getJobStatus(jobId);

        if (job.status !== 'COMPLETED') {
          setError('Translation is not yet completed. Please wait for the translation to finish.');
          setLoading(false);
          return;
        }

        setJobData({
          fileName: job.fileName,
          sourceLanguage: 'Source',
          targetLanguage: job.targetLanguage,
        });

        // Download translated file
        const translatedBlob = await translationService.downloadTranslation(jobId);

        // Read translated text
        const translatedTextContent = await translatedBlob.text();
        setTranslatedText(translatedTextContent);

        // TODO: Implement source text retrieval from backend
        // For now, use a placeholder
        setSourceText(
          'Note: Source text display requires backend implementation.\n\nThe original source document would appear here for comparison with the translation.'
        );

        setLoading(false);
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
          setError('Failed to load translation data');
        }
        setLoading(false);
      }
    };

    fetchTranslationData();
  }, [jobId, navigate]);

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading translation comparison...</Typography>
      </Container>
    );
  }

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

  return (
    <Container maxWidth="xl" sx={{ py: 4, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Breadcrumbs */}
      <Breadcrumbs sx={{ mb: 3 }}>
        <Link component={RouterLink} to="/dashboard" underline="hover" color="inherit">
          Dashboard
        </Link>
        <Link component={RouterLink} to="/translation/history" underline="hover" color="inherit">
          Translation History
        </Link>
        <Link component={RouterLink} to={`/translation/${jobId}`} underline="hover" color="inherit">
          {jobData?.fileName || 'Translation Details'}
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
          sourceLanguage={jobData?.sourceLanguage}
          targetLanguage={jobData?.targetLanguage}
        />
      </Box>
    </Container>
  );
};
