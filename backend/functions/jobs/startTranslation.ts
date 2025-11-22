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
import { SFNClient, StartExecutionCommand, StartExecutionCommandOutput } from '@aws-sdk/client-sfn';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import { isValidTargetLanguage, TargetLanguage } from '../translation/types';

const logger = new Logger('lfmt-start-translation');
const dynamoClient = new DynamoDBClient({});
const sfnClient = new SFNClient({});

const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const STATE_MACHINE_NAME = getRequiredEnv('STATE_MACHINE_NAME'); // State machine name (ARN constructed dynamically)
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * Construct State Machine ARN dynamically to avoid circular dependency in CDK
 * ARN format: arn:aws:states:<region>:<account-id>:stateMachine:<name>
 */
const getStateMachineArn = async (): Promise<string> => {
  // Get account ID from STS (cached after first call)
  const { STSClient, GetCallerIdentityCommand } = await import('@aws-sdk/client-sts');
  const stsClient = new STSClient({});
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const accountId = identity.Account;

  return `arn:aws:states:${AWS_REGION}:${accountId}:stateMachine:${STATE_MACHINE_NAME}`;
};

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
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Starting translation request', {
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // Get authenticated user from Cognito claims
    const userId = event.requestContext?.authorizer?.claims?.sub;
    if (!userId) {
      return createErrorResponse(401, 'Unauthorized', undefined, undefined, requestOrigin);
    }

    // Extract jobId from path
    const jobId = event.pathParameters?.jobId;
    if (!jobId) {
      return createErrorResponse(400, "Missing jobId in path", "MISSING_JOB_ID", undefined, requestOrigin);
    }

    // Parse request body
    const body: StartTranslationRequest = event.body
      ? JSON.parse(event.body)
      : {};

    // Validate request
    const validation = validateRequest(body);
    if (!validation.valid) {
      return createErrorResponse(400, validation.error!, "INVALID_REQUEST", undefined, requestOrigin);
    }

    // Load job from DynamoDB
    const job = await loadJob(jobId, userId);

    // Verify job exists
    if (!job) {
      return createErrorResponse(404, `Job not found: ${jobId}`, "JOB_NOT_FOUND", undefined, requestOrigin);
    }

    // Verify user owns the job
    if (job.userId !== userId) {
      return createErrorResponse(
        403,
        'You do not have permission to translate this job',
        'FORBIDDEN',
        undefined,
        requestOrigin
      );
    }

    // Verify job is in CHUNKED status
    if (job.status !== 'CHUNKED') {
      return createErrorResponse(
        400,
        `Job must be in CHUNKED status to start translation. Current status: ${job.status}`,
        'INVALID_JOB_STATUS',
        undefined,
        requestOrigin
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
        'TRANSLATION_ALREADY_STARTED',
        undefined,
        requestOrigin
      );
    }

    // Verify job has chunks
    if (!job.totalChunks || job.totalChunks === 0) {
      return createErrorResponse(
        400,
        'Job has no chunks to translate',
        'NO_CHUNKS_AVAILABLE',
        undefined,
        requestOrigin
      );
    }

    logger.info('Starting translation', {
      jobId,
      userId,
      targetLanguage: body.targetLanguage,
      totalChunks: job.totalChunks,
    });

    // Initialize translation in DynamoDB
    await initializeTranslation(jobId, userId, {
      targetLanguage: body.targetLanguage as TargetLanguage,
      tone: body.tone,
      contextChunks: body.contextChunks ?? 2,
      totalChunks: job.totalChunks,
    });

    // Start Step Functions workflow to process all chunks
    const executionArn = await startStateMachineExecution(jobId, userId, {
      targetLanguage: body.targetLanguage,
      tone: body.tone,
      contextChunks: body.contextChunks ?? 2,
      totalChunks: job.totalChunks,
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
      executionArn,
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
      executionArn, // Step Functions execution ARN for tracking
    }, undefined, requestOrigin);
  } catch (error) {
    logger.error('Failed to start translation', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Failed to start translation',
      undefined,
      undefined,
      requestOrigin
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
async function loadJob(jobId: string, userId: string): Promise<any | null> {
  const command = new GetItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
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
  userId: string,
  params: {
    targetLanguage: TargetLanguage;
    tone?: string;
    contextChunks: number;
    totalChunks: number;
  }
): Promise<void> {
  const command = new UpdateItemCommand({
    TableName: JOBS_TABLE,
    Key: marshall({ jobId, userId }),
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
    userId,
    targetLanguage: params.targetLanguage,
    totalChunks: params.totalChunks,
  });
}

/**
 * Start Step Functions state machine execution
 */
async function startStateMachineExecution(
  jobId: string,
  userId: string,
  params: {
    targetLanguage: string;
    tone?: string;
    contextChunks: number;
    totalChunks: number;
  }
): Promise<string> {
  // Load chunk metadata from S3 to build chunks array for state machine
  const chunks = [];
  for (let i = 0; i < params.totalChunks; i++) {
    chunks.push({
      chunkIndex: i,
    });
  }

  const input = {
    jobId,
    userId,
    targetLanguage: params.targetLanguage,
    tone: params.tone || 'neutral',
    contextChunks: params.contextChunks,
    chunks,
  };

  // Construct state machine ARN dynamically
  const stateMachineArn = await getStateMachineArn();

  const command = new StartExecutionCommand({
    stateMachineArn,
    name: `${jobId}-${Date.now()}`, // Unique execution name
    input: JSON.stringify(input),
  });

  const response: StartExecutionCommandOutput = await sfnClient.send(command);

  logger.info('Started Step Functions execution', {
    jobId,
    executionArn: response.executionArn,
    totalChunks: params.totalChunks,
  });

  return response.executionArn!;
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
