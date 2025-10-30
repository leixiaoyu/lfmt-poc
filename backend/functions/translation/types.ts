/**
 * Translation Service Types
 * TypeScript interfaces for Gemini API integration
 */

/**
 * Supported target languages for translation
 */
export type TargetLanguage = 'es' | 'fr' | 'it' | 'de' | 'zh';

/**
 * Translation options for customizing output
 */
export interface TranslationOptions {
  /**
   * Target language code (ISO 639-1)
   */
  targetLanguage: TargetLanguage;

  /**
   * Tone/style for translation (formal, informal, neutral)
   * @default 'neutral'
   */
  tone?: 'formal' | 'informal' | 'neutral';

  /**
   * Whether to preserve formatting (markdown, line breaks, etc.)
   * @default true
   */
  preserveFormatting?: boolean;

  /**
   * Additional context or instructions for the translator
   */
  additionalInstructions?: string;
}

/**
 * Result of a translation request
 */
export interface TranslationResult {
  /**
   * The translated text
   */
  translatedText: string;

  /**
   * Source language detected by the model (if auto-detected)
   */
  detectedSourceLanguage?: string;

  /**
   * Target language used for translation
   */
  targetLanguage: TargetLanguage;

  /**
   * Number of tokens used in the request (input + output)
   */
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };

  /**
   * Estimated cost for this translation request
   */
  estimatedCost: number;

  /**
   * Processing time in milliseconds
   */
  processingTimeMs: number;
}

/**
 * Context for translation (previous chunks)
 */
export interface TranslationContext {
  /**
   * Previous translated chunks to provide context
   */
  previousChunks: string[];

  /**
   * Total tokens in context
   */
  contextTokens: number;
}

/**
 * Error thrown by Gemini API
 */
export class GeminiApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public errorCode?: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'GeminiApiError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends GeminiApiError {
  constructor(
    message: string,
    public retryAfterMs?: number
  ) {
    super(message, 429, 'RATE_LIMIT_EXCEEDED', true);
    this.name = 'RateLimitError';
  }
}

/**
 * Invalid API key error
 */
export class AuthenticationError extends GeminiApiError {
  constructor(message: string) {
    super(message, 401, 'INVALID_API_KEY', false);
    this.name = 'AuthenticationError';
  }
}

/**
 * Language mapping for full language names
 */
export const LANGUAGE_NAMES: Record<TargetLanguage, string> = {
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  de: 'German',
  zh: 'Chinese (Simplified)',
};

/**
 * Validate if a language code is supported
 */
export function isValidTargetLanguage(lang: string): lang is TargetLanguage {
  return ['es', 'fr', 'it', 'de', 'zh'].includes(lang);
}
