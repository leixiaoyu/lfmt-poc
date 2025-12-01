/**
 * Unit tests for Gemini Client
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { GeminiClient, createGeminiClient } from '../geminiClient';
import {
  GeminiApiError,
  RateLimitError,
  AuthenticationError,
  TranslationOptions,
} from '../types';

// Mock the Google GenAI SDK
jest.mock('@google/genai', () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: jest.fn(),
      },
    })),
  };
});

const secretsMock = mockClient(SecretsManagerClient);

describe('GeminiClient', () => {
  const mockApiKey = 'AIzaSyTest123ApiKey456';
  const mockConfig = {
    apiKeySecretName: 'test-gemini-api-key',
    model: 'gemini-2.5-flash',
    maxRetries: 3,
    initialRetryDelayMs: 100, // Faster for tests
  };

  beforeEach(() => {
    secretsMock.reset();
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should fetch API key from Secrets Manager on initialization', async () => {
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: mockApiKey,
      } as any);

      const client = new GeminiClient(mockConfig);
      await client.initialize();

      expect(secretsMock.commandCalls(GetSecretValueCommand).length).toBe(1);
      expect(secretsMock.commandCalls(GetSecretValueCommand)[0].args[0].input).toEqual({
        SecretId: mockConfig.apiKeySecretName,
      });
    });

    it('should throw error if Secrets Manager returns empty secret', async () => {
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: '',
      } as any);

      const client = new GeminiClient(mockConfig);

      await expect(client.initialize()).rejects.toThrow(GeminiApiError);
      await expect(client.initialize()).rejects.toThrow('Failed to retrieve API key');
    });

    it('should throw error if Secrets Manager call fails', async () => {
      secretsMock.on(GetSecretValueCommand).rejects(new Error('Access denied'));

      const client = new GeminiClient(mockConfig);

      await expect(client.initialize()).rejects.toThrow(GeminiApiError);
    });

    it('should only initialize once (idempotent)', async () => {
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: mockApiKey,
      } as any);

      const client = new GeminiClient(mockConfig);
      await client.initialize();
      await client.initialize(); // Second call

      expect(secretsMock.commandCalls(GetSecretValueCommand).length).toBe(1);
    });
  });

  describe('translate', () => {
    let client: GeminiClient;
    let mockGenerateContent: jest.Mock;

    beforeEach(async () => {
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: mockApiKey,
      } as any);

      const { GoogleGenAI } = require('@google/genai');
      mockGenerateContent = jest.fn();

      (GoogleGenAI as jest.Mock).mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent,
        },
      }));

      client = new GeminiClient(mockConfig);
      await client.initialize();
    });

    it('should translate text successfully', async () => {
      const mockResponse = {
        text: 'Hola, mundo!',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      const result = await client.translate('Hello, world!', options);

      expect(result.translatedText).toBe('Hola, mundo!');
      expect(result.targetLanguage).toBe('es');
      expect(result.tokensUsed.total).toBe(15);
      expect(result.estimatedCost).toBeGreaterThan(0);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should include context in translation prompt', async () => {
      const mockResponse = {
        text: 'Traducción con contexto',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          totalTokenCount: 120,
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      const context = {
        previousChunks: ['Previous chunk 1', 'Previous chunk 2'],
        contextTokens: 50,
      };

      await client.translate('Current chunk', options, context);

      // Verify the prompt includes context
      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents;

      expect(promptText).toContain('CONTEXT FROM PREVIOUS SECTIONS');
      expect(promptText).toContain('Previous chunk 1');
      expect(promptText).toContain('Previous chunk 2');
    });

    it('should respect tone option in prompt', async () => {
      const mockResponse = {
        text: 'Formal translation',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
        tone: 'formal',
      };

      await client.translate('Text', options);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents;

      expect(promptText).toContain('formal');
    });

    it('should use informal tone in translation prompt', async () => {
      const mockResponse = {
        text: 'Traducción informal',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
        tone: 'informal',
      };

      await client.translate('Text', options);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents;

      expect(promptText).toContain('casual');
    });

    it('should include custom additional instructions in prompt', async () => {
      const mockResponse = {
        text: 'Traducción personalizada',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
        additionalInstructions: 'Preserve all proper nouns and technical terms.',
      };

      await client.translate('Text', options);

      const callArgs = mockGenerateContent.mock.calls[0][0];
      const promptText = callArgs.contents;

      expect(promptText).toContain('Preserve all proper nouns');
    });

    it('should throw error if client not initialized', async () => {
      const uninitializedClient = new GeminiClient(mockConfig);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(
        uninitializedClient.translate('Text', options)
      ).rejects.toThrow('Client not initialized');
    });
  });

  describe('error handling', () => {
    let client: GeminiClient;
    let mockGenerateContent: jest.Mock;

    beforeEach(async () => {
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: mockApiKey,
      } as any);

      const { GoogleGenAI } = require('@google/genai');
      mockGenerateContent = jest.fn();

      (GoogleGenAI as jest.Mock).mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent,
        },
      }));

      client = new GeminiClient(mockConfig);
      await client.initialize();
    });

    it('should throw AuthenticationError on 401', async () => {
      const error = new Error('Invalid API key');
      (error as any).status = 401;

      mockGenerateContent.mockRejectedValue(error);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(client.translate('Text', options)).rejects.toThrow(
        AuthenticationError
      );
    });

    it('should throw RateLimitError on 429', async () => {
      const error = new Error('Rate limit exceeded');
      (error as any).status = 429;

      mockGenerateContent.mockRejectedValue(error);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(client.translate('Text', options)).rejects.toThrow(
        RateLimitError
      );
    });

    it('should throw GeminiApiError on 400', async () => {
      const error = new Error('Invalid request');
      (error as any).status = 400;

      mockGenerateContent.mockRejectedValue(error);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(client.translate('Text', options)).rejects.toThrow(
        GeminiApiError
      );
    });

    it('should handle unknown error status codes (418)', async () => {
      const error = new Error('I am a teapot');
      (error as any).status = 418; // Uncommon status code not handled by specific cases

      mockGenerateContent.mockRejectedValue(error);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(client.translate('Text', options)).rejects.toMatchObject({
        message: expect.stringContaining('Translation failed'),
        errorCode: 'UNKNOWN_ERROR',
        retryable: false,
      });
    });
  });

  describe('retry logic', () => {
    let client: GeminiClient;
    let mockGenerateContent: jest.Mock;

    beforeEach(async () => {
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: mockApiKey,
      } as any);

      const { GoogleGenAI } = require('@google/genai');
      mockGenerateContent = jest.fn();

      (GoogleGenAI as jest.Mock).mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent,
        },
      }));

      client = new GeminiClient(mockConfig);
      await client.initialize();
    });

    it('should retry on 500 error and succeed', async () => {
      const error = new Error('Internal server error');
      (error as any).status = 500;

      const successResponse = {
        text: 'Success after retry',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      // First call fails, second succeeds
      mockGenerateContent
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(successResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      const result = await client.translate('Text', options);

      expect(result.translatedText).toBe('Success after retry');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should retry on 429 error and succeed', async () => {
      const error = new Error('Rate limit');
      (error as any).status = 429;

      const successResponse = {
        text: 'Success after rate limit retry',
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      mockGenerateContent
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(successResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      const result = await client.translate('Text', options);

      expect(result.translatedText).toBe('Success after rate limit retry');
      expect(mockGenerateContent).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries exceeded', async () => {
      const error = new Error('Server error');
      (error as any).status = 500;

      mockGenerateContent.mockRejectedValue(error);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(client.translate('Text', options)).rejects.toThrow(
        GeminiApiError
      );

      // Should have tried: initial + 3 retries = 4 times
      expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    });

    it('should not retry on 401 error', async () => {
      const error = new Error('Unauthorized');
      (error as any).status = 401;

      mockGenerateContent.mockRejectedValue(error);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(client.translate('Text', options)).rejects.toThrow(
        AuthenticationError
      );

      // Should only try once (no retries for auth errors)
      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    });

    it('should throw RateLimitError after exhausting all retries on 429', async () => {
      const error = new Error('Rate limit exceeded');
      (error as any).status = 429;

      // Fail all attempts (initial + 3 retries = 4 total)
      mockGenerateContent.mockRejectedValue(error);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      await expect(client.translate('Text', options)).rejects.toMatchObject({
        message: expect.stringContaining('Rate limit exceeded'),
        retryable: true,
      });

      // Should have tried: initial + 3 retries = 4 times
      expect(mockGenerateContent).toHaveBeenCalledTimes(4);
    });
  });

  describe('createGeminiClient factory', () => {
    it('should create a GeminiClient instance', () => {
      const client = createGeminiClient(mockConfig);

      expect(client).toBeInstanceOf(GeminiClient);
    });
  });

  describe('cost calculation', () => {
    let client: GeminiClient;
    let mockGenerateContent: jest.Mock;

    beforeEach(async () => {
      secretsMock.on(GetSecretValueCommand).resolves({
        SecretString: mockApiKey,
      } as any);

      const { GoogleGenAI } = require('@google/genai');
      mockGenerateContent = jest.fn();

      (GoogleGenAI as jest.Mock).mockImplementation(() => ({
        models: {
          generateContent: mockGenerateContent,
        },
      }));

      client = new GeminiClient(mockConfig);
      await client.initialize();
    });

    it('should calculate cost correctly for translation', async () => {
      const mockResponse = {
        text: 'Translated',
        usageMetadata: {
          promptTokenCount: 10000, // 10K tokens
          candidatesTokenCount: 5000,
          totalTokenCount: 15000,
        },
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const options: TranslationOptions = {
        targetLanguage: 'es',
      };

      const result = await client.translate('Text', options);

      // Cost = (10000 / 1,000,000) * $0.075 = $0.00075
      expect(result.estimatedCost).toBeCloseTo(0.00075, 6);
    });
  });
});
