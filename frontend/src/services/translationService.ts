/**
 * Translation Service
 *
 * Handles all translation-related API calls including job management,
 * file uploads, and status tracking.
 */

import axios, { AxiosError } from 'axios';
import { getAuthToken } from '../utils/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/v1';

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
    const formData = new FormData();
    formData.append('file', request.file);
    formData.append('legalAttestation', JSON.stringify(request.legalAttestation));

    const response = await axios.post<{ data: TranslationJob }>(
      `${API_BASE_URL}/translation/upload`,
      formData,
      {
        headers: {
          ...getAuthHeaders(),
          'Content-Type': 'multipart/form-data',
        },
      }
    );

    return response.data.data;
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
      `${API_BASE_URL}/translation/${jobId}/start`,
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
      `${API_BASE_URL}/translation/${jobId}/status`,
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
      `${API_BASE_URL}/translation/jobs`,
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
 */
export const getUserIPAddress = async (): Promise<string> => {
  try {
    // Use a public IP API service
    const response = await axios.get('https://api.ipify.org?format=json');
    return response.data.ip;
  } catch (error) {
    // Fallback to unknown if service is unavailable
    console.warn('Failed to get IP address:', error);
    return 'unknown';
  }
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
