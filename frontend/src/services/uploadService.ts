/**
 * Upload Service
 *
 * Handles document upload workflow:
 * 1. Request presigned URL from backend
 * 2. Upload file directly to S3
 * 3. Track upload progress
 *
 * Uses centralized API client for backend communication.
 */

import { apiClient } from '../utils/api';
import type { PresignedUrlRequest, PresignedUrlResponse } from '@lfmt/shared-types';

/**
 * Upload progress callback
 */
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type UploadProgressCallback = (progress: UploadProgress) => void;

/**
 * Upload request result
 */
export interface UploadRequestResult {
  uploadUrl: string;
  fileId: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>;
}

/**
 * Upload completion result
 */
export interface UploadResult {
  fileId: string;
  success: boolean;
  error?: string;
}

/**
 * Request presigned URL from backend
 *
 * @param file - File to upload
 * @returns Presigned URL and metadata for upload
 * @throws ApiError if request fails
 */
export async function requestUploadUrl(
  file: File
): Promise<UploadRequestResult> {
  const request: PresignedUrlRequest = {
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type,
  };

  const response = await apiClient.post<{ data: PresignedUrlResponse }>(
    '/jobs/upload',
    request
  );

  return response.data.data;
}

/**
 * Upload file to S3 using presigned URL
 *
 * @param file - File to upload
 * @param uploadUrl - Presigned URL from backend
 * @param requiredHeaders - Headers required by S3
 * @param onProgress - Optional progress callback
 * @returns Upload result
 * @throws Error if upload fails
 */
export async function uploadToS3(
  file: File,
  uploadUrl: string,
  requiredHeaders: Record<string, string>,
  onProgress?: UploadProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    // Track upload progress
    if (onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          });
        }
      });
    }

    // Handle completion
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(
          new Error(
            `Upload failed with status ${xhr.status}: ${xhr.statusText}`
          )
        );
      }
    });

    // Handle errors
    xhr.addEventListener('error', () => {
      reject(new Error('Network error during file upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error('Upload was cancelled'));
    });

    // Configure and send request
    xhr.open('PUT', uploadUrl);

    // Set required headers
    Object.entries(requiredHeaders).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });

    xhr.send(file);
  });
}

/**
 * Complete document upload workflow
 *
 * @param file - File to upload
 * @param onProgress - Optional progress callback
 * @returns Upload result with fileId
 * @throws Error if any step fails
 */
export async function uploadDocument(
  file: File,
  onProgress?: UploadProgressCallback
): Promise<UploadResult> {
  try {
    // Step 1: Request presigned URL
    const { uploadUrl, fileId, requiredHeaders } = await requestUploadUrl(
      file
    );

    // Step 2: Upload to S3
    await uploadToS3(file, uploadUrl, requiredHeaders, onProgress);

    return {
      fileId,
      success: true,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Upload failed';

    return {
      fileId: '',
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * UploadService
 *
 * Exported object with all upload methods
 */
export const uploadService = {
  requestUploadUrl,
  uploadToS3,
  uploadDocument,
};
