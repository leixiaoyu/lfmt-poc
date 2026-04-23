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
    copyrightOwnership: z.boolean().refine((val) => val === true),
    translationRights: z.boolean().refine((val) => val === true),
    liabilityAcceptance: z.boolean().refine((val) => val === true),
    publicDomainAcknowledgment: z.boolean().refine((val) => val === true),
    dataProcessingConsent: z.boolean().refine((val) => val === true),
    termsOfServiceAcceptance: z.boolean().refine((val) => val === true),
  }),
  interactionMetrics: z.object({
    pageViewDuration: z.number().min(30000), // Minimum 30 seconds
    scrollCompletionPercentage: z.number().min(80), // Minimum 80% scroll
    mouseMovements: z.number().min(5),
    keystrokes: z.number().min(0),
    attestationMethod: z.enum(['checkbox', 'digital_signature', 'voice_verification']),
    readingPattern: z.array(
      z.object({
        timestamp: z.number(),
        action: z.enum(['scroll', 'click', 'focus', 'blur']),
        elementId: z.string().optional(),
        scrollPosition: z.number().optional(),
        duration: z.number().optional(),
      })
    ),
  }),
  browserFingerprint: z.object({
    userAgent: z.string(),
    language: z.string(),
    timezone: z.string(),
    screen: z.object({
      width: z.number(),
      height: z.number(),
      colorDepth: z.number(),
    }),
    canvas: z.string(),
    webgl: z.string(),
    timestamp: z.number(),
  }),
  documentMetadata: z.object({
    filename: z.string(),
    fileSize: z.number(),
    wordCount: z.number(),
    documentHash: z.string(),
    uploadTimestamp: z.string(),
  }),
});

// =====================================================================
// Legal Attestation Write-Path Schema (production write path)
//
// What this is:
//   The minimal, *actually persisted* attestation record stored in the
//   `AttestationsTable` DynamoDB table when a user submits a document
//   upload request. Every legitimate upload MUST produce one of these
//   records — this is the audit-trail entry required for OWASP A09
//   compliance (Security Logging & Monitoring Failures) and DMCA-style
//   copyright dispute response.
//
// Why a separate schema:
//   The richer `AttestationRecord` interface above is a forward-looking
//   blockchain-style design from low-level Doc 6. The write-path schema
//   below matches what the frontend `LegalAttestation.tsx` actually
//   collects today plus server-derived fields (IP, UA, hash, version).
//
// Persistence model:
//   - Partition key: `attestationId` (uuid v4, generated server-side)
//   - Sort key:      `userId`        (Cognito sub)
//   - GSI:           UserAttestationsIndex   (userId, createdAt)
//   - GSI:           DocumentAttestationsIndex (documentId, createdAt)
//   - TTL attribute: `ttl` — populated to 7 years from `createdAt`
//                    (legal retention requirement).
// =====================================================================

/**
 * Current attestation contract version. Bump when the attestation text
 * shown to users in `LegalAttestationCheckboxes` changes — old records
 * remain valid under their original version, new records get the new one.
 */
export const ATTESTATION_VERSION = 'v1.0';

/**
 * The shape of the `legalAttestation` block the frontend includes in
 * the `/jobs/upload` request body. Server validates and persists this.
 */
export interface LegalAttestationPayload {
  acceptCopyrightOwnership: boolean;
  acceptTranslationRights: boolean;
  acceptLiabilityTerms: boolean;
  /**
   * Optional client-reported metadata. The server overrides these with
   * authoritative values (`requestContext.identity.sourceIp`,
   * `headers['User-Agent']`, server timestamp) before persisting.
   */
  userIPAddress?: string;
  userAgent?: string;
  timestamp?: string;
}

export const legalAttestationPayloadSchema = z.object({
  acceptCopyrightOwnership: z
    .boolean()
    .refine((val) => val === true, {
      message: 'acceptCopyrightOwnership must be true to upload',
    }),
  acceptTranslationRights: z
    .boolean()
    .refine((val) => val === true, {
      message: 'acceptTranslationRights must be true to upload',
    }),
  acceptLiabilityTerms: z
    .boolean()
    .refine((val) => val === true, {
      message: 'acceptLiabilityTerms must be true to upload',
    }),
  userIPAddress: z.string().optional(),
  userAgent: z.string().optional(),
  timestamp: z.string().optional(),
});

/**
 * The persisted DynamoDB record. Server-authoritative fields only.
 */
export interface LegalAttestationRecord {
  /** uuid v4 — partition key */
  attestationId: string;
  /** Cognito sub — sort key */
  userId: string;
  /** jobId from the upload request (1:1 with this attestation) */
  jobId: string;
  /** documentId == fileId from the upload request */
  documentId: string;
  /** SHA-256 hex of `${userId}:${jobId}:${filename}:${fileSize}:${contentType}`
   *  — a deterministic identifier of the upload-intent (the actual S3 object
   *  hash isn't computed until the bytes arrive; we fingerprint the pre-upload
   *  metadata so the audit trail can be cross-referenced even if the upload
   *  is later abandoned). */
  documentHash: string;
  /** Attestation contract version (see ATTESTATION_VERSION). */
  attestationVersion: string;
  /** Source IP from API Gateway requestContext.identity.sourceIp. */
  ipAddress: string;
  /** User-Agent header from the original API request. */
  userAgent: string;
  /** Server-side ISO-8601 timestamp of acceptance. */
  acceptedAt: string;
  /** ISO-8601 mirror of acceptedAt — used by the GSI sort key. */
  createdAt: string;
  /** Unix epoch seconds — DynamoDB TTL attribute (7-year retention). */
  ttl: number;
  /** The exact clauses the user accepted, preserved verbatim for audit. */
  acceptedClauses: {
    acceptCopyrightOwnership: boolean;
    acceptTranslationRights: boolean;
    acceptLiabilityTerms: boolean;
  };
  /** Additional context (filename, fileSize, contentType) for forensics. */
  documentMetadata: {
    filename: string;
    fileSize: number;
    contentType: string;
  };
}

export const legalAttestationRecordSchema = z.object({
  attestationId: z.string().uuid(),
  userId: z.string().min(1),
  jobId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/, 'documentHash must be 64-char sha256 hex'),
  attestationVersion: z.string().min(1),
  ipAddress: z.string().min(1),
  userAgent: z.string().min(1),
  acceptedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  ttl: z.number().int().positive(),
  acceptedClauses: z.object({
    acceptCopyrightOwnership: z.literal(true),
    acceptTranslationRights: z.literal(true),
    acceptLiabilityTerms: z.literal(true),
  }),
  documentMetadata: z.object({
    filename: z.string().min(1),
    fileSize: z.number().int().positive(),
    contentType: z.string().min(1),
  }),
});
