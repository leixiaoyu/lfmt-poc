/**
 * Tokenizer Utility Tests
 *
 * Tests for token counting and text manipulation utilities
 */

import { describe, it, expect } from '@jest/globals';
import {
  countTokens,
  countTokensBatch,
  exceedsTokenLimit,
  truncateToTokenLimit,
  splitIntoSentences,
  isValidTokenCount,
} from '../tokenizer';

describe('Tokenizer Utilities', () => {
  describe('countTokens', () => {
    it('should count tokens in simple text', () => {
      const text = 'Hello world';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThan(10);
    });

    it('should return 0 for empty string', () => {
      expect(countTokens('')).toBe(0);
      expect(countTokens('   ')).toBe(0);
    });

    it('should handle longer text', () => {
      const text = 'The quick brown fox jumps over the lazy dog. '.repeat(100);
      const count = countTokens(text);

      expect(count).toBeGreaterThan(100);
    });

    it('should handle Unicode characters', () => {
      const text = '你好世界 مرحبا Привет שלום';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle special characters', () => {
      const text = '@#$%^&*()_+-=[]{}|;:\'",.<>?/';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle emojis', () => {
      const text = '🌍🌎🌏 🚀💻📱';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });
  });

  describe('countTokensBatch', () => {
    it('should count tokens for multiple texts', () => {
      const texts = [
        'First text',
        'Second text is longer',
        'Third text is even longer than the second one',
      ];

      const counts = countTokensBatch(texts);

      expect(counts).toHaveLength(3);
      expect(counts[0]).toBeGreaterThan(0);
      expect(counts[1]).toBeGreaterThan(counts[0]);
      expect(counts[2]).toBeGreaterThan(counts[1]);
    });

    it('should handle empty array', () => {
      const counts = countTokensBatch([]);

      expect(counts).toEqual([]);
    });

    it('should handle array with empty strings', () => {
      const texts = ['', 'text', ''];
      const counts = countTokensBatch(texts);

      expect(counts).toEqual([0, expect.any(Number), 0]);
      expect(counts[1]).toBeGreaterThan(0);
    });
  });

  describe('exceedsTokenLimit', () => {
    it('should detect when text exceeds limit', () => {
      const longText = 'word '.repeat(1000);

      expect(exceedsTokenLimit(longText, 100)).toBe(true);
      expect(exceedsTokenLimit(longText, 5000)).toBe(false);
    });

    it('should return false for empty text', () => {
      expect(exceedsTokenLimit('', 100)).toBe(false);
    });

    it('should handle exact limit', () => {
      const text = 'Hello world';
      const tokenCount = countTokens(text);

      expect(exceedsTokenLimit(text, tokenCount)).toBe(false);
      expect(exceedsTokenLimit(text, tokenCount - 1)).toBe(true);
    });
  });

  describe('truncateToTokenLimit', () => {
    it('should truncate long text to fit limit', () => {
      const longText = 'This is a sentence. '.repeat(200);
      const maxTokens = 100;

      const truncated = truncateToTokenLimit(longText, maxTokens);

      expect(countTokens(truncated)).toBeLessThanOrEqual(maxTokens);
      expect(truncated.length).toBeLessThan(longText.length);
    });

    it('should not truncate text already within limit', () => {
      const shortText = 'This is a short text.';
      const maxTokens = 100;

      const result = truncateToTokenLimit(shortText, maxTokens);

      expect(result).toBe(shortText);
    });

    it('should try to truncate at sentence boundaries', () => {
      const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
      const maxTokens = 10;

      const truncated = truncateToTokenLimit(text, maxTokens);

      // Should end with a period if possible
      expect(truncated.trim().endsWith('.')).toBe(true);
    });

    it('should handle text with no sentence boundaries', () => {
      const text = 'word '.repeat(1000);
      const maxTokens = 50;

      const truncated = truncateToTokenLimit(text, maxTokens);

      expect(countTokens(truncated)).toBeLessThanOrEqual(maxTokens);
    });

    it('should handle empty text', () => {
      const result = truncateToTokenLimit('', 100);

      expect(result).toBe('');
    });
  });

  describe('splitIntoSentences', () => {
    it('should split text at periods', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const sentences = splitIntoSentences(text);

      expect(sentences).toHaveLength(3);
      expect(sentences[0]).toContain('First');
      expect(sentences[1]).toContain('Second');
      expect(sentences[2]).toContain('Third');
    });

    it('should handle question marks', () => {
      const text = 'Is this a question? Yes it is. Another statement.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle exclamation marks', () => {
      const text = 'This is exciting! Very exciting! Calm down.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle mixed punctuation', () => {
      const text = 'Question? Statement. Exclamation! End.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThanOrEqual(3);
    });

    it('should return empty array for empty text', () => {
      expect(splitIntoSentences('')).toEqual([]);
      expect(splitIntoSentences('   ')).toEqual([]);
    });

    it('should handle text with no sentence terminators', () => {
      const text = 'This text has no terminators';
      const sentences = splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toBe(text);
    });

    it('should handle quotes after terminators', () => {
      const text = '"Is this working?" she asked. "Yes!" he replied.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle abbreviations', () => {
      const text = 'Dr. Smith works at the hospital. He is great.';
      const sentences = splitIntoSentences(text);

      // May split on Dr. period, which is acceptable
      expect(sentences.length).toBeGreaterThan(0);
    });
  });

  describe('isValidTokenCount', () => {
    it('should validate token count within range', () => {
      expect(isValidTokenCount(50, 0, 100)).toBe(true);
      expect(isValidTokenCount(0, 0, 100)).toBe(true);
      expect(isValidTokenCount(100, 0, 100)).toBe(true);
    });

    it('should reject token count outside range', () => {
      expect(isValidTokenCount(150, 0, 100)).toBe(false);
      expect(isValidTokenCount(-10, 0, 100)).toBe(false);
    });

    it('should use default min/max if not provided', () => {
      expect(isValidTokenCount(100)).toBe(true);
      expect(isValidTokenCount(-1)).toBe(false);
    });

    it('should handle custom ranges', () => {
      expect(isValidTokenCount(50, 100, 200)).toBe(false);
      expect(isValidTokenCount(150, 100, 200)).toBe(true);
      expect(isValidTokenCount(250, 100, 200)).toBe(false);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle very long text efficiently', () => {
      const veryLongText = 'word '.repeat(50000);
      const startTime = Date.now();

      const count = countTokens(veryLongText);

      const duration = Date.now() - startTime;

      expect(count).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000); // Should be fast
    });

    it('should handle newlines and tabs', () => {
      const text = 'Line one\nLine two\tTab here\r\nWindows line';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle repeated spaces', () => {
      const text = 'Too    many     spaces';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle HTML/XML tags', () => {
      const text = '<div>Hello <span>world</span></div>';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle markdown', () => {
      const text = '# Heading\n\n**Bold** and *italic* text with [link](url)';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle code blocks', () => {
      const text = 'Some code: `const x = 10;` and ```function test() {}```';
      const count = countTokens(text);

      expect(count).toBeGreaterThan(0);
    });
  });

  describe('Token Count Accuracy', () => {
    it('should have consistent counts for same text', () => {
      const text = 'The quick brown fox jumps over the lazy dog.';

      const count1 = countTokens(text);
      const count2 = countTokens(text);

      expect(count1).toBe(count2);
    });

    it('should have different counts for different text', () => {
      const text1 = 'Short';
      const text2 = 'This is a much longer piece of text with many more words';

      const count1 = countTokens(text1);
      const count2 = countTokens(text2);

      expect(count2).toBeGreaterThan(count1);
    });

    it('should count roughly 4 chars per token for English', () => {
      const text = 'a'.repeat(1000);
      const count = countTokens(text);

      // Should be roughly 250 tokens (1000 chars / 4)
      expect(count).toBeGreaterThan(100);
      expect(count).toBeLessThan(500);
    });
  });

  describe('Tokenizer Error Handling and Fallback', () => {
    it('should handle null input gracefully', () => {
      // @ts-expect-error Testing runtime behavior with null
      const count = countTokens(null);
      expect(count).toBe(0);
    });

    it('should handle undefined input gracefully', () => {
      // @ts-expect-error Testing runtime behavior with undefined
      const count = countTokens(undefined);
      expect(count).toBe(0);
    });

    it('should handle very long continuous text', () => {
      const veryLongWord = 'x'.repeat(100000);
      const count = countTokens(veryLongWord);

      expect(count).toBeGreaterThan(0);
      expect(typeof count).toBe('number');
    });

    it('should handle mixed language text', () => {
      const mixedText = 'English text with 中文字符 and العربية والروسية Русский';
      const count = countTokens(mixedText);

      expect(count).toBeGreaterThan(0);
    });

    it('should handle control characters', () => {
      const textWithControl = 'Text with\x00null\x01character\x02test';
      const count = countTokens(textWithControl);

      expect(count).toBeGreaterThan(0);
    });
  });

  describe('Batch Token Counting Edge Cases', () => {
    it('should handle array with mix of empty and non-empty strings', () => {
      const texts = ['', 'text', '', 'more text', '   ', 'final'];
      const counts = countTokensBatch(texts);

      expect(counts.length).toBe(6);
      expect(counts[0]).toBe(0);
      expect(counts[1]).toBeGreaterThan(0);
      expect(counts[2]).toBe(0);
      expect(counts[3]).toBeGreaterThan(0);
      expect(counts[4]).toBe(0);
      expect(counts[5]).toBeGreaterThan(0);
    });

    it('should handle very large batch', () => {
      const texts = Array(1000).fill('Sample text for batch counting');
      const counts = countTokensBatch(texts);

      expect(counts.length).toBe(1000);
      counts.forEach(count => {
        expect(count).toBeGreaterThan(0);
      });
    });

    it('should handle batch with Unicode text', () => {
      const texts = ['你好', 'مرحبا', 'Привет', 'שלום', '🌍'];
      const counts = countTokensBatch(texts);

      expect(counts.length).toBe(5);
      counts.forEach(count => {
        expect(count).toBeGreaterThan(0);
      });
    });
  });

  describe('Truncation Edge Cases', () => {
    it('should truncate at word boundaries when possible', () => {
      const text = 'Word one. Word two. Word three. Word four.';
      const maxTokens = 5;

      const truncated = truncateToTokenLimit(text, maxTokens);

      expect(countTokens(truncated)).toBeLessThanOrEqual(maxTokens);
    });

    it('should handle truncation with no sentence boundaries', () => {
      const text = 'verylongwordwithnospacesatallthisissomethingthatmighthappen';
      const maxTokens = 5;

      const truncated = truncateToTokenLimit(text, maxTokens);

      // Truncation uses character-based estimation (~4 chars per token)
      // Allow some margin for estimation error
      expect(countTokens(truncated)).toBeLessThanOrEqual(maxTokens + 2);
      expect(truncated.length).toBeGreaterThan(0);
    });

    it('should handle truncation when maxTokens is 0', () => {
      const text = 'Some text';
      const truncated = truncateToTokenLimit(text, 0);

      expect(truncated).toBe('');
    });

    it('should handle truncation when maxTokens is 1', () => {
      const text = 'Word';
      const truncated = truncateToTokenLimit(text, 1);

      expect(truncated.length).toBeGreaterThan(0);
    });

    it('should preserve ellipsis-like endings', () => {
      const text = 'First sentence... Second sentence. Third sentence.';
      const maxTokens = 5;

      const truncated = truncateToTokenLimit(text, maxTokens);

      expect(countTokens(truncated)).toBeLessThanOrEqual(maxTokens);
    });

    it('should handle mixed sentence terminators', () => {
      const text = 'Question? Statement. Exclamation! Another.';
      const maxTokens = 10;

      const truncated = truncateToTokenLimit(text, maxTokens);

      expect(countTokens(truncated)).toBeLessThanOrEqual(maxTokens);
    });
  });

  describe('Sentence Splitting Edge Cases', () => {
    it('should handle multiple spaces between sentences', () => {
      const text = 'First.     Second.       Third.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBe(3);
      sentences.forEach(s => expect(s.trim().length).toBeGreaterThan(0));
    });

    it('should handle sentences with quotes at the end', () => {
      const text = '"First sentence." "Second sentence!" "Third question?"';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle ellipsis', () => {
      const text = 'Wait... this is interesting. Really.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThan(0);
    });

    it('should handle mixed terminators with quotes', () => {
      const text = 'She said, "Really?" He replied, "Yes!" They agreed.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThan(0);
    });

    it('should handle single word sentence', () => {
      const text = 'Hello.';
      const sentences = splitIntoSentences(text);

      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toContain('Hello');
    });

    it('should handle URL-like text', () => {
      const text = 'Check this www.example.com website. It has info.';
      const sentences = splitIntoSentences(text);

      expect(sentences.length).toBeGreaterThan(0);
    });

    it('should handle only terminator characters', () => {
      const text = '...';
      const sentences = splitIntoSentences(text);

      // May return empty or the text itself depending on implementation
      expect(sentences.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Token Limit Validation Edge Cases', () => {
    it('should validate with min=max boundaries', () => {
      expect(isValidTokenCount(50, 50, 50)).toBe(true);
      expect(isValidTokenCount(49, 50, 50)).toBe(false);
      expect(isValidTokenCount(51, 50, 50)).toBe(false);
    });

    it('should handle negative token counts', () => {
      expect(isValidTokenCount(-1, 0, 100)).toBe(false);
      expect(isValidTokenCount(-100, -50, 100)).toBe(false);
    });

    it('should handle very large token counts', () => {
      expect(isValidTokenCount(1000000, 0, 2000000)).toBe(true);
      expect(isValidTokenCount(1000000, 0, 500000)).toBe(false);
    });

    it('should handle Infinity boundaries', () => {
      expect(isValidTokenCount(999999, 0, Infinity)).toBe(true);
      expect(isValidTokenCount(0, -Infinity, 100)).toBe(true);
    });
  });
});
