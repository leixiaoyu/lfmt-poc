/**
 * Gemini API Client Wrapper
 * Handles communication with Google Gemini API for translation
 */

import { GoogleGenAI } from '@google/genai';
// FinishReason is intentionally imported as a TYPE-ONLY symbol below (see
// `geminiClient.test.ts` jest.mock at file top — that factory replaces the
// `@google/genai` module wholesale and does NOT re-export the FinishReason
// enum, so `import { FinishReason }` (value-form) would crash any test
// suite that mocks the module). Using `import type` keeps the type
// information at compile time and emits no JS reference at runtime, while
// the constants below use plain string literals (which are exactly the
// FinishReason enum's runtime values per @google/genai/dist/node/node.d.ts).
//
// PR #203 R4: removed a stale `eslint-disable-next-line
// @typescript-eslint/no-unused-vars` directive that suppressed a
// v6-era false positive. `@typescript-eslint v7` correctly recognises
// `import type` consumed as a type annotation (line ~463 below) as
// "used", so the disable is now reported as unused-disable and was
// itself a lint error.
import type { FinishReason } from '@google/genai';
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
   * @default 'gemini-2.5-flash'
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
      model: config.model || 'gemini-2.5-flash',
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

      // Extract translated text from response.
      // result.text is typed string | undefined by the @google/genai SDK.
      // It can be undefined / null / '' when Gemini returns a safety-filtered
      // or empty response (observed: chunk 0 Sherlock job 2026-05-02, after a
      // 54s generation the response body had no text candidate). Treat this
      // as a GeminiApiError so translateChunk returns success:false with a
      // clear message instead of crashing in storeTranslatedChunk with
      // "Cannot read properties of undefined (reading 'length')".
      //
      // OMC-followup R4: branch `retryable` on candidates[0].finishReason.
      // Gemini's GenerateContentResponse exposes a per-candidate finishReason
      // (FinishReason enum from @google/genai). Some reasons are deterministic
      // and MUST NOT be retried (SAFETY / RECITATION / BLOCKLIST / PROHIBITED_CONTENT
      // / SPII / IMAGE_SAFETY / IMAGE_PROHIBITED_CONTENT / IMAGE_RECITATION are all
      // content-policy outcomes; MAX_TOKENS / LANGUAGE / MALFORMED_FUNCTION_CALL /
      // UNEXPECTED_TOOL_CALL / NO_IMAGE are structural mismatches a retry can't
      // fix). OTHER and FINISH_REASON_UNSPECIFIED (or any unknown / undefined
      // value) are treated as transient and retryable so Step Functions can
      // schedule a retry.
      const translatedText = result.text;
      if (translatedText === undefined || translatedText === null || translatedText === '') {
        const finishReason = result.candidates?.[0]?.finishReason;
        const retryable = isFinishReasonRetryable(finishReason);
        throw new GeminiApiError(
          `Gemini returned an empty response (finishReason: ${finishReason ?? 'unknown'}). ` +
            'This may indicate a safety filter, content policy block, or upstream model error.',
          200,
          'EMPTY_RESPONSE',
          retryable
        );
      }

      // Calculate token usage and cost
      const tokensUsed = {
        input: result.usageMetadata?.promptTokenCount ?? 0,
        output: result.usageMetadata?.candidatesTokenCount ?? 0,
        total: result.usageMetadata?.totalTokenCount ?? 0,
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
      prompt +=
        'Use the above context to maintain consistency in terminology, style, and narrative flow.\n\n';
    }

    prompt += '---TEXT TO TRANSLATE---\n';
    prompt += text;
    prompt += '\n---END TEXT---\n\n';
    prompt += 'Provide ONLY the translated text without any explanations, notes, or metadata.';

    return prompt;
  }

  /**
   * Make API request with retry logic
   * Returns any - Gemini API response structure varies
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    } catch (error: unknown) {
      // Error type from the Gemini SDK is not strictly typed, so we narrow
      // by inspecting fields on the unknown value before reading them.
      const status = this.extractErrorStatus(error);
      const message = error instanceof Error ? error.message : String(error);

      // Handle rate limit errors
      if (status === 429 || message.includes('429')) {
        const retryAfterMs = this.calculateRetryDelay(retryCount);

        if (retryCount < this.config.maxRetries) {
          logger.warn('Rate limit hit, retrying', {
            retryCount: retryCount + 1,
            retryAfterMs,
          });

          await this.sleep(retryAfterMs);
          return this.makeRequestWithRetry(prompt, retryCount + 1);
        }

        throw new RateLimitError('Rate limit exceeded. Please try again later.', retryAfterMs);
      }

      // Handle transient errors (500, 503)
      if (
        status !== undefined &&
        status >= 500 &&
        status < 600 &&
        retryCount < this.config.maxRetries
      ) {
        const retryDelayMs = this.calculateRetryDelay(retryCount);

        logger.warn('Transient error, retrying', {
          status,
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
   * Extract numeric HTTP status from an unknown error shape.
   * Gemini SDK errors expose `.status` (or `.statusCode`); narrow safely.
   */
  private extractErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
      return undefined;
    }
    const candidate = error as { status?: unknown; statusCode?: unknown };
    if (typeof candidate.status === 'number') {
      return candidate.status;
    }
    if (typeof candidate.statusCode === 'number') {
      return candidate.statusCode;
    }
    return undefined;
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
   * Error parameter is any - catches all error types from Gemini SDK
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      return new GeminiApiError(`Invalid request: ${message}`, 400, 'BAD_REQUEST', false);
    }

    // Server errors (retryable)
    if (status >= 500 && status < 600) {
      return new GeminiApiError(`Server error: ${message}`, status, 'SERVER_ERROR', true);
    }

    // Unknown errors
    return new GeminiApiError(`Translation failed: ${message}`, status, 'UNKNOWN_ERROR', false);
  }
}

/**
 * OMC-followup R4 — finishReason → retryable mapping.
 *
 * Determines whether an EMPTY_RESPONSE from Gemini should be retried by
 * Step Functions, based on the candidate's finishReason. Deterministic
 * outcomes (content-policy blocks, structural mismatches) are NOT retryable;
 * unknown / OTHER / unspecified are treated as transient.
 *
 * Exported for testability.
 *
 * Mapping rationale:
 *   - SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII,
 *     IMAGE_SAFETY, IMAGE_PROHIBITED_CONTENT, IMAGE_RECITATION
 *       → content-policy block, retry will produce the same outcome
 *   - MAX_TOKENS → chunk too big; retrying with the same input is futile
 *   - LANGUAGE → unsupported language; deterministic
 *   - MALFORMED_FUNCTION_CALL, UNEXPECTED_TOOL_CALL, NO_IMAGE
 *       → structural mismatch with the request; deterministic
 *   - OTHER, IMAGE_OTHER → unspecified upstream issue, likely transient
 *   - FINISH_REASON_UNSPECIFIED, undefined, unknown enum value
 *       → benefit of the doubt — assume transient
 */
// String literals match the FinishReason enum values declared in
// node_modules/@google/genai/dist/node/node.d.ts (e.g. SAFETY = "SAFETY").
// Using literals (instead of importing the enum as a value) avoids runtime
// crashes in test suites that mock the entire @google/genai module — see
// the type-only import note at the top of this file.
const NON_RETRYABLE_FINISH_REASONS: ReadonlySet<string> = new Set<string>([
  'SAFETY',
  'RECITATION',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'SPII',
  'MAX_TOKENS',
  'LANGUAGE',
  'MALFORMED_FUNCTION_CALL',
  'UNEXPECTED_TOOL_CALL',
  'IMAGE_SAFETY',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_RECITATION',
  'NO_IMAGE',
]);

export function isFinishReasonRetryable(
  finishReason: FinishReason | string | undefined | null
): boolean {
  if (finishReason === undefined || finishReason === null || finishReason === '') {
    // Unknown / unspecified → benefit of the doubt → retryable
    return true;
  }
  return !NON_RETRYABLE_FINISH_REASONS.has(finishReason);
}

/**
 * Create a configured Gemini client instance
 */
export function createGeminiClient(config: GeminiClientConfig): GeminiClient {
  return new GeminiClient(config);
}
