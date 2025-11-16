/**
 * Get Translation Status Lambda Function
 * GET /jobs/{jobId}/translation-status
 * Returns detailed translation progress and status
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient, GetItemCommand, GetItemCommandOutput } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';

const logger = new Logger('lfmt-translation-status');
const dynamoClient = new DynamoDBClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');

/**
 * Translation status response
 */
interface TranslationStatusResponse {
  jobId: string;
  status: string; // Overall job status (PENDING_UPLOAD, UPLOADED, CHUNKED, etc.)
  translationStatus: string;
  targetLanguage?: string;
  tone?: string;
  totalChunks: number;
  chunksTranslated: number;
  progressPercentage: number;
  tokensUsed?: number;
  estimatedCost?: number;
  translationStartedAt?: string;
  translationCompletedAt?: string;
  estimatedCompletion?: string;
  error?: string;
}

/**
 * Lambda handler for getting translation status
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.info('Translation status request', {
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // Get authenticated user from Cognito claims
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized', undefined);
    }

    // Extract jobId from path
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      return createErrorResponse(400, 'Missing jobId in path', undefined);
    }

    // Load job from DynamoDB (requires both jobId and userId as composite key)
    const job = await loadJob(jobId, userId);

    // Verify job exists
    if (!job) {
      return createErrorResponse(404, `Job not found: ${jobId}`, undefined);
    }

    // Build response
    const response: TranslationStatusResponse = {
      jobId,
      status: job.status, // Overall job status (PENDING_UPLOAD, UPLOADED, CHUNKED, etc.)
      translationStatus: job.translationStatus || 'NOT_STARTED',
      targetLanguage: job.targetLanguage,
      tone: job.translationTone,
      totalChunks: job.totalChunks || 0,
      chunksTranslated: job.translatedChunks || 0,
      progressPercentage: calculateProgress(
        job.translatedChunks || 0,
        job.totalChunks || 0
      ),
      tokensUsed: job.tokensUsed,
      estimatedCost: job.estimatedCost,
      translationStartedAt: job.translationStartedAt,
      translationCompletedAt: job.translationCompletedAt,
    };

    // Add estimated completion for in-progress translations
    if (job.translationStatus === 'IN_PROGRESS') {
      response.estimatedCompletion = calculateEstimatedCompletion(
        job.translatedChunks || 0,
        job.totalChunks || 0,
        job.translationStartedAt
      );
    }

    // Add error information if translation failed
    if (job.translationStatus === 'TRANSLATION_FAILED') {
      response.error = job.translationError || 'Translation failed';
    }

    logger.info('Translation status retrieved', {
      jobId,
      translationStatus: response.translationStatus,
      progressPercentage: response.progressPercentage,
    });

    return createSuccessResponse(200, response);
  } catch (error) {
    logger.error('Failed to get translation status', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Failed to get translation status',
      undefined
    );
  }
};

/**
 * Load job from DynamoDB
 * DynamoDB table has composite primary key: jobId (HASH) + userId (RANGE)
 * Uses ConsistentRead to ensure we get the latest status updates
 */
async function loadJob(jobId: string, userId: string): Promise<any | null> {
  const command = new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
    ConsistentRead: true, // Ensure we get the latest data, critical for status polling
  });

  const response: GetItemCommandOutput = await dynamoClient.send(command);

  if (!response.Item) {
    return null;
  }

  return unmarshall(response.Item);
}

/**
 * Calculate progress percentage
 */
function calculateProgress(chunksTranslated: number, totalChunks: number): number {
  if (totalChunks === 0) return 0;
  return Math.round((chunksTranslated / totalChunks) * 100);
}

/**
 * Calculate estimated completion time based on current progress
 */
function calculateEstimatedCompletion(
  chunksTranslated: number,
  totalChunks: number,
  startedAt?: string
): string | undefined {
  if (!startedAt || chunksTranslated === 0) {
    // Can't estimate without start time or progress
    return undefined;
  }

  const startTime = new Date(startedAt).getTime();
  const now = Date.now();
  const elapsed = now - startTime;

  // Calculate average time per chunk
  const avgTimePerChunk = elapsed / chunksTranslated;

  // Estimate remaining time
  const remainingChunks = totalChunks - chunksTranslated;
  const estimatedRemainingMs = remainingChunks * avgTimePerChunk;

  const completionTime = new Date(now + estimatedRemainingMs);
  return completionTime.toISOString();
}
