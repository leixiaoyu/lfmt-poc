/**
 * Test Helpers for Integration Tests
 *
 * Provides reusable utilities for integration testing across all test suites.
 */

import { randomBytes } from 'crypto';

// Types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

export interface ApiResponse<T = any> {
  status: number;
  data: T;
  headers: Headers;
}

export interface UploadResponse {
  jobId: string;
  uploadUrl: string;
  uploadFields: Record<string, string>;
}

export interface JobStatus {
  jobId: string;
  userId: string;
  status: string;
  fileName?: string;
  fileSize?: number;
  contentType?: string;
  totalChunks?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TranslationStatus {
  jobId: string;
  translationStatus?: string;
  targetLanguage?: string;
  tone?: string;
  totalChunks?: number;
  chunksTranslated?: number;
  progressPercentage?: number;
  tokensUsed?: number;
  estimatedCost?: number;
  translationStartedAt?: string;
  translationCompletedAt?: string;
  estimatedCompletion?: string;
  error?: string;
}

// Configuration
export const API_BASE_URL =
  process.env.API_BASE_URL ||
  'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1';

export const TEST_EMAIL_DOMAIN = '@integration-test.com';

export const DEFAULT_TEST_TIMEOUT = 300000; // 5 minutes

// Utility Functions

/**
 * Generate a unique test email address
 */
export const generateTestEmail = (): string => {
  const randomId = randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return `test-${timestamp}-${randomId}${TEST_EMAIL_DOMAIN}`;
};

/**
 * Generate a unique test user
 */
export interface TestUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export const generateTestUser = (): TestUser => {
  return {
    email: generateTestEmail(),
    password: 'IntegrationTest123!',
    firstName: 'Integration',
    lastName: 'Test',
  };
};

/**
 * Sleep for specified milliseconds
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 */
export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  initialDelayMs: number = 1000
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries - 1) {
        const delay = initialDelayMs * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
};

/**
 * Make an API request
 */
export const apiRequest = async <T = any>(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  authToken?: string,
  additionalHeaders?: Record<string, string>
): Promise<ApiResponse<T>> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...additionalHeaders,
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: T;
  try {
    data = (await response.json()) as T;
  } catch (error) {
    data = null as any;
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
};

/**
 * Register a new user
 */
export const registerUser = async (user: TestUser): Promise<ApiResponse> => {
  return apiRequest('/auth/register', 'POST', {
    email: user.email,
    password: user.password,
    confirmPassword: user.password,
    firstName: user.firstName,
    lastName: user.lastName,
    acceptedTerms: true,
    acceptedPrivacy: true,
  });
};

/**
 * Login user
 */
export const loginUser = async (
  email: string,
  password: string
): Promise<ApiResponse<AuthTokens & { user: any }>> => {
  return apiRequest('/auth/login', 'POST', {
    email,
    password,
  });
};

/**
 * Register and login in one step
 */
export const registerAndLogin = async (
  email?: string,
  password?: string
): Promise<AuthTokens> => {
  const user = email && password
    ? { email, password, firstName: 'Test', lastName: 'User' }
    : generateTestUser();

  // Register (ignore if already exists)
  await registerUser(user);

  // Login
  const loginResponse = await loginUser(user.email, user.password);

  if (loginResponse.status !== 200) {
    throw new Error(
      `Login failed: ${loginResponse.status} - ${JSON.stringify(loginResponse.data)}`
    );
  }

  // Extract tokens from login response (tokens are at root level)
  return {
    accessToken: loginResponse.data.accessToken,
    refreshToken: loginResponse.data.refreshToken,
    idToken: loginResponse.data.idToken,
  };
};

/**
 * Request document upload with legal attestation
 */
export const requestUpload = async (
  authToken: string,
  fileName: string,
  fileSize: number,
  contentType: string = 'text/plain'
): Promise<UploadResponse> => {
  const response = await apiRequest<UploadResponse>(
    '/jobs/upload',
    'POST',
    {
      fileName,
      fileSize,
      contentType,
      legalAttestation: {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '127.0.0.1',
        userAgent: 'integration-test',
      },
    },
    authToken
  );

  if (response.status !== 200) {
    throw new Error(
      `Upload request failed: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return response.data;
};

/**
 * Upload document to S3
 */
export const uploadToS3 = async (
  uploadUrl: string,
  uploadFields: Record<string, string>,
  content: string,
  fileName: string
): Promise<void> => {
  const formData = new FormData();

  // Add all fields from uploadFields
  Object.entries(uploadFields).forEach(([key, value]) => {
    formData.append(key, value);
  });

  // Add file content
  const blob = new Blob([content], { type: 'text/plain' });
  formData.append('file', blob, fileName);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    body: formData,
  });

  if (uploadResponse.status !== 204 && uploadResponse.status !== 200) {
    throw new Error(
      `S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
    );
  }
};

/**
 * Complete document upload (request + S3 upload)
 */
export const uploadDocument = async (
  authToken: string,
  content: string,
  fileName: string = 'test-document.txt'
): Promise<string> => {
  const { jobId, uploadUrl, uploadFields } = await requestUpload(
    authToken,
    fileName,
    content.length
  );

  await uploadToS3(uploadUrl, uploadFields, content, fileName);

  return jobId;
};

/**
 * Get job status
 */
export const getJobStatus = async (
  authToken: string,
  jobId: string
): Promise<JobStatus> => {
  const response = await apiRequest<JobStatus>(
    `/jobs/${jobId}`,
    'GET',
    undefined,
    authToken
  );

  if (response.status !== 200) {
    throw new Error(
      `Get job status failed: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return response.data;
};

/**
 * Wait for job to reach a specific status
 */
export const waitForJobStatus = async (
  authToken: string,
  jobId: string,
  targetStatus: string | string[],
  maxWaitTime: number = 30000, // Reduced from 60s to 30s for faster failure detection
  pollInterval: number = 1000 // Reduced from 2s to 1s for faster feedback
): Promise<JobStatus> => {
  const startTime = Date.now();
  const targetStatuses = Array.isArray(targetStatus) ? targetStatus : [targetStatus];

  while (Date.now() - startTime < maxWaitTime) {
    const status = await getJobStatus(authToken, jobId);

    if (targetStatuses.includes(status.status)) {
      return status;
    }

    if (status.status.includes('FAILED')) {
      throw new Error(
        `Job failed: ${status.status} - ${status.error || 'Unknown error'}`
      );
    }

    await sleep(pollInterval);
  }

  throw new Error(`Timeout waiting for status ${targetStatuses.join(' or ')}`);
};

/**
 * Wait for document chunking to complete
 */
export const waitForChunking = async (
  authToken: string,
  jobId: string,
  maxWaitTime: number = 30000 // Reduced from 60s to 30s
): Promise<JobStatus> => {
  return waitForJobStatus(authToken, jobId, 'CHUNKED', maxWaitTime);
};

/**
 * Start translation
 */
export const startTranslation = async (
  authToken: string,
  jobId: string,
  targetLanguage: string = 'es',
  tone: 'formal' | 'informal' | 'neutral' = 'neutral'
): Promise<void> => {
  const response = await apiRequest(
    `/jobs/${jobId}/translate`,
    'POST',
    {
      targetLanguage,
      tone,
    },
    authToken
  );

  if (response.status !== 200 && response.status !== 202) {
    throw new Error(
      `Start translation failed: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }
};

/**
 * Get translation status
 */
export const getTranslationStatus = async (
  authToken: string,
  jobId: string
): Promise<TranslationStatus> => {
  const response = await apiRequest<TranslationStatus>(
    `/jobs/${jobId}/translation-status`,
    'GET',
    undefined,
    authToken
  );

  if (response.status !== 200) {
    throw new Error(
      `Get translation status failed: ${response.status} - ${JSON.stringify(response.data)}`
    );
  }

  return response.data;
};

/**
 * Wait for translation to complete
 */
export const waitForTranslation = async (
  authToken: string,
  jobId: string,
  maxWaitTime: number = 90000, // Reduced from 180s (3min) to 90s (1.5min) for faster tests
  pollInterval: number = 2000 // Reduced from 5s to 2s for faster feedback
): Promise<TranslationStatus> => {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const status = await getTranslationStatus(authToken, jobId);

    if (status.translationStatus === 'COMPLETED') {
      return status;
    }

    if (status.translationStatus === 'TRANSLATION_FAILED') {
      throw new Error(
        `Translation failed: ${status.error || 'Unknown error'}`
      );
    }

    await sleep(pollInterval);
  }

  throw new Error(`Translation timeout after ${maxWaitTime}ms`);
};

/**
 * Complete workflow: upload, chunk, translate
 */
export const completeTranslationWorkflow = async (
  authToken: string,
  documentContent: string,
  fileName: string,
  targetLanguage: string = 'es',
  tone: 'formal' | 'informal' | 'neutral' = 'neutral',
  maxWaitTime: number = 120000 // Reduced from 300s (5min) to 120s (2min) for faster tests
): Promise<{
  jobId: string;
  jobStatus: JobStatus;
  translationStatus: TranslationStatus;
}> => {
  // Upload
  const jobId = await uploadDocument(authToken, documentContent, fileName);

  // Wait for chunking
  const jobStatus = await waitForChunking(authToken, jobId);

  // Start translation
  await startTranslation(authToken, jobId, targetLanguage, tone);

  // Wait for completion
  const translationStatus = await waitForTranslation(authToken, jobId, maxWaitTime);

  return {
    jobId,
    jobStatus,
    translationStatus,
  };
};

/**
 * Verify CORS headers
 */
export const verifyCorsHeaders = (headers: Headers): void => {
  const corsOrigin = headers.get('access-control-allow-origin');
  const corsCredentials = headers.get('access-control-allow-credentials');

  if (!corsOrigin) {
    throw new Error('Missing CORS header: access-control-allow-origin');
  }

  if (!corsCredentials) {
    throw new Error('Missing CORS header: access-control-allow-credentials');
  }
};

/**
 * Verify response format
 */
export const verifyResponseFormat = (
  data: any,
  requiredFields: string[]
): void => {
  requiredFields.forEach((field) => {
    if (!(field in data)) {
      throw new Error(`Missing required field: ${field}`);
    }
  });
};

/**
 * Measure execution time
 */
export const measureTime = async <T>(
  fn: () => Promise<T>
): Promise<{ result: T; durationMs: number }> => {
  const startTime = Date.now();
  const result = await fn();
  const durationMs = Date.now() - startTime;

  return { result, durationMs };
};

/**
 * Format duration for logging
 */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
};

/**
 * Create a test context with cleanup
 */
export class TestContext {
  private authTokens: AuthTokens | null = null;
  private jobIds: string[] = [];
  private user: TestUser | null = null;

  async initialize(): Promise<void> {
    this.user = generateTestUser();
    this.authTokens = await registerAndLogin(this.user.email, this.user.password);
  }

  getAuthTokens(): AuthTokens {
    if (!this.authTokens) {
      throw new Error('TestContext not initialized. Call initialize() first.');
    }
    return this.authTokens;
  }

  getAccessToken(): string {
    return this.getAuthTokens().accessToken;
  }

  getUser(): TestUser {
    if (!this.user) {
      throw new Error('TestContext not initialized. Call initialize() first.');
    }
    return this.user;
  }

  trackJob(jobId: string): void {
    this.jobIds.push(jobId);
  }

  getJobIds(): string[] {
    return [...this.jobIds];
  }

  async cleanup(): Promise<void> {
    // In a real implementation, this would clean up test data
    // For now, we just log
    if (this.jobIds.length > 0) {
      console.log(`Test context cleanup: ${this.jobIds.length} jobs created`);
    }
  }
}
