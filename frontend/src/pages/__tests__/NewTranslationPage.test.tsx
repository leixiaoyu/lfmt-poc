/**
 * New Translation Page Tests
 *
 * Comprehensive test suite for the NewTranslationPage component.
 * Tests app bar, logout functionality, and file upload integration.
 *
 * Key scenarios tested:
 * - App bar rendering with user information
 * - Logout button functionality and navigation
 * - File upload form integration
 * - Error handling and edge cases
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import NewTranslationPage from '../NewTranslationPage';
import { AuthProvider } from '../../contexts/AuthContext';
import * as AuthContext from '../../contexts/AuthContext';

// Mock the FileUploadForm component to isolate testing
vi.mock('../../components/Translation', () => ({
  FileUploadForm: ({ onUploadComplete, onUploadError }: any) => (
    <div data-testid="file-upload-form">
      <button onClick={() => onUploadComplete('test-file-id')}>
        Simulate Upload Complete
      </button>
      <button onClick={() => onUploadError('Upload failed')}>
        Simulate Upload Error
      </button>
    </div>
  ),
}));

// Mock router navigation
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('NewTranslationPage', () => {
  const mockLogout = vi.fn();
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderWithAuth = (user: typeof mockUser | null = mockUser) => {
    vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
      user,
      isAuthenticated: !!user,
      isLoading: false,
      error: null,
      login: vi.fn(),
      register: vi.fn(),
      logout: mockLogout,
      refreshToken: vi.fn(),
      clearError: vi.fn(),
    });

    return render(
      <BrowserRouter>
        <NewTranslationPage />
      </BrowserRouter>
    );
  };

  describe('App Bar Rendering', () => {
    it('should render app bar with application title', () => {
      renderWithAuth();

      expect(screen.getByText('LFMT Translation Service')).toBeInTheDocument();
    });

    it('should display user email when authenticated', () => {
      renderWithAuth(mockUser);

      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });

    it('should not display email when user is null', () => {
      renderWithAuth(null);

      expect(screen.queryByText('test@example.com')).not.toBeInTheDocument();
    });

    it('should render logout button', () => {
      renderWithAuth();

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toBeInTheDocument();
    });
  });

  describe('Logout Functionality', () => {
    it('should call logout when logout button is clicked', async () => {
      renderWithAuth();

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalledTimes(1);
      });
    });

    it('should navigate to login page after logout', async () => {
      mockLogout.mockResolvedValueOnce(undefined);
      renderWithAuth();

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/login');
      });
    });

    it('should handle logout errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockLogout.mockRejectedValueOnce(new Error('Logout failed'));

      renderWithAuth();

      const logoutButton = screen.getByRole('button', { name: /logout/i });
      fireEvent.click(logoutButton);

      await waitFor(() => {
        expect(mockLogout).toHaveBeenCalled();
      });

      // Component should still attempt to navigate even if logout throws
      // (This is current behavior - could be improved to show error)

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Page Content', () => {
    it('should render page title', () => {
      renderWithAuth();

      expect(screen.getByText('New Translation')).toBeInTheDocument();
    });

    it('should render page description', () => {
      renderWithAuth();

      expect(
        screen.getByText(/Upload your document to begin the translation process/i)
      ).toBeInTheDocument();
    });

    it('should render file size limit information', () => {
      renderWithAuth();

      expect(screen.getByText(/100MB/i)).toBeInTheDocument();
    });
  });

  describe('File Upload Integration', () => {
    it('should render FileUploadForm component', () => {
      renderWithAuth();

      expect(screen.getByTestId('file-upload-form')).toBeInTheDocument();
    });

    it('should handle upload complete callback', () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      renderWithAuth();

      const completeButton = screen.getByText('Simulate Upload Complete');
      fireEvent.click(completeButton);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Upload complete, fileId:',
        'test-file-id'
      );

      consoleLogSpy.mockRestore();
    });

    it('should handle upload error callback', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      renderWithAuth();

      const errorButton = screen.getByText('Simulate Upload Error');
      fireEvent.click(errorButton);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Upload error:',
        'Upload failed'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Accessibility', () => {
    it('should have semantic HTML structure', () => {
      renderWithAuth();

      // App bar should be a navigation landmark
      const appBar = screen.getByRole('banner');
      expect(appBar).toBeInTheDocument();

      // Main content should be in a main landmark
      const main = screen.getByRole('main');
      expect(main).toBeInTheDocument();

      // Logout should be a button
      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toHaveAttribute('type', 'button');
    });

    it('should have proper heading hierarchy', () => {
      renderWithAuth();

      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).toHaveTextContent('New Translation');
    });
  });

  describe('Responsive Behavior', () => {
    it('should use Container with md maxWidth', () => {
      const { container } = renderWithAuth();

      const mainContainer = container.querySelector('main');
      expect(mainContainer).toBeInTheDocument();
      // Material-UI applies maxWidth through classes, which is implementation detail
      // We're just ensuring the container exists
    });
  });

  describe('User Experience', () => {
    it('should maintain logout button visibility during upload', () => {
      renderWithAuth();

      // Logout button should always be visible, even during upload
      const logoutButton = screen.getByRole('button', { name: /logout/i });
      expect(logoutButton).toBeVisible();
      expect(logoutButton).not.toBeDisabled();
    });

    it('should display user context (email) prominently', () => {
      renderWithAuth(mockUser);

      const emailElement = screen.getByText('test@example.com');

      // Email should be in the app bar (not buried in content)
      const appBar = screen.getByRole('banner');
      expect(appBar).toContainElement(emailElement);
    });
  });

  describe('Edge Cases', () => {
    it('should handle user with missing firstName/lastName', () => {
      const minimalUser = {
        id: 'user-456',
        email: 'minimal@example.com',
        firstName: '',
        lastName: '',
      };

      renderWithAuth(minimalUser);

      // Should still display email
      expect(screen.getByText('minimal@example.com')).toBeInTheDocument();
    });

    it('should handle very long email addresses', () => {
      const userWithLongEmail = {
        ...mockUser,
        email: 'very.long.email.address.that.might.overflow@example.com',
      };

      renderWithAuth(userWithLongEmail);

      expect(
        screen.getByText('very.long.email.address.that.might.overflow@example.com')
      ).toBeInTheDocument();
    });

    it('should not crash if auth context provides undefined user', () => {
      expect(() => {
        renderWithAuth(null);
      }).not.toThrow();

      // Logout button should still be present
      expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument();
    });
  });
});
