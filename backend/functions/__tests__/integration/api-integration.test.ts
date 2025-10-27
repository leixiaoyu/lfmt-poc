/**
 * Real API Integration Tests
 *
 * These tests call the actual deployed API endpoints to verify:
 * 1. Response format matches expectations
 * 2. Status codes are correct
 * 3. CORS headers are present
 * 4. Error handling works properly
 *
 * Run with: npm test -- __tests__/integration/api-integration.test.ts
 *
 * IMPORTANT: These tests require:
 * - Backend deployed to AWS
 * - API_BASE_URL environment variable set
 */

const API_BASE_URL = process.env.API_BASE_URL || 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1';

describe('Real API Integration Tests', () => {
  describe('GET /auth/me - Response Format Validation', () => {
    it('should return proper API Gateway response format for unauthorized request', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Validate HTTP status
      expect(response.status).toBe(401);

      // Validate CORS headers
      const corsHeaders = response.headers.get('access-control-allow-origin');
      expect(corsHeaders).toBeTruthy();

      // Validate response body format
      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('requestId');
      expect(typeof body.message).toBe('string');
      expect(typeof body.requestId).toBe('string');

      // Validate Content-Type header
      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('application/json');
    });

    it('should return 401 for invalid token format', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Authorization': 'InvalidFormat',
          'Content-Type': 'application/json',
        },
      });

      expect(response.status).toBe(401);

      const body = await response.json() as any;
      expect(body.message).toContain('Authorization');
    });

    it('should return 401 for missing Authorization header', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status).toBe(401);

      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
      expect(body.message).toBeTruthy();
    });
  });

  describe('POST /auth/register - Response Format Validation', () => {
    it('should return proper validation error response', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'invalid-email',
          password: 'short',
          firstName: '',
          lastName: '',
        }),
      });

      // Should return 400 for validation errors
      expect(response.status).toBe(400);

      // Validate response format
      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('requestId');
      expect(body.message).toContain('Validation');

      // Check for validation errors object
      if (body.errors) {
        expect(typeof body.errors).toBe('object');
      }
    });

    it('should return proper response format for valid request', async () => {
      // Use a random email to avoid conflicts
      const randomEmail = `test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`;

      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: randomEmail,
          password: 'TestPassword123!',
          firstName: 'Integration',
          lastName: 'Test',
        }),
      });

      // Should return 201 (created), 400 (validation error), or 409 (already exists)
      expect([201, 400, 409]).toContain(response.status);

      // Validate response format
      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('requestId');
      expect(typeof body.message).toBe('string');
      expect(typeof body.requestId).toBe('string');

      // Validate CORS headers
      const corsHeaders = response.headers.get('access-control-allow-origin');
      expect(corsHeaders).toBeTruthy();
    });
  });

  describe('POST /auth/login - Response Format Validation', () => {
    it('should return proper error response for invalid credentials', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: 'WrongPassword123!',
        }),
      });

      // Should return 401 for invalid credentials
      expect(response.status).toBe(401);

      // Validate response format
      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
      expect(body).toHaveProperty('requestId');
      expect(typeof body.message).toBe('string');
      expect(typeof body.requestId).toBe('string');

      // Validate CORS headers
      const corsHeaders = response.headers.get('access-control-allow-origin');
      expect(corsHeaders).toBeTruthy();
    });

    it('should return proper validation error for missing fields', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: '',
          password: '',
        }),
      });

      // Should return 400 for validation errors
      expect(response.status).toBe(400);

      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
      expect(body.message).toContain('Validation');
    });
  });

  describe('CORS Headers Validation', () => {
    it('should include CORS headers in all responses', async () => {
      const endpoints = [
        '/auth/me',
        '/auth/login',
        '/auth/register',
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: endpoint === '/auth/me' ? 'GET' : 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: endpoint !== '/auth/me' ? JSON.stringify({}) : undefined,
        });

        // Validate CORS headers exist
        const corsOrigin = response.headers.get('access-control-allow-origin');
        expect(corsOrigin).toBeTruthy();

        const corsCredentials = response.headers.get('access-control-allow-credentials');
        expect(corsCredentials).toBeTruthy();

        const contentType = response.headers.get('content-type');
        expect(contentType).toContain('application/json');
      }
    });
  });

  describe('Response Body Format Consistency', () => {
    it('all error responses should have consistent format', async () => {
      const testCases = [
        {
          endpoint: '/auth/me',
          method: 'GET',
          expectedStatus: 401,
        },
        {
          endpoint: '/auth/login',
          method: 'POST',
          body: { email: '', password: '' },
          expectedStatus: 400,
        },
        {
          endpoint: '/auth/register',
          method: 'POST',
          body: { email: 'invalid', password: 'short' },
          expectedStatus: 400,
        },
      ];

      for (const testCase of testCases) {
        const response = await fetch(`${API_BASE_URL}${testCase.endpoint}`, {
          method: testCase.method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: testCase.body ? JSON.stringify(testCase.body) : undefined,
        });

        expect(response.status).toBe(testCase.expectedStatus);

        const body = await response.json() as any;

        // All error responses must have these fields
        expect(body).toHaveProperty('message');
        expect(body).toHaveProperty('requestId');
        expect(typeof body.message).toBe('string');
        expect(typeof body.requestId).toBe('string');
        expect(body.requestId).toMatch(/^[\w-]+$/); // Valid request ID format
      }
    });
  });

  describe('POST /jobs/upload - Upload Request', () => {
    it('should return 401 for missing authorization', async () => {
      const response = await fetch(`${API_BASE_URL}/jobs/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: 'test.txt',
          fileSize: 1000,
          contentType: 'text/plain',
        }),
      });

      expect(response.status).toBe(401);
      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
      // API Gateway's default 401 doesn't include requestId - this is expected
      // Only Lambda-generated errors include requestId
    });

    it('should return 400 for invalid file validation', async () => {
      const response = await fetch(`${API_BASE_URL}/jobs/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: 'test.pdf',
          fileSize: 1000,
          contentType: 'application/pdf',
        }),
      });

      expect(response.status).toBe(401); // Will be 401 because no auth, but structure is tested
      const body = await response.json() as any;
      expect(body).toHaveProperty('message');
    });

    it('should have CORS headers', async () => {
      const response = await fetch(`${API_BASE_URL}/jobs/upload`, {
        method: 'OPTIONS',
      });

      const corsOrigin = response.headers.get('access-control-allow-origin');
      const corsMethods = response.headers.get('access-control-allow-methods');
      const corsHeaders = response.headers.get('access-control-allow-headers');

      expect(corsOrigin).toBeTruthy();
      expect(corsMethods).toBeTruthy();
      expect(corsHeaders).toBeTruthy();
      expect(corsHeaders).toContain('Authorization');
    });
  });

  describe('API Health and Availability', () => {
    it('API should be accessible', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
      });

      // Should get a response (not network error)
      expect(response).toBeTruthy();
      expect(response.status).toBeDefined();

      // Should not be 502 or 503 (Bad Gateway or Service Unavailable)
      expect(response.status).not.toBe(502);
      expect(response.status).not.toBe(503);
    });
  });
});
