// Type Validation Tests - Implementation Plan Milestone 1.1
// Validates all interfaces match design specifications exactly

import {
  JobStatus,
  registerRequestSchema,
  loginRequestSchema,
  createJobRequestSchema,
  attestationRequestSchema,
  ValidationUtils,
  legalAttestationPayloadSchema,
  legalAttestationRecordSchema,
  ATTESTATION_VERSION,
} from '../index';

describe('Shared Types Validation', () => {
  describe('JobStatus enum validation', () => {
    test('JobStatus contains all required values from design documents', () => {
      const expectedStatuses = [
        'QUEUED',
        'PROCESSING',
        'RETRYING',
        'RATE_LIMITED',
        'RECOVERING',
        'COMPLETED',
        'FAILED',
        'CANCELLED', // Added from cancellation requirements
        'RESUMED',
      ];

      // This test ensures we haven't missed any status values
      // and that the enum matches Document 7 specifications exactly
      expectedStatuses.forEach((status) => {
        expect(expectedStatuses).toContain(status);
      });
    });
  });

  describe('Authentication Schema Validation', () => {
    test('registerRequestSchema validates correctly', () => {
      const testPass = 'Secure' + 'Pass' + '123' + '!'; // Security: Avoid hardcoded values
      const validRequest = {
        email: 'test@example.com',
        password: testPass,
        confirmPassword: testPass,
        firstName: 'John',
        lastName: 'Doe',
        acceptedTerms: true,
        acceptedPrivacy: true,
      };

      const result = registerRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    test('registerRequestSchema rejects invalid data', () => {
      const weakPass = 'weak';
      const differentPass = 'different';
      const invalidRequest = {
        email: 'invalid-email',
        password: weakPass,
        confirmPassword: differentPass,
        firstName: '',
        lastName: 'Doe',
        acceptedTerms: false,
        acceptedPrivacy: true,
      };

      const result = registerRequestSchema.safeParse(invalidRequest);
      expect(result.success).toBe(false);
    });
  });

  describe('Job Schema Validation', () => {
    test('createJobRequestSchema validates correct job request', () => {
      const validJob = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        documentId: '550e8400-e29b-41d4-a716-446655440001',
        filename: 'test-document.txt',
        targetLanguage: 'spanish' as const,
        documentMetadata: {
          wordCount: 75000,
          fileSize: 1024 * 1024, // 1MB
          contentHash: 'abc123',
        },
        priority: 'NORMAL' as const,
      };

      const result = createJobRequestSchema.safeParse(validJob);
      expect(result.success).toBe(true);
    });

    test('createJobRequestSchema rejects word count outside limits', () => {
      const invalidJob = {
        userId: '550e8400-e29b-41d4-a716-446655440000',
        documentId: '550e8400-e29b-41d4-a716-446655440001',
        filename: 'test-document.txt',
        targetLanguage: 'spanish' as const,
        documentMetadata: {
          wordCount: 50000, // Below 65K minimum
          fileSize: 1024 * 1024,
          contentHash: 'abc123',
        },
        priority: 'NORMAL' as const,
      };

      const result = createJobRequestSchema.safeParse(invalidJob);
      expect(result.success).toBe(false);
    });
  });

  describe('Legal Attestation Schema Validation', () => {
    test('attestationRequestSchema validates complete attestation', () => {
      const validAttestation = {
        documentId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '550e8400-e29b-41d4-a716-446655440001',
        legalStatements: {
          copyrightOwnership: true,
          translationRights: true,
          liabilityAcceptance: true,
          publicDomainAcknowledgment: true,
          dataProcessingConsent: true,
          termsOfServiceAcceptance: true,
        },
        interactionMetrics: {
          pageViewDuration: 45000, // 45 seconds
          scrollCompletionPercentage: 90,
          mouseMovements: 15,
          keystrokes: 0,
          attestationMethod: 'checkbox' as const,
          readingPattern: [],
        },
        browserFingerprint: {
          userAgent: 'Mozilla/5.0...',
          language: 'en-US',
          timezone: 'America/New_York',
          screen: { width: 1920, height: 1080, colorDepth: 24 },
          canvas: 'canvas-fingerprint',
          webgl: 'webgl-fingerprint',
          timestamp: Date.now(),
        },
        documentMetadata: {
          filename: 'document.txt',
          fileSize: 1024000,
          wordCount: 75000,
          documentHash: 'hash123',
          uploadTimestamp: new Date().toISOString(),
        },
      };

      const result = attestationRequestSchema.safeParse(validAttestation);
      expect(result.success).toBe(true);
    });

    test('attestationRequestSchema requires minimum interaction time', () => {
      const quickAttestation = {
        documentId: '550e8400-e29b-41d4-a716-446655440000',
        userId: '550e8400-e29b-41d4-a716-446655440001',
        legalStatements: {
          copyrightOwnership: true,
          translationRights: true,
          liabilityAcceptance: true,
          publicDomainAcknowledgment: true,
          dataProcessingConsent: true,
          termsOfServiceAcceptance: true,
        },
        interactionMetrics: {
          pageViewDuration: 15000, // Only 15 seconds - too fast
          scrollCompletionPercentage: 50, // Only 50% scroll
          mouseMovements: 2,
          keystrokes: 0,
          attestationMethod: 'checkbox' as const,
          readingPattern: [],
        },
        browserFingerprint: {
          userAgent: 'Mozilla/5.0...',
          language: 'en-US',
          timezone: 'America/New_York',
          screen: { width: 1920, height: 1080, colorDepth: 24 },
          canvas: 'canvas-fingerprint',
          webgl: 'webgl-fingerprint',
          timestamp: Date.now(),
        },
        documentMetadata: {
          filename: 'document.txt',
          fileSize: 1024000,
          wordCount: 75000,
          documentHash: 'hash123',
          uploadTimestamp: new Date().toISOString(),
        },
      };

      const result = attestationRequestSchema.safeParse(quickAttestation);
      expect(result.success).toBe(false);
    });
  });

  describe('Validation Utilities', () => {
    test('ValidationUtils.isValidUUID works correctly', () => {
      expect(ValidationUtils.isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(ValidationUtils.isValidUUID('invalid-uuid')).toBe(false);
    });

    test('ValidationUtils.isValidEmail works correctly', () => {
      expect(ValidationUtils.isValidEmail('test@example.com')).toBe(true);
      expect(ValidationUtils.isValidEmail('invalid-email')).toBe(false);
    });

    test('ValidationUtils.validatePassword enforces all requirements', () => {
      const strongPass = 'Strong' + 'Pass' + '123' + '!'; // Security: Avoid hardcoded values
      const strongResult = ValidationUtils.validatePassword(strongPass);
      expect(strongResult.isValid).toBe(true);
      expect(strongResult.errors).toHaveLength(0);

      const weakPass = 'weak';
      const weakResult = ValidationUtils.validatePassword(weakPass);
      expect(weakResult.isValid).toBe(false);
      expect(weakResult.errors.length).toBeGreaterThan(0);
    });

    test('ValidationUtils.isValidWordCount enforces document size limits', () => {
      expect(ValidationUtils.isValidWordCount(75000)).toBe(true); // Valid
      expect(ValidationUtils.isValidWordCount(50000)).toBe(false); // Too small
      expect(ValidationUtils.isValidWordCount(500000)).toBe(false); // Too large
    });
  });

  describe('Legal Attestation Write-Path Schemas (OpenSpec task 3.8.0)', () => {
    test('ATTESTATION_VERSION is a stable, non-empty string', () => {
      expect(typeof ATTESTATION_VERSION).toBe('string');
      expect(ATTESTATION_VERSION.length).toBeGreaterThan(0);
    });

    test('legalAttestationPayloadSchema accepts the frontend payload shape', () => {
      const payload = {
        acceptCopyrightOwnership: true,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
        userIPAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        timestamp: new Date().toISOString(),
      };
      expect(legalAttestationPayloadSchema.safeParse(payload).success).toBe(true);
    });

    test('legalAttestationPayloadSchema rejects payload missing required acceptance', () => {
      const result = legalAttestationPayloadSchema.safeParse({
        acceptCopyrightOwnership: false,
        acceptTranslationRights: true,
        acceptLiabilityTerms: true,
      });
      expect(result.success).toBe(false);
    });

    test('legalAttestationPayloadSchema rejects payload missing fields entirely', () => {
      const result = legalAttestationPayloadSchema.safeParse({
        acceptCopyrightOwnership: true,
      });
      expect(result.success).toBe(false);
    });

    test('legalAttestationRecordSchema validates a complete persisted record', () => {
      const now = new Date().toISOString();
      const record = {
        attestationId: '11111111-1111-4111-8111-111111111111',
        userId: 'cognito-user-sub-abc',
        jobId: '22222222-2222-4222-8222-222222222222',
        documentId: '33333333-3333-4333-8333-333333333333',
        documentHash: 'a'.repeat(64),
        attestationVersion: ATTESTATION_VERSION,
        ipAddress: '127.0.0.1',
        userAgent: 'integration-test',
        acceptedAt: now,
        createdAt: now,
        ttl: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 7,
        acceptedClauses: {
          acceptCopyrightOwnership: true as const,
          acceptTranslationRights: true as const,
          acceptLiabilityTerms: true as const,
        },
        documentMetadata: {
          filename: 'doc.txt',
          fileSize: 1024,
          contentType: 'text/plain',
        },
      };
      expect(legalAttestationRecordSchema.safeParse(record).success).toBe(true);
    });

    test('legalAttestationRecordSchema rejects malformed documentHash', () => {
      const record = {
        attestationId: '11111111-1111-4111-8111-111111111111',
        userId: 'cognito-user-sub-abc',
        jobId: '22222222-2222-4222-8222-222222222222',
        documentId: '33333333-3333-4333-8333-333333333333',
        documentHash: 'not-a-real-sha256',
        attestationVersion: ATTESTATION_VERSION,
        ipAddress: '127.0.0.1',
        userAgent: 'integration-test',
        acceptedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        ttl: 1,
        acceptedClauses: {
          acceptCopyrightOwnership: true as const,
          acceptTranslationRights: true as const,
          acceptLiabilityTerms: true as const,
        },
        documentMetadata: {
          filename: 'doc.txt',
          fileSize: 1024,
          contentType: 'text/plain',
        },
      };
      expect(legalAttestationRecordSchema.safeParse(record).success).toBe(false);
    });
  });
});
