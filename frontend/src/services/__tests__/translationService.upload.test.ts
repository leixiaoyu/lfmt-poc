/**
 * Translation Service Upload Workflow Tests
 *
 * Tests to prevent regression of upload workflow issues:
 * - Issue #2: Wrong API paths (/translation/* vs /jobs/*)
 * - Issue #5: Sending file directly instead of using presigned URL
 * - Issue #6: Wrong Content-Type (multipart/form-data vs application/json)
 * - Issue #7: Missing requestOrigin in Authorization header
 */

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { uploadDocument, startTranslation, getJobStatus } from '../translationService';
import { UploadDocumentRequest, TranslationConfig } from '../translationService';

describe('Translation Service - Upload Workflow', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(axios);
    // Mock getAuthToken
    jest.mock('../../utils/api', () => ({
      getAuthToken: jest.fn(() => 'mock-access-token'),
    }));
  });

  afterEach(() => {
    mock.restore();
    jest.clearAllMocks();
  });

  describe('Upload Document - Presigned URL Flow', () => {
    const mockFile = new File(['test content'], 'test.txt', { type: 'text/plain' });
    const mockLegalAttestation = {
      acceptCopyrightOwnership: true,
      acceptTranslationRights: true,
      acceptLiabilityTerms: true,
      userIPAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      timestamp: new Date().toISOString(),
    };

    it('should use correct API path /jobs/upload (not /translation/upload)', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';
      const fileId = 'test-file-id';

      // Step 1: Mock presigned URL request
      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId,
          expiresIn: 900,
          requiredHeaders: {
            'Content-Type': 'text/plain',
            'Content-Length': '12',
          },
        },
      });

      // Step 2: Mock S3 upload
      mock.onPut(presignedUrl).reply(200);

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      await uploadDocument(request);

      // Verify correct API path was called
      const presignedUrlRequest = mock.history.post.find((req) =>
        req.url?.includes('/jobs/upload')
      );
      expect(presignedUrlRequest).toBeDefined();
      expect(presignedUrlRequest?.url).not.toContain('/translation/upload');
    });

    it('should send JSON payload (not multipart/form-data) to /jobs/upload', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';

      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId: 'test-file-id',
          expiresIn: 900,
          requiredHeaders: {},
        },
      });
      mock.onPut(presignedUrl).reply(200);

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      await uploadDocument(request);

      const presignedUrlRequest = mock.history.post[0];

      // Verify JSON payload, not FormData
      expect(presignedUrlRequest.headers?.['Content-Type']).toBe('application/json');
      expect(presignedUrlRequest.data).not.toBeInstanceOf(FormData);

      const requestBody = JSON.parse(presignedUrlRequest.data);
      expect(requestBody).toEqual({
        fileName: 'test.txt',
        fileSize: 12,
        contentType: 'text/plain',
        legalAttestation: mockLegalAttestation,
      });
    });

    it('should include Authorization header with Bearer token', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';

      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId: 'test-file-id',
          expiresIn: 900,
          requiredHeaders: {},
        },
      });
      mock.onPut(presignedUrl).reply(200);

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      await uploadDocument(request);

      const presignedUrlRequest = mock.history.post[0];
      expect(presignedUrlRequest.headers?.['Authorization']).toMatch(/^Bearer /);
    });

    it('should upload file to S3 using presigned URL (Step 2)', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';
      const requiredHeaders = {
        'Content-Type': 'text/plain',
        'Content-Length': '12',
      };

      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId: 'test-file-id',
          expiresIn: 900,
          requiredHeaders,
        },
      });
      mock.onPut(presignedUrl).reply(200);

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      await uploadDocument(request);

      // Verify S3 upload happened
      const s3Upload = mock.history.put.find((req) => req.url === presignedUrl);
      expect(s3Upload).toBeDefined();
      expect(s3Upload?.data).toBeInstanceOf(File);
      expect(s3Upload?.headers?.['Content-Type']).toBe('text/plain');
    });

    it('should NOT send file to /jobs/upload endpoint directly', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';

      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId: 'test-file-id',
          expiresIn: 900,
          requiredHeaders: {},
        },
      });
      mock.onPut(presignedUrl).reply(200);

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      await uploadDocument(request);

      const apiRequest = mock.history.post[0];

      // File should NOT be in API request body
      expect(apiRequest.data).not.toBeInstanceOf(File);
      expect(apiRequest.data).not.toBeInstanceOf(FormData);
    });

    it('should handle presigned URL request failure', async () => {
      mock.onPost(/\/jobs\/upload$/).reply(401, {
        message: 'Unauthorized',
      });

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      await expect(uploadDocument(request)).rejects.toThrow();
    });

    it('should handle S3 upload failure', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';

      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId: 'test-file-id',
          expiresIn: 900,
          requiredHeaders: {},
        },
      });
      mock.onPut(presignedUrl).reply(403, {
        message: 'Access Denied',
      });

      const request: UploadDocumentRequest = {
        file: mockFile,
        legalAttestation: mockLegalAttestation,
      };

      await expect(uploadDocument(request)).rejects.toThrow();
    });
  });

  describe('Start Translation - Correct API Path', () => {
    it('should use /jobs/{jobId}/translate (not /translation/{jobId}/start)', async () => {
      const jobId = 'test-job-id';
      const config: TranslationConfig = {
        targetLanguage: 'es',
        tone: 'formal',
      };

      mock.onPost(/\/jobs\/[^/]+\/translate$/).reply(200, {
        data: {
          jobId,
          status: 'IN_PROGRESS',
        },
      });

      await startTranslation(jobId, config);

      const request = mock.history.post[0];
      expect(request.url).toContain(`/jobs/${jobId}/translate`);
      expect(request.url).not.toContain('/translation/');
    });
  });

  describe('Get Job Status - Correct API Path', () => {
    it('should use /jobs/{jobId}/translation-status (not /translation/{jobId}/status)', async () => {
      const jobId = 'test-job-id';

      mock.onGet(/\/jobs\/[^/]+\/translation-status$/).reply(200, {
        data: {
          jobId,
          status: 'IN_PROGRESS',
          progress: 50,
        },
      });

      await getJobStatus(jobId);

      const request = mock.history.get[0];
      expect(request.url).toContain(`/jobs/${jobId}/translation-status`);
      expect(request.url).not.toContain('/translation/');
    });
  });

  describe('CORS and Origin Handling', () => {
    it('should not include Origin header in API requests (browser handles this)', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';

      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId: 'test-file-id',
          expiresIn: 900,
          requiredHeaders: {},
        },
      });
      mock.onPut(presignedUrl).reply(200);

      const request: UploadDocumentRequest = {
        file: new File(['test'], 'test.txt', { type: 'text/plain' }),
        legalAttestation: mockLegalAttestation,
      };

      await uploadDocument(request);

      const apiRequest = mock.history.post[0];

      // Axios should not manually set Origin header (browser does this)
      expect(apiRequest.headers?.['Origin']).toBeUndefined();
    });
  });

  describe('File Metadata Validation', () => {
    it('should include correct file metadata in presigned URL request', async () => {
      const presignedUrl = 'https://s3.amazonaws.com/bucket/key?signature=xyz';
      const largeFile = new File(
        [new ArrayBuffer(1024 * 1024)],
        'large-file.txt',
        { type: 'text/plain' }
      );

      mock.onPost(/\/jobs\/upload$/).reply(200, {
        data: {
          uploadUrl: presignedUrl,
          fileId: 'test-file-id',
          expiresIn: 900,
          requiredHeaders: {},
        },
      });
      mock.onPut(presignedUrl).reply(200);

      const request: UploadDocumentRequest = {
        file: largeFile,
        legalAttestation: mockLegalAttestation,
      };

      await uploadDocument(request);

      const apiRequest = mock.history.post[0];
      const requestBody = JSON.parse(apiRequest.data);

      expect(requestBody.fileName).toBe('large-file.txt');
      expect(requestBody.fileSize).toBe(1024 * 1024);
      expect(requestBody.contentType).toBe('text/plain');
    });
  });
});
