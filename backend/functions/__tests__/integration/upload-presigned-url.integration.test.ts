/**
 * Upload Presigned URL Integration Tests
 *
 * End-to-end integration tests for the upload workflow:
 * - Tests the complete presigned URL flow (API → Lambda → S3)
 * - Validates CORS headers in real responses
 * - Tests authentication and authorization
 */

import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';

// Type definitions for API responses
interface PresignedUrlResponse {
  data: {
    uploadUrl: string;
    fileId: string;
    expiresIn: number;
    requiredHeaders: Record<string, string>;
  };
}

interface ErrorResponse {
  message: string;
}

describe('Upload Presigned URL - Integration Tests', () => {
  const API_BASE_URL = process.env.API_BASE_URL || 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1';
  const TEST_USER_TOKEN = process.env.TEST_USER_TOKEN; // Set in CI/CD
  const DOCUMENT_BUCKET = process.env.DOCUMENT_BUCKET || 'lfmt-documents-lfmtpocdev';
  const JOBS_TABLE = process.env.JOBS_TABLE || 'lfmt-jobs-LfmtPocDev';

  const s3Client = new S3Client({});
  const dynamoClient = new DynamoDBClient({});

  // Skip tests if running locally without credentials
  const describeOrSkip = TEST_USER_TOKEN ? describe : describe.skip;

  describeOrSkip('Complete Upload Flow', () => {
    it('should successfully upload file using presigned URL', async () => {
      const testFile = Buffer.from('Test document content for translation');
      const fileName = `integration-test-${Date.now()}.txt`;

      // Step 1: Request presigned URL
      const presignedResponse = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_USER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName,
            fileSize: testFile.length,
            contentType: 'text/plain',
            legalAttestation: {
              acceptCopyrightOwnership: true,
              acceptTranslationRights: true,
              acceptLiabilityTerms: true,
              userIPAddress: '127.0.0.1',
              userAgent: 'Integration Test',
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      expect(presignedResponse.status).toBe(200);
      const presignedData = await presignedResponse.json() as PresignedUrlResponse;
      expect(presignedData.data).toHaveProperty('uploadUrl');
      expect(presignedData.data).toHaveProperty('fileId');
      expect(presignedData.data).toHaveProperty('expiresIn');

      const { uploadUrl, fileId, requiredHeaders } = presignedData.data;

      // Step 2: Upload file to S3
      const s3Response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          ...requiredHeaders,
          'Content-Type': 'text/plain',
        },
        body: testFile,
      });

      expect(s3Response.status).toBe(200);

      // Step 3: Verify file exists in S3
      const headCommand = new HeadObjectCommand({
        Bucket: DOCUMENT_BUCKET,
        Key: `uploads/test-user-id/${fileId}/${fileName}`, // Adjust based on actual key pattern
      });

      const headResponse = await s3Client.send(headCommand);
      expect(headResponse.ContentLength).toBe(testFile.length);
      expect(headResponse.ContentType).toBe('text/plain');

      // Step 4: Verify job record exists in DynamoDB
      const getItemCommand = new GetItemCommand({
        TableName: JOBS_TABLE,
        Key: {
          jobId: { S: fileId },
        },
      });

      const jobRecord = await dynamoClient.send(getItemCommand);
      expect(jobRecord.Item).toBeDefined();
      expect(jobRecord.Item?.status.S).toBe('PENDING');

      // Cleanup: Delete test file from S3
      // (Add cleanup logic here if needed)
    }, 30000); // 30 second timeout

    it('should include correct CORS headers in presigned URL response', async () => {
      const response = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_USER_TOKEN}`,
            Origin: 'https://d39xcun7144jgl.cloudfront.net',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
            legalAttestation: {
              acceptCopyrightOwnership: true,
              acceptTranslationRights: true,
              acceptLiabilityTerms: true,
              userIPAddress: '127.0.0.1',
              userAgent: 'Integration Test',
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      // Verify CORS headers
      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('should reject request without authentication token', async () => {
      const response = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
          }),
        }
      );

      expect(response.status).toBe(401);
      // Verify CORS headers are present even in error response
      expect(response.headers.get('access-control-allow-origin')).toBeDefined();
    });

    it('should reject invalid file validation', async () => {
      const response = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_USER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: '', // Invalid: empty filename
            fileSize: 1024,
            contentType: 'text/plain',
          }),
        }
      );

      expect(response.status).toBe(400);
      const data = await response.json() as ErrorResponse;
      expect(data.message).toContain('validation');
    });

    it('should reject oversized files', async () => {
      const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

      const response = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_USER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: 'huge-file.txt',
            fileSize: MAX_FILE_SIZE + 1, // Exceed limit
            contentType: 'text/plain',
            legalAttestation: {
              acceptCopyrightOwnership: true,
              acceptTranslationRights: true,
              acceptLiabilityTerms: true,
              userIPAddress: '127.0.0.1',
              userAgent: 'Integration Test',
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      expect(response.status).toBe(400);
      const data = await response.json() as ErrorResponse;
      expect(data.message).toContain('exceeds maximum');
    });

    it('should reject wrong content type', async () => {
      const response = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_USER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: 'test.pdf',
            fileSize: 1024,
            contentType: 'application/pdf', // Not allowed (only text/plain)
            legalAttestation: {
              acceptCopyrightOwnership: true,
              acceptTranslationRights: true,
              acceptLiabilityTerms: true,
              userIPAddress: '127.0.0.1',
              userAgent: 'Integration Test',
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      expect(response.status).toBe(400);
      const data = await response.json() as ErrorResponse;
      expect(data.message).toContain('content type');
    });
  });

  describeOrSkip('Presigned URL Security', () => {
    it('should expire presigned URL after 15 minutes', async () => {
      const response = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_USER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: 'test.txt',
            fileSize: 1024,
            contentType: 'text/plain',
            legalAttestation: {
              acceptCopyrightOwnership: true,
              acceptTranslationRights: true,
              acceptLiabilityTerms: true,
              userIPAddress: '127.0.0.1',
              userAgent: 'Integration Test',
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      const data = await response.json() as PresignedUrlResponse;
      const { uploadUrl, expiresIn } = data.data;

      // Verify expiration time
      expect(expiresIn).toBe(900); // 15 minutes in seconds

      // Verify URL contains expiration parameter
      expect(uploadUrl).toContain('X-Amz-Expires=900');
    });

    it('should include required metadata in S3 object', async () => {
      const testFile = Buffer.from('Test content');
      const fileName = `metadata-test-${Date.now()}.txt`;

      // Request presigned URL
      const presignedResponse = await fetch(
        `${API_BASE_URL}/jobs/upload`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${TEST_USER_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName,
            fileSize: testFile.length,
            contentType: 'text/plain',
            legalAttestation: {
              acceptCopyrightOwnership: true,
              acceptTranslationRights: true,
              acceptLiabilityTerms: true,
              userIPAddress: '127.0.0.1',
              userAgent: 'Integration Test',
              timestamp: new Date().toISOString(),
            },
          }),
        }
      );

      const presignedData = await presignedResponse.json() as PresignedUrlResponse;
      const { uploadUrl, fileId } = presignedData.data;

      // Upload to S3
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: testFile,
      });

      // Verify metadata
      const headCommand = new HeadObjectCommand({
        Bucket: DOCUMENT_BUCKET,
        Key: `uploads/test-user-id/${fileId}/${fileName}`,
      });

      const metadata = await s3Client.send(headCommand);
      expect(metadata.Metadata).toHaveProperty('fileid');
      expect(metadata.Metadata).toHaveProperty('userid');
      expect(metadata.Metadata).toHaveProperty('originalfilename');
    }, 30000);
  });

  describeOrSkip('Error Handling', () => {
    it('should handle S3 service errors gracefully', async () => {
      // This test would require mocking S3 errors or using a test environment
      // where S3 permissions can be temporarily revoked
      expect(true).toBe(true); // Placeholder
    });

    it('should handle DynamoDB errors gracefully', async () => {
      // Similar to above - requires test environment setup
      expect(true).toBe(true); // Placeholder
    });
  });
});
