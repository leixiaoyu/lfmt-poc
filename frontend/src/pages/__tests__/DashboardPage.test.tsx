/**
 * DashboardPage Tests
 *
 * Tests the main dashboard page including:
 * - Page rendering with user data
 * - Logout functionality
 * - Navigation after logout
 * - User information display
 * - Edge cases (missing user fields)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DashboardPage from '../DashboardPage';
import { AuthContext, type AuthContextType } from '../../contexts/AuthContext';
import type { User } from '../../services/authService';

// Mock login page component
function MockLoginPage() {
  return <div data-testid="login-page">Login Page</div>;
}

// Helper to render DashboardPage with mocked AuthContext
function renderDashboard(authContext: Partial<AuthContextType>) {
  const defaultContext: AuthContextType = {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    clearError: vi.fn(),
    ...authContext,
  };

  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthContext.Provider value={defaultContext}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/login" element={<MockLoginPage />} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}

describe('DashboardPage', () => {
  const mockUser: User = {
    id: 'test-user-123',
    email: 'john.doe@example.com',
    firstName: 'John',
    lastName: 'Doe',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Page Rendering', () => {
    it('should render dashboard heading', () => {
      renderDashboard({ user: mockUser });

      expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    });

    it('should display welcome message with user name', () => {
      renderDashboard({ user: mockUser });

      expect(screen.getByText(/welcome john doe!/i)).toBeInTheDocument();
    });

    it('should display user email', () => {
      renderDashboard({ user: mockUser });

      expect(screen.getByText(/email: john.doe@example.com/i)).toBeInTheDocument();
    });

    it('should render logout button', () => {
      renderDashboard({ user: mockUser });

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toBeInTheDocument();
    });

    it('should display placeholder text for future implementation', () => {
      renderDashboard({ user: mockUser });

      expect(
        screen.getByText(/dashboard content will be implemented in later phases/i)
      ).toBeInTheDocument();
    });
  });

  describe('User Data Display', () => {
    it('should display full name correctly', () => {
      const user: User = {
        id: 'test-id',
        email: 'test@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
      };

      renderDashboard({ user });

      expect(screen.getByText(/welcome jane smith!/i)).toBeInTheDocument();
    });

    it('should display email correctly', () => {
      const user: User = {
        id: 'test-id',
        email: 'custom@email.com',
        firstName: 'Test',
        lastName: 'User',
      };

      renderDashboard({ user });

      expect(screen.getByText(/email: custom@email.com/i)).toBeInTheDocument();
    });

    it('should handle user with empty first name', () => {
      const user: User = {
        id: 'test-id',
        email: 'test@example.com',
        firstName: '',
        lastName: 'Doe',
      };

      renderDashboard({ user });

      // Should render "Welcome  Doe!" (with extra space)
      expect(screen.getByText(/welcome.*doe!/i)).toBeInTheDocument();
    });

    it('should handle user with empty last name', () => {
      const user: User = {
        id: 'test-id',
        email: 'test@example.com',
        firstName: 'John',
        lastName: '',
      };

      renderDashboard({ user });

      // Should render "Welcome John !" (with trailing space)
      expect(screen.getByText(/welcome john/i)).toBeInTheDocument();
    });

    it('should handle special characters in user name', () => {
      const user: User = {
        id: 'test-id',
        email: 'test@example.com',
        firstName: "O'Brien",
        lastName: 'José-María',
      };

      renderDashboard({ user });

      expect(screen.getByText(/welcome o'brien josé-maría!/i)).toBeInTheDocument();
    });
  });

  describe('Logout Functionality', () => {
    it('should call logout when logout button is clicked', async () => {
      const user = userEvent.setup();
      const mockLogout = vi.fn().mockResolvedValue(undefined);

      renderDashboard({ user: mockUser, logout: mockLogout });

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      await user.click(logoutButton);

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });

    it('should navigate to login page after logout', async () => {
      const user = userEvent.setup();
      const mockLogout = vi.fn().mockResolvedValue(undefined);

      renderDashboard({ user: mockUser, logout: mockLogout });

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      await user.click(logoutButton);

      // Wait for navigation to complete
      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
      });
    });

    it('should not navigate to login if logout fails', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockLogout = vi.fn().mockRejectedValue(new Error('Logout failed'));

      renderDashboard({ user: mockUser, logout: mockLogout });

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      await user.click(logoutButton);

      // Should NOT navigate if logout fails (await will throw)
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled();
      });

      // Should still be on dashboard page
      expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();

      consoleError.mockRestore();
    });

    it('should handle rapid logout button clicks gracefully', async () => {
      const user = userEvent.setup();
      const mockLogout = vi.fn().mockResolvedValue(undefined);

      renderDashboard({ user: mockUser, logout: mockLogout });

      const logoutButton = screen.getByRole('button', { name: /logout/i });

      // Click multiple times rapidly
      await user.click(logoutButton);
      await user.click(logoutButton);
      await user.click(logoutButton);

      // Wait for navigation
      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
      });

      // Logout should have been called at least once
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  describe('Integration with AuthContext', () => {
    it('should use user from AuthContext', () => {
      const contextUser: User = {
        id: 'context-user',
        email: 'context@example.com',
        firstName: 'Context',
        lastName: 'User',
      };

      renderDashboard({ user: contextUser });

      expect(screen.getByText(/welcome context user!/i)).toBeInTheDocument();
      expect(screen.getByText(/email: context@example.com/i)).toBeInTheDocument();
    });

    it('should use logout function from AuthContext', async () => {
      const user = userEvent.setup();
      const mockLogout = vi.fn().mockResolvedValue(undefined);

      renderDashboard({ user: mockUser, logout: mockLogout });

      await user.click(screen.getByRole('button', { name: /logout/i }));

      expect(mockLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null user gracefully', () => {
      renderDashboard({ user: null });

      // Should still render dashboard structure
      expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();

      // Welcome message should handle null user
      expect(screen.getByText(/welcome/i)).toBeInTheDocument();
    });

    it('should handle undefined user fields', () => {
      const user = {
        id: 'test-id',
        email: 'test@example.com',
        firstName: undefined as any,
        lastName: undefined as any,
      };

      renderDashboard({ user });

      // Should render without crashing
      expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    });

    it('should render logout button even with null user', () => {
      renderDashboard({ user: null });

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should have accessible heading', () => {
      renderDashboard({ user: mockUser });

      const heading = screen.getByRole('heading', { name: /dashboard/i });
      expect(heading).toBeInTheDocument();
      expect(heading.tagName).toBe('H1');
    });

    it('should have accessible logout button', () => {
      renderDashboard({ user: mockUser });

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toHaveAccessibleName();
    });

    it('should have proper semantic structure', () => {
      renderDashboard({ user: mockUser });

      // Should have main container
      const mainContainer = screen.getByRole('main');
      expect(mainContainer).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should be on /dashboard route', () => {
      renderDashboard({ user: mockUser });

      // Should render dashboard content
      expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();
    });

    it('should navigate away after logout', async () => {
      const user = userEvent.setup();
      const mockLogout = vi.fn().mockResolvedValue(undefined);

      renderDashboard({ user: mockUser, logout: mockLogout });

      // Initially on dashboard
      expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();

      // Click logout
      await user.click(screen.getByRole('button', { name: /logout/i }));

      // Should navigate to login
      await waitFor(() => {
        expect(screen.getByTestId('login-page')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: /dashboard/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('Async Logout Handling', () => {
    it('should handle async logout completion', async () => {
      const user = userEvent.setup();
      const mockLogout = vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      renderDashboard({ user: mockUser, logout: mockLogout });

      await user.click(screen.getByRole('button', { name: /logout/i }));

      // Should navigate after logout completes
      await waitFor(
        () => {
          expect(screen.getByTestId('login-page')).toBeInTheDocument();
        },
        { timeout: 500 }
      );
    });

    it('should handle logout promise rejection without navigation', async () => {
      const user = userEvent.setup();
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mockLogout = vi.fn().mockRejectedValue(new Error('Network error'));

      renderDashboard({ user: mockUser, logout: mockLogout });

      await user.click(screen.getByRole('button', { name: /logout/i }));

      // Should call logout but not navigate on error
      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled();
      });

      // Should remain on dashboard page after error
      expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
      expect(screen.queryByTestId('login-page')).not.toBeInTheDocument();

      consoleError.mockRestore();
    });
  });
});
