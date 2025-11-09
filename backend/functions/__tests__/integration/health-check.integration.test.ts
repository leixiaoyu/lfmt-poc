/**
 * API Health Check Integration Tests
 *
 * These tests verify the health and availability of all API endpoints,
 * infrastructure components, and external dependencies.
 *
 * Run with: npm run test:integration -- health-check.integration.test.ts
 */

const API_BASE_URL =
  process.env.API_BASE_URL ||
  'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1';

interface HealthCheckResult {
  endpoint: string;
  method: string;
  status: number;
  responseTime: number;
  success: boolean;
  error?: string;
}

const checkEndpoint = async (
  endpoint: string,
  method: string = 'GET',
  expectedStatusCodes: number[] = [200, 401, 404]
): Promise<HealthCheckResult> => {
  const startTime = Date.now();

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const responseTime = Date.now() - startTime;
    const success = expectedStatusCodes.includes(response.status);

    return {
      endpoint,
      method,
      status: response.status,
      responseTime,
      success,
      error: success ? undefined : `Unexpected status: ${response.status}`,
    };
  } catch (error) {
    return {
      endpoint,
      method,
      status: 0,
      responseTime: Date.now() - startTime,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

describe('API Health Check Integration Tests', () => {
  describe('Authentication Endpoints Health', () => {
    it('should have all auth endpoints available', async () => {
      const endpoints = [
        { path: '/auth/register', method: 'POST', expectedCodes: [400, 409] },
        { path: '/auth/login', method: 'POST', expectedCodes: [400, 401] },
        { path: '/auth/refresh', method: 'POST', expectedCodes: [400, 401] },
        {
          path: '/auth/reset-password',
          method: 'POST',
          expectedCodes: [200, 400],
        },
        { path: '/auth/me', method: 'GET', expectedCodes: [401] },
      ];

      const results: HealthCheckResult[] = [];

      for (const endpoint of endpoints) {
        const result = await checkEndpoint(
          endpoint.path,
          endpoint.method,
          endpoint.expectedCodes
        );
        results.push(result);
      }

      // All endpoints should be reachable
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.responseTime).toBeLessThan(5000); // 5 seconds max
        expect(result.status).not.toBe(0); // Not a network error
        expect(result.status).not.toBe(502); // Not a bad gateway
        expect(result.status).not.toBe(503); // Not service unavailable
      });

      console.log('Auth Endpoints Health:');
      results.forEach((r) => {
        console.log(
          `  ${r.endpoint}: ${r.status} (${r.responseTime}ms) ${r.success ? '✓' : '✗'}`
        );
      });
    });

    it('auth endpoints should respond within acceptable time', async () => {
      const endpoint = '/auth/me';
      const iterations = 5;
      const responseTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const result = await checkEndpoint(endpoint, 'GET', [401]);
        responseTimes.push(result.responseTime);
      }

      const avgResponseTime =
        responseTimes.reduce((a, b) => a + b, 0) / iterations;
      const maxResponseTime = Math.max(...responseTimes);

      console.log(`Auth endpoint average response time: ${avgResponseTime}ms`);
      console.log(`Auth endpoint max response time: ${maxResponseTime}ms`);

      // Average should be under 1 second
      expect(avgResponseTime).toBeLessThan(1000);
      // Max should be under 3 seconds
      expect(maxResponseTime).toBeLessThan(3000);
    });
  });

  describe('Jobs Endpoints Health', () => {
    it('should have all jobs endpoints available', async () => {
      const endpoints = [
        { path: '/jobs/upload', method: 'POST', expectedCodes: [401, 400] },
        { path: '/jobs/fake-id', method: 'GET', expectedCodes: [401, 404] },
        {
          path: '/jobs/fake-id/translate',
          method: 'POST',
          expectedCodes: [401, 404],
        },
        {
          path: '/jobs/fake-id/translation-status',
          method: 'GET',
          expectedCodes: [401, 404],
        },
      ];

      const results: HealthCheckResult[] = [];

      for (const endpoint of endpoints) {
        const result = await checkEndpoint(
          endpoint.path,
          endpoint.method,
          endpoint.expectedCodes
        );
        results.push(result);
      }

      // All endpoints should be reachable
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.responseTime).toBeLessThan(5000);
        expect(result.status).not.toBe(0);
        expect(result.status).not.toBe(502);
        expect(result.status).not.toBe(503);
      });

      console.log('Jobs Endpoints Health:');
      results.forEach((r) => {
        console.log(
          `  ${r.endpoint}: ${r.status} (${r.responseTime}ms) ${r.success ? '✓' : '✗'}`
        );
      });
    });

    it('translation endpoints should respond within acceptable time', async () => {
      const endpoint = '/jobs/fake-id/translation-status';
      const iterations = 5;
      const responseTimes: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const result = await checkEndpoint(endpoint, 'GET', [401, 404]);
        responseTimes.push(result.responseTime);
      }

      const avgResponseTime =
        responseTimes.reduce((a, b) => a + b, 0) / iterations;
      const maxResponseTime = Math.max(...responseTimes);

      console.log(
        `Translation endpoint average response time: ${avgResponseTime}ms`
      );
      console.log(
        `Translation endpoint max response time: ${maxResponseTime}ms`
      );

      // Average should be under 1 second
      expect(avgResponseTime).toBeLessThan(1000);
      // Max should be under 3 seconds
      expect(maxResponseTime).toBeLessThan(3000);
    });
  });

  describe('CORS Configuration Health', () => {
    it('should have proper CORS headers on all endpoints', async () => {
      const endpoints = [
        '/auth/register',
        '/auth/login',
        '/auth/me',
        '/jobs/upload',
        '/jobs/fake-id/translate',
        '/jobs/fake-id/translation-status',
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'OPTIONS',
        });

        const corsOrigin = response.headers.get('access-control-allow-origin');
        const corsMethods = response.headers.get('access-control-allow-methods');
        const corsHeaders = response.headers.get('access-control-allow-headers');
        const corsCredentials = response.headers.get(
          'access-control-allow-credentials'
        );

        expect(corsOrigin).toBeTruthy();
        expect(corsMethods).toBeTruthy();
        expect(corsHeaders).toBeTruthy();
        expect(corsHeaders).toContain('Authorization');
        expect(corsCredentials).toBe('true');

        console.log(`${endpoint}: CORS ✓`);
      }
    });

    it('should allow requests from allowed origins', async () => {
      const allowedOrigins = ['http://localhost:3000', 'https://localhost:3000'];

      for (const origin of allowedOrigins) {
        const response = await fetch(`${API_BASE_URL}/auth/me`, {
          method: 'GET',
          headers: {
            Origin: origin,
          },
        });

        const corsOrigin = response.headers.get('access-control-allow-origin');
        expect(corsOrigin).toBeTruthy();
      }
    });
  });

  describe('API Gateway Health', () => {
    it('should not return API Gateway errors', async () => {
      const endpoints = [
        '/auth/me',
        '/jobs/fake-id',
        '/jobs/fake-id/translation-status',
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'GET',
        });

        // Should not be gateway errors
        expect(response.status).not.toBe(502); // Bad Gateway
        expect(response.status).not.toBe(503); // Service Unavailable
        expect(response.status).not.toBe(504); // Gateway Timeout

        // Should have proper content type
        const contentType = response.headers.get('content-type');
        expect(contentType).toContain('application/json');
      }
    });

    it('should include X-Ray trace headers', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
      });

      // AWS X-Ray trace header should be present
      const traceId = response.headers.get('x-amzn-trace-id');
      const requestId = response.headers.get('x-amzn-requestid');

      // At least one should be present
      expect(traceId || requestId).toBeTruthy();
    });
  });

  describe('Response Format Consistency', () => {
    it('all endpoints should return valid JSON', async () => {
      const endpoints = [
        { path: '/auth/me', method: 'GET' },
        { path: '/auth/login', method: 'POST' },
        { path: '/jobs/fake-id', method: 'GET' },
        { path: '/jobs/fake-id/translation-status', method: 'GET' },
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${API_BASE_URL}${endpoint.path}`, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json',
          },
        });

        const contentType = response.headers.get('content-type');
        expect(contentType).toContain('application/json');

        // Should be able to parse as JSON
        let data;
        try {
          data = await response.json();
        } catch (error) {
          fail(`Failed to parse JSON response from ${endpoint.path}`);
        }

        expect(data).toBeTruthy();
        expect(typeof data).toBe('object');
      }
    });

    it('all error responses should have consistent structure', async () => {
      const endpoints = [
        { path: '/auth/me', method: 'GET', expectedStatus: 401 },
        { path: '/jobs/fake-id', method: 'GET', expectedStatus: 401 },
        {
          path: '/jobs/fake-id/translation-status',
          method: 'GET',
          expectedStatus: 401,
        },
      ];

      for (const endpoint of endpoints) {
        const response = await fetch(`${API_BASE_URL}${endpoint.path}`, {
          method: endpoint.method,
        });

        expect(response.status).toBe(endpoint.expectedStatus);

        const data = await response.json() as any;

        // All error responses should have these fields
        expect(data).toHaveProperty('message');
        expect(typeof data.message).toBe('string');
        expect(data.message.length).toBeGreaterThan(0);

        // Lambda-generated errors should have requestId
        // API Gateway 401s may not have requestId
        if (response.status !== 401 || data.requestId) {
          expect(data).toHaveProperty('requestId');
          expect(typeof data.requestId).toBe('string');
        }
      }
    });
  });

  describe('Rate Limiting and Throttling', () => {
    it('should handle concurrent requests gracefully', async () => {
      const concurrentRequests = 10;
      const endpoint = '/auth/me';

      const promises = Array.from({ length: concurrentRequests }, () =>
        fetch(`${API_BASE_URL}${endpoint}`, { method: 'GET' })
      );

      const responses = await Promise.all(promises);

      // All requests should complete
      expect(responses).toHaveLength(concurrentRequests);

      // None should be throttled (429)
      responses.forEach((response) => {
        expect(response.status).not.toBe(429);
        expect(response.status).not.toBe(502);
        expect(response.status).not.toBe(503);
      });

      console.log(
        `${concurrentRequests} concurrent requests handled successfully`
      );
    });

    it('should not throttle reasonable sequential requests', async () => {
      const sequentialRequests = 20;
      const endpoint = '/auth/me';
      const throttledStatuses: number[] = [];

      for (let i = 0; i < sequentialRequests; i++) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'GET',
        });

        if (response.status === 429) {
          throttledStatuses.push(i);
        }
      }

      console.log(
        `${sequentialRequests} sequential requests - throttled: ${throttledStatuses.length}`
      );

      // Should not throttle reasonable sequential requests
      expect(throttledStatuses.length).toBe(0);
    });
  });

  describe('Endpoint Availability Summary', () => {
    it('should generate comprehensive health report', async () => {
      const allEndpoints = [
        { path: '/auth/register', method: 'POST', category: 'Auth' },
        { path: '/auth/login', method: 'POST', category: 'Auth' },
        { path: '/auth/refresh', method: 'POST', category: 'Auth' },
        { path: '/auth/reset-password', method: 'POST', category: 'Auth' },
        { path: '/auth/me', method: 'GET', category: 'Auth' },
        { path: '/jobs/upload', method: 'POST', category: 'Jobs' },
        { path: '/jobs/fake-id', method: 'GET', category: 'Jobs' },
        {
          path: '/jobs/fake-id/translate',
          method: 'POST',
          category: 'Translation',
        },
        {
          path: '/jobs/fake-id/translation-status',
          method: 'GET',
          category: 'Translation',
        },
      ];

      const results: (HealthCheckResult & { category: string })[] = [];

      for (const endpoint of allEndpoints) {
        const result = await checkEndpoint(
          endpoint.path,
          endpoint.method,
          [200, 201, 400, 401, 404, 409]
        );
        results.push({ ...result, category: endpoint.category });
      }

      // Generate summary
      const summary = {
        total: results.length,
        healthy: results.filter((r) => r.success).length,
        unhealthy: results.filter((r) => !r.success).length,
        avgResponseTime:
          results.reduce((sum, r) => sum + r.responseTime, 0) / results.length,
        maxResponseTime: Math.max(...results.map((r) => r.responseTime)),
        byCategory: {} as Record<string, { healthy: number; total: number }>,
      };

      // Group by category
      results.forEach((r) => {
        if (!summary.byCategory[r.category]) {
          summary.byCategory[r.category] = { healthy: 0, total: 0 };
        }
        summary.byCategory[r.category].total++;
        if (r.success) {
          summary.byCategory[r.category].healthy++;
        }
      });

      console.log('\n=== API Health Report ===');
      console.log(`Total Endpoints: ${summary.total}`);
      console.log(`Healthy: ${summary.healthy}`);
      console.log(`Unhealthy: ${summary.unhealthy}`);
      console.log(`Avg Response Time: ${summary.avgResponseTime.toFixed(0)}ms`);
      console.log(`Max Response Time: ${summary.maxResponseTime}ms`);
      console.log('\nBy Category:');
      Object.entries(summary.byCategory).forEach(([category, stats]) => {
        console.log(
          `  ${category}: ${stats.healthy}/${stats.total} healthy`
        );
      });
      console.log('\nDetailed Results:');
      results.forEach((r) => {
        const status = r.success ? '✓' : '✗';
        console.log(
          `  ${status} [${r.category}] ${r.method} ${r.endpoint} - ${r.status} (${r.responseTime}ms)`
        );
        if (r.error) {
          console.log(`      Error: ${r.error}`);
        }
      });
      console.log('========================\n');

      // All endpoints should be healthy
      expect(summary.unhealthy).toBe(0);
      expect(summary.avgResponseTime).toBeLessThan(2000);
    });
  });

  describe('Infrastructure Dependencies', () => {
    it('should verify API Gateway is accessible', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
      });

      expect(response).toBeTruthy();
      expect(response.status).toBeDefined();
      expect(response.status).not.toBe(0); // Not a network error
    });

    it('should verify Lambda functions are responding', async () => {
      const endpoints = ['/auth/me', '/jobs/fake-id/translation-status'];

      for (const endpoint of endpoints) {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'GET',
        });

        // Lambda cold start might be slow, but should respond
        expect(response.status).toBeDefined();
        expect(response.status).not.toBe(502); // Lambda errors
        expect(response.status).not.toBe(503);
      }
    });

    it('should verify Cognito integration is working', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      });

      // Should get 401 from Cognito authorizer
      expect(response.status).toBe(401);

      const data = await response.json();
      expect(data).toHaveProperty('message');
    });
  });
});
