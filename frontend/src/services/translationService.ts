/**
 * Translation Service
 *
 * Handles all translation-related API calls including job management,
 * file uploads, and status tracking.
 */

import axios, { AxiosError } from 'axios';
import { getAuthToken } from '../utils/api';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/v1';

/**
 * Translation Job Status
 */
export interface TranslationJob {
  jobId: string;
  userId: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  status: 'PENDING' | 'CHUNKING' | 'CHUNKED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' |
          'CHUNKING_FAILED' | 'TRANSLATION_FAILED';
  targetLanguage?: string;
  tone?: 'formal' | 'informal' | 'neutral';
  totalChunks?: number;
  completedChunks?: number;
  failedChunks?: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

/**
 * Legal Attestation Data
 */
export interface LegalAttestation {
  acceptCopyrightOwnership: boolean;
  acceptTranslationRights: boolean;
  acceptLiabilityTerms: boolean;
  userIPAddress: string;
  userAgent: string;
  timestamp: string;
}

/**
 * Translation Configuration
 */
export interface TranslationConfig {
  targetLanguage: 'es' | 'fr' | 'de' | 'it' | 'zh';
  tone: 'formal' | 'informal' | 'neutral';
}

/**
 * Upload Document Request
 */
export interface UploadDocumentRequest {
  file: File;
  legalAttestation: LegalAttestation;
}

/**
 * Start Translation Request
 */
export interface StartTranslationRequest {
  targetLanguage: string;
  tone: string;
}

/**
 * Translation Service Error
 */
export class TranslationServiceError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: AxiosError
  ) {
    super(message);
    this.name = 'TranslationServiceError';
  }
}

/**
 * Get authenticated headers
 */
const getAuthHeaders = () => {
  const token = getAuthToken();
  if (!token) {
    throw new TranslationServiceError('Not authenticated', 401);
  }
  return {
    Authorization: `Bearer ${token}`,
  };
};

/**
 * Handle API errors
 */
const handleError = (error: unknown): never => {
  // Re-throw TranslationServiceError without wrapping
  if (error instanceof TranslationServiceError) {
    throw error;
  }

  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message || error.message;
    const statusCode = error.response?.status;
    throw new TranslationServiceError(message, statusCode, error);
  }
  throw new TranslationServiceError('An unexpected error occurred');
};

/**
 * Upload a document for translation
 */
export const uploadDocument = async (request: UploadDocumentRequest): Promise<TranslationJob> => {
  try {
    // Step 1: Request presigned URL from backend
    const presignedResponse = await axios.post<{
      data: {
        uploadUrl: string;
        fileId: string;
        expiresIn: number;
        requiredHeaders: Record<string, string>;
      };
    }>(
      `${API_BASE_URL}/jobs/upload`,
      {
        fileName: request.file.name,
        fileSize: request.file.size,
        contentType: request.file.type,
        legalAttestation: request.legalAttestation,
      },
      {
        headers: getAuthHeaders(),
      }
    );

    const { uploadUrl, fileId, requiredHeaders } = presignedResponse.data.data;

    // Step 2: Upload file directly to S3 using presigned URL
    await axios.put(uploadUrl, request.file, {
      headers: {
        ...requiredHeaders,
        'Content-Type': request.file.type,
      },
    });

    // Step 3: Return job information
    // Note: The backend creates the job record but doesn't return it immediately
    // The job will be retrieved later when starting translation
    return {
      jobId: fileId,
      userId: '', // Will be populated by backend
      fileName: request.file.name,
      fileSize: request.file.size,
      contentType: request.file.type,
      status: 'PENDING' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Start translation for a job
 */
export const startTranslation = async (
  jobId: string,
  config: TranslationConfig
): Promise<TranslationJob> => {
  try {
    const response = await axios.post<{ data: TranslationJob }>(
      `${API_BASE_URL}/jobs/${jobId}/translate`,
      {
        targetLanguage: config.targetLanguage,
        tone: config.tone,
      },
      {
        headers: getAuthHeaders(),
      }
    );

    return response.data.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get job status
 */
export const getJobStatus = async (jobId: string): Promise<TranslationJob> => {
  try {
    const response = await axios.get<{ data: TranslationJob }>(
      `${API_BASE_URL}/jobs/${jobId}/translation-status`,
      {
        headers: getAuthHeaders(),
      }
    );

    return response.data.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get all translation jobs for the current user
 */
export const getTranslationJobs = async (): Promise<TranslationJob[]> => {
  try {
    const response = await axios.get<{ data: TranslationJob[] }>(
      `${API_BASE_URL}/jobs`,
      {
        headers: getAuthHeaders(),
      }
    );

    return response.data.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Download translated document
 */
export const downloadTranslation = async (jobId: string): Promise<Blob> => {
  try {
    const response = await axios.get(`${API_BASE_URL}/translation/${jobId}/download`, {
      headers: getAuthHeaders(),
      responseType: 'blob',
    });

    return response.data;
  } catch (error) {
    return handleError(error);
  }
};

/**
 * Get user's IP address for legal attestation
 * Note: IP address is now captured on the backend from request headers
 * This function returns a placeholder that will be replaced by the backend
 */
export const getUserIPAddress = async (): Promise<string> => {
  // Backend will capture the actual IP from API Gateway event headers
  return 'captured-by-backend';
};

/**
 * Create legal attestation data
 */
export const createLegalAttestation = async (
  acceptCopyrightOwnership: boolean,
  acceptTranslationRights: boolean,
  acceptLiabilityTerms: boolean
): Promise<LegalAttestation> => {
  const ipAddress = await getUserIPAddress();
  const userAgent = navigator.userAgent;
  const timestamp = new Date().toISOString();

  return {
    acceptCopyrightOwnership,
    acceptTranslationRights,
    acceptLiabilityTerms,
    userIPAddress: ipAddress,
    userAgent,
    timestamp,
  };
};

/**
 * Translation Service exports
 */
export const translationService = {
  uploadDocument,
  startTranslation,
  getJobStatus,
  getTranslationJobs,
  downloadTranslation,
  getUserIPAddress,
  createLegalAttestation,
};
