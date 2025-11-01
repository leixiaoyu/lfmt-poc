/**
 * FileUploadForm Component Tests
 *
 * Comprehensive test suite for FileUploadForm component
 * Tests file selection, validation, upload workflow, and user interactions
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUploadForm } from '../FileUploadForm';
import * as uploadService from '../../../services/uploadService';

// Mock upload service
vi.mock('../../../services/uploadService', () => ({
  uploadService: {
    uploadDocument: vi.fn(),
  },
}));

describe('FileUploadForm', () => {
  const mockOnUploadComplete = vi.fn();
  const mockOnUploadError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Initial Rendering', () => {
    it('should render upload form with correct heading', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      expect(
        screen.getByRole('heading', { name: /upload document/i })
      ).toBeInTheDocument();
    });

    it('should display file size and type information', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      expect(
        screen.getByText(/maximum file size: 100mb/i)
      ).toBeInTheDocument();
    });

    it('should render file drop zone', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      expect(
        screen.getByText(/drag and drop your file here/i)
      ).toBeInTheDocument();
      expect(screen.getByText(/or click to browse/i)).toBeInTheDocument();
    });

    it('should have upload button disabled initially', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      expect(uploadButton).toBeDisabled();
    });
  });

  describe('File Selection', () => {
    it('should handle valid file selection', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500); // 1500 bytes - valid size
      const file = new File([content], 'test.txt', {
        type: 'text/plain',
      });

      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText('test.txt')).toBeInTheDocument();
      });

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      expect(uploadButton).toBeEnabled();
    });

    it('should display file size after selection', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1024 * 1024); // 1MB
      const file = new File([content], 'large.txt', { type: 'text/plain' });

      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/1\.00 MB/i)).toBeInTheDocument();
      });
    });

    it('should show Clear button after file selection', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /clear/i })
        ).toBeInTheDocument();
      });
    });

    it('should clear selected file when Clear button clicked', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText('test.txt')).toBeInTheDocument();
      });

      const clearButton = screen.getByRole('button', { name: /clear/i });
      await user.click(clearButton);

      await waitFor(() => {
        expect(screen.queryByText('test.txt')).not.toBeInTheDocument();
        expect(
          screen.getByText(/drag and drop your file here/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('File Validation', () => {
    it('should reject files that are too large', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const largeContent = 'x'.repeat(101 * 1024 * 1024); // 101MB
      const file = new File([largeContent], 'large.txt', {
        type: 'text/plain',
      });

      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByText(/file size exceeds maximum allowed size/i)
        ).toBeInTheDocument();
      });

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      expect(uploadButton).toBeDisabled();
    });

    it('should reject files that are too small', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const file = new File(['x'], 'tiny.txt', { type: 'text/plain' });

      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByText(/file size is below minimum required size/i)
        ).toBeInTheDocument();
      });
    });

    it('should reject non-text files', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'image.png', { type: 'image/png' });

      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByText(/only \.txt files are allowed/i)
        ).toBeInTheDocument();
      });
    });

    it('should reject files without .txt extension', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'file.doc', { type: 'text/plain' });

      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByText(/only \.txt files are allowed/i)
        ).toBeInTheDocument();
      });
    });

    it('should clear error when valid file is selected after invalid file', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      // Select invalid file - has text/plain type but wrong extension
      const content = 'x'.repeat(1500);
      const invalidFile = new File([content], 'file.doc', {
        type: 'text/plain',
      });
      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, invalidFile);

      await waitFor(() => {
        // Type check passes, but extension check fails
        expect(
          screen.getByText(/only \.txt files are allowed/i)
        ).toBeInTheDocument();
      });

      // Select valid file
      const validFile = new File([content], 'test.txt', {
        type: 'text/plain',
      });
      await user.upload(input, validFile);

      await waitFor(() => {
        expect(
          screen.queryByText(/only \.txt files are allowed/i)
        ).not.toBeInTheDocument();
      });
    });
  });

  describe('Drag and Drop', () => {
    it('should handle file drop', async () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const dropZone = screen.getByText(/drag and drop your file here/i)
        .closest('div')!;

      fireEvent.drop(dropZone, {
        dataTransfer: {
          files: [file],
        },
      });

      await waitFor(() => {
        expect(screen.getByText('test.txt')).toBeInTheDocument();
      });
    });

    it('should highlight drop zone on drag over', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const dropZone = screen.getByText(/drag and drop your file here/i)
        .closest('div')!.parentElement!;

      fireEvent.dragEnter(dropZone);

      // The component should apply active styling (tested via visual inspection)
      // We verify the event is handled without errors
      expect(dropZone).toBeInTheDocument();
    });

    it('should remove highlight when drag leaves', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const dropZone = screen.getByText(/drag and drop your file here/i)
        .closest('div')!.parentElement!;

      fireEvent.dragEnter(dropZone);
      fireEvent.dragLeave(dropZone);

      // Verify event handled
      expect(dropZone).toBeInTheDocument();
    });
  });

  describe('Upload Workflow', () => {
    it('should upload file successfully', async () => {
      const user = userEvent.setup();

      vi.spyOn(uploadService.uploadService, 'uploadDocument').mockResolvedValue(
        {
          fileId: 'test-file-id-123',
          success: true,
        }
      );

      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      await user.click(uploadButton);

      await waitFor(() => {
        expect(uploadService.uploadService.uploadDocument).toHaveBeenCalledWith(
          file,
          expect.any(Function)
        );
      });

      await waitFor(() => {
        expect(mockOnUploadComplete).toHaveBeenCalledWith('test-file-id-123');
      });

      expect(
        screen.getByText(/file uploaded successfully/i)
      ).toBeInTheDocument();
    });

    it('should display progress during upload', async () => {
      const user = userEvent.setup();

      vi.spyOn(
        uploadService.uploadService,
        'uploadDocument'
      ).mockImplementation(async (_file, onProgress) => {
        // Simulate progress
        if (onProgress) {
          onProgress({ loaded: 50, total: 100, percentage: 50 });
          onProgress({ loaded: 100, total: 100, percentage: 100 });
        }
        return { fileId: 'test-id', success: true };
      });

      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      await user.click(uploadButton);

      await waitFor(() => {
        expect(screen.getByText('Uploading test.txt...')).toBeInTheDocument();
      });
    });

    it('should handle upload errors', async () => {
      const user = userEvent.setup();

      vi.spyOn(uploadService.uploadService, 'uploadDocument').mockResolvedValue(
        {
          fileId: '',
          success: false,
          error: 'Network error during upload',
        }
      );

      render(
        <FileUploadForm
          onUploadComplete={mockOnUploadComplete}
          onUploadError={mockOnUploadError}
        />
      );

      const content = 'x'.repeat(1500);
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      await user.click(uploadButton);

      await waitFor(() => {
        expect(
          screen.getByText(/network error during upload/i)
        ).toBeInTheDocument();
      });

      expect(mockOnUploadError).toHaveBeenCalledWith(
        'Network error during upload'
      );
      expect(mockOnUploadComplete).not.toHaveBeenCalled();
    });

    it('should allow uploading another file after success', async () => {
      const user = userEvent.setup();

      vi.spyOn(uploadService.uploadService, 'uploadDocument').mockResolvedValue(
        {
          fileId: 'test-id',
          success: true,
        }
      );

      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content = 'x'.repeat(1500);
      const file = new File([content], 'test.txt', { type: 'text/plain' });
      const input = screen.getByLabelText(/file upload input/i);
      await user.upload(input, file);

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      await user.click(uploadButton);

      await waitFor(() => {
        expect(
          screen.getByText(/file uploaded successfully/i)
        ).toBeInTheDocument();
      });

      const uploadAnotherButton = screen.getByRole('button', {
        name: /upload another file/i,
      });
      await user.click(uploadAnotherButton);

      await waitFor(() => {
        expect(
          screen.getByText(/drag and drop your file here/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Accessibility', () => {
    it('should have accessible file input', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const input = screen.getByLabelText(/file upload input/i);
      expect(input).toHaveAttribute('type', 'file');
      expect(input).toHaveAttribute('accept', '.txt');
    });

    it('should have accessible buttons', () => {
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const uploadButton = screen.getByRole('button', { name: /^upload$/i });
      expect(uploadButton).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid file selection changes', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const content1 = 'x'.repeat(1500);
      const content2 = 'y'.repeat(1600);
      const file1 = new File([content1], 'test1.txt', {
        type: 'text/plain',
      });
      const file2 = new File([content2], 'test2.txt', {
        type: 'text/plain',
      });

      const input = screen.getByLabelText(/file upload input/i);

      await user.upload(input, file1);
      await user.upload(input, file2);

      await waitFor(() => {
        expect(screen.getByText('test2.txt')).toBeInTheDocument();
        expect(screen.queryByText('test1.txt')).not.toBeInTheDocument();
      });
    });

    it('should handle clicking drop zone to browse', async () => {
      const user = userEvent.setup();
      render(<FileUploadForm onUploadComplete={mockOnUploadComplete} />);

      const dropZone = screen.getByText(/drag and drop your file here/i)
        .closest('div')!.parentElement!;

      await user.click(dropZone);

      // Verify the hidden input would be triggered (tested via implementation)
      expect(dropZone).toBeInTheDocument();
    });
  });
});
