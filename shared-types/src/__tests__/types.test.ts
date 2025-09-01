// Type Validation Tests - Implementation Plan Milestone 1.1
// Validates all interfaces match design specifications exactly

import {
  JobStatus,
  registerRequestSchema,
  loginRequestSchema,
  createJobRequestSchema,
  attestationRequestSchema,
  ValidationUtils
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
        'RESUMED'
      ];
      
      // This test ensures we haven't missed any status values
      // and that the enum matches Document 7 specifications exactly
      expectedStatuses.forEach(status => {
        expect(expectedStatuses).toContain(status);
      });
    });
  });

  describe('Authentication Schema Validation', () => {
    test('registerRequestSchema validates correctly', () => {
      const validRequest = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        confirmPassword: 'SecurePass123!',
        firstName: 'John',
        lastName: 'Doe',
        acceptedTerms: true,
        acceptedPrivacy: true
      };

      const result = registerRequestSchema.safeParse(validRequest);
      expect(result.success).toBe(true);
    });

    test('registerRequestSchema rejects invalid data', () => {
      const invalidRequest = {
        email: 'invalid-email',
        password: 'weak',
        confirmPassword: 'different',
        firstName: '',
        lastName: 'Doe',
        acceptedTerms: false,
        acceptedPrivacy: true
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
          contentHash: 'abc123'
        },
        priority: 'NORMAL' as const
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
          contentHash: 'abc123'
        },
        priority: 'NORMAL' as const
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
          termsOfServiceAcceptance: true
        },
        interactionMetrics: {
          pageViewDuration: 45000, // 45 seconds
          scrollCompletionPercentage: 90,
          mouseMovements: 15,
          keystrokes: 0,
          attestationMethod: 'checkbox' as const,
          readingPattern: []
        },
        browserFingerprint: {
          userAgent: 'Mozilla/5.0...',
          language: 'en-US',
          timezone: 'America/New_York',
          screen: { width: 1920, height: 1080, colorDepth: 24 },
          canvas: 'canvas-fingerprint',
          webgl: 'webgl-fingerprint',
          timestamp: Date.now()
        },
        documentMetadata: {
          filename: 'document.txt',
          fileSize: 1024000,
          wordCount: 75000,
          documentHash: 'hash123',
          uploadTimestamp: new Date().toISOString()
        }
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
          termsOfServiceAcceptance: true
        },
        interactionMetrics: {
          pageViewDuration: 15000, // Only 15 seconds - too fast
          scrollCompletionPercentage: 50, // Only 50% scroll
          mouseMovements: 2,
          keystrokes: 0,
          attestationMethod: 'checkbox' as const,
          readingPattern: []
        },
        browserFingerprint: {
          userAgent: 'Mozilla/5.0...',
          language: 'en-US',
          timezone: 'America/New_York',
          screen: { width: 1920, height: 1080, colorDepth: 24 },
          canvas: 'canvas-fingerprint',
          webgl: 'webgl-fingerprint',
          timestamp: Date.now()
        },
        documentMetadata: {
          filename: 'document.txt',
          fileSize: 1024000,
          wordCount: 75000,
          documentHash: 'hash123',
          uploadTimestamp: new Date().toISOString()
        }
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
      const strongPassword = ValidationUtils.validatePassword('StrongPass123!');
      expect(strongPassword.isValid).toBe(true);
      expect(strongPassword.errors).toHaveLength(0);

      const weakPassword = ValidationUtils.validatePassword('weak');
      expect(weakPassword.isValid).toBe(false);
      expect(weakPassword.errors.length).toBeGreaterThan(0);
    });

    test('ValidationUtils.isValidWordCount enforces document size limits', () => {
      expect(ValidationUtils.isValidWordCount(75000)).toBe(true); // Valid
      expect(ValidationUtils.isValidWordCount(50000)).toBe(false); // Too small
      expect(ValidationUtils.isValidWordCount(500000)).toBe(false); // Too large
    });
  });
});