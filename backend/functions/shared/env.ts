/**
 * Environment Variable Utilities
 * Ensures required environment variables are set and validated
 */

/**
 * Get a required environment variable
 * Throws an error if the variable is not set
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value
 */
export function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Validate that all required environment variables are set
 * Call this at Lambda cold start to fail fast
 */
export function validateEnvironment(requiredVars: string[]): void {
  const missing = requiredVars.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`
    );
  }
}
