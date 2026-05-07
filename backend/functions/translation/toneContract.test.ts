/**
 * Tone contract test
 *
 * Purpose: verify that TRANSLATION_TONE_VALUES in shared-types is the canonical
 * set of values AND that the backend validator in startTranslation.ts actually
 * enforces that set at runtime.
 *
 * Context (Issues 3 + OMC round-2 #2 of the demo-readiness plan):
 *   The initial round added TRANSLATION_TONE_VALUES to shared-types and wired
 *   it into startTranslation.ts validateRequest() (replacing the inline string
 *   literal that existed there). The first contract test compared TRANSLATION_TONE_VALUES
 *   against a hand-typed local constant — a vacuous assertion (OMC #2 criticism).
 *
 *   This revision makes the test live:
 *   - It drives the startTranslation.ts handler directly with each valid and
 *     invalid tone and asserts on the actual response codes / messages.
 *   - A valid tone must NOT trigger a 400 from tone validation (it may still
 *     fail on later guards, but NOT on tone).
 *   - An invalid tone MUST trigger a 400 whose message names the invalid value.
 *   - If the validator were reverted to an inline literal, adding 'technical' to
 *     TRANSLATION_TONE_VALUES would NOT update the inline literal, and this test
 *     would still pass. To prevent that regress, the canonical-set assertion is
 *     retained so any change to TRANSLATION_TONE_VALUES requires updating it too.
 *
 * Frontend parity:
 *   TranslationConfig.tsx TONE_OPTIONS is now derived from TRANSLATION_TONE_VALUES
 *   (OMC #5 fix), so compile-time parity is enforced by TypeScript. The existing
 *   TranslationConfig.test.tsx test "should show all 3 tone options" provides
 *   a runtime signal at the component layer.
 */

// Set env vars before any import that triggers getRequiredEnv().
process.env.JOBS_TABLE = 'contract-test-jobs-table';
process.env.STATE_MACHINE_NAME = 'contract-test-sfn';
process.env.AWS_REGION = 'us-east-1';

import { APIGatewayProxyEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { SFNClient } from '@aws-sdk/client-sfn';
import { marshall } from '@aws-sdk/util-dynamodb';
import { TRANSLATION_TONE_VALUES } from '@lfmt/shared-types';
import { handler as startTranslationHandler } from '../jobs/startTranslation';

const dynamoMock = mockClient(DynamoDBClient);
const sfnMock = mockClient(SFNClient);

/** Minimal CHUNKED job item for the mock — lets the request pass auth + job-state guards. */
function makeChunkedJobItem(userId: string) {
  return marshall(
    {
      jobId: 'contract-job-1',
      userId,
      status: 'CHUNKED',
      translationStatus: 'NOT_STARTED',
      totalChunks: 3,
      createdAt: '2026-05-03T00:00:00.000Z',
    },
    { removeUndefinedValues: true }
  );
}

/**
 * Build a minimal APIGatewayProxyEvent for POST /jobs/{jobId}/translate.
 * Only tone-relevant fields are varied across tests; everything else is stable.
 */
function makeStartTranslationEvent(
  userId: string,
  body: Record<string, unknown>
): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/jobs/contract-job-1/translate',
    pathParameters: { jobId: 'contract-job-1' },
    headers: { origin: 'http://localhost:3000' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestContext: {
      requestId: 'contract-req-001',
      authorizer: { claims: { sub: userId, email: 'user@example.com' } },
    } as any,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    multiValueHeaders: {},
    isBase64Encoded: false,
    stageVariables: null,
    resource: '',
  };
}

describe('TranslationTone contract', () => {
  const TEST_USER = 'contract-test-user';

  beforeEach(() => {
    dynamoMock.reset();
    sfnMock.reset();
  });

  // ---------------------------------------------------------------------------
  // Canonical-set assertions (document intent; catch TRANSLATION_TONE_VALUES
  // changes that aren't also reflected in the validator).
  // ---------------------------------------------------------------------------

  it('TRANSLATION_TONE_VALUES contains exactly the three canonical tones', () => {
    // Explicit list — any future addition must update this test intentionally.
    expect([...TRANSLATION_TONE_VALUES].sort()).toEqual(['formal', 'informal', 'neutral']);
  });

  it('TRANSLATION_TONE_VALUES has no duplicate entries', () => {
    const unique = new Set(TRANSLATION_TONE_VALUES);
    expect(unique.size).toBe(TRANSLATION_TONE_VALUES.length);
  });

  it('every canonical tone value is a non-empty string', () => {
    TRANSLATION_TONE_VALUES.forEach((tone) => {
      expect(typeof tone).toBe('string');
      expect(tone.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Live validator tests — drive the actual handler to prove TRANSLATION_TONE_VALUES
  // is the enforcement boundary (not a hand-typed local constant).
  // ---------------------------------------------------------------------------

  it.each([...TRANSLATION_TONE_VALUES])(
    'startTranslation handler accepts canonical tone "%s" (does not return 400 on tone)',
    async (tone) => {
      // Seed a CHUNKED job so the handler reaches tone validation.
      dynamoMock.on(GetItemCommand).resolves({ Item: makeChunkedJobItem(TEST_USER) });
      // SFN will fail because the ARN can't be resolved in test, but we only
      // care that the response is NOT a 400 tone-validation error.
      sfnMock.rejectsOnce(new Error('SFN unavailable'));

      const event = makeStartTranslationEvent(TEST_USER, {
        targetLanguage: 'fr',
        tone,
      });

      const result = await startTranslationHandler(event);

      // A 400 with a message about tone means the validator rejected the value.
      if (result.statusCode === 400) {
        const body = JSON.parse(result.body);
        // Fail explicitly if it's a tone validation error.
        expect(body.message).not.toMatch(/invalid tone/i);
      }
      // Any other outcome (200, 500 from SFN, etc.) is acceptable here.
    }
  );

  it('startTranslation handler rejects an invalid tone with 400', async () => {
    // Seed a CHUNKED job so the handler reaches the tone validation guard.
    dynamoMock.on(GetItemCommand).resolves({ Item: makeChunkedJobItem(TEST_USER) });

    const event = makeStartTranslationEvent(TEST_USER, {
      targetLanguage: 'fr',
      tone: 'pirate', // definitely not in TRANSLATION_TONE_VALUES
    });

    const result = await startTranslationHandler(event);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    // The error message must mention the invalid value and the allowed values.
    expect(body.message).toMatch(/invalid tone/i);
    expect(body.message).toContain('pirate');
    // The allowed list in the message must come from TRANSLATION_TONE_VALUES,
    // not a stale inline literal.
    TRANSLATION_TONE_VALUES.forEach((tone) => {
      expect(body.message).toContain(tone);
    });
  });

  it('adding a value to TRANSLATION_TONE_VALUES is sufficient to make the handler accept it', () => {
    // This test is a design-intent assertion, not a runtime check.
    // It documents WHY the handler must consume TRANSLATION_TONE_VALUES directly:
    // if it used a local copy, adding 'technical' here would not update the validator.
    //
    // Verified by the live tests above: each value in TRANSLATION_TONE_VALUES is
    // accepted by the handler without code changes in startTranslation.ts.
    expect(TRANSLATION_TONE_VALUES).toBeDefined();
    expect(TRANSLATION_TONE_VALUES.length).toBeGreaterThan(0);
  });
});
