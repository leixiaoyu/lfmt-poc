// Legal Attestation Types - From Document 6 (Legal Attestation System)
import { z } from 'zod';

// Legal Attestation
export interface AttestationRequest {
  documentId: string;
  userId: string;
  legalStatements: {
    copyrightOwnership: boolean;
    translationRights: boolean;
    liabilityAcceptance: boolean;
    publicDomainAcknowledgment: boolean;
    dataProcessingConsent: boolean;
    termsOfServiceAcceptance: boolean;
  };
  interactionMetrics: {
    pageViewDuration: number; // milliseconds
    scrollCompletionPercentage: number; // 0-100
    mouseMovements: number;
    keystrokes: number;
    attestationMethod: 'checkbox' | 'digital_signature' | 'voice_verification';
    readingPattern: ReadingPattern[];
  };
  browserFingerprint: BrowserFingerprint;
  documentMetadata: {
    filename: string;
    fileSize: number;
    wordCount: number;
    documentHash: string;
    uploadTimestamp: string;
  };
}

export interface ReadingPattern {
  timestamp: number;
  action: 'scroll' | 'click' | 'focus' | 'blur';
  elementId?: string;
  scrollPosition?: number;
  duration?: number;
}

export interface BrowserFingerprint {
  userAgent: string;
  language: string;
  timezone: string;
  screen: {
    width: number;
    height: number;
    colorDepth: number;
  };
  canvas: string;
  webgl: string;
  timestamp: number;
}

export interface AttestationResponse {
  attestationId: string;
  status: 'VALID' | 'INVALID' | 'PENDING_REVIEW';
  immutableHash: string;
  blockchainRecordId?: string;
  validUntil: string;
  complianceScore: number; // 0-100
  warnings: AttestationWarning[];
  legalProtections: {
    auditTrailId: string;
    retentionPeriod: string;
    jurisdiction: string;
    applicableLaws: string[];
  };
}

export interface AttestationWarning {
  code: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  message: string;
  recommendation?: string;
}

// Legal Terms
export interface LegalTermsRequest {
  version: string;
  language?: string;
}

export interface LegalTermsResponse {
  version: string;
  content: string;
  lastModified: string;
  requiresAttestation: boolean;
  minimumReadTime: number; // seconds
  checksumHash: string;
  translations: {
    [language: string]: {
      content: string;
      translatedBy: string;
      validatedBy: string;
    };
  };
}

// Attestation Records
export interface AttestationRecord {
  attestationId: string;
  userId: string;
  documentId: string;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  immutableHash: string;
  auditTrail: AuditTrailEntry[];
}

export interface AuditTrailEntry {
  timestamp: string;
  action: string;
  userId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface UserAttestationsRequest {
  userId: string;
  startDate?: string;
  endDate?: string;
  status?: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
}

export interface UserAttestationsResponse {
  attestations: AttestationRecord[];
  totalCount: number;
  complianceStatus: 'COMPLIANT' | 'NEEDS_RENEWAL' | 'NON_COMPLIANT';
  nextRenewalDate?: string;
}

// Validation Schemas
export const attestationRequestSchema = z.object({
  documentId: z.string().uuid(),
  userId: z.string().uuid(),
  legalStatements: z.object({
    copyrightOwnership: z.boolean().refine(val => val === true),
    translationRights: z.boolean().refine(val => val === true),
    liabilityAcceptance: z.boolean().refine(val => val === true),
    publicDomainAcknowledgment: z.boolean().refine(val => val === true),
    dataProcessingConsent: z.boolean().refine(val => val === true),
    termsOfServiceAcceptance: z.boolean().refine(val => val === true)
  }),
  interactionMetrics: z.object({
    pageViewDuration: z.number().min(30000), // Minimum 30 seconds
    scrollCompletionPercentage: z.number().min(80), // Minimum 80% scroll
    mouseMovements: z.number().min(5),
    keystrokes: z.number().min(0),
    attestationMethod: z.enum(['checkbox', 'digital_signature', 'voice_verification']),
    readingPattern: z.array(z.object({
      timestamp: z.number(),
      action: z.enum(['scroll', 'click', 'focus', 'blur']),
      elementId: z.string().optional(),
      scrollPosition: z.number().optional(),
      duration: z.number().optional()
    }))
  }),
  browserFingerprint: z.object({
    userAgent: z.string(),
    language: z.string(),
    timezone: z.string(),
    screen: z.object({
      width: z.number(),
      height: z.number(),
      colorDepth: z.number()
    }),
    canvas: z.string(),
    webgl: z.string(),
    timestamp: z.number()
  }),
  documentMetadata: z.object({
    filename: z.string(),
    fileSize: z.number(),
    wordCount: z.number(),
    documentHash: z.string(),
    uploadTimestamp: z.string()
  })
});