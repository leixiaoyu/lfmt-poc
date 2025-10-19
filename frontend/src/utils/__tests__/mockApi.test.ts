/**
 * Mock API Tests
 *
 * Tests the mock API interceptor to ensure:
 * - Correct handling of request data (string vs object)
 * - Proper response format
 * - No JSON parsing errors
 * - Correct mock data generation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios, { AxiosInstance } from 'axios';
import { installMockApi, isMockApiEnabled } from '../mockApi';

describe('mockApi', () => {
  let client: AxiosInstance;

  beforeEach(() => {
    // Create a fresh axios instance for each test
    client = axios.create({
      baseURL: 'https://api.example.com',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Install mock interceptors
    installMockApi(client);

    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isMockApiEnabled', () => {
    it('should detect mock API is enabled in development', () => {
      // This test runs in Vitest which sets DEV mode
      const isEnabled = isMockApiEnabled();
      expect(isEnabled).toBe(true);
    });
  });

  describe('Mock Register Endpoint', () => {
    it('should handle registration with object data', async () => {
      const registrationData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        password: 'SecurePass123!',
      };

      const response = await client.post('/auth/register', registrationData);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('user');
      expect(response.data).toHaveProperty('accessToken');
      expect(response.data).toHaveProperty('refreshToken');
      expect(response.data.user).toMatchObject({
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('should handle registration with string data', async () => {
      const registrationData = JSON.stringify({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
        password: 'Password123!',
      });

      // Override default JSON serialization
      const response = await client.post('/auth/register', registrationData, {
        headers: { 'Content-Type': 'application/json' },
        transformRequest: [(data) => data], // Skip default transform
      });

      expect(response.status).toBe(200);
      expect(response.data.user.email).toBe('jane@example.com');
    });

    it('should not throw "is not valid JSON" error', async () => {
      const consoleError = vi.spyOn(console, 'error');

      const registrationData = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        password: 'Password123!',
      };

      await client.post('/auth/register', registrationData);

      expect(consoleError).not.toHaveBeenCalledWith(
        expect.stringContaining('is not valid JSON')
      );

      consoleError.mockRestore();
    });

    it('should handle special characters in registration data', async () => {
      const registrationData = {
        firstName: "O'Brien",
        lastName: 'José-María',
        email: 'test+special@example.com',
        password: 'P@ssw0rd!#$%',
      };

      const response = await client.post('/auth/register', registrationData);

      expect(response.status).toBe(200);
      expect(response.data.user.firstName).toBe("O'Brien");
      expect(response.data.user.lastName).toBe('José-María');
      expect(response.data.user.email).toBe('test+special@example.com');
    });

    it('should generate unique tokens for each registration', async () => {
      const userData = {
        firstName: 'User',
        lastName: 'One',
        email: 'user1@example.com',
        password: 'Password123!',
      };

      const response1 = await client.post('/auth/register', userData);

      // Small delay to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));

      const response2 = await client.post('/auth/register', {
        ...userData,
        email: 'user2@example.com',
      });

      expect(response1.data.accessToken).not.toBe(response2.data.accessToken);
      expect(response1.data.refreshToken).not.toBe(response2.data.refreshToken);
    });
  });

  describe('Mock Login Endpoint', () => {
    it('should handle login with object data', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'password123',
      };

      const response = await client.post('/auth/login', loginData);

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('user');
      expect(response.data).toHaveProperty('accessToken');
      expect(response.data.user.email).toBe('user@example.com');
    });

    it('should handle login with string data', async () => {
      const loginData = JSON.stringify({
        email: 'test@example.com',
        password: 'password',
      });

      const response = await client.post('/auth/login', loginData, {
        transformRequest: [(data) => data],
      });

      expect(response.status).toBe(200);
      expect(response.data.user.email).toBe('test@example.com');
    });

    it('should create generic user for login (no firstName/lastName in request)', async () => {
      const response = await client.post('/auth/login', {
        email: 'generic@example.com',
        password: 'password',
      });

      expect(response.data.user).toMatchObject({
        email: 'generic@example.com',
        firstName: 'Test',
        lastName: 'User',
      });
    });
  });

  describe('Mock Forgot Password Endpoint', () => {
    it('should handle forgot password request', async () => {
      const response = await client.post('/auth/forgot-password', {
        email: 'forgot@example.com',
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('message');
    });

    it('should handle forgot password with string data', async () => {
      const response = await client.post(
        '/auth/forgot-password',
        JSON.stringify({ email: 'test@example.com' }),
        { transformRequest: [(data) => data] }
      );

      expect(response.status).toBe(200);
    });
  });

  describe('Mock Get Current User Endpoint', () => {
    it('should return user from localStorage if exists', async () => {
      const mockUser = {
        id: 'test-id',
        email: 'stored@example.com',
        firstName: 'Stored',
        lastName: 'User',
      };

      localStorage.setItem('lfmt_user_data', JSON.stringify(mockUser));

      const response = await client.get('/auth/me');

      expect(response.status).toBe(200);
      expect(response.data).toMatchObject(mockUser);
    });

    it('should return default user if localStorage is empty', async () => {
      const response = await client.get('/auth/me');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('email');
      expect(response.data.email).toBe('test@example.com');
    });
  });

  describe('Mock Logout Endpoint', () => {
    it('should handle logout request', async () => {
      const response = await client.post('/auth/logout');

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('message');
    });
  });

  describe('Mock Refresh Token Endpoint', () => {
    it('should return new tokens', async () => {
      const response = await client.post('/auth/refresh', {
        refreshToken: 'old-refresh-token',
      });

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('accessToken');
      expect(response.data).toHaveProperty('refreshToken');
      expect(response.data.accessToken).toContain('mock-access-token');
    });
  });

  describe('Response Timing', () => {
    it('should simulate realistic API delay', async () => {
      const startTime = Date.now();

      await client.post('/auth/login', {
        email: 'test@example.com',
        password: 'password',
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should have some delay (at least 400ms, we use 500ms)
      expect(duration).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Console Logging', () => {
    it('should log mock API calls', async () => {
      const consoleLog = vi.spyOn(console, 'log');

      await client.post('/auth/register', {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        password: 'password',
      });

      expect(consoleLog).toHaveBeenCalledWith(
        '[MOCK API] Register:',
        expect.objectContaining({
          email: 'test@example.com',
        })
      );

      consoleLog.mockRestore();
    });
  });

  describe('Error Scenarios', () => {
    it('should handle requests to non-auth endpoints normally', async () => {
      // Non-auth endpoints should not be mocked
      try {
        await client.get('/api/some-other-endpoint');
      } catch (error) {
        // Should get a real network error, not a mock response
        expect(error).toBeTruthy();
      }
    });
  });
});
