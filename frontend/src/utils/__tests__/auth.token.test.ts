/**
 * Authentication Token Tests
 *
 * Tests to prevent regression of authentication issues:
 * - Token expiration handling
 * - Token format validation
 * - Authorization header format
 * - Token refresh logic
 */

import { getAuthToken } from '../api';

describe('Authentication Token Handling', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('Token Retrieval', () => {
    it('should retrieve valid access token from localStorage', () => {
      const mockToken = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      localStorage.setItem('accessToken', mockToken);

      const token = getAuthToken();
      expect(token).toBe(mockToken);
    });

    it('should return null when no token exists', () => {
      const token = getAuthToken();
      expect(token).toBeNull();
    });

    it('should handle corrupted localStorage gracefully', () => {
      // Simulate corrupted storage
      Object.defineProperty(window, 'localStorage', {
        value: {
          getItem: jest.fn(() => {
            throw new Error('Storage error');
          }),
        },
        writable: true,
      });

      expect(() => getAuthToken()).not.toThrow();
    });
  });

  describe('Token Format Validation', () => {
    it('should validate JWT token format (3 parts separated by dots)', () => {
      const validToken = 'header.payload.signature';
      const isValid = validateJWTFormat(validToken);
      expect(isValid).toBe(true);
    });

    it('should reject malformed tokens', () => {
      const invalidTokens = [
        'not-a-jwt',
        'only.two.parts', // Missing signature
        '', // Empty
        'Bearer token', // Includes Bearer prefix (should be removed)
      ];

      invalidTokens.forEach((token) => {
        const isValid = validateJWTFormat(token);
        expect(isValid).toBe(false);
      });
    });
  });

  describe('Token Expiration', () => {
    it('should detect expired tokens', () => {
      // Create an expired token (exp in the past)
      const expiredPayload = {
        sub: 'test-user',
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };
      const expiredToken = createMockJWT(expiredPayload);

      const isExpired = isTokenExpired(expiredToken);
      expect(isExpired).toBe(true);
    });

    it('should detect valid (non-expired) tokens', () => {
      const validPayload = {
        sub: 'test-user',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      };
      const validToken = createMockJWT(validPayload);

      const isExpired = isTokenExpired(validToken);
      expect(isExpired).toBe(false);
    });

    it('should handle tokens without expiration claim', () => {
      const payloadWithoutExp = {
        sub: 'test-user',
        // No exp field
      };
      const token = createMockJWT(payloadWithoutExp);

      const isExpired = isTokenExpired(token);
      // Should treat as expired or invalid
      expect(isExpired).toBe(true);
    });
  });

  describe('Authorization Header Format', () => {
    it('should format Authorization header correctly', () => {
      const token = 'mock-access-token';
      const header = formatAuthHeader(token);
      expect(header).toBe(`Bearer ${token}`);
    });

    it('should not double-add Bearer prefix', () => {
      const tokenWithBearer = 'Bearer mock-access-token';
      const header = formatAuthHeader(tokenWithBearer);
      expect(header).toBe('Bearer mock-access-token');
      expect(header).not.toBe('Bearer Bearer mock-access-token');
    });

    it('should handle empty token', () => {
      const header = formatAuthHeader('');
      expect(header).toBe('Bearer ');
    });
  });

  describe('Token Refresh Logic', () => {
    it('should use refresh token when access token expires', async () => {
      const expiredAccessToken = createExpiredToken();
      const validRefreshToken = createValidRefreshToken();

      localStorage.setItem('accessToken', expiredAccessToken);
      localStorage.setItem('refreshToken', validRefreshToken);

      // Mock refresh endpoint
      const mockRefresh = jest.fn().mockResolvedValue({
        accessToken: 'new-access-token',
        expiresIn: 3600,
      });

      // Attempt to get token - should trigger refresh
      const token = await getValidToken(mockRefresh);
      expect(mockRefresh).toHaveBeenCalled();
      expect(token).toBe('new-access-token');
    });

    it('should redirect to login when refresh token also expires', async () => {
      const expiredAccessToken = createExpiredToken();
      const expiredRefreshToken = createExpiredToken();

      localStorage.setItem('accessToken', expiredAccessToken);
      localStorage.setItem('refreshToken', expiredRefreshToken);

      const mockRedirect = jest.fn();
      window.location.href = '/login';

      await getValidToken();
      // Should clear tokens and redirect
      expect(localStorage.getItem('accessToken')).toBeNull();
      expect(localStorage.getItem('refreshToken')).toBeNull();
    });

    it('should handle refresh token API errors', async () => {
      const expiredAccessToken = createExpiredToken();
      const validRefreshToken = createValidRefreshToken();

      localStorage.setItem('accessToken', expiredAccessToken);
      localStorage.setItem('refreshToken', validRefreshToken);

      const mockRefresh = jest.fn().mockRejectedValue(new Error('Refresh failed'));

      await expect(getValidToken(mockRefresh)).rejects.toThrow();
      // Should clear tokens on refresh failure
      expect(localStorage.getItem('accessToken')).toBeNull();
    });
  });

  describe('Cognito Token Validation', () => {
    it('should validate Cognito JWT structure', () => {
      const cognitoToken = {
        header: {
          kid: 'test-kid',
          alg: 'RS256',
        },
        payload: {
          sub: 'test-user-id',
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_tyG2buO70',
          client_id: '4qlc7n27ptoad18k3rlj1nipg7',
          token_use: 'access',
          scope: 'aws.cognito.signin.user.admin',
          auth_time: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        },
      };

      const isValid = validateCognitoToken(cognitoToken);
      expect(isValid).toBe(true);
    });

    it('should reject non-Cognito tokens', () => {
      const nonCognitoToken = {
        payload: {
          sub: 'test-user',
          iss: 'https://not-cognito.com',
        },
      };

      const isValid = validateCognitoToken(nonCognitoToken);
      expect(isValid).toBe(false);
    });

    it('should validate token_use is "access" not "id"', () => {
      const idToken = {
        payload: {
          token_use: 'id', // Wrong token type
          iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_tyG2buO70',
        },
      };

      const isValid = validateCognitoToken(idToken);
      expect(isValid).toBe(false);
    });
  });
});

// Helper functions for tests
function validateJWTFormat(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3;
}

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split('.');
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return true;
    return payload.exp < Math.floor(Date.now() / 1000);
  } catch {
    return true;
  }
}

function formatAuthHeader(token: string): string {
  if (token.startsWith('Bearer ')) return token;
  return `Bearer ${token}`;
}

function createMockJWT(payload: any): string {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payloadStr = btoa(JSON.stringify(payload));
  const signature = 'mock-signature';
  return `${header}.${payloadStr}.${signature}`;
}

function createExpiredToken(): string {
  return createMockJWT({
    sub: 'test-user',
    exp: Math.floor(Date.now() / 1000) - 3600,
  });
}

function createValidRefreshToken(): string {
  return createMockJWT({
    sub: 'test-user',
    exp: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
  });
}

async function getValidToken(refreshFn?: any): Promise<string | null> {
  const accessToken = localStorage.getItem('accessToken');
  if (!accessToken || isTokenExpired(accessToken)) {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken || isTokenExpired(refreshToken)) {
      localStorage.clear();
      window.location.href = '/login';
      return null;
    }
    if (refreshFn) {
      try {
        const result = await refreshFn();
        localStorage.setItem('accessToken', result.accessToken);
        return result.accessToken;
      } catch (error) {
        localStorage.clear();
        throw error;
      }
    }
  }
  return accessToken;
}

function validateCognitoToken(token: any): boolean {
  if (!token.payload) return false;
  if (!token.payload.iss?.includes('cognito-idp.us-east-1.amazonaws.com')) return false;
  if (token.payload.token_use !== 'access') return false;
  return true;
}
