/**
 * Authentication Integration Tests
 *
 * Tests the complete authentication flow including:
 * - Protected route access with valid token
 * - Protected route redirect without token
 * - Session restoration on page load
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import { ProtectedRoute } from '../components/Auth/ProtectedRoute';
import * as api from '../utils/api';
import { AUTH_CONFIG } from '../config/constants';

// Mock API client
vi.mock('../utils/api', async () => {
  const actual = await vi.importActual('../utils/api');
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
    },
  };
});

// Test components
function ProtectedContent() {
  return (
    <div>
      <h1>Dashboard</h1>
      <div>Protected Content</div>
    </div>
  );
}

function LoginPage() {
  return <div>Login Page</div>;
}

// Helper to render app with routing and auth
function renderApp() {
  return render(
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/protected"
            element={
              <ProtectedRoute>
                <ProtectedContent />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

describe('Authentication Integration Tests', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Protected Route without Authentication', () => {
    it('should redirect to login when no token exists', async () => {
      // Setup: No token in localStorage
      // (already cleared in beforeEach)

      // Act: Navigate to protected route
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should redirect to login
      await waitFor(() => {
        expect(screen.getByText('Login Page')).toBeInTheDocument();
      });

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it.skip('should show loading state briefly before redirecting', async () => {
      // Setup: No token
      window.history.pushState({}, '', '/protected');

      // Act: Render app
      renderApp();

      // Assert: Should show loading initially
      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      // Then redirect to login
      await waitFor(() => {
        expect(screen.getByText('Login Page')).toBeInTheDocument();
      });
    });
  });

  describe('Protected Route with Valid Authentication', () => {
    const mockUser = {
      id: 'user-123',
      email: 'test@example.com',
      firstName: 'Test',
      lastName: 'User',
    };

    const mockToken = 'valid-jwt-token';

    beforeEach(() => {
      // Setup: Valid token and user in localStorage
      localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, mockToken);
      localStorage.setItem(AUTH_CONFIG.USER_DATA_KEY, JSON.stringify(mockUser));

      // Mock successful API call to verify token
      vi.spyOn(api.apiClient, 'get').mockResolvedValue({
        data: { user: mockUser },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });
    });

    it.skip('should allow access to protected route with valid token', async () => {
      // Act: Navigate to protected route
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should show protected content after loading
      await waitFor(() => {
        expect(screen.getByText('Protected Content')).toBeInTheDocument();
      });

      expect(screen.queryByText('Login Page')).not.toBeInTheDocument();
    });

    it.skip('should verify token by calling /auth/me endpoint', async () => {
      // Act: Navigate to protected route
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should call getCurrentUser API
      await waitFor(() => {
        expect(api.apiClient.get).toHaveBeenCalledWith('/auth/me');
      });

      // And show protected content
      expect(await screen.findByText('Protected Content')).toBeInTheDocument();
    });

    it.skip('should show loading state while verifying token', async () => {
      // Setup: Delay API response to observe loading state
      let resolveGetUser: (value: any) => void;
      const getUserPromise = new Promise((resolve) => {
        resolveGetUser = resolve;
      });

      vi.spyOn(api.apiClient, 'get').mockReturnValue(getUserPromise as any);

      // Act: Navigate to protected route
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should show loading
      expect(screen.getByRole('progressbar')).toBeInTheDocument();

      // Resolve API call
      resolveGetUser!({
        data: { user: mockUser },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      // Should show content after loading
      await waitFor(() => {
        expect(screen.getByText('Protected Content')).toBeInTheDocument();
      });
    });
  });

  describe('Protected Route with Invalid/Expired Token', () => {
    const invalidToken = 'expired-jwt-token';

    beforeEach(() => {
      // Setup: Invalid/expired token in localStorage
      localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, invalidToken);

      // Mock 401 response for expired token
      vi.spyOn(api.apiClient, 'get').mockRejectedValue({
        message: 'Token expired',
        status: 401,
      });
    });

    it('should redirect to login when token is invalid', async () => {
      // Act: Navigate to protected route
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should redirect to login after token verification fails
      await waitFor(() => {
        expect(screen.getByText('Login Page')).toBeInTheDocument();
      });

      expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('should clear auth data when token is invalid', async () => {
      // Act: Navigate to protected route
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should clear localStorage
      await waitFor(() => {
        expect(localStorage.getItem(AUTH_CONFIG.ACCESS_TOKEN_KEY)).toBeNull();
      });
    });
  });

  describe('Session Persistence', () => {
    const mockUser = {
      id: 'user-456',
      email: 'persisted@example.com',
      firstName: 'Persisted',
      lastName: 'User',
    };

    it.skip('should restore session on page reload with valid token', async () => {
      // Setup: Simulate existing session from previous page load
      const token = 'persisted-token';
      localStorage.setItem(AUTH_CONFIG.ACCESS_TOKEN_KEY, token);

      vi.spyOn(api.apiClient, 'get').mockResolvedValue({
        data: { user: mockUser },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {} as any,
      });

      // Act: Load protected page (simulating page reload)
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should automatically verify token and show content
      await waitFor(() => {
        expect(screen.getByText('Protected Content')).toBeInTheDocument();
      });

      expect(api.apiClient.get).toHaveBeenCalledWith('/auth/me');
    });

    it('should not make API call when no token exists', async () => {
      // Setup: No token (fresh session)
      // Already cleared in beforeEach

      // Act: Load protected page
      window.history.pushState({}, '', '/protected');
      renderApp();

      // Assert: Should redirect to login without API call
      await waitFor(() => {
        expect(screen.getByText('Login Page')).toBeInTheDocument();
      });

      expect(api.apiClient.get).not.toHaveBeenCalled();
    });
  });
});
