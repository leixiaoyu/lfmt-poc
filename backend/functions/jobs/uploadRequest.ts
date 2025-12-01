/**
 * Upload Request Lambda Function
 * Generates presigned S3 URLs for document uploads and creates job records
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import {
  S3Client,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  DynamoDBClient,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';
import {
  PresignedUrlRequest,
  PresignedUrlResponse,
  fileValidationSchema
} from '@lfmt/shared-types';
import { createSuccessResponse, createErrorResponse } from '../shared/api-response';
import Logger from '../shared/logger';
import { getRequiredEnv } from '../shared/env';
import { randomUUID } from 'crypto';

const logger = new Logger('lfmt-upload-request');
const s3Client = new S3Client({});
const dynamoClient = new DynamoDBClient({});

const DOCUMENT_BUCKET = getRequiredEnv('DOCUMENT_BUCKET');
const JOBS_TABLE = getRequiredEnv('JOBS_TABLE');
const PRESIGNED_URL_EXPIRATION = 900; // 15 minutes

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Processing upload request', { requestId });

  try {
    // Extract user ID from Cognito authorizer context
    const userId = event.requestContext.authorizer?.claims?.sub;

    if (!userId) {
      logger.warn('Missing user ID from authorizer', { requestId });
      return createErrorResponse(
        401,
        'Unauthorized - user ID not found',
        requestId,
        undefined,
        requestOrigin
      );
    }

    // Parse and validate request body
    const body = JSON.parse(event.body || '{}') as PresignedUrlRequest;

    const validationResult = fileValidationSchema.safeParse({
      filename: body.fileName,
      fileSize: body.fileSize,
      contentType: body.contentType
    });

    if (!validationResult.success) {
      logger.warn('File validation failed', {
        requestId,
        errors: validationResult.error.flatten().fieldErrors,
      });

      return createErrorResponse(
        400,
        'File validation failed',
        requestId,
        validationResult.error.flatten().fieldErrors,
        requestOrigin
      );
    }

    const { filename, fileSize, contentType } = validationResult.data;

    // Generate unique IDs for file and job
    const fileId = randomUUID();
    const jobId = randomUUID();
    const s3Key = `uploads/${userId}/${fileId}/${filename}`;

    logger.info('Generating presigned URL', {
      requestId,
      userId,
      fileId,
      jobId,
      filename,
      fileSize,
    });

    // Generate presigned URL for S3 upload
    const putCommand = new PutObjectCommand({
      Bucket: DOCUMENT_BUCKET,
      Key: s3Key,
      ContentType: contentType,
      ContentLength: fileSize,
      Metadata: {
        userId,
        fileId,
        jobId,
        originalFilename: filename,
        uploadRequestId: requestId,
      },
    });

    const uploadUrl = await getSignedUrl(s3Client, putCommand, {
      expiresIn: PRESIGNED_URL_EXPIRATION,
    });

    // Create initial job record in DynamoDB
    const now = new Date().toISOString();

    const jobRecord = {
      jobId,
      userId,
      documentId: fileId,
      filename,
      status: 'PENDING_UPLOAD',
      s3Key,
      fileSize,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + PRESIGNED_URL_EXPIRATION * 1000).toISOString(),
      metadata: {
        originalFilename: filename,
        uploadRequestId: requestId,
      },
    };

    const putItemCommand = new PutItemCommand({
      TableName: JOBS_TABLE,
      Item: marshall(jobRecord, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(jobId)',
    });

    await dynamoClient.send(putItemCommand);

    logger.info('Job record created successfully', {
      requestId,
      userId,
      jobId,
      fileId,
    });

    // Prepare response
    const response: PresignedUrlResponse = {
      uploadUrl,
      fileId,
      expiresIn: PRESIGNED_URL_EXPIRATION,
      requiredHeaders: {
        'Content-Type': contentType,
        'Content-Length': fileSize.toString(),
      },
    };

    return createSuccessResponse(
      200,
      {
        message: 'Upload URL generated successfully',
        data: response,
      },
      requestId,
      requestOrigin
    );
  } catch (error) {
    logger.error('Unexpected error during upload request processing', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return createErrorResponse(
      500,
      'Failed to generate upload URL. Please try again later.',
      requestId,
      undefined,
      requestOrigin
    );
  }
};
