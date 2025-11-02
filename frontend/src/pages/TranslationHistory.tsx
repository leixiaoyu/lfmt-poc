/**
 * Translation History Page
 *
 * Displays all translation jobs for the current user with filtering and sorting.
 * Implements requirements from OpenSpec: translation-history/spec.md
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  MenuItem,
  IconButton,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityIcon from '@mui/icons-material/Visibility';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  TranslationJob,
  translationService,
  TranslationServiceError,
} from '../services/translationService';

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

export const TranslationHistory: React.FC = () => {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<TranslationJob[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<TranslationJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const jobsData = await translationService.getTranslationJobs();
      setJobs(jobsData);
      setFilteredJobs(jobsData);
      setError(null);
    } catch (err) {
      if (err instanceof TranslationServiceError) {
        setError(err.message);
      } else {
        setError('Failed to load translation history');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  useEffect(() => {
    let filtered = [...jobs];

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((job) => job.status === statusFilter);
    }

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (job) =>
          job.fileName.toLowerCase().includes(query) ||
          job.jobId.toLowerCase().includes(query)
      );
    }

    setFilteredJobs(filtered);
  }, [jobs, statusFilter, searchQuery]);

  const handleViewDetails = (jobId: string) => {
    navigate(`/translation/${jobId}`);
  };

  const handleDownload = async (jobId: string, fileName: string) => {
    try {
      const blob = await translationService.downloadTranslation(jobId);

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `translated_${fileName}`;
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
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  if (loading) {
    return (
      <Container maxWidth="lg" sx={{ py: 4, textAlign: 'center' }}>
        <CircularProgress />
        <Typography sx={{ mt: 2 }}>Loading translation history...</Typography>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* Page Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Typography variant="h4">Translation History</Typography>
        <Button
          component={RouterLink}
          to="/translation/upload"
          variant="contained"
          startIcon={<AddIcon />}
        >
          New Translation
        </Button>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <TextField
          label="Search"
          variant="outlined"
          size="small"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by file name or job ID"
          sx={{ flex: 1, maxWidth: 400 }}
        />

        <TextField
          select
          label="Status"
          variant="outlined"
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="all">All Statuses</MenuItem>
          <MenuItem value="PENDING">Pending</MenuItem>
          <MenuItem value="CHUNKING">Chunking</MenuItem>
          <MenuItem value="CHUNKED">Chunked</MenuItem>
          <MenuItem value="IN_PROGRESS">In Progress</MenuItem>
          <MenuItem value="COMPLETED">Completed</MenuItem>
          <MenuItem value="FAILED">Failed</MenuItem>
        </TextField>

        <Tooltip title="Refresh">
          <IconButton onClick={fetchJobs} color="primary">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Jobs Table */}
      {filteredJobs.length === 0 ? (
        <Paper elevation={1} sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {jobs.length === 0
              ? 'No translations yet. Start your first translation!'
              : 'No translations match your filters.'}
          </Typography>
          {jobs.length === 0 && (
            <Button
              component={RouterLink}
              to="/translation/upload"
              variant="contained"
              startIcon={<AddIcon />}
              sx={{ mt: 2 }}
            >
              New Translation
            </Button>
          )}
        </Paper>
      ) : (
        <TableContainer component={Paper} elevation={1}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>File Name</TableCell>
                <TableCell>Language</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredJobs.map((job) => (
                <TableRow
                  key={job.jobId}
                  hover
                  sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                >
                  <TableCell>
                    <Typography variant="body2">{job.fileName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {job.jobId}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {job.targetLanguage ? (
                      <Box>
                        <Typography variant="body2">{job.targetLanguage}</Typography>
                        {job.tone && (
                          <Typography variant="caption" color="text.secondary">
                            {job.tone}
                          </Typography>
                        )}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Not set
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={job.status}
                      color={STATUS_COLORS[job.status]}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>{formatDate(job.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="View Details">
                      <IconButton
                        size="small"
                        onClick={() => handleViewDetails(job.jobId)}
                        color="primary"
                      >
                        <VisibilityIcon />
                      </IconButton>
                    </Tooltip>
                    {job.status === 'COMPLETED' && (
                      <Tooltip title="Download">
                        <IconButton
                          size="small"
                          onClick={() => handleDownload(job.jobId, job.fileName)}
                          color="success"
                        >
                          <DownloadIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Summary */}
      {filteredJobs.length > 0 && (
        <Box sx={{ mt: 2, textAlign: 'right' }}>
          <Typography variant="caption" color="text.secondary">
            Showing {filteredJobs.length} of {jobs.length} translations
          </Typography>
        </Box>
      )}
    </Container>
  );
};
