/**
 * Unit tests for shared jobRepository
 * Tests the loadJobForUser ownership-enforcing fetch helper.
 */

// Set environment variables BEFORE imports
process.env.JOBS_TABLE = 'test-jobs-table';

import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { loadJobForUser } from './jobRepository';

const dynamoMock = mockClient(DynamoDBClient);
const client = new DynamoDBClient({});

describe('loadJobForUser', () => {
  beforeEach(() => {
    dynamoMock.reset();
  });

  // ---------------------------------------------------------------------------
  // Happy-path: job exists and belongs to the caller
  // ---------------------------------------------------------------------------

  it('returns the job record when it exists and belongs to the caller', async () => {
    dynamoMock.on(GetItemCommand).resolves({
      Item: {
        jobId: { S: 'job-abc' },
        userId: { S: 'user-123' },
        status: { S: 'PENDING_UPLOAD' },
        createdAt: { S: '2026-01-01T00:00:00.000Z' },
      },
    } as any);

    const result = await loadJobForUser(client, 'test-jobs-table', 'job-abc', 'user-123');

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe('job-abc');
    expect(result!.userId).toBe('user-123');
    expect(result!.status).toBe('PENDING_UPLOAD');
  });

  // ---------------------------------------------------------------------------
  // BOLA guard: job belongs to a different user (composite key miss → null)
  // ---------------------------------------------------------------------------

  it('returns null when the job is owned by a different user', async () => {
    // DynamoDB composite key lookup with the requester's userId will miss because
    // the stored userId is different — the mock returns no Item.
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const result = await loadJobForUser(client, 'test-jobs-table', 'job-abc', 'attacker-999');

    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Not found: job does not exist at all
  // ---------------------------------------------------------------------------

  it('returns null when the job does not exist', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    const result = await loadJobForUser(client, 'test-jobs-table', 'missing-job', 'user-123');

    expect(result).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Passes correct keys to DynamoDB (spot-check the marshall call)
  // ---------------------------------------------------------------------------

  it('issues GetItemCommand with the correct table, jobId, and userId', async () => {
    dynamoMock.on(GetItemCommand).resolves({ Item: undefined });

    await loadJobForUser(client, 'my-table', 'job-xyz', 'user-abc');

    const calls = dynamoMock.commandCalls(GetItemCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0].args[0].input;
    expect(input.TableName).toBe('my-table');
    // The Key is marshalled — just verify both partition key attributes are present
    expect(input.Key).toHaveProperty('jobId');
    expect(input.Key).toHaveProperty('userId');
  });

  // ---------------------------------------------------------------------------
  // Error propagation
  // ---------------------------------------------------------------------------

  it('propagates DynamoDB errors to the caller', async () => {
    dynamoMock.on(GetItemCommand).rejects(new Error('DynamoDB unavailable'));

    await expect(loadJobForUser(client, 'test-jobs-table', 'job-abc', 'user-123')).rejects.toThrow(
      'DynamoDB unavailable'
    );
  });
});
