/**
 * Structured Logging Utility
 *
 * Provides standardized JSON logging with correlation IDs for CloudWatch Logs.
 *
 * Key Features:
 * - Correlation ID tracking (from API Gateway requestContext.requestId)
 * - Structured JSON format for CloudWatch Insights queries
 * - Log levels: DEBUG, INFO, WARN, ERROR
 * - Metadata support for additional context
 *
 * Usage:
 * ```typescript
 * import { Logger } from './utils/logger';
 *
 * const logger = Logger.fromAPIGatewayEvent(event);
 * logger.info('User logged in', { userId: '123', email: 'user@example.com' });
 * logger.error('Failed to process request', { error: err.message });
 * ```
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  correlationId: string;
  message: string;
  metadata?: Record<string, any>;
}

export class Logger {
  private correlationId: string;

  constructor(correlationId: string) {
    this.correlationId = correlationId;
  }

  /**
   * Create logger from API Gateway event
   * Extracts correlation ID from event.requestContext.requestId
   */
  static fromAPIGatewayEvent(event: any): Logger {
    const correlationId = event?.requestContext?.requestId || 'unknown';
    return new Logger(correlationId);
  }

  /**
   * Create logger from Step Functions event
   * Uses execution ID as correlation ID
   */
  static fromStepFunctionsEvent(executionArn: string): Logger {
    const correlationId = executionArn.split(':').pop() || 'unknown';
    return new Logger(correlationId);
  }

  /**
   * Create logger with custom correlation ID
   */
  static withCorrelationId(correlationId: string): Logger {
    return new Logger(correlationId);
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, any>): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      correlationId: this.correlationId,
      message,
      ...(metadata && { metadata }),
    };

    // Output as JSON to CloudWatch Logs
    console.log(JSON.stringify(entry));
  }

  debug(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, metadata);
  }

  info(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, metadata);
  }

  warn(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, metadata);
  }

  error(message: string, metadata?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, metadata);
  }

  /**
   * Get correlation ID (useful for adding to response headers)
   */
  getCorrelationId(): string {
    return this.correlationId;
  }
}

/**
 * CloudWatch Insights Query Examples:
 *
 * 1. Find all errors by Lambda function:
 *    fields @timestamp, message, metadata
 *    | filter level = "ERROR"
 *    | sort @timestamp desc
 *
 * 2. Find slow requests (duration > 3s):
 *    fields @timestamp, correlationId, message, metadata.duration
 *    | filter metadata.duration > 3000
 *    | sort @timestamp desc
 *
 * 3. Track requests by correlation ID:
 *    fields @timestamp, level, message, metadata
 *    | filter correlationId = "your-correlation-id-here"
 *    | sort @timestamp asc
 *
 * 4. Translation job failures with details:
 *    fields @timestamp, correlationId, message, metadata.jobId, metadata.error
 *    | filter level = "ERROR" and message like /translation/
 *    | sort @timestamp desc
 */
