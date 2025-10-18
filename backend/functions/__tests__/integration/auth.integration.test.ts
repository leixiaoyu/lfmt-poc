/**
 * Integration Tests for Authentication Endpoints
 *
 * These tests verify end-to-end functionality against the deployed API
 * following Test-Driven Development principles.
 *
 * Prerequisites:
 * - AWS infrastructure deployed to dev environment
 * - API Gateway URL configured
 * - Cognito User Pool accessible
 *
 * Run with: npm run test:integration
 */

import { randomBytes } from 'crypto';

// Configuration from environment or defaults
const API_BASE_URL = process.env.API_URL || 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1';
const TEST_EMAIL_DOMAIN = '@test.com';

// Helper to generate unique test emails
const generateTestEmail = (): string => {
  const randomId = randomBytes(8).toString('hex');
  return `test-${randomId}${TEST_EMAIL_DOMAIN}`;
};

// Helper to make API requests
const apiRequest = async (
  endpoint: string,
  method: string = 'GET',
  body?: any
): Promise<{status: number; data: any; headers: Headers}> => {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json();
  return {
    status: response.status,
    data,
    headers: response.headers,
  };
};

describe('Authentication API Integration Tests', () => {
  // Test data
  let testEmail: string;
  const testPassword = 'IntegrationTest123!';
  const testFirstName = 'Integration';
  const testLastName = 'Test';

  beforeEach(() => {
    testEmail = generateTestEmail();
  });

  describe('POST /auth - User Registration', () => {
    it('should successfully register a new user with valid data', async () => {
      const response = await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty('message');
      expect(response.data.message).toContain('registered successfully');
      expect(response.data).toHaveProperty('requestId');
    });

    it('should return 400 for password without special characters', async () => {
      const response = await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: 'SimplePassword123',
        confirmPassword: 'SimplePassword123',
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      expect(response.status).toBe(400);
      expect(response.data.message).toContain('Password does not meet security requirements');
    });

    it('should return 400 for missing required fields', async () => {
      const response = await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        // Missing confirmPassword, firstName, lastName, terms
      });

      expect(response.status).toBe(400);
      expect(response.data.message).toContain('Validation failed');
    });

    it('should return 400 for non-matching passwords', async () => {
      const response = await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        confirmPassword: 'DifferentPassword123!',
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      expect(response.status).toBe(400);
    });

    it('should return 409 for duplicate email', async () => {
      // First registration
      await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      // Second registration with same email
      const response = await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      expect(response.status).toBe(409);
      expect(response.data.message).toContain('already exists');
    });

    it('should return 400 for invalid email format', async () => {
      const response = await apiRequest('/auth', 'POST', {
        email: 'not-an-email',
        password: testPassword,
        confirmPassword: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      expect(response.status).toBe(400);
    });

    it('should include proper CORS headers', async () => {
      const response = await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      expect(response.headers.get('access-control-allow-origin')).toBeTruthy();
      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    });
  });

  describe('POST /auth/login - User Login', () => {
    it('should return 401 for non-existent user', async () => {
      const response = await apiRequest('/auth/login', 'POST', {
        email: generateTestEmail(),
        password: testPassword,
      });

      expect(response.status).toBe(401);
      expect(response.data.message).toContain('Incorrect email or password');
    });

    it('should return 401 for incorrect password', async () => {
      // First register a user
      await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      // Try to login with wrong password
      const response = await apiRequest('/auth/login', 'POST', {
        email: testEmail,
        password: 'WrongPassword123!',
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing email or password', async () => {
      const response = await apiRequest('/auth/login', 'POST', {
        email: testEmail,
        // Missing password
      });

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/refresh - Token Refresh', () => {
    it('should return 401 for invalid refresh token', async () => {
      const response = await apiRequest('/auth/refresh', 'POST', {
        refreshToken: 'invalid-token',
      });

      expect(response.status).toBe(401);
    });

    it('should return 400 for missing refresh token', async () => {
      const response = await apiRequest('/auth/refresh', 'POST', {});

      expect(response.status).toBe(400);
    });
  });

  describe('POST /auth/reset-password - Password Reset', () => {
    it('should return 200 for valid email (even if user does not exist)', async () => {
      const response = await apiRequest('/auth/reset-password', 'POST', {
        email: generateTestEmail(),
      });

      expect(response.status).toBe(200);
      expect(response.data.message).toBeTruthy();
    });

    it('should return 400 for invalid email format', async () => {
      const response = await apiRequest('/auth/reset-password', 'POST', {
        email: 'not-an-email',
      });

      expect(response.status).toBe(400);
    });

    it('should return 400 for missing email', async () => {
      const response = await apiRequest('/auth/reset-password', 'POST', {});

      expect(response.status).toBe(400);
    });
  });

  describe('API Performance', () => {
    it('should respond to registration within 2 seconds', async () => {
      const startTime = Date.now();

      await apiRequest('/auth', 'POST', {
        email: testEmail,
        password: testPassword,
        confirmPassword: testPassword,
        firstName: testFirstName,
        lastName: testLastName,
        acceptedTerms: true,
        acceptedPrivacy: true,
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      expect(duration).toBeLessThan(2000);
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error format with message and requestId', async () => {
      const response = await apiRequest('/auth', 'POST', {
        email: 'invalid-email',
        password: testPassword,
      });

      expect(response.data).toHaveProperty('message');
      expect(response.data).toHaveProperty('requestId');
      expect(typeof response.data.message).toBe('string');
      expect(typeof response.data.requestId).toBe('string');
    });
  });
});

/**
 * TODO: Add after email verification is implemented
 *
 * describe('Complete Registration Flow', () => {
 *   it('should register, verify, and login successfully', async () => {
 *     // 1. Register
 *     // 2. Verify email (requires AWS CLI or admin API)
 *     // 3. Login and get tokens
 *     // 4. Refresh tokens
 *   });
 * });
 */
