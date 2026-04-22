/**
 * Legal Attestation Writer (OpenSpec task 3.8.0 — OWASP A09 closure)
 *
 * Persists user consent records to the `AttestationsTable` DynamoDB table.
 * Every successful upload-request MUST produce one of these records — if the
 * write fails the caller is required to surface a 5xx and abort the upload
 * (silently dropping consent is the bug we're fixing).
 *
 * SECURITY:
 *   - Caller is responsible for validating the inbound payload BEFORE
 *     constructing the record (use `legalAttestationPayloadSchema` from
 *     `@lfmt/shared-types`).
 *   - This module does NOT swallow errors. Failure throws
 *     `AttestationWriteError`, which the handler converts to a 500.
 */

import { createHash, randomUUID } from 'crypto';
import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandOutput,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  ATTESTATION_VERSION,
  LegalAttestationRecord,
  legalAttestationRecordSchema,
} from '@lfmt/shared-types';
import Logger from './logger';
import { getRequiredEnv } from './env';

/** 7 years in seconds — DMCA-style retention window. */
const SEVEN_YEARS_SECONDS = 60 * 60 * 24 * 365 * 7;

/**
 * Typed error so callers can distinguish attestation persistence failures
 * from other DynamoDB errors and respond with a clear 500 body.
 */
export class AttestationWriteError extends Error {
  public readonly code = 'AttestationPersistFailure';
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AttestationWriteError';
    this.cause = cause;
  }
}

/** Inputs for building a record from a verified upload request. */
export interface BuildAttestationInput {
  userId: string;
  jobId: string;
  documentId: string;
  filename: string;
  fileSize: number;
  contentType: string;
  ipAddress: string;
  userAgent: string;
  acceptedClauses: {
    acceptCopyrightOwnership: boolean;
    acceptTranslationRights: boolean;
    acceptLiabilityTerms: boolean;
  };
  /** Optional — defaults to `new Date().toISOString()`. */
  acceptedAt?: string;
  /** Optional — defaults to `ATTESTATION_VERSION`. */
  attestationVersion?: string;
}

/**
 * Build the deterministic upload-intent fingerprint.
 *
 * The actual S3 object hash isn't available at presigned-URL time (the
 * bytes haven't arrived yet); we instead hash the upload-intent metadata
 * so the audit trail can be cross-referenced with the eventual S3 object
 * by the same five fields, even if the user later abandons the upload.
 */
export function computeDocumentHash(input: {
  userId: string;
  jobId: string;
  filename: string;
  fileSize: number;
  contentType: string;
}): string {
  const canonical = `${input.userId}:${input.jobId}:${input.filename}:${input.fileSize}:${input.contentType}`;
  return createHash('sha256').update(canonical).digest('hex');
}

/** Build a fully-populated `LegalAttestationRecord` ready for persistence. */
export function buildAttestationRecord(
  input: BuildAttestationInput
): LegalAttestationRecord {
  const acceptedAt = input.acceptedAt ?? new Date().toISOString();
  const ttl = Math.floor(Date.parse(acceptedAt) / 1000) + SEVEN_YEARS_SECONDS;

  const record: LegalAttestationRecord = {
    attestationId: randomUUID(),
    userId: input.userId,
    jobId: input.jobId,
    documentId: input.documentId,
    documentHash: computeDocumentHash({
      userId: input.userId,
      jobId: input.jobId,
      filename: input.filename,
      fileSize: input.fileSize,
      contentType: input.contentType,
    }),
    attestationVersion: input.attestationVersion ?? ATTESTATION_VERSION,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    acceptedAt,
    createdAt: acceptedAt,
    ttl,
    acceptedClauses: {
      acceptCopyrightOwnership: input.acceptedClauses.acceptCopyrightOwnership,
      acceptTranslationRights: input.acceptedClauses.acceptTranslationRights,
      acceptLiabilityTerms: input.acceptedClauses.acceptLiabilityTerms,
    },
    documentMetadata: {
      filename: input.filename,
      fileSize: input.fileSize,
      contentType: input.contentType,
    },
  };

  // Validate before write — defensive: ensures we never persist a record
  // that the schema would reject on read-back.
  const parsed = legalAttestationRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new AttestationWriteError(
      `Built attestation record failed schema validation: ${parsed.error.message}`
    );
  }

  return record;
}

/**
 * Persist a `LegalAttestationRecord` to DynamoDB.
 *
 * THROWS `AttestationWriteError` on any DynamoDB failure — caller MUST
 * propagate as a 500 response and abort the upload flow.
 */
export async function writeAttestation(
  record: LegalAttestationRecord,
  options: {
    dynamoClient?: DynamoDBClient;
    tableName?: string;
    logger?: Logger;
  } = {}
): Promise<PutItemCommandOutput> {
  const logger = options.logger ?? new Logger('lfmt-attestation-writer');
  const dynamoClient = options.dynamoClient ?? new DynamoDBClient({});
  const tableName = options.tableName ?? getRequiredEnv('ATTESTATIONS_TABLE_NAME');

  // Defensive re-validation: protects against callers bypassing
  // `buildAttestationRecord`.
  const parsed = legalAttestationRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new AttestationWriteError(
      `Refusing to persist invalid attestation record: ${parsed.error.message}`
    );
  }

  const command = new PutItemCommand({
    TableName: tableName,
    Item: marshall(record, { removeUndefinedValues: true }),
    // Idempotency guard — never silently overwrite an existing record
    // for the same attestationId (which is a uuid, so collisions imply
    // a programming error worth surfacing).
    ConditionExpression: 'attribute_not_exists(attestationId)',
  });

  try {
    const result = await dynamoClient.send(command);
    logger.info('Legal attestation persisted', {
      attestationId: record.attestationId,
      jobId: record.jobId,
      userId: record.userId,
      documentId: record.documentId,
      attestationVersion: record.attestationVersion,
    });
    return result;
  } catch (err) {
    logger.error('Failed to persist legal attestation', {
      attestationId: record.attestationId,
      jobId: record.jobId,
      userId: record.userId,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
    throw new AttestationWriteError(
      'Failed to persist legal attestation record',
      err
    );
  }
}
