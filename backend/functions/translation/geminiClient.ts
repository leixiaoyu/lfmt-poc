/**
 * Gemini API Client Wrapper
 * Handles communication with Google Gemini API for translation
 */

import { GoogleGenAI } from '@google/genai';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
  GetSecretValueCommandOutput,
} from '@aws-sdk/client-secrets-manager';
import Logger from '../shared/logger';
import {
  TranslationOptions,
  TranslationResult,
  TranslationContext,
  GeminiApiError,
  RateLimitError,
  AuthenticationError,
  LANGUAGE_NAMES,
} from './types';

const logger = new Logger('lfmt-gemini-client');

/**
 * Configuration for Gemini client
 */
export interface GeminiClientConfig {
  /**
   * AWS Secrets Manager secret name containing API key
   */
  apiKeySecretName: string;

  /**
   * Model to use for translation
   * @default 'gemini-1.5-pro'
   */
  model?: string;

  /**
   * Maximum retries for transient failures
   * @default 3
   */
  maxRetries?: number;

  /**
   * Initial retry delay in milliseconds
   * @default 1000
   */
  initialRetryDelayMs?: number;
}

/**
 * Gemini API Client for translation operations
 */
export class GeminiClient {
  private apiKey: string | null = null;
  private genAI: GoogleGenAI | null = null;
  private secretsClient: SecretsManagerClient;
  private config: Required<GeminiClientConfig>;

  constructor(config: GeminiClientConfig) {
    this.config = {
      apiKeySecretName: config.apiKeySecretName,
      model: config.model || 'gemini-1.5-pro',
      maxRetries: config.maxRetries ?? 3,
      initialRetryDelayMs: config.initialRetryDelayMs ?? 1000,
    };

    this.secretsClient = new SecretsManagerClient({});
    logger.info('GeminiClient initialized', { model: this.config.model });
  }

  /**
   * Initialize the client by fetching API key from Secrets Manager
   */
  async initialize(): Promise<void> {
    if (this.apiKey && this.genAI) {
      logger.debug('Client already initialized');
      return;
    }

    try {
      logger.info('Fetching Gemini API key from Secrets Manager', {
        secretName: this.config.apiKeySecretName,
      });

      const command = new GetSecretValueCommand({
        SecretId: this.config.apiKeySecretName,
      });

      const response: GetSecretValueCommandOutput = await this.secretsClient.send(command);

      if (!response.SecretString) {
        throw new Error('Secret value is empty');
      }

      this.apiKey = response.SecretString ?? null;
      this.genAI = this.apiKey ? new GoogleGenAI({ apiKey: this.apiKey }) : null;

      logger.info('Gemini client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Gemini client', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new GeminiApiError(
        'Failed to retrieve API key from Secrets Manager',
        500,
        'INITIALIZATION_ERROR',
        false
      );
    }
  }

  /**
   * Translate text to target language
   *
   * @param text - Text to translate
   * @param options - Translation options
   * @param context - Optional context from previous chunks
   * @returns Translation result with metadata
   */
  async translate(
    text: string,
    options: TranslationOptions,
    context?: TranslationContext
  ): Promise<TranslationResult> {
    if (!this.genAI) {
      throw new GeminiApiError(
        'Client not initialized. Call initialize() first.',
        500,
        'NOT_INITIALIZED',
        false
      );
    }

    const startTime = Date.now();

    try {
      logger.info('Starting translation', {
        textLength: text.length,
        targetLanguage: options.targetLanguage,
        hasContext: !!context,
        contextChunks: context?.previousChunks.length ?? 0,
      });

      // Build the translation prompt
      const prompt = this.buildTranslationPrompt(text, options, context);

      // Make the API call with retry logic
      const result = await this.makeRequestWithRetry(prompt);

      const processingTimeMs = Date.now() - startTime;

      // Extract translated text from response
      const translatedText = result.response.text();

      // Calculate token usage and cost
      const tokensUsed = {
        input: result.response.usageMetadata?.promptTokenCount ?? 0,
        output: result.response.usageMetadata?.candidatesTokenCount ?? 0,
        total: result.response.usageMetadata?.totalTokenCount ?? 0,
      };

      // Gemini 1.5 Pro pricing: $0.075 per 1M input tokens (free tier)
      const estimatedCost = (tokensUsed.input / 1_000_000) * 0.075;

      logger.info('Translation completed', {
        targetLanguage: options.targetLanguage,
        tokensUsed: tokensUsed.total,
        estimatedCost,
        processingTimeMs,
      });

      return {
        translatedText,
        targetLanguage: options.targetLanguage,
        tokensUsed,
        estimatedCost,
        processingTimeMs,
      };
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      logger.error('Translation failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTimeMs,
      });

      if (error instanceof GeminiApiError) {
        throw error;
      }

      throw this.handleApiError(error);
    }
  }

  /**
   * Build translation prompt with context
   */
  private buildTranslationPrompt(
    text: string,
    options: TranslationOptions,
    context?: TranslationContext
  ): string {
    const targetLanguageName = LANGUAGE_NAMES[options.targetLanguage];
    const tone = options.tone || 'neutral';

    let prompt = `You are a professional translator. Translate the following text to ${targetLanguageName}.\n\n`;

    // Add tone/style instructions
    if (tone === 'formal') {
      prompt += 'Use formal language and professional tone.\n';
    } else if (tone === 'informal') {
      prompt += 'Use casual, conversational language.\n';
    }

    // Add formatting instructions
    if (options.preserveFormatting !== false) {
      prompt += 'Preserve all formatting, line breaks, and structure.\n';
    }

    // Add additional instructions
    if (options.additionalInstructions) {
      prompt += `${options.additionalInstructions}\n`;
    }

    // Add context from previous chunks if available
    if (context && context.previousChunks.length > 0) {
      prompt += '\n---CONTEXT FROM PREVIOUS SECTIONS---\n';
      prompt += context.previousChunks.join('\n\n');
      prompt += '\n---END CONTEXT---\n\n';
      prompt += 'Use the above context to maintain consistency in terminology, style, and narrative flow.\n\n';
    }

    prompt += '---TEXT TO TRANSLATE---\n';
    prompt += text;
    prompt += '\n---END TEXT---\n\n';
    prompt += 'Provide ONLY the translated text without any explanations, notes, or metadata.';

    return prompt;
  }

  /**
   * Make API request with retry logic
   */
  private async makeRequestWithRetry(prompt: string, retryCount = 0): Promise<any> {
    if (!this.genAI) {
      throw new Error('Client not initialized');
    }

    try {
      const result = await this.genAI.models.generateContent({
        model: this.config.model,
        contents: prompt,
      });

      return result;
    } catch (error: any) {
      // Handle rate limit errors
      if (error.status === 429 || error.message?.includes('429')) {
        const retryAfterMs = this.calculateRetryDelay(retryCount);

        if (retryCount < this.config.maxRetries) {
          logger.warn('Rate limit hit, retrying', {
            retryCount: retryCount + 1,
            retryAfterMs,
          });

          await this.sleep(retryAfterMs);
          return this.makeRequestWithRetry(prompt, retryCount + 1);
        }

        throw new RateLimitError(
          'Rate limit exceeded. Please try again later.',
          retryAfterMs
        );
      }

      // Handle transient errors (500, 503)
      if (
        error.status >= 500 &&
        error.status < 600 &&
        retryCount < this.config.maxRetries
      ) {
        const retryDelayMs = this.calculateRetryDelay(retryCount);

        logger.warn('Transient error, retrying', {
          status: error.status,
          retryCount: retryCount + 1,
          retryDelayMs,
        });

        await this.sleep(retryDelayMs);
        return this.makeRequestWithRetry(prompt, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s...
    const baseDelay = this.config.initialRetryDelayMs * Math.pow(2, retryCount);
    // Add jitter (±25%)
    const jitter = baseDelay * 0.25 * (Math.random() - 0.5);
    return Math.floor(baseDelay + jitter);
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Handle and classify API errors
   */
  private handleApiError(error: any): GeminiApiError {
    const status = error.status || error.statusCode;
    const message = error.message || 'Unknown API error';

    // Authentication errors
    if (status === 401 || status === 403) {
      return new AuthenticationError(
        'Invalid or expired API key. Please check your Gemini API credentials.'
      );
    }

    // Rate limit errors
    if (status === 429) {
      return new RateLimitError('Rate limit exceeded. Please try again later.');
    }

    // Bad request errors
    if (status === 400) {
      return new GeminiApiError(
        `Invalid request: ${message}`,
        400,
        'BAD_REQUEST',
        false
      );
    }

    // Server errors (retryable)
    if (status >= 500 && status < 600) {
      return new GeminiApiError(
        `Server error: ${message}`,
        status,
        'SERVER_ERROR',
        true
      );
    }

    // Unknown errors
    return new GeminiApiError(
      `Translation failed: ${message}`,
      status,
      'UNKNOWN_ERROR',
      false
    );
  }
}

/**
 * Create a configured Gemini client instance
 */
export function createGeminiClient(config: GeminiClientConfig): GeminiClient {
  return new GeminiClient(config);
}
