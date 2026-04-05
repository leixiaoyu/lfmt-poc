# Structured Logging Guide

**Last Updated**: 2025-04-05
**Owner**: Backend Team

---

## Overview

All Lambda functions in the LFMT project use structured JSON logging with correlation IDs for better observability and debugging.

**Benefits**:
- **Correlation IDs**: Track requests across multiple Lambda invocations
- **Structured Data**: Query logs efficiently with CloudWatch Insights
- **Consistent Format**: All logs follow the same JSON schema
- **Metadata Support**: Attach additional context to log entries

---

## Logger Utility

**Location**: `backend/functions/utils/logger.ts`

### Log Entry Format

```typescript
{
  "timestamp": "2025-04-05T10:30:45.123Z",
  "level": "INFO" | "DEBUG" | "WARN" | "ERROR",
  "correlationId": "abc123-request-id",
  "message": "User logged in successfully",
  "metadata": {
    "userId": "user-123",
    "email": "user@example.com"
  }
}
```

---

## Usage in Lambda Handlers

### 1. API Gateway Lambda (Correlation ID from Request Context)

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from './utils/logger';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Create logger from API Gateway event (extracts requestContext.requestId)
  const logger = Logger.fromAPIGatewayEvent(event);

  logger.info('Processing login request', {
    path: event.path,
    method: event.httpMethod,
  });

  try {
    // Business logic
    const userId = 'user-123';
    const email = 'user@example.com';

    logger.info('User authenticated successfully', { userId, email });

    // Return correlation ID in response headers for frontend logging
    return {
      statusCode: 200,
      headers: {
        'X-Correlation-ID': logger.getCorrelationId(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    logger.error('Login failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      statusCode: 500,
      headers: {
        'X-Correlation-ID': logger.getCorrelationId(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
```

---

### 2. Step Functions Lambda (Correlation ID from Execution ARN)

```typescript
import { Logger } from './utils/logger';

export const handler = async (event: any): Promise<any> => {
  // Create logger from execution ARN (for Step Functions invocations)
  const executionArn = event.executionArn || 'unknown';
  const logger = Logger.fromStepFunctionsEvent(executionArn);

  logger.info('Processing translation chunk', {
    jobId: event.jobId,
    chunkIndex: event.chunkIndex,
  });

  try {
    // Business logic
    const result = await translateChunk(event);

    logger.info('Chunk translated successfully', {
      jobId: event.jobId,
      chunkIndex: event.chunkIndex,
      duration: result.duration,
    });

    return result;
  } catch (error) {
    logger.error('Chunk translation failed', {
      jobId: event.jobId,
      chunkIndex: event.chunkIndex,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
};
```

---

### 3. S3 Event Lambda (Custom Correlation ID)

```typescript
import { S3Event } from 'aws-lambda';
import { Logger } from './utils/logger';

export const handler = async (event: S3Event): Promise<void> => {
  // Create logger with custom correlation ID (use S3 request ID)
  const correlationId = event.Records[0]?.responseElements?.['x-amz-request-id'] || 'unknown';
  const logger = Logger.withCorrelationId(correlationId);

  logger.info('Processing S3 upload event', {
    bucket: event.Records[0]?.s3.bucket.name,
    key: event.Records[0]?.s3.object.key,
  });

  try {
    // Business logic
    await processUpload(event);

    logger.info('Upload processed successfully');
  } catch (error) {
    logger.error('Upload processing failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    throw error;
  }
};
```

---

## CloudWatch Insights Queries

### Find All Errors by Lambda Function

```sql
fields @timestamp, message, metadata
| filter level = "ERROR"
| sort @timestamp desc
| limit 100
```

### Track Requests by Correlation ID

```sql
fields @timestamp, level, message, metadata
| filter correlationId = "abc123-request-id"
| sort @timestamp asc
```

### Find Slow Requests (Duration > 3s)

```sql
fields @timestamp, correlationId, message, metadata.duration
| filter metadata.duration > 3000
| sort @timestamp desc
| limit 50
```

### Translation Job Failures with Details

```sql
fields @timestamp, correlationId, message, metadata.jobId, metadata.error
| filter level = "ERROR" and message like /translation/
| sort @timestamp desc
| limit 100
```

### Lambda Errors Grouped by Error Message

```sql
fields metadata.error as errorMessage
| filter level = "ERROR"
| stats count() as errorCount by errorMessage
| sort errorCount desc
```

---

## Migration Guide

### Converting Existing Lambdas

**Before** (console.log):
```typescript
export const handler = async (event: any): Promise<any> => {
  console.log('Processing request', JSON.stringify(event));

  try {
    const result = await doSomething();
    console.log('Success:', result);
    return result;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
};
```

**After** (structured logging):
```typescript
import { Logger } from './utils/logger';

export const handler = async (event: any): Promise<any> => {
  const logger = Logger.fromAPIGatewayEvent(event);

  logger.info('Processing request', {
    path: event.path,
    method: event.httpMethod,
  });

  try {
    const result = await doSomething();
    logger.info('Success', { result });
    return result;
  } catch (error) {
    logger.error('Error occurred', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};
```

---

## Best Practices

### 1. Always Include Relevant Context

**Good**:
```typescript
logger.info('User authenticated successfully', {
  userId: user.id,
  email: user.email,
  authMethod: 'cognito',
});
```

**Bad**:
```typescript
logger.info('Success');  // No context
```

### 2. Use Appropriate Log Levels

- **DEBUG**: Verbose diagnostic information (disabled in production)
- **INFO**: Normal operational messages (user logged in, file uploaded)
- **WARN**: Recoverable errors or warnings (rate limit approaching, deprecated API used)
- **ERROR**: Unrecoverable errors that require investigation (API call failed, database error)

### 3. Include Error Details

**Good**:
```typescript
catch (error) {
  logger.error('Failed to translate chunk', {
    jobId: event.jobId,
    chunkIndex: event.chunkIndex,
    error: error instanceof Error ? error.message : 'Unknown error',
    stack: error instanceof Error ? error.stack : undefined,
  });
}
```

**Bad**:
```typescript
catch (error) {
  logger.error('Error');  // No details
}
```

### 4. Return Correlation ID in Response Headers

```typescript
return {
  statusCode: 200,
  headers: {
    'X-Correlation-ID': logger.getCorrelationId(),  // ← Important for frontend logging
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ success: true }),
};
```

This allows frontend to include correlation ID in support tickets:
```
Error occurred. Please contact support with correlation ID: abc123-request-id
```

---

## Frontend Integration (Future Enhancement)

When implementing frontend RUM (Real User Monitoring):

```typescript
// Frontend: Extract correlation ID from response
const response = await fetch('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify(credentials),
});

const correlationId = response.headers.get('X-Correlation-ID');

if (!response.ok) {
  // Show user-friendly error with correlation ID
  alert(`Error occurred. Please contact support with ID: ${correlationId}`);

  // Log to frontend monitoring (CloudWatch RUM)
  cwr('recordError', {
    message: 'Login failed',
    correlationId,
    statusCode: response.status,
  });
}
```

---

## Appendix: Logger API Reference

### Class: `Logger`

#### Static Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `fromAPIGatewayEvent` | `event: APIGatewayProxyEvent` | `Logger` | Create logger from API Gateway event (extracts requestContext.requestId) |
| `fromStepFunctionsEvent` | `executionArn: string` | `Logger` | Create logger from Step Functions execution ARN |
| `withCorrelationId` | `correlationId: string` | `Logger` | Create logger with custom correlation ID |

#### Instance Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| `debug` | `message: string, metadata?: object` | Log DEBUG level message |
| `info` | `message: string, metadata?: object` | Log INFO level message |
| `warn` | `message: string, metadata?: object` | Log WARN level message |
| `error` | `message: string, metadata?: object` | Log ERROR level message |
| `getCorrelationId` | - | Get correlation ID for this logger instance |

---

## FAQs

### Q: Should I migrate all Lambda functions at once?

**A**: No. Migrate incrementally, starting with critical path Lambdas (auth, translation). Older Lambdas can continue using `console.log` until refactored.

### Q: What if I don't have a correlation ID?

**A**: Use `Logger.withCorrelationId('unknown')` as a fallback. The logger will still provide structured logging benefits.

### Q: How do I filter logs by log level in CloudWatch Insights?

**A**: Use `filter level = "ERROR"` in your query.

### Q: Can I use the logger outside of Lambda handlers?

**A**: Yes! The logger works anywhere in Node.js. Just create an instance with `Logger.withCorrelationId()`.

---

## Troubleshooting

### Logs not appearing in CloudWatch

- Verify Lambda execution role has `logs:PutLogEvents` permission
- Check CloudWatch Logs retention settings
- Ensure logger is called before async operations complete

### Correlation ID shows as "unknown"

- For API Gateway: Verify `event.requestContext.requestId` exists
- For Step Functions: Verify `executionArn` is passed correctly
- Use `logger.getCorrelationId()` to debug what correlation ID is being used
