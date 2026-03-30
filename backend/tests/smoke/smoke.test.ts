/**
 * Production Smoke Tests
 *
 * Lightweight smoke tests to verify critical functionality in production environments.
 * These tests cover:
 * - API health and reachability
 * - Authentication flow (register → login → getCurrentUser)
 * - Upload presigned URL request
 * - Translation status polling
 *
 * Usage:
 *   API_URL=https://api.production.com npm run test:smoke
 *
 * Environment Variables:
 *   API_URL - Base URL of the API to test (required)
 */

import { randomBytes } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const API_URL = process.env.API_URL;

if (!API_URL) {
  console.error('❌ API_URL environment variable is required');
  console.error('   Usage: API_URL=https://api.example.com npm run test:smoke');
  process.exit(1);
}

const TEST_TIMEOUT = 30000; // 30 seconds per test
const REQUEST_TIMEOUT = 10000; // 10 seconds per HTTP request

// ============================================================================
// Types
// ============================================================================

interface TestUser {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

interface ApiResponse<T = any> {
  status: number;
  data: T;
  headers: Headers;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate unique test email
 */
const generateTestEmail = (): string => {
  const randomId = randomBytes(8).toString('hex');
  const timestamp = Date.now();
  return `smoke-test-${timestamp}-${randomId}@test.lfmt.com`;
};

/**
 * Generate test user
 */
const generateTestUser = (): TestUser => ({
  email: generateTestEmail(),
  password: 'SmokeTest123!',
  firstName: 'Smoke',
  lastName: 'Test',
});

/**
 * Make HTTP request with timeout
 */
const makeRequest = async <T = any>(
  endpoint: string,
  method: string = 'GET',
  body?: any,
  authToken?: string,
  additionalHeaders?: Record<string, string>
): Promise<ApiResponse<T>> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...additionalHeaders,
    };

    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    let data: T;
    try {
      data = (await response.json()) as T;
    } catch {
      data = null as any;
    }

    return {
      status: response.status,
      data,
      headers: response.headers,
    };
  } finally {
    clearTimeout(timeoutId);
  }
};

/**
 * Wait for specified time
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ============================================================================
// Smoke Tests
// ============================================================================

describe('Production Smoke Tests', () => {
  // Increase timeout for all tests
  jest.setTimeout(TEST_TIMEOUT);

  describe('Health Check & API Reachability', () => {
    it('should verify API is reachable and responding', async () => {
      // Test any public endpoint (401 is acceptable, means API is responding)
      const response = await makeRequest('/auth/me', 'GET');

      // API should respond (not network error)
      expect(response.status).toBeGreaterThan(0);
      expect(response.status).not.toBe(502); // Not Bad Gateway
      expect(response.status).not.toBe(503); // Not Service Unavailable
      expect(response.status).not.toBe(504); // Not Gateway Timeout

      // Should return JSON
      expect(response.headers.get('content-type')).toContain('application/json');

      console.log(`✓ API is reachable at ${API_URL}`);
    });

    it('should verify CORS headers are present', async () => {
      const response = await makeRequest('/auth/me', 'GET');

      // CORS headers should be present
      const corsOrigin = response.headers.get('access-control-allow-origin');
      const corsCredentials = response.headers.get('access-control-allow-credentials');

      expect(corsOrigin).toBeTruthy();
      expect(corsCredentials).toBe('true');

      console.log('✓ CORS headers configured correctly');
    });

    it('should verify critical endpoints are available', async () => {
      const endpoints = [
        { path: '/auth/register', method: 'POST', expectedCodes: [400, 409] },
        { path: '/auth/login', method: 'POST', expectedCodes: [400, 401] },
        { path: '/auth/me', method: 'GET', expectedCodes: [401] },
        { path: '/jobs/upload', method: 'POST', expectedCodes: [401, 400] },
      ];

      for (const endpoint of endpoints) {
        const response = await makeRequest(endpoint.path, endpoint.method);

        // Endpoint should be reachable and return expected status
        expect(response.status).toBeGreaterThan(0);
        expect(endpoint.expectedCodes).toContain(response.status);

        console.log(`✓ ${endpoint.method} ${endpoint.path}: ${response.status}`);
      }
    });

    it('should verify response times are acceptable', async () => {
      const startTime = Date.now();
      await makeRequest('/auth/me', 'GET');
      const duration = Date.now() - startTime;

      // Should respond within 5 seconds
      expect(duration).toBeLessThan(5000);

      console.log(`✓ Response time: ${duration}ms`);
    });
  });

  describe('Authentication Flow', () => {
    let testUser: TestUser;
    let authTokens: AuthTokens;

    it('should register a new user', async () => {
      testUser = generateTestUser();

      const response = await makeRequest('/auth/register', 'POST', {
        email: testUser.email,
        password: testUser.password,
        confirmPassword: testUser.password,
        firstName: testUser.firstName,
        lastName: testUser.lastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      // Should succeed or indicate user already exists
      expect([200, 201, 409]).toContain(response.status);

      if (response.status === 200 || response.status === 201) {
        expect(response.data).toHaveProperty('message');
        console.log(`✓ User registered: ${testUser.email}`);
      } else {
        console.log(`✓ User already exists: ${testUser.email}`);
      }
    });

    it('should login with registered credentials', async () => {
      const response = await makeRequest<AuthTokens & { user: any }>(
        '/auth/login',
        'POST',
        {
          email: testUser.email,
          password: testUser.password,
        }
      );

      // Should succeed
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('accessToken');
      expect(response.data).toHaveProperty('refreshToken');
      expect(response.data).toHaveProperty('idToken');
      expect(response.data).toHaveProperty('user');

      authTokens = {
        accessToken: response.data.accessToken,
        refreshToken: response.data.refreshToken,
        idToken: response.data.idToken,
      };

      console.log('✓ Login successful');
    });

    it('should get current user info with access token', async () => {
      const response = await makeRequest<{ user: any }>(
        '/auth/me',
        'GET',
        undefined,
        authTokens.accessToken
      );

      // Should succeed
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('user');
      expect(response.data.user).toHaveProperty('id');
      expect(response.data.user).toHaveProperty('email');
      expect(response.data.user.email).toBe(testUser.email);

      console.log('✓ getCurrentUser successful');
    });

    it('should reject requests without valid token', async () => {
      const response = await makeRequest('/auth/me', 'GET');

      // Should return 401 Unauthorized
      expect(response.status).toBe(401);

      console.log('✓ Unauthorized access properly rejected');
    });
  });

  describe('Upload Presigned URL Request', () => {
    let authToken: string;

    beforeAll(async () => {
      // Create and login test user
      const user = generateTestUser();

      await makeRequest('/auth/register', 'POST', {
        email: user.email,
        password: user.password,
        confirmPassword: user.password,
        firstName: user.firstName,
        lastName: user.lastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      const loginResponse = await makeRequest<AuthTokens>(
        '/auth/login',
        'POST',
        {
          email: user.email,
          password: user.password,
        }
      );

      authToken = loginResponse.data.accessToken;
    });

    it('should request presigned upload URL', async () => {
      const response = await makeRequest(
        '/jobs/upload',
        'POST',
        {
          fileName: 'smoke-test-document.txt',
          fileSize: 1024,
          contentType: 'text/plain',
          legalAttestation: {
            acceptCopyrightOwnership: true,
            acceptTranslationRights: true,
            acceptLiabilityTerms: true,
            userIPAddress: '127.0.0.1',
            userAgent: 'smoke-test',
          },
        },
        authToken
      );

      // Should succeed
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('jobId');
      expect(response.data).toHaveProperty('uploadUrl');
      expect(response.data).toHaveProperty('uploadFields');

      // Validate response structure
      expect(typeof response.data.jobId).toBe('string');
      expect(typeof response.data.uploadUrl).toBe('string');
      expect(typeof response.data.uploadFields).toBe('object');

      console.log('✓ Upload presigned URL request successful');
      console.log(`  Job ID: ${response.data.jobId}`);
    });

    it('should reject upload request without authentication', async () => {
      const response = await makeRequest('/jobs/upload', 'POST', {
        fileName: 'test.txt',
        fileSize: 100,
        contentType: 'text/plain',
        legalAttestation: {
          acceptCopyrightOwnership: true,
          acceptTranslationRights: true,
          acceptLiabilityTerms: true,
          userIPAddress: '127.0.0.1',
          userAgent: 'smoke-test',
        },
      });

      // Should return 401 Unauthorized
      expect(response.status).toBe(401);

      console.log('✓ Unauthenticated upload properly rejected');
    });

    it('should reject upload request with invalid payload', async () => {
      const response = await makeRequest(
        '/jobs/upload',
        'POST',
        {
          // Missing required fields
          fileName: 'test.txt',
        },
        authToken
      );

      // Should return 400 Bad Request
      expect(response.status).toBe(400);

      console.log('✓ Invalid upload request properly rejected');
    });
  });

  describe('Translation Status Polling', () => {
    let authToken: string;
    let jobId: string;

    beforeAll(async () => {
      // Create and login test user
      const user = generateTestUser();

      await makeRequest('/auth/register', 'POST', {
        email: user.email,
        password: user.password,
        confirmPassword: user.password,
        firstName: user.firstName,
        lastName: user.lastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      const loginResponse = await makeRequest<AuthTokens>(
        '/auth/login',
        'POST',
        {
          email: user.email,
          password: user.password,
        }
      );

      authToken = loginResponse.data.accessToken;

      // Create a job
      const uploadResponse = await makeRequest(
        '/jobs/upload',
        'POST',
        {
          fileName: 'smoke-test-document.txt',
          fileSize: 1024,
          contentType: 'text/plain',
          legalAttestation: {
            acceptCopyrightOwnership: true,
            acceptTranslationRights: true,
            acceptLiabilityTerms: true,
            userIPAddress: '127.0.0.1',
            userAgent: 'smoke-test',
          },
        },
        authToken
      );

      jobId = uploadResponse.data.jobId;
    });

    it('should poll job status', async () => {
      const response = await makeRequest(
        `/jobs/${jobId}`,
        'GET',
        undefined,
        authToken
      );

      // Should succeed
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('jobId');
      expect(response.data).toHaveProperty('status');
      expect(response.data.jobId).toBe(jobId);

      console.log('✓ Job status polling successful');
      console.log(`  Status: ${response.data.status}`);
    });

    it('should poll translation status', async () => {
      const response = await makeRequest(
        `/jobs/${jobId}/translation-status`,
        'GET',
        undefined,
        authToken
      );

      // Should succeed or return 404 if not started
      expect([200, 404]).toContain(response.status);

      if (response.status === 200) {
        expect(response.data).toHaveProperty('jobId');
        expect(response.data.jobId).toBe(jobId);
        console.log('✓ Translation status polling successful');
        console.log(`  Translation status: ${response.data.translationStatus || 'not started'}`);
      } else {
        console.log('✓ Translation not started (expected for new job)');
      }
    });

    it('should reject status request without authentication', async () => {
      const response = await makeRequest(`/jobs/${jobId}`, 'GET');

      // Should return 401 Unauthorized
      expect(response.status).toBe(401);

      console.log('✓ Unauthenticated status request properly rejected');
    });

    it('should reject status request for non-existent job', async () => {
      const fakeJobId = 'non-existent-job-id-12345';
      const response = await makeRequest(
        `/jobs/${fakeJobId}`,
        'GET',
        undefined,
        authToken
      );

      // Should return 404 Not Found
      expect(response.status).toBe(404);

      console.log('✓ Non-existent job properly rejected');
    });

    it('should handle rapid sequential status polls', async () => {
      const pollCount = 5;
      const results: number[] = [];

      for (let i = 0; i < pollCount; i++) {
        const response = await makeRequest(
          `/jobs/${jobId}/translation-status`,
          'GET',
          undefined,
          authToken
        );
        results.push(response.status);
        await sleep(100); // Small delay between requests
      }

      // All requests should succeed (200 or 404)
      results.forEach((status) => {
        expect([200, 404]).toContain(status);
      });

      console.log(`✓ Rapid sequential polling successful (${pollCount} requests)`);
    });
  });

  describe('Error Handling & Resilience', () => {
    it('should handle invalid endpoints gracefully', async () => {
      const response = await makeRequest('/non-existent-endpoint', 'GET');

      // Should return 403 Forbidden or 404 Not Found (API Gateway behavior)
      expect([403, 404]).toContain(response.status);
      expect(response.data).toBeTruthy();

      console.log('✓ Invalid endpoint handled gracefully');
    });

    it('should handle malformed JSON payloads', async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      try {
        const response = await fetch(`${API_URL}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: '{invalid-json',
          signal: controller.signal,
        });

        // Should return 400 Bad Request
        expect(response.status).toBe(400);

        console.log('✓ Malformed JSON handled gracefully');
      } finally {
        clearTimeout(timeoutId);
      }
    });

    it('should return proper error messages', async () => {
      const response = await makeRequest('/auth/login', 'POST', {
        email: 'invalid-email',
        password: '123',
      });

      // Should return error response
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.data).toHaveProperty('message');
      expect(typeof response.data.message).toBe('string');
      expect(response.data.message.length).toBeGreaterThan(0);

      console.log('✓ Error messages are informative');
    });
  });
});
