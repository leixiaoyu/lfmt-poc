/**
 * Token Counting Utility
 *
 * Provides accurate token counting using GPT tokenizer (compatible with Claude)
 * Used for document chunking to ensure chunks stay within API limits
 */

import { encode } from 'gpt-tokenizer';

/**
 * Count the number of tokens in a text string
 * Uses GPT-4 tokenizer which is compatible with Claude's tokenization
 *
 * @param text - The text to tokenize
 * @returns Number of tokens
 */
export function countTokens(text: string): number {
  if (!text || text.trim().length === 0) {
    return 0;
  }

  try {
    const tokens = encode(text);
    return tokens.length;
  } catch (error) {
    // Fallback to rough estimation if tokenization fails
    // Average of ~4 characters per token for English text
    console.warn('Token encoding failed, using fallback estimation', error);
    return Math.ceil(text.length / 4);
  }
}

/**
 * Estimate tokens for a batch of texts
 * More efficient than calling countTokens multiple times
 *
 * @param texts - Array of text strings
 * @returns Array of token counts corresponding to each text
 */
export function countTokensBatch(texts: string[]): number[] {
  return texts.map(text => countTokens(text));
}

/**
 * Check if text exceeds a token limit
 *
 * @param text - The text to check
 * @param maxTokens - Maximum allowed tokens
 * @returns True if text exceeds limit
 */
export function exceedsTokenLimit(text: string, maxTokens: number): boolean {
  return countTokens(text) > maxTokens;
}

/**
 * Truncate text to fit within a token limit
 * Attempts to truncate at sentence boundaries
 *
 * @param text - The text to truncate
 * @param maxTokens - Maximum allowed tokens
 * @returns Truncated text
 */
export function truncateToTokenLimit(text: string, maxTokens: number): string {
  if (!exceedsTokenLimit(text, maxTokens)) {
    return text;
  }

  // Try to find sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let result = '';
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = countTokens(sentence);
    if (currentTokens + sentenceTokens <= maxTokens) {
      result += sentence;
      currentTokens += sentenceTokens;
    } else {
      break;
    }
  }

  // If no sentences fit, do character-based truncation
  if (result.length === 0 && text.length > 0) {
    // Rough estimate: keep ~4 chars per token
    const estimatedChars = Math.floor(maxTokens * 4);
    result = text.substring(0, estimatedChars);
  }

  return result.trim();
}

/**
 * Split text into sentences
 * Handles common sentence terminators and edge cases
 *
 * @param text - The text to split
 * @returns Array of sentences
 */
export function splitIntoSentences(text: string): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  // Split on sentence terminators while preserving them
  // Handles . ! ? with optional quotes and spaces
  const sentencePattern = /[^.!?]+[.!?]+(?:\s*["'])?/g;
  const sentences = text.match(sentencePattern);

  if (!sentences) {
    // If no clear sentences, return the whole text
    return [text];
  }

  // Clean up and filter empty sentences
  return sentences
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Validate token count is within acceptable range
 *
 * @param tokenCount - The token count to validate
 * @param minTokens - Minimum acceptable tokens
 * @param maxTokens - Maximum acceptable tokens
 * @returns True if valid
 */
export function isValidTokenCount(
  tokenCount: number,
  minTokens: number = 0,
  maxTokens: number = Infinity
): boolean {
  return tokenCount >= minTokens && tokenCount <= maxTokens;
}
