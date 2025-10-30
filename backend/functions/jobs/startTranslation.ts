/**
 * Start Translation Lambda Function
 * POST /jobs/{jobId}/translate
 * Initiates translation process for a chunked document
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  GetItemCommandOutput,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import { isValidTargetLanguage, TargetLanguage } from '../translation/types';

const logger = new Logger('lfmt-start-translation');
const dynamoClient = new DynamoDBClient({});
const lambdaClient = new LambdaClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const TRANSLATE_CHUNK_FUNCTION = getRequiredEnv('TRANSLATE_CHUNK_FUNCTION_NAME');

/**
 * Request body for starting translation
 */
interface StartTranslationRequest {
  targetLanguage: string;
  tone?: 'formal' | 'informal' | 'neutral';
  contextChunks?: number;
}

/**
 * Lambda handler for starting translation
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.info('Starting translation request', {
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
      return createErrorResponse(400, 'Missing jobId in path', 'MISSING_JOB_ID');
    }

    // Parse request body
    const body: StartTranslationRequest = event.body
      ? JSON.parse(event.body)
      : {};

    // Validate request
    const validation = validateRequest(body);
    if (!validation.valid) {
      return createErrorResponse(400, validation.error!, 'INVALID_REQUEST');
    }

    // Load job from DynamoDB
    const job = await loadJob(jobId);

    // Verify job exists
    if (!job) {
      return createErrorResponse(404, `Job not found: ${jobId}`, 'JOB_NOT_FOUND');
    }

    // Verify user owns the job
    if (job.userId !== userId) {
      return createErrorResponse(
        403,
        'You do not have permission to translate this job',
        'FORBIDDEN'
      );
    }

    // Verify job is in CHUNKED status
    if (job.status !== 'CHUNKED') {
      return createErrorResponse(
        400,
        `Job must be in CHUNKED status to start translation. Current status: ${job.status}`,
        'INVALID_JOB_STATUS'
      );
    }

    // Verify job is not already being translated
    if (
      job.translationStatus === 'IN_PROGRESS' ||
      job.translationStatus === 'COMPLETED'
    ) {
      return createErrorResponse(
        400,
        `Translation already ${job.translationStatus.toLowerCase()} for this job`,
        'TRANSLATION_ALREADY_STARTED'
      );
    }

    // Verify job has chunks
    if (!job.totalChunks || job.totalChunks === 0) {
      return createErrorResponse(
        400,
        'Job has no chunks to translate',
        'NO_CHUNKS_AVAILABLE'
      );
    }

    logger.info('Starting translation', {
      jobId,
      userId,
      targetLanguage: body.targetLanguage,
      totalChunks: job.totalChunks,
    });

    // Initialize translation in DynamoDB
    await initializeTranslation(jobId, {
      targetLanguage: body.targetLanguage as TargetLanguage,
      tone: body.tone,
      contextChunks: body.contextChunks ?? 2,
      totalChunks: job.totalChunks,
    });

    // Trigger first chunk translation
    await invokeTranslateChunk(jobId, 0, {
      targetLanguage: body.targetLanguage,
      tone: body.tone,
      contextChunks: body.contextChunks,
    });

    // Calculate estimated completion time
    // Assume 10 seconds per chunk (conservative estimate with rate limiting)
    const estimatedSeconds = job.totalChunks * 10;
    const estimatedCompletion = new Date(
      Date.now() + estimatedSeconds * 1000
    ).toISOString();

    logger.info('Translation started successfully', {
      jobId,
      totalChunks: job.totalChunks,
      estimatedCompletion,
    });

    return createSuccessResponse(200, {
      message: 'Translation started successfully',
      jobId,
      translationStatus: 'IN_PROGRESS',
      targetLanguage: body.targetLanguage,
      totalChunks: job.totalChunks,
      chunksTranslated: 0,
      estimatedCompletion,
      estimatedCost: calculateEstimatedCost(job.totalChunks, 3500), // Assume 3500 tokens per chunk
    });
  } catch (error) {
    logger.error('Failed to start translation', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Failed to start translation',
      undefined
    );
  }
};

/**
 * Validate translation request
 */
function validateRequest(body: StartTranslationRequest): {
  valid: boolean;
  error?: string;
} {
  if (!body.targetLanguage) {
    return {
      valid: false,
      error: 'targetLanguage is required',
    };
  }

  if (!isValidTargetLanguage(body.targetLanguage)) {
    return {
      valid: false,
      error: `Invalid targetLanguage: ${body.targetLanguage}. Must be one of: es, fr, it, de, zh`,
    };
  }

  if (body.tone && !['formal', 'informal', 'neutral'].includes(body.tone)) {
    return {
      valid: false,
      error: `Invalid tone: ${body.tone}. Must be one of: formal, informal, neutral`,
    };
  }

  if (
    body.contextChunks !== undefined &&
    (body.contextChunks < 0 || body.contextChunks > 5)
  ) {
    return {
      valid: false,
      error: 'contextChunks must be between 0 and 5',
    };
  }

  return { valid: true };
}

/**
 * Load job from DynamoDB
 */
async function loadJob(jobId: string): Promise<any | null> {
  const command = new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId }),
  });

  const response: GetItemCommandOutput = await dynamoClient.send(command);

  if (!response.Item) {
    return null;
  }

  return unmarshall(response.Item);
}

/**
 * Initialize translation status in DynamoDB
 */
async function initializeTranslation(
  jobId: string,
  params: {
    targetLanguage: TargetLanguage;
    tone?: string;
    contextChunks: number;
    totalChunks: number;
  }
): Promise<void> {
  const command = new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId }),
    UpdateExpression:
      'SET translationStatus = :status, targetLanguage = :lang, translationTone = :tone, translationContextChunks = :context, translatedChunks = :translated, translationStartedAt = :startedAt, tokensUsed = :tokens, estimatedCost = :cost, updatedAt = :updatedAt',
    ExpressionAttributeValues: marshall({
      ':status': 'IN_PROGRESS',
      ':lang': params.targetLanguage,
      ':tone': params.tone || 'neutral',
      ':context': params.contextChunks,
      ':translated': 0,
      ':startedAt': new Date().toISOString(),
      ':tokens': 0,
      ':cost': 0,
      ':updatedAt': new Date().toISOString(),
    }),
  });

  await dynamoClient.send(command);

  logger.info('Translation initialized in DynamoDB', {
    jobId,
    targetLanguage: params.targetLanguage,
    totalChunks: params.totalChunks,
  });
}

/**
 * Invoke translateChunk Lambda asynchronously
 */
async function invokeTranslateChunk(
  jobId: string,
  chunkIndex: number,
  params: {
    targetLanguage: string;
    tone?: string;
    contextChunks?: number;
  }
): Promise<void> {
  const payload = {
    jobId,
    chunkIndex,
    targetLanguage: params.targetLanguage,
    tone: params.tone,
    contextChunks: params.contextChunks,
  };

  const command = new InvokeCommand({
    FunctionName: TRANSLATE_CHUNK_FUNCTION,
    InvocationType: 'Event', // Asynchronous invocation
    Payload: JSON.stringify(payload),
  });

  await lambdaClient.send(command);

  logger.info('Invoked translateChunk Lambda', {
    jobId,
    chunkIndex,
    functionName: TRANSLATE_CHUNK_FUNCTION,
  });
}

/**
 * Calculate estimated cost based on token count
 * Gemini 1.5 Pro: $0.075 per 1M input tokens
 */
function calculateEstimatedCost(
  totalChunks: number,
  tokensPerChunk: number
): number {
  const totalTokens = totalChunks * tokensPerChunk;
  const costPerMillionTokens = 0.075;
  return (totalTokens / 1_000_000) * costPerMillionTokens;
}
