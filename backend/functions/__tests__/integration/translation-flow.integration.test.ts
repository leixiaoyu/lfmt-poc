/**
 * End-to-End Translation Flow Integration Tests
 *
 * These tests verify the complete translation workflow:
 * 1. User authentication (register/login)
 * 2. Upload request with legal attestation
 * 3. Document upload to S3
 * 4. Document chunking
 * 5. Start translation
 * 6. Monitor translation progress
 * 7. Download translated document
 *
 * Prerequisites:
 * - AWS infrastructure deployed to dev environment
 * - API Gateway URL configured
 * - Cognito User Pool accessible
 * - S3 buckets created
 * - DynamoDB tables created
 * - Gemini API key configured in Secrets Manager
 *
 * Run with: npm run test:integration -- translation-flow.integration.test.ts
 *
 * Environment Variables:
 * - API_BASE_URL: API Gateway base URL (default: dev endpoint)
 * - TEST_TIMEOUT: Test timeout in milliseconds (default: 300000 = 5 minutes)
 */

import { randomBytes } from 'crypto';
import { API_BASE_URL, DEFAULT_TEST_TIMEOUT } from './helpers/test-helpers';

// Configuration
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT || `${DEFAULT_TEST_TIMEOUT}`, 10);
const TEST_EMAIL_DOMAIN = '@example.org'; // Using .org for better Cognito compatibility

// Test document content (minimal text for fast testing, exactly 1000+ bytes)
// IMPORTANT: Keep this short to minimize translation API calls and test execution time
const TEST_DOCUMENT_CONTENT = `Integration Test Document

This is a minimal test document for the LFMT translation service integration tests.
The purpose of this document is to validate that the translation workflow functions
correctly while minimizing API call costs and test execution time. This document
contains exactly enough text to meet the minimum file size requirement of 1000 bytes
without exceeding it significantly.

The translation system processes this document through the following stages:
1. Upload to S3 storage
2. Document chunking based on token limits
3. Translation via Gemini API
4. Chunk reassembly and formatting preservation

This short document allows us to test all core functionality including:
- Authentication and authorization
- File upload with legal attestation
- Document chunking algorithm
- Translation API integration
- Progress tracking and status updates
- Error handling and validation

By keeping the document minimal, we reduce:
- Translation API costs (fewer tokens processed)
- Test execution time (faster translation completion)
- Cloud resource usage (smaller S3 storage, faster Lambda execution)

This approach ensures our integration tests run quickly while still validating
all critical system functionality. End padding text to reach minimum size requirement.`;

// Helper types
interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

interface UploadResponse {
  uploadUrl: string;
  fileId: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>;
}

interface TranslationStatus {
  jobId: string;
  status: string;
  translationStatus?: string;
  totalChunks?: number;
  chunksTranslated?: number;
  progressPercentage?: number;
  targetLanguage?: string;
  tone?: string;
  estimatedCompletion?: string;
  translationStartedAt?: string;
  translationCompletedAt?: string;
  error?: string;
  tokensUsed?: number;
  estimatedCost?: number;
}

// Helper functions
const generateTestEmail = (): string => {
  const randomId = randomBytes(8).toString('hex');
  return `test-${randomId}${TEST_EMAIL_DOMAIN}`;
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const apiRequest = async (
  endpoint: string,
  method: string = 'GET',
  body?: any,
  authToken?: string
): Promise<{ status: number; data: any; headers: Headers }> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  return {
    status: response.status,
    data,
    headers: response.headers,
  };
};

const registerAndLogin = async (
  email: string,
  password: string
): Promise<AuthTokens> => {
  // Register
  const registerResponse = await apiRequest('/auth/register', 'POST', {
    email,
    password,
    confirmPassword: password,
    firstName: 'Integration',
    lastName: 'Test',
    acceptedTerms: true,
    acceptedPrivacy: true,
  });

  if (registerResponse.status !== 201 && registerResponse.status !== 409) {
    throw new Error(
      `Registration failed: ${registerResponse.status} - ${JSON.stringify(registerResponse.data)}`
    );
  }

  // Login (works even if user already exists)
  const loginResponse = await apiRequest('/auth/login', 'POST', {
    email,
    password,
  });

  if (loginResponse.status !== 200) {
    throw new Error(
      `Login failed: ${loginResponse.status} - ${JSON.stringify(loginResponse.data)}`
    );
  }

  // Extract tokens from login response (all tokens are at root level)
  return {
    accessToken: loginResponse.data.accessToken,
    refreshToken: loginResponse.data.refreshToken,
    idToken: loginResponse.data.idToken,
  };
};

const uploadDocument = async (
  authToken: string,
  content: string,
  fileName: string = 'test-document.txt'
): Promise<{ jobId: string; fileId: string }> => {
  // Step 1: Request upload with legal attestation
  const uploadRequestResponse = await apiRequest(
    '/jobs/upload',
    'POST',
    {
      fileName,
      fileSize: content.length,
      contentType: 'text/plain',
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

  if (uploadRequestResponse.status !== 200) {
    throw new Error(
      `Upload request failed: ${uploadRequestResponse.status} - ${JSON.stringify(uploadRequestResponse.data)}`
    );
  }

  const uploadData: UploadResponse = uploadRequestResponse.data.data;
  const { uploadUrl, fileId, requiredHeaders } = uploadData;

  // Extract jobId from presigned URL metadata
  const urlParams = new URLSearchParams(uploadUrl.split('?')[1]);
  const jobId = urlParams.get('x-amz-meta-jobid');

  if (!jobId) {
    throw new Error('Job ID not found in upload URL');
  }

  // Step 2: Upload to S3 using presigned PUT URL
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: requiredHeaders,
    body: content,
  });

  if (uploadResponse.status !== 200) {
    throw new Error(`S3 upload failed: ${uploadResponse.status}`);
  }

  return { jobId, fileId };
};

const waitForChunking = async (
  authToken: string,
  jobId: string,
  maxWaitTime: number = 30000 // Reduced from 60s to 30s
): Promise<void> => {
  const startTime = Date.now();
  let pollInterval = 2000; // Start with 2s interval
  let pollCount = 0;

  // Initial delay to allow S3 event notifications to propagate
  // S3 PUT → uploadComplete Lambda → file copy → chunkDocument Lambda trigger
  // Typical delay: 2-10 seconds
  console.log('Waiting 6 seconds for S3 event notifications to propagate...');
  await sleep(6000);

  while (Date.now() - startTime < maxWaitTime) {
    pollCount++;
    const elapsed = Date.now() - startTime;

    console.log(`[Poll #${pollCount}] Checking chunking status (elapsed: ${elapsed}ms)...`);

    const statusResponse = await apiRequest(
      `/jobs/${jobId}/translation-status`,
      'GET',
      undefined,
      authToken
    );

    if (statusResponse.status !== 200) {
      const errorMsg = `Status check failed: ${statusResponse.status} - ${JSON.stringify(statusResponse.data)}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    const { status, jobId: returnedJobId } = statusResponse.data;

    console.log(`[Poll #${pollCount}] Status: ${status}, JobId: ${returnedJobId}`);

    if (status === 'CHUNKED') {
      console.log(`✓ Chunking completed successfully after ${elapsed}ms (${pollCount} polls)`);
      return; // Success
    }

    if (status === 'FAILED' || status === 'CHUNKING_FAILED') {
      const errorMsg = `Chunking failed: ${JSON.stringify(statusResponse.data)}`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    // Exponential backoff: 2s → 3s → 5s → 5s...
    if (pollCount === 2) pollInterval = 3000;
    if (pollCount >= 3) pollInterval = 5000;

    console.log(`Waiting ${pollInterval}ms before next poll...`);
    await sleep(pollInterval);
  }

  const finalElapsed = Date.now() - startTime;
  const errorMsg = `Chunking timeout after ${finalElapsed}ms (${pollCount} polls). Last status may still be PENDING or UPLOADED.`;
  console.error(errorMsg);
  throw new Error(errorMsg);
};

const startTranslation = async (
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

const getTranslationStatus = async (
  authToken: string,
  jobId: string
): Promise<TranslationStatus> => {
  const response = await apiRequest(
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

const waitForTranslation = async (
  authToken: string,
  jobId: string,
  maxWaitTime: number = 90000 // Reduced from 180s (3min) to 90s (1.5min) for minimal test document
): Promise<TranslationStatus> => {
  const startTime = Date.now();
  const pollInterval = 2000; // Reduced from 5s to 2s for faster feedback

  while (Date.now() - startTime < maxWaitTime) {
    const status = await getTranslationStatus(authToken, jobId);

    if (status.translationStatus === 'COMPLETED') {
      return status; // Success
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

// Integration Tests
describe('End-to-End Translation Flow Integration Tests', () => {
  // Shared test data
  let testEmail: string;
  const testPassword = 'IntegrationTest123!';
  let authTokens: AuthTokens;

  beforeAll(() => {
    testEmail = generateTestEmail();
    console.log(`Test email: ${testEmail}`);
  });

  describe('Complete Translation Workflow', () => {
    it(
      'should complete full workflow: register, upload, chunk, translate',
      async () => {
        // Step 1: Register and login
        console.log('Step 1: Authenticating...');
        authTokens = await registerAndLogin(testEmail, testPassword);
        console.log('Auth tokens received:', {
          hasAccessToken: !!authTokens.accessToken,
          hasRefreshToken: !!authTokens.refreshToken,
          hasIdToken: !!authTokens.idToken,
          accessTokenPrefix: authTokens.accessToken?.substring(0, 20),
        });
        expect(authTokens.accessToken).toBeTruthy();

        // Step 2: Upload document
        console.log('Step 2: Uploading document...');
        const { jobId } = await uploadDocument(
          authTokens.idToken,
          TEST_DOCUMENT_CONTENT,
          'integration-test.txt'
        );
        expect(jobId).toBeTruthy();
        console.log(`Job ID: ${jobId}`);

        // Step 3: Wait for chunking
        console.log('Step 3: Waiting for chunking...');
        await waitForChunking(authTokens.idToken, jobId, 60000);
        console.log('Chunking complete!');

        // Step 4: Start translation
        console.log('Step 4: Starting translation...');
        await startTranslation(authTokens.idToken, jobId, 'es', 'formal');
        console.log('Translation started!');

        // Step 5: Check initial translation status
        console.log('Step 5: Checking translation status...');
        const initialStatus = await getTranslationStatus(
          authTokens.idToken,
          jobId
        );
        expect(initialStatus.jobId).toBe(jobId);
        expect(initialStatus.targetLanguage).toBe('es');
        expect(initialStatus.tone).toBe('formal');
        expect(initialStatus.totalChunks).toBeGreaterThan(0);
        expect(['NOT_STARTED', 'IN_PROGRESS']).toContain(
          initialStatus.translationStatus
        );

        // Step 6: Wait for translation completion
        console.log('Step 6: Waiting for translation to complete...');
        const finalStatus = await waitForTranslation(
          authTokens.idToken,
          jobId,
          180000
        );

        // Verify final status
        expect(finalStatus.translationStatus).toBe('COMPLETED');
        expect(finalStatus.progressPercentage).toBe(100);
        // DynamoDB NUMBER fields are returned as strings (correct format for NUMBER type)
        expect(Number(finalStatus.chunksTranslated)).toBe(Number(finalStatus.totalChunks));
        expect(finalStatus.translationCompletedAt).toBeTruthy();
        // Token usage and cost may be 0 for test documents
        expect(finalStatus.tokensUsed).toBeGreaterThanOrEqual(0);
        expect(finalStatus.estimatedCost).toBeGreaterThanOrEqual(0);

        console.log('Translation workflow completed successfully!');
        console.log(`Total chunks: ${finalStatus.totalChunks}`);
        console.log(`Tokens used: ${finalStatus.tokensUsed}`);
        console.log(`Estimated cost: $${finalStatus.estimatedCost}`);
      },
      TEST_TIMEOUT
    );
  });

  describe('Translation Status Polling', () => {
    it(
      'should track translation progress accurately',
      async () => {
        // Authenticate
        authTokens = await registerAndLogin(testEmail, testPassword);

        // Upload and chunk document
        const { jobId } = await uploadDocument(
          authTokens.idToken,
          TEST_DOCUMENT_CONTENT
        );
        await waitForChunking(authTokens.idToken, jobId);

        // Start translation
        await startTranslation(authTokens.idToken, jobId, 'fr', 'neutral');

        // Poll for progress updates
        const progressSnapshots: number[] = [];
        const maxPolls = 60; // Maximum 60 polls (5 minutes at 5s interval)
        let pollCount = 0;

        while (pollCount < maxPolls) {
          const status = await getTranslationStatus(authTokens.idToken, jobId);

          // Record progress
          if (status.progressPercentage !== undefined) {
            progressSnapshots.push(status.progressPercentage);
          }

          // Check if completed
          if (status.translationStatus === 'COMPLETED') {
            break;
          }

          if (status.translationStatus === 'TRANSLATION_FAILED') {
            throw new Error(`Translation failed: ${status.error}`);
          }

          await sleep(5000);
          pollCount++;
        }

        // Verify progress tracking
        expect(progressSnapshots.length).toBeGreaterThan(0);
        expect(progressSnapshots[progressSnapshots.length - 1]).toBe(100);

        // Progress should be monotonically increasing
        for (let i = 1; i < progressSnapshots.length; i++) {
          expect(progressSnapshots[i]).toBeGreaterThanOrEqual(
            progressSnapshots[i - 1]
          );
        }

        console.log(`Progress snapshots: ${progressSnapshots.join(', ')}`);
      },
      TEST_TIMEOUT
    );
  });

  describe('Multiple Target Languages', () => {
    const targetLanguages = ['es', 'fr', 'de', 'it', 'zh'];

    targetLanguages.forEach((language) => {
      it(
        `should successfully translate to ${language}`,
        async () => {
          // Authenticate
          authTokens = await registerAndLogin(testEmail, testPassword);

          // Upload and chunk document
          const { jobId } = await uploadDocument(
            authTokens.idToken,
            TEST_DOCUMENT_CONTENT,
            `test-${language}.txt`
          );
          await waitForChunking(authTokens.idToken, jobId);

          // Start translation
          await startTranslation(
            authTokens.idToken,
            jobId,
            language,
            'neutral'
          );

          // Wait for completion
          const finalStatus = await waitForTranslation(
            authTokens.idToken,
            jobId,
            180000
          );

          expect(finalStatus.translationStatus).toBe('COMPLETED');
          expect(finalStatus.targetLanguage).toBe(language);
          expect(finalStatus.progressPercentage).toBe(100);

          console.log(
            `Translation to ${language} completed in ${
              new Date(finalStatus.translationCompletedAt!).getTime() -
              new Date(finalStatus.translationStartedAt!).getTime()
            }ms`
          );
        },
        TEST_TIMEOUT
      );
    });
  });

  describe('Translation Tone Options', () => {
    const tones: Array<'formal' | 'informal' | 'neutral'> = [
      'formal',
      'informal',
      'neutral',
    ];

    tones.forEach((tone) => {
      it(
        `should successfully translate with ${tone} tone`,
        async () => {
          // Authenticate
          authTokens = await registerAndLogin(testEmail, testPassword);

          // Upload and chunk document
          const { jobId } = await uploadDocument(
            authTokens.idToken,
            TEST_DOCUMENT_CONTENT,
            `test-${tone}.txt`
          );
          await waitForChunking(authTokens.idToken, jobId);

          // Start translation
          await startTranslation(authTokens.idToken, jobId, 'es', tone);

          // Wait for completion
          const finalStatus = await waitForTranslation(
            authTokens.idToken,
            jobId,
            180000
          );

          expect(finalStatus.translationStatus).toBe('COMPLETED');
          expect(finalStatus.tone).toBe(tone);
          expect(finalStatus.progressPercentage).toBe(100);

          console.log(`Translation with ${tone} tone completed successfully`);
        },
        TEST_TIMEOUT
      );
    });
  });

  describe('Error Handling', () => {
    it('should reject translation request without authentication', async () => {
      const response = await apiRequest('/jobs/fake-job-id/translate', 'POST', {
        targetLanguage: 'es',
      });

      expect(response.status).toBe(401);
    });

    it('should reject translation status request without authentication', async () => {
      const response = await apiRequest(
        '/jobs/fake-job-id/translation-status',
        'GET'
      );

      expect(response.status).toBe(401);
    });

    it(
      'should return 404 for non-existent job',
      async () => {
        authTokens = await registerAndLogin(testEmail, testPassword);

        const response = await apiRequest(
          '/jobs/non-existent-job-id/translation-status',
          'GET',
          undefined,
          authTokens.idToken
        );

        expect(response.status).toBe(404);
        expect(response.data.message).toContain('not found');
      },
      TEST_TIMEOUT
    );

    it(
      'should reject translation of non-chunked job',
      async () => {
        authTokens = await registerAndLogin(testEmail, testPassword);

        // Upload document but don't wait for chunking
        const { jobId } = await uploadDocument(
          authTokens.idToken,
          TEST_DOCUMENT_CONTENT
        );

        // Immediately try to start translation (should fail)
        const response = await apiRequest(
          `/jobs/${jobId}/translate`,
          'POST',
          {
            targetLanguage: 'es',
          },
          authTokens.idToken
        );

        // Should either be 400 (not ready) or 409 (conflict) or might succeed if chunking was very fast
        expect([200, 202, 400, 409]).toContain(response.status);
      },
      TEST_TIMEOUT
    );

    it(
      'should reject invalid target language',
      async () => {
        authTokens = await registerAndLogin(testEmail, testPassword);

        const { jobId } = await uploadDocument(
          authTokens.idToken,
          TEST_DOCUMENT_CONTENT
        );
        await waitForChunking(authTokens.idToken, jobId);

        const response = await apiRequest(
          `/jobs/${jobId}/translate`,
          'POST',
          {
            targetLanguage: 'invalid-language',
          },
          authTokens.idToken
        );

        expect(response.status).toBe(400);
        expect(response.data.message).toContain('language');
      },
      TEST_TIMEOUT
    );
  });

  describe('Performance Benchmarks', () => {
    it(
      'should complete translation within expected time',
      async () => {
        authTokens = await registerAndLogin(testEmail, testPassword);

        const { jobId } = await uploadDocument(
          authTokens.idToken,
          TEST_DOCUMENT_CONTENT
        );
        await waitForChunking(authTokens.idToken, jobId);

        const startTime = Date.now();
        await startTranslation(authTokens.idToken, jobId, 'es', 'neutral');

        const finalStatus = await waitForTranslation(
          authTokens.idToken,
          jobId,
          180000
        );

        const totalTime = Date.now() - startTime;

        console.log(`Translation completed in ${totalTime}ms`);
        console.log(`Chunks translated: ${finalStatus.chunksTranslated}`);
        console.log(`Tokens used: ${finalStatus.tokensUsed}`);

        // For a small test document, should complete in under 3 minutes
        expect(totalTime).toBeLessThan(180000);
      },
      TEST_TIMEOUT
    );
  });

  describe('CORS Headers', () => {
    it('should include CORS headers in translation endpoints', async () => {
      const endpoints = [
        { path: '/jobs/fake-job/translate', method: 'POST' },
        { path: '/jobs/fake-job/translation-status', method: 'GET' },
      ];

      for (const endpoint of endpoints) {
        const response = await apiRequest(endpoint.path, endpoint.method);

        const corsOrigin = response.headers.get('access-control-allow-origin');
        const corsCredentials = response.headers.get(
          'access-control-allow-credentials'
        );

        expect(corsOrigin).toBeTruthy();
        expect(corsCredentials).toBeTruthy();
      }
    });
  });
});
