/**
 * Structured Logging Utility
 * Provides consistent, queryable logging across all Lambda functions
 */

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Type for additional structured logging fields.
 *
 * `unknown` is intentional — it preserves the flexible "log anything"
 * ergonomics callers rely on (raw error objects, response bodies, IDs, etc.)
 * while forcing the *reader* to narrow before introspecting, so an implicit
 * `any` cannot leak out of the logger and infect downstream code.
 *
 * Follows the `unknown` + narrowing pattern established in PR #127 / PR #149
 * / PR #152 — same shape as the (now-removed) `LogMetadata` type from
 * `utils/logger.ts` before that file was deleted as dead code in PR #152.
 */
export interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

class Logger {
  private serviceName: string;
  private logLevel: LogLevel;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
    this.logLevel = this.getLogLevelFromEnv();
  }

  private getLogLevelFromEnv(): LogLevel {
    const level = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    return LogLevel[level as keyof typeof LogLevel] || LogLevel.INFO;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentLevelIndex = levels.indexOf(this.logLevel);
    const messageLevelIndex = levels.indexOf(level);
    return messageLevelIndex >= currentLevelIndex;
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
      ...context,
    };

    // Use console.error for ERROR/WARN, console.log for others.
    // This ensures errors surface in CloudWatch error metrics. The logger IS
    // the console abstraction — these two calls are the intentional output
    // path for the entire Lambda structured-logging layer.
    if (level === LogLevel.ERROR || level === LogLevel.WARN) {
      // eslint-disable-next-line no-console -- structured logger writes to CloudWatch via console
      console.error(JSON.stringify(logEntry));
    } else {
      // eslint-disable-next-line no-console -- structured logger writes to CloudWatch via console
      console.log(JSON.stringify(logEntry));
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, context);
  }
}

export default Logger;
