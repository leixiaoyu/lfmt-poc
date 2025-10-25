/**
 * FileUploadForm Component
 *
 * Document upload interface for translation service.
 * Provides file selection, validation, and upload progress tracking.
 *
 * Features:
 * - File selection with drag-and-drop support
 * - File type and size validation
 * - Upload progress indicator
 * - Error handling and user feedback
 * - Integration with upload service
 */

import { useState, useCallback, useRef } from 'react';
import {
  Box,
  Button,
  Typography,
  Alert,
  LinearProgress,
  Paper,
  Stack,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { uploadService, type UploadProgress } from '../../services/uploadService';

/**
 * File validation constraints
 * Based on backend limits
 */
const FILE_CONSTRAINTS = {
  MAX_SIZE: 100 * 1024 * 1024, // 100MB (matches backend)
  MIN_SIZE: 1000, // 1KB (matches backend)
  ALLOWED_TYPE: 'text/plain',
  ALLOWED_EXTENSION: '.txt',
};

/**
 * Upload state
 */
type UploadState = 'idle' | 'uploading' | 'success' | 'error';

/**
 * FileUploadForm Props
 */
export interface FileUploadFormProps {
  /** Callback when upload completes successfully */
  onUploadComplete: (fileId: string) => void;
  /** Optional callback when upload fails */
  onUploadError?: (error: string) => void;
}

/**
 * FileUploadForm Component
 *
 * @example
 * ```tsx
 * <FileUploadForm
 *   onUploadComplete={(fileId) => {
 *     console.log('File uploaded:', fileId);
 *     navigate(`/translation/${fileId}`);
 *   }}
 * />
 * ```
 */
export function FileUploadForm({
  onUploadComplete,
  onUploadError,
}: FileUploadFormProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Validate selected file
   */
  const validateFile = useCallback((file: File): string | null => {
    // Check file type
    if (file.type !== FILE_CONSTRAINTS.ALLOWED_TYPE) {
      return `Only ${FILE_CONSTRAINTS.ALLOWED_EXTENSION} files are allowed`;
    }

    // Check file extension
    if (!file.name.toLowerCase().endsWith(FILE_CONSTRAINTS.ALLOWED_EXTENSION)) {
      return `Only ${FILE_CONSTRAINTS.ALLOWED_EXTENSION} files are allowed`;
    }

    // Check file size
    if (file.size > FILE_CONSTRAINTS.MAX_SIZE) {
      return `File size exceeds maximum allowed size of ${FILE_CONSTRAINTS.MAX_SIZE / (1024 * 1024)}MB`;
    }

    if (file.size < FILE_CONSTRAINTS.MIN_SIZE) {
      return `File size is below minimum required size of ${FILE_CONSTRAINTS.MIN_SIZE} bytes`;
    }

    return null;
  }, []);

  /**
   * Handle file selection
   */
  const handleFileSelect = useCallback(
    (file: File | null) => {
      if (!file) {
        setSelectedFile(null);
        setErrorMessage(null);
        return;
      }

      const validationError = validateFile(file);
      if (validationError) {
        setErrorMessage(validationError);
        setSelectedFile(null);
        return;
      }

      setSelectedFile(file);
      setErrorMessage(null);
      setUploadState('idle');
    },
    [validateFile]
  );

  /**
   * Handle file input change
   */
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    handleFileSelect(file);
  };

  /**
   * Handle drag events
   */
  const handleDrag = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.type === 'dragenter' || event.type === 'dragover') {
      setDragActive(true);
    } else if (event.type === 'dragleave') {
      setDragActive(false);
    }
  };

  /**
   * Handle drop event
   */
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);

    const file = event.dataTransfer.files?.[0] || null;
    handleFileSelect(file);
  };

  /**
   * Handle upload progress
   */
  const handleProgress = useCallback((progress: UploadProgress) => {
    setUploadProgress(progress.percentage);
  }, []);

  /**
   * Handle file upload
   */
  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      setUploadState('uploading');
      setUploadProgress(0);
      setErrorMessage(null);

      const result = await uploadService.uploadDocument(
        selectedFile,
        handleProgress
      );

      if (result.success) {
        setUploadState('success');
        setUploadProgress(100);
        onUploadComplete(result.fileId);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to upload file';
      setUploadState('error');
      setErrorMessage(message);
      onUploadError?.(message);
    }
  };

  /**
   * Reset form
   */
  const handleReset = () => {
    setSelectedFile(null);
    setUploadState('idle');
    setUploadProgress(0);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Trigger file input click
   */
  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <Box sx={{ width: '100%', maxWidth: 600 }}>
      <Typography variant="h5" component="h2" gutterBottom>
        Upload Document
      </Typography>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Upload a text file (.txt) for translation. Maximum file size: 100MB.
      </Typography>

      {/* Error Alert */}
      {errorMessage && uploadState !== 'success' && (
        <Alert severity="error" sx={{ mb: 2 }} icon={<ErrorIcon />}>
          {errorMessage}
        </Alert>
      )}

      {/* Success Alert */}
      {uploadState === 'success' && (
        <Alert severity="success" sx={{ mb: 2 }} icon={<CheckCircleIcon />}>
          File uploaded successfully!
        </Alert>
      )}

      {/* File Drop Zone */}
      {uploadState === 'idle' || uploadState === 'error' ? (
        <>
          <Paper
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            sx={{
              p: 4,
              mb: 2,
              border: 2,
              borderStyle: 'dashed',
              borderColor: dragActive ? 'primary.main' : 'divider',
              bgcolor: dragActive ? 'action.hover' : 'background.paper',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                borderColor: 'primary.main',
                bgcolor: 'action.hover',
              },
            }}
            onClick={handleBrowseClick}
          >
            <Stack spacing={2} alignItems="center">
              <CloudUploadIcon
                sx={{ fontSize: 60, color: 'text.secondary' }}
              />
              <Typography variant="h6" align="center">
                {selectedFile
                  ? selectedFile.name
                  : 'Drag and drop your file here'}
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center">
                or click to browse
              </Typography>
              {selectedFile && (
                <Typography variant="caption" color="text.secondary">
                  {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                </Typography>
              )}
            </Stack>
          </Paper>

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_CONSTRAINTS.ALLOWED_EXTENSION}
            onChange={handleInputChange}
            style={{ display: 'none' }}
            aria-label="File upload input"
          />

          {/* Upload Button */}
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              onClick={handleUpload}
              disabled={!selectedFile}
              fullWidth
              size="large"
            >
              Upload
            </Button>
            {selectedFile && (
              <Button
                variant="outlined"
                onClick={handleReset}
                size="large"
              >
                Clear
              </Button>
            )}
          </Stack>
        </>
      ) : null}

      {/* Upload Progress */}
      {uploadState === 'uploading' && (
        <Box>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Uploading {selectedFile?.name}...
          </Typography>
          <LinearProgress
            variant="determinate"
            value={uploadProgress}
            sx={{ mb: 1 }}
          />
          <Typography variant="caption" color="text.secondary">
            {uploadProgress}%
          </Typography>
        </Box>
      )}

      {/* Success State */}
      {uploadState === 'success' && (
        <Button variant="outlined" onClick={handleReset} fullWidth size="large">
          Upload Another File
        </Button>
      )}
    </Box>
  );
}
