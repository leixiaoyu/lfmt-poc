/**
 * Jest Setup File
 * Sets up environment variables required for testing
 */

// Required environment variables for Lambda functions
process.env.RATE_LIMIT_BUCKETS_TABLE = 'test-rate-limit-buckets';
process.env.JOBS_TABLE = 'test-jobs-table';
process.env.CHUNKS_BUCKET = 'test-chunks-bucket';
process.env.GEMINI_API_KEY_SECRET_NAME = 'test-gemini-api-key';
process.env.COGNITO_USER_POOL_ID = 'test-user-pool-id';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.ENVIRONMENT = 'test';
