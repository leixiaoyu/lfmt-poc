/**
 * Unit tests for `attestationWriter` (OpenSpec task 3.8.0 — OWASP A09).
 *
 * Verifies:
 *   - Document hash is deterministic and SHA-256 hex.
 *   - Built records carry every required field, attestation version, ttl.
 *   - DynamoDB PutItem is invoked with the correct table + marshalled item.
 *   - Failures throw a typed `AttestationWriteError` (no silent drop).
 *   - Schema-invalid records are refused before hitting DynamoDB.
 */

import {
  DynamoDBClient,
  PutItemCommand,
  PutItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { ATTESTATION_VERSION } from '@lfmt/shared-types';

import {
  AttestationWriteError,
  buildAttestationRecord,
  computeDocumentHash,
  writeAttestation,
} from '../attestationWriter';

// Silence the Logger module so tests focus on behavior, not logs.
jest.mock('../logger', () => {
  return jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }));
});

const ddbMock = mockClient(DynamoDBClient);

const VALID_INPUT = {
  userId: 'cognito-user-sub-abc',
  jobId: '22222222-2222-4222-8222-222222222222',
  documentId: '33333333-3333-4333-8333-333333333333',
  filename: 'doc.txt',
  fileSize: 1024,
  contentType: 'text/plain',
  ipAddress: '127.0.0.1',
  userAgent: 'integration-test',
  acceptedClauses: {
    acceptCopyrightOwnership: true,
    acceptTranslationRights: true,
    acceptLiabilityTerms: true,
  },
};

describe('computeDocumentHash', () => {
  it('produces a 64-char SHA-256 hex string', () => {
    const hash = computeDocumentHash({
      userId: 'u',
      jobId: 'j',
      filename: 'f',
      fileSize: 1,
      contentType: 'c',
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    const a = computeDocumentHash({
      userId: 'u',
      jobId: 'j',
      filename: 'f',
      fileSize: 1,
      contentType: 'c',
    });
    const b = computeDocumentHash({
      userId: 'u',
      jobId: 'j',
      filename: 'f',
      fileSize: 1,
      contentType: 'c',
    });
    expect(a).toBe(b);
  });

  it('differs when any field changes', () => {
    const base = computeDocumentHash({
      userId: 'u',
      jobId: 'j',
      filename: 'f',
      fileSize: 1,
      contentType: 'c',
    });
    expect(
      computeDocumentHash({
        userId: 'u',
        jobId: 'j',
        filename: 'f',
        fileSize: 2,
        contentType: 'c',
      })
    ).not.toBe(base);
  });
});

describe('buildAttestationRecord', () => {
  it('populates every required field', () => {
    const record = buildAttestationRecord(VALID_INPUT);
    expect(record.attestationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(record.userId).toBe(VALID_INPUT.userId);
    expect(record.jobId).toBe(VALID_INPUT.jobId);
    expect(record.documentId).toBe(VALID_INPUT.documentId);
    expect(record.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(record.attestationVersion).toBe(ATTESTATION_VERSION);
    expect(record.ipAddress).toBe(VALID_INPUT.ipAddress);
    expect(record.userAgent).toBe(VALID_INPUT.userAgent);
    expect(typeof record.acceptedAt).toBe('string');
    expect(record.createdAt).toBe(record.acceptedAt);
    expect(record.ttl).toBeGreaterThan(0);
    expect(record.acceptedClauses).toEqual(VALID_INPUT.acceptedClauses);
    expect(record.documentMetadata).toEqual({
      filename: VALID_INPUT.filename,
      fileSize: VALID_INPUT.fileSize,
      contentType: VALID_INPUT.contentType,
    });
  });

  it('sets ttl to ~7 years from acceptedAt', () => {
    const acceptedAt = '2024-01-01T00:00:00.000Z';
    const record = buildAttestationRecord({ ...VALID_INPUT, acceptedAt });
    const expectedTtl =
      Math.floor(Date.parse(acceptedAt) / 1000) + 60 * 60 * 24 * 365 * 7;
    expect(record.ttl).toBe(expectedTtl);
  });

  it('honours an explicit attestationVersion override', () => {
    const record = buildAttestationRecord({
      ...VALID_INPUT,
      attestationVersion: 'v9.99',
    });
    expect(record.attestationVersion).toBe('v9.99');
  });
});

describe('writeAttestation', () => {
  beforeEach(() => {
    ddbMock.reset();
    process.env.ATTESTATIONS_TABLE_NAME = 'test-attestations-table';
  });

  it('writes a marshalled item to the configured table', async () => {
    ddbMock.on(PutItemCommand).resolves({});
    const record = buildAttestationRecord(VALID_INPUT);

    await writeAttestation(record);

    expect(ddbMock.calls()).toHaveLength(1);
    const input = ddbMock.call(0).args[0].input as PutItemCommandInput;
    expect(input.TableName).toBe('test-attestations-table');
    expect(input.ConditionExpression).toContain('attribute_not_exists');
    const persisted = unmarshall(input.Item!);
    expect(persisted.attestationId).toBe(record.attestationId);
    expect(persisted.documentHash).toBe(record.documentHash);
    expect(persisted.attestationVersion).toBe(ATTESTATION_VERSION);
    expect(persisted.acceptedClauses.acceptCopyrightOwnership).toBe(true);
    expect(persisted.documentMetadata.filename).toBe(VALID_INPUT.filename);
  });

  it('uses an injected client + tableName when supplied', async () => {
    const customClient = new DynamoDBClient({});
    const customMock = mockClient(customClient);
    customMock.on(PutItemCommand).resolves({});
    const record = buildAttestationRecord(VALID_INPUT);

    await writeAttestation(record, {
      dynamoClient: customClient,
      tableName: 'override-table',
    });

    expect(customMock.calls()).toHaveLength(1);
    const input = customMock.call(0).args[0].input as PutItemCommandInput;
    expect(input.TableName).toBe('override-table');
  });

  it('throws AttestationWriteError when DynamoDB rejects the write', async () => {
    ddbMock.on(PutItemCommand).rejects(new Error('AccessDenied'));
    const record = buildAttestationRecord(VALID_INPUT);

    await expect(writeAttestation(record)).rejects.toBeInstanceOf(
      AttestationWriteError
    );
  });

  it('preserves the original DynamoDB error as the cause', async () => {
    const original = new Error('ProvisionedThroughputExceeded');
    ddbMock.on(PutItemCommand).rejects(original);
    const record = buildAttestationRecord(VALID_INPUT);

    try {
      await writeAttestation(record);
      throw new Error('expected writeAttestation to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AttestationWriteError);
      expect((err as AttestationWriteError).code).toBe(
        'AttestationPersistFailure'
      );
      expect((err as AttestationWriteError).cause).toBe(original);
    }
  });

  it('refuses to persist a schema-invalid record (no DynamoDB call)', async () => {
    ddbMock.on(PutItemCommand).resolves({});
    const record = buildAttestationRecord(VALID_INPUT);
    // Tamper with the record post-build: an obviously-bad documentHash.
    const tampered = { ...record, documentHash: 'not-a-hash' };

    await expect(writeAttestation(tampered)).rejects.toBeInstanceOf(
      AttestationWriteError
    );
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it('throws when ATTESTATIONS_TABLE_NAME is missing and no override provided', async () => {
    delete process.env.ATTESTATIONS_TABLE_NAME;
    const record = buildAttestationRecord(VALID_INPUT);
    await expect(writeAttestation(record)).rejects.toThrow(
      /ATTESTATIONS_TABLE_NAME/
    );
  });
});
