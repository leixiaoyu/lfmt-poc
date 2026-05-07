/**
 * Job Repository
 *
 * Centralises the "fetch job by (jobId, userId) and enforce ownership" pattern
 * that was previously duplicated across getJob.ts, deleteJob.ts, and
 * getTranslationStatus.ts.
 *
 * The DynamoDB table uses a composite primary key (jobId HASH + userId RANGE).
 * GetItem with both keys therefore enforces ownership at the database level:
 * - Job exists and belongs to caller  → returns the DynamoDBJob record
 * - Job does not exist OR belongs to another user → returns null
 *
 * Callers should map null → 404 (NOT 403) to avoid leaking job existence to
 * cross-ownership probes (OWASP API1:2023 — Broken Object Level Authorization).
 */

import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBJob } from '@lfmt/shared-types';

/**
 * Load a job record from DynamoDB, enforcing that it belongs to the caller.
 *
 * @param client    - DynamoDBClient instance (caller manages lifecycle)
 * @param tableName - Jobs table name from environment
 * @param jobId     - Job identifier from path parameters
 * @param userId    - Cognito sub from the authorizer claims (owner check)
 * @returns The job record if it exists AND belongs to userId, otherwise null
 */
export async function loadJobForUser(
  client: DynamoDBClient,
  tableName: string,
  jobId: string,
  userId: string
): Promise<DynamoDBJob | null> {
  const command = new GetItemCommand({
    TableName: tableName,
    Key: marshall({ jobId, userId }),
    // Eventual consistency is sufficient here: the callers (GET and status-poll
    // endpoints) are read-after-write on data that was written seconds-to-minutes
    // earlier. The eventual consistency window (~10-100 ms) is invisible at
    // human timescales. Consistent reads double the consumed RCU cost.
    //
    // Exception: getTranslationStatus.ts retains ConsistentRead: true because
    // it is polled tightly during an active translation and stale reads could
    // cause the UI to display outdated progress. That function does NOT use this
    // helper (see its inline comment for rationale).
  });

  const result: GetItemCommandOutput = await client.send(command);

  if (!result.Item) {
    return null;
  }

  return unmarshall(result.Item) as DynamoDBJob;
}
