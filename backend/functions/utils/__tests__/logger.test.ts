/**
 * Unit tests for Logger utility
 */

import { Logger, LogLevel, LogEntry } from '../logger';

describe('Logger', () => {
  // Mock console.log to capture output
  let consoleLogSpy: jest.SpyInstance;
  let capturedLogs: string[];

  beforeEach(() => {
    capturedLogs = [];
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation((message: string) => {
      capturedLogs.push(message);
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  describe('Logger.withCorrelationId()', () => {
    it('should create a logger with custom correlation ID', () => {
      const logger = Logger.withCorrelationId('test-correlation-id');

      logger.info('Test message');

      expect(capturedLogs).toHaveLength(1);
      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('test-correlation-id');
    });

    it('should support any string as correlation ID', () => {
      const logger = Logger.withCorrelationId('custom-123-abc');

      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('custom-123-abc');
    });
  });

  describe('Logger.fromAPIGatewayEvent()', () => {
    it('should extract correlation ID from API Gateway event', () => {
      const event = {
        requestContext: {
          requestId: 'api-gateway-request-id-12345',
        },
      };

      const logger = Logger.fromAPIGatewayEvent(event);
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('api-gateway-request-id-12345');
    });

    it('should use "unknown" when requestContext is missing', () => {
      const event = {};

      const logger = Logger.fromAPIGatewayEvent(event);
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('unknown');
    });

    it('should use "unknown" when requestId is missing', () => {
      const event = {
        requestContext: {},
      };

      const logger = Logger.fromAPIGatewayEvent(event);
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('unknown');
    });

    it('should handle null event gracefully', () => {
      const logger = Logger.fromAPIGatewayEvent(null);
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('unknown');
    });
  });

  describe('Logger.fromStepFunctionsEvent()', () => {
    it('should extract execution ID from Step Functions execution ARN', () => {
      const executionArn = 'arn:aws:states:us-east-1:123456789012:execution:MyStateMachine:execution-id-xyz';

      const logger = Logger.fromStepFunctionsEvent(executionArn);
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('execution-id-xyz');
    });

    it('should handle short ARN format', () => {
      const executionArn = 'execution:short-id';

      const logger = Logger.fromStepFunctionsEvent(executionArn);
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('short-id');
    });

    it('should use "unknown" for empty execution ARN', () => {
      const logger = Logger.fromStepFunctionsEvent('');
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.correlationId).toBe('unknown');
    });
  });

  describe('logger.info()', () => {
    it('should produce correct LogEntry with INFO level', () => {
      const logger = Logger.withCorrelationId('test-id');
      const testMessage = 'User logged in successfully';

      logger.info(testMessage);

      expect(capturedLogs).toHaveLength(1);
      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);

      expect(logEntry.level).toBe(LogLevel.INFO);
      expect(logEntry.message).toBe(testMessage);
      expect(logEntry.correlationId).toBe('test-id');
      expect(logEntry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(logEntry.metadata).toBeUndefined();
    });

    it('should include metadata when provided', () => {
      const logger = Logger.withCorrelationId('test-id');
      const metadata = { userId: '123', email: 'user@example.com' };

      logger.info('User logged in', metadata);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.metadata).toEqual(metadata);
    });

    it('should handle complex metadata objects', () => {
      const logger = Logger.withCorrelationId('test-id');
      const metadata = {
        user: { id: '123', roles: ['admin', 'user'] },
        request: { path: '/api/login', method: 'POST' },
        duration: 150,
      };

      logger.info('Request completed', metadata);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.metadata).toEqual(metadata);
    });
  });

  describe('logger.warn()', () => {
    it('should produce correct LogEntry with WARN level', () => {
      const logger = Logger.withCorrelationId('test-id');
      const testMessage = 'Rate limit approaching threshold';

      logger.warn(testMessage);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.level).toBe(LogLevel.WARN);
      expect(logEntry.message).toBe(testMessage);
      expect(logEntry.correlationId).toBe('test-id');
    });

    it('should include metadata when provided', () => {
      const logger = Logger.withCorrelationId('test-id');
      const metadata = { currentUsage: 80, limit: 100 };

      logger.warn('High usage detected', metadata);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.metadata).toEqual(metadata);
    });
  });

  describe('logger.error()', () => {
    it('should produce correct LogEntry with ERROR level', () => {
      const logger = Logger.withCorrelationId('test-id');
      const testMessage = 'Failed to process translation request';

      logger.error(testMessage);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.level).toBe(LogLevel.ERROR);
      expect(logEntry.message).toBe(testMessage);
      expect(logEntry.correlationId).toBe('test-id');
    });

    it('should include error metadata', () => {
      const logger = Logger.withCorrelationId('test-id');
      const metadata = {
        error: 'Database connection failed',
        stack: 'Error stack trace here',
        code: 'ECONNREFUSED'
      };

      logger.error('Database error', metadata);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.metadata).toEqual(metadata);
    });
  });

  describe('logger.debug()', () => {
    it('should produce correct LogEntry with DEBUG level', () => {
      const logger = Logger.withCorrelationId('test-id');
      const testMessage = 'Processing chunk 3 of 10';

      logger.debug(testMessage);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.level).toBe(LogLevel.DEBUG);
      expect(logEntry.message).toBe(testMessage);
      expect(logEntry.correlationId).toBe('test-id');
    });

    it('should include debug metadata', () => {
      const logger = Logger.withCorrelationId('test-id');
      const metadata = {
        chunkIndex: 3,
        totalChunks: 10,
        tokensProcessed: 3500
      };

      logger.debug('Chunk processing progress', metadata);

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry.metadata).toEqual(metadata);
    });
  });

  describe('logger.getCorrelationId()', () => {
    it('should return the correlation ID', () => {
      const logger = Logger.withCorrelationId('test-correlation-id');

      expect(logger.getCorrelationId()).toBe('test-correlation-id');
    });

    it('should return correlation ID from API Gateway event', () => {
      const event = {
        requestContext: {
          requestId: 'api-gateway-id',
        },
      };

      const logger = Logger.fromAPIGatewayEvent(event);
      expect(logger.getCorrelationId()).toBe('api-gateway-id');
    });

    it('should return correlation ID from Step Functions event', () => {
      const executionArn = 'arn:aws:states:us-east-1:123456789012:execution:MyStateMachine:exec-id';
      const logger = Logger.fromStepFunctionsEvent(executionArn);

      expect(logger.getCorrelationId()).toBe('exec-id');
    });
  });

  describe('log entry format', () => {
    it('should produce valid JSON for all log levels', () => {
      const logger = Logger.withCorrelationId('test-id');

      logger.debug('Debug message');
      logger.info('Info message');
      logger.warn('Warn message');
      logger.error('Error message');

      expect(capturedLogs).toHaveLength(4);

      capturedLogs.forEach((log) => {
        expect(() => JSON.parse(log)).not.toThrow();
        const entry: LogEntry = JSON.parse(log);
        expect(entry).toHaveProperty('timestamp');
        expect(entry).toHaveProperty('level');
        expect(entry).toHaveProperty('correlationId');
        expect(entry).toHaveProperty('message');
      });
    });

    it('should have ISO 8601 timestamp format', () => {
      const logger = Logger.withCorrelationId('test-id');
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      const timestamp = new Date(logEntry.timestamp);

      expect(timestamp.toISOString()).toBe(logEntry.timestamp);
      expect(isNaN(timestamp.getTime())).toBe(false);
    });

    it('should omit metadata field when not provided', () => {
      const logger = Logger.withCorrelationId('test-id');
      logger.info('Test message');

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry).not.toHaveProperty('metadata');
    });

    it('should include metadata field when provided', () => {
      const logger = Logger.withCorrelationId('test-id');
      logger.info('Test message', { key: 'value' });

      const logEntry: LogEntry = JSON.parse(capturedLogs[0]);
      expect(logEntry).toHaveProperty('metadata');
      expect(logEntry.metadata).toEqual({ key: 'value' });
    });
  });

  describe('multiple log calls', () => {
    it('should maintain correlation ID across multiple log calls', () => {
      const logger = Logger.withCorrelationId('persistent-id');

      logger.info('First log');
      logger.warn('Second log');
      logger.error('Third log');

      expect(capturedLogs).toHaveLength(3);

      const entries = capturedLogs.map((log) => JSON.parse(log) as LogEntry);
      entries.forEach((entry) => {
        expect(entry.correlationId).toBe('persistent-id');
      });
    });

    it('should produce separate log entries for each call', () => {
      const logger = Logger.withCorrelationId('test-id');

      logger.info('Message 1', { step: 1 });
      logger.info('Message 2', { step: 2 });
      logger.info('Message 3', { step: 3 });

      expect(capturedLogs).toHaveLength(3);

      const entry1: LogEntry = JSON.parse(capturedLogs[0]);
      const entry2: LogEntry = JSON.parse(capturedLogs[1]);
      const entry3: LogEntry = JSON.parse(capturedLogs[2]);

      expect(entry1.message).toBe('Message 1');
      expect(entry2.message).toBe('Message 2');
      expect(entry3.message).toBe('Message 3');

      expect(entry1.metadata).toEqual({ step: 1 });
      expect(entry2.metadata).toEqual({ step: 2 });
      expect(entry3.metadata).toEqual({ step: 3 });
    });
  });
});
