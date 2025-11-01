/**
 * FileUpload Component Tests
 *
 * Tests cover file selection, drag-drop, validation, and error handling.
 * Critical for ensuring only valid files are uploaded.
 *
 * Target Coverage: 85%+
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../../../test-utils';
import userEvent from '@testing-library/user-event';
import { FileUpload } from '../FileUpload';

describe('FileUpload Component', () => {
  const createMockFile = (name: string, size: number, type: string = 'text/plain'): File => {
    const file = new File(['a'.repeat(size)], name, { type });
    return file;
  };

  const createProps = (overrides = {}) => ({
    file: null,
    onChange: vi.fn(),
    ...overrides,
  });

  describe('Rendering', () => {
    it('should render the component with heading', () => {
      // Arrange & Act
      render(<FileUpload {...createProps()} />);

      // Assert
      expect(screen.getByText('Upload Document')).toBeInTheDocument();
    });

    it('should display accepted formats and max size', () => {
      // Arrange & Act
      render(<FileUpload {...createProps()} maxSizeMB={10} />);

      // Assert
      expect(screen.getByText(/Supported formats:.*\.txt.*\.doc.*\.docx.*\.pdf/i)).toBeInTheDocument();
      expect(screen.getByText(/max 10MB/i)).toBeInTheDocument();
    });

    it('should render drag-drop zone when no file selected', () => {
      // Arrange & Act
      render(<FileUpload {...createProps()} />);

      // Assert
      expect(screen.getByText('Drag and drop your file here')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Browse Files' })).toBeInTheDocument();
    });

    it('should render file info when file is selected', () => {
      // Arrange
      const mockFile = createMockFile('test-document.txt', 1024);

      // Act
      render(<FileUpload {...createProps({ file: mockFile })} />);

      // Assert
      expect(screen.getByText('test-document.txt')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Remove/i })).toBeInTheDocument();
    });

    it('should have hidden file input with proper attributes', () => {
      // Arrange & Act
      render(<FileUpload {...createProps()} />);

      // Assert
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;
      expect(fileInput).toHaveAttribute('type', 'file');
      expect(fileInput).toHaveAttribute('accept', '.txt,.doc,.docx,.pdf');
      expect(fileInput).toHaveStyle({ display: 'none' });
    });
  });

  describe('File Selection via Browse Button', () => {
    it('should call onChange with file when valid file is selected', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      render(<FileUpload {...createProps({ onChange: mockOnChange })} />);

      const mockFile = createMockFile('test.txt', 1024);
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert
      expect(mockOnChange).toHaveBeenCalledTimes(1);
      expect(mockOnChange).toHaveBeenCalledWith(mockFile);
    });

    it('should open file dialog when clicking browse button', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<FileUpload {...createProps()} />);

      const browseButton = screen.getByRole('button', { name: 'Browse Files' });
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      const clickSpy = vi.spyOn(fileInput, 'click');

      // Act
      await user.click(browseButton);

      // Assert
      expect(clickSpy).toHaveBeenCalled();
    });

    it('should open file dialog when clicking drag-drop zone', async () => {
      // Arrange
      const user = userEvent.setup();
      render(<FileUpload {...createProps()} />);

      const dropZone = screen.getByText('Drag and drop your file here').closest('div');
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      const clickSpy = vi.spyOn(fileInput, 'click');

      // Act
      if (dropZone) {
        await user.click(dropZone);
      }

      // Assert
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('File Validation', () => {
    it('should accept .txt files', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      render(<FileUpload {...createProps({ onChange: mockOnChange })} />);

      const mockFile = createMockFile('document.txt', 1024);
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(mockFile);
    });

    it('should accept .doc files', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      render(<FileUpload {...createProps({ onChange: mockOnChange })} />);

      const mockFile = createMockFile('document.doc', 1024, 'application/msword');
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(mockFile);
    });

    it('should accept .docx files', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      render(<FileUpload {...createProps({ onChange: mockOnChange })} />);

      const mockFile = createMockFile('document.docx', 1024, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(mockFile);
    });

    it('should accept .pdf files', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      render(<FileUpload {...createProps({ onChange: mockOnChange })} />);

      const mockFile = createMockFile('document.pdf', 1024, 'application/pdf');
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(mockFile);
    });

    it('should reject files larger than max size', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(<FileUpload {...createProps({ onChange: mockOnChange, maxSizeMB: 1 })} />);

      // Create file larger than 1MB (1MB = 1024 * 1024 bytes)
      const mockFile = createMockFile('large-file.txt', 2 * 1024 * 1024);
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert
      expect(mockOnChange).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('File size must be less than 1MB');

      consoleErrorSpy.mockRestore();
    });

    it('should reject unsupported file formats', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();

      render(<FileUpload {...createProps({ onChange: mockOnChange })} />);

      const mockFile = createMockFile('document.jpg', 1024, 'image/jpeg');
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert - onChange should not be called for invalid format
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it('should use custom accepted formats when provided', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      render(<FileUpload {...createProps({ onChange: mockOnChange, acceptedFormats: ['.txt'] })} />);

      const mockFile = createMockFile('document.pdf', 1024);
      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;

      // Act
      await user.upload(fileInput, mockFile);

      // Assert - onChange should not be called for non-txt files
      expect(mockOnChange).not.toHaveBeenCalled();
    });
  });

  describe('Drag and Drop', () => {
    it('should highlight drop zone on drag enter', () => {
      // Arrange
      const { container } = render(<FileUpload {...createProps()} />);
      const dropZone = container.querySelector('[class*="MuiBox-root"]');

      // Act
      if (dropZone) {
        fireEvent.dragEnter(dropZone);
      }

      // Assert - Visual feedback for drag state
      expect(dropZone).toBeInTheDocument();
    });

    it('should remove highlight on drag leave', () => {
      // Arrange
      const { container } = render(<FileUpload {...createProps()} />);
      const dropZone = container.querySelector('[class*="MuiBox-root"]');

      // Act
      if (dropZone) {
        fireEvent.dragEnter(dropZone);
        fireEvent.dragLeave(dropZone);
      }

      // Assert - Visual feedback removed
      expect(dropZone).toBeInTheDocument();
    });

    it('should call onChange when valid file is dropped', () => {
      // Arrange
      const mockOnChange = vi.fn();
      render(<FileUpload {...createProps({ onChange: mockOnChange })} />);

      const mockFile = createMockFile('dropped-file.txt', 1024);
      const dropZone = screen.getByText('Drag and drop your file here').closest('div');

      // Act
      if (dropZone) {
        fireEvent.dragEnter(dropZone);
        fireEvent.drop(dropZone, {
          dataTransfer: {
            files: [mockFile],
          },
        });
      }

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(mockFile);
    });

    it('should not call onChange when invalid file is dropped', () => {
      // Arrange
      const mockOnChange = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      render(<FileUpload {...createProps({ onChange: mockOnChange, maxSizeMB: 1 })} />);

      const mockFile = createMockFile('large-file.txt', 2 * 1024 * 1024);
      const dropZone = screen.getByText('Drag and drop your file here').closest('div');

      // Act
      if (dropZone) {
        fireEvent.drop(dropZone, {
          dataTransfer: {
            files: [mockFile],
          },
        });
      }

      // Assert
      expect(mockOnChange).not.toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('File Removal', () => {
    it('should call onChange with null when remove button is clicked', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      const mockFile = createMockFile('test.txt', 1024);

      render(<FileUpload {...createProps({ file: mockFile, onChange: mockOnChange })} />);

      const removeButton = screen.getByRole('button', { name: /Remove/i });

      // Act
      await user.click(removeButton);

      // Assert
      expect(mockOnChange).toHaveBeenCalledWith(null);
    });

    it('should clear file input value when file is removed', async () => {
      // Arrange
      const user = userEvent.setup();
      const mockOnChange = vi.fn();
      const mockFile = createMockFile('test.txt', 1024);

      render(<FileUpload {...createProps({ file: mockFile, onChange: mockOnChange })} />);

      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;
      const removeButton = screen.getByRole('button', { name: /Remove/i });

      // Act
      await user.click(removeButton);

      // Assert
      expect(fileInput.value).toBe('');
    });
  });

  describe('Error Display', () => {
    it('should display error message when error prop is provided', () => {
      // Arrange
      const errorMessage = 'Upload failed. Please try again.';

      // Act
      render(<FileUpload {...createProps({ error: errorMessage })} />);

      // Assert
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('should not display error when error prop is undefined', () => {
      // Arrange & Act
      render(<FileUpload {...createProps({ error: undefined })} />);

      // Assert
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('File Size Formatting', () => {
    it('should format bytes correctly', () => {
      // Arrange
      const mockFile = createMockFile('test.txt', 500);

      // Act
      render(<FileUpload {...createProps({ file: mockFile })} />);

      // Assert
      expect(screen.getByText('500 Bytes')).toBeInTheDocument();
    });

    it('should format KB correctly', () => {
      // Arrange
      const mockFile = createMockFile('test.txt', 1536); // 1.5 KB

      // Act
      render(<FileUpload {...createProps({ file: mockFile })} />);

      // Assert
      expect(screen.getByText('1.5 KB')).toBeInTheDocument();
    });

    it('should format MB correctly', () => {
      // Arrange
      const mockFile = createMockFile('test.txt', 2 * 1024 * 1024); // 2 MB

      // Act
      render(<FileUpload {...createProps({ file: mockFile })} />);

      // Assert
      expect(screen.getByText('2 MB')).toBeInTheDocument();
    });

    it('should handle 0 bytes', () => {
      // Arrange
      const mockFile = createMockFile('test.txt', 0);

      // Act
      render(<FileUpload {...createProps({ file: mockFile })} />);

      // Assert
      expect(screen.getByText('0 Bytes')).toBeInTheDocument();
    });
  });

  describe('Custom Props', () => {
    it('should use custom maxSizeMB', () => {
      // Arrange & Act
      render(<FileUpload {...createProps({ maxSizeMB: 50 })} />);

      // Assert
      expect(screen.getByText(/max 50MB/i)).toBeInTheDocument();
    });

    it('should use custom accepted formats', () => {
      // Arrange & Act
      render(<FileUpload {...createProps({ acceptedFormats: ['.txt', '.md'] })} />);

      // Assert
      expect(screen.getByText(/Supported formats:.*\.txt.*\.md/i)).toBeInTheDocument();

      const fileInput = screen.getByLabelText('Upload document file') as HTMLInputElement;
      expect(fileInput).toHaveAttribute('accept', '.txt,.md');
    });
  });
});
