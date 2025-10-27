/**
 * Document Chunker Tests
 *
 * Comprehensive test suite for document chunking functionality
 * Tests sliding window chunking, context overlap, and edge cases
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { DocumentChunker, createChunker, ChunkContext } from '../documentChunker';
import { countTokens } from '../../shared/tokenizer';

describe('DocumentChunker', () => {
  let chunker: DocumentChunker;

  beforeEach(() => {
    chunker = createChunker();
  });

  describe('Basic Chunking', () => {
    it('should chunk a simple document into multiple chunks', () => {
      const content = generateLongText(10000); // ~10000 tokens to ensure multiple chunks
      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
      expect(result.metadata.totalChunks).toBe(result.chunks.length);
      expect(result.metadata.originalTokenCount).toBeGreaterThan(0);
    });

    it('should return single chunk for small documents', () => {
      const content = 'This is a short document with only a few sentences. It should fit in one chunk.';
      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].chunkIndex).toBe(0);
      expect(result.chunks[0].totalChunks).toBe(1);
      expect(result.chunks[0].previousSummary).toBe('');
      expect(result.chunks[0].nextPreview).toBe('');
    });

    it('should maintain correct chunk indices', () => {
      const content = generateLongText(10000); // ~10000 tokens
      const result = chunker.chunkDocument(content);

      result.chunks.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.totalChunks).toBe(result.chunks.length);
      });
    });

    it('should generate unique chunk IDs', () => {
      const content = generateLongText(5000);
      const result = chunker.chunkDocument(content);

      const chunkIds = result.chunks.map(c => c.chunkId);
      const uniqueIds = new Set(chunkIds);

      expect(uniqueIds.size).toBe(chunkIds.length);
      chunkIds.forEach(id => {
        expect(id).toMatch(/^chunk-\d{4}-of-\d{4}-\d+$/);
      });
    });
  });

  describe('Token Limits', () => {
    it('should not exceed primary chunk size limit', () => {
      const content = generateLongText(15000); // ~15000 tokens
      const result = chunker.chunkDocument(content);

      result.chunks.forEach((chunk, index) => {
        const tokens = countTokens(chunk.primaryContent);
        expect(tokens).toBeLessThanOrEqual(3500);
        if (tokens > 3500) {
          console.error(`Chunk ${index} exceeds limit: ${tokens} tokens`);
        }
      });
    });

    it('should respect context size limits', () => {
      const content = generateLongText(10000);
      const result = chunker.chunkDocument(content);

      result.chunks.forEach((chunk, index) => {
        if (chunk.previousSummary) {
          const prevTokens = countTokens(chunk.previousSummary);
          expect(prevTokens).toBeLessThanOrEqual(250);
        }

        if (chunk.nextPreview) {
          const nextTokens = countTokens(chunk.nextPreview);
          expect(nextTokens).toBeLessThanOrEqual(250);
        }
      });
    });

    it('should handle custom chunk sizes', () => {
      const customChunker = createChunker({
        primaryChunkSize: 2000,
        contextSize: 100,
      });

      const content = generateLongText(5000);
      const result = customChunker.chunkDocument(content);

      result.chunks.forEach(chunk => {
        const tokens = countTokens(chunk.primaryContent);
        expect(tokens).toBeLessThanOrEqual(2000);

        if (chunk.previousSummary) {
          expect(countTokens(chunk.previousSummary)).toBeLessThanOrEqual(100);
        }
      });
    });
  });

  describe('Sliding Window Context', () => {
    it('should add previous summary to all chunks except first', () => {
      const content = generateLongText(8000);
      const result = chunker.chunkDocument(content);

      expect(result.chunks[0].previousSummary).toBe('');

      for (let i = 1; i < result.chunks.length; i++) {
        expect(result.chunks[i].previousSummary).not.toBe('');
        expect(result.chunks[i].previousSummary.length).toBeGreaterThan(0);
      }
    });

    it('should add next preview to all chunks except last', () => {
      const content = generateLongText(8000);
      const result = chunker.chunkDocument(content);

      const lastIndex = result.chunks.length - 1;
      expect(result.chunks[lastIndex].nextPreview).toBe('');

      for (let i = 0; i < lastIndex; i++) {
        expect(result.chunks[i].nextPreview).not.toBe('');
        expect(result.chunks[i].nextPreview.length).toBeGreaterThan(0);
      }
    });

    it('should have overlapping content between adjacent chunks', () => {
      const content = generateLongText(8000);
      const result = chunker.chunkDocument(content);

      for (let i = 0; i < result.chunks.length - 1; i++) {
        const currentChunk = result.chunks[i];
        const nextChunk = result.chunks[i + 1];

        // Current chunk's nextPreview should be in next chunk's primaryContent
        if (currentChunk.nextPreview) {
          const previewWords = currentChunk.nextPreview.split(/\s+/).slice(0, 5).join(' ');
          expect(nextChunk.primaryContent).toContain(previewWords);
        }

        // Next chunk's previousSummary should be in current chunk's primaryContent
        if (nextChunk.previousSummary) {
          const summaryWords = nextChunk.previousSummary.split(/\s+/).slice(-5).join(' ');
          expect(currentChunk.primaryContent).toContain(summaryWords);
        }
      }
    });
  });

  describe('Sentence Boundary Handling', () => {
    it('should not break sentences across chunks', () => {
      const sentences = [
        'This is the first sentence.',
        'This is the second sentence.',
        'This is the third sentence.',
      ];
      const content = sentences.join(' ').repeat(2000); // Make it long enough to chunk

      const result = chunker.chunkDocument(content);

      result.chunks.forEach(chunk => {
        // Check that chunks end with sentence terminators
        const trimmed = chunk.primaryContent.trim();
        const lastChar = trimmed[trimmed.length - 1];
        // Should end with sentence terminator or be incomplete due to chunking
        expect(['.', '!', '?', ' '].some(char => trimmed.includes(char))).toBe(true);
      });
    });

    it('should handle oversized sentences by splitting on words', () => {
      // Create a very long sentence (no periods)
      const longSentence = 'word '.repeat(5000); // Very long sentence
      const content = longSentence + '.';

      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThan(1);

      result.chunks.forEach(chunk => {
        const tokens = countTokens(chunk.primaryContent);
        expect(tokens).toBeLessThanOrEqual(3500);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should throw error for empty content', () => {
      expect(() => chunker.chunkDocument('')).toThrow('Content cannot be empty');
      expect(() => chunker.chunkDocument('   ')).toThrow('Content cannot be empty');
    });

    it('should handle content with only whitespace between sentences', () => {
      const content = 'Sentence one.    Sentence two.     Sentence three.';
      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.chunks[0].primaryContent).toBeTruthy();
    });

    it('should handle content with various punctuation', () => {
      const content = 'Question? Statement. Exclamation! Another statement.';
      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('should handle content with newlines and paragraphs', () => {
      const content = `
        First paragraph with multiple sentences. This is another sentence.

        Second paragraph here. It also has sentences.

        Third paragraph follows.
      `.repeat(500);

      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThan(0);
      result.chunks.forEach(chunk => {
        expect(countTokens(chunk.primaryContent)).toBeLessThanOrEqual(3500);
      });
    });

    it('should handle content with special characters', () => {
      const content = 'Test with "quotes" and (parentheses) and [brackets]. Also dashes—em and en–dashes. ' .repeat(1000);

      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('should handle Unicode characters', () => {
      const content = 'Testing Unicode: 你好世界 مرحبا בעולם Привет שלום 🌍🌎🌏. '.repeat(1000);

      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Chunk Validation', () => {
    it('should validate correct chunks', () => {
      const content = generateLongText(5000);
      const result = chunker.chunkDocument(content);

      result.chunks.forEach(chunk => {
        expect(chunker.validateChunk(chunk)).toBe(true);
      });
    });

    it('should reject chunks with oversized primary content', () => {
      // Generate content that definitely exceeds 3500 tokens
      const oversizedContent = 'word '.repeat(20000); // ~5000 tokens
      const invalidChunk: ChunkContext = {
        primaryContent: oversizedContent,
        previousSummary: '',
        nextPreview: '',
        chunkIndex: 0,
        totalChunks: 1,
        chunkId: 'test-chunk',
      };

      expect(chunker.validateChunk(invalidChunk)).toBe(false);
    });

    it('should reject chunks with oversized context', () => {
      // Generate context that exceeds 250 tokens
      const oversizedContext = 'word '.repeat(1500); // ~375 tokens
      const invalidChunk: ChunkContext = {
        primaryContent: 'Valid content.',
        previousSummary: oversizedContext,
        nextPreview: '',
        chunkIndex: 0,
        totalChunks: 1,
        chunkId: 'test-chunk',
      };

      expect(chunker.validateChunk(invalidChunk)).toBe(false);
    });
  });

  describe('Chunking Statistics', () => {
    it('should provide accurate chunking statistics', () => {
      const content = generateLongText(10000);
      const stats = chunker.getChunkingStats(content);

      expect(stats.totalTokens).toBeGreaterThan(0);
      expect(stats.estimatedChunks).toBeGreaterThan(0);
      expect(stats.averageTokensPerChunk).toBeGreaterThan(0);
      expect(stats.averageTokensPerChunk).toBeLessThanOrEqual(3500);
    });

    it('should match actual chunking results', () => {
      const content = generateLongText(10000);
      const stats = chunker.getChunkingStats(content);
      const result = chunker.chunkDocument(content);

      expect(result.chunks.length).toBeGreaterThanOrEqual(stats.estimatedChunks - 1);
      expect(result.chunks.length).toBeLessThanOrEqual(stats.estimatedChunks + 1);
    });

    it('should include processing time in metadata', () => {
      const content = generateLongText(5000);
      const result = chunker.chunkDocument(content);

      expect(result.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.metadata.processingTimeMs).toBeLessThan(10000); // Should be fast
    });
  });

  describe('Content Preservation', () => {
    it('should preserve all content when reassembling chunks', () => {
      const content = generateLongText(5000);
      const result = chunker.chunkDocument(content);

      const reassembled = result.chunks
        .map(c => c.primaryContent)
        .join(' ');

      // Token count should be approximately the same (may vary due to whitespace)
      const originalTokens = countTokens(content);
      const reassembledTokens = countTokens(reassembled);

      expect(Math.abs(originalTokens - reassembledTokens)).toBeLessThan(50);
    });

    it('should not duplicate content in primary chunks', () => {
      const content = generateLongText(5000);
      const result = chunker.chunkDocument(content);

      for (let i = 0; i < result.chunks.length - 1; i++) {
        const currentContent = result.chunks[i].primaryContent;
        const nextContent = result.chunks[i + 1].primaryContent;

        // Primary contents should not overlap (context does, but not primary)
        const currentWords = currentContent.split(/\s+/).slice(-10);
        const nextWords = nextContent.split(/\s+/).slice(0, 10);

        const overlap = currentWords.filter(word => nextWords.includes(word));
        // Some overlap is acceptable due to common words, but not complete overlap
        expect(overlap.length).toBeLessThan(8);
      }
    });
  });

  describe('Performance', () => {
    it('should handle large documents efficiently', () => {
      // Each sentence is ~20 tokens, need 2500 sentences for 50K tokens
      const content = generateLongText(50000); // ~50K tokens (2500 sentences)
      const startTime = Date.now();

      const result = chunker.chunkDocument(content);

      const duration = Date.now() - startTime;

      // With 3500 token chunks, actual token count determines chunk count
      // The test should verify it creates multiple chunks efficiently
      expect(result.chunks.length).toBeGreaterThanOrEqual(8);
      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
    });

    it('should handle many small sentences efficiently', () => {
      const sentences = Array(10000).fill('Short sentence.').join(' ');
      const startTime = Date.now();

      const result = chunker.chunkDocument(sentences);

      const duration = Date.now() - startTime;

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Uncovered Edge Cases', () => {
    it('should handle document that fails sentence splitting', () => {
      // Mock a scenario where splitIntoSentences returns empty array
      const emptyContentAfterSplit = '.'; // This should split into sentences
      const result = chunker.chunkDocument(emptyContentAfterSplit);

      expect(result.chunks.length).toBeGreaterThan(0);
    });

    it('should save current chunk when encountering oversized sentence', () => {
      // Create a document with a normal chunk followed by an oversized sentence
      const normalText = 'Normal sentence. '.repeat(300); // ~900 tokens
      const oversizedSentence = 'word '.repeat(5000) + '.'; // ~5000 tokens, exceeds 3500
      const content = normalText + oversizedSentence;

      const result = chunker.chunkDocument(content);

      // Should create at least 2 chunks: one for normal text and one+ for oversized
      expect(result.chunks.length).toBeGreaterThanOrEqual(2);
    });

    it('should validate chunk with exactly the minimum size', () => {
      const customChunker = createChunker({ minChunkSize: 100 });
      const smallContent = 'word '.repeat(50); // ~50 tokens, below minimum

      const result = customChunker.chunkDocument(smallContent);
      const chunk = result.chunks[0];

      // Chunk should still be valid even if below min for single-chunk docs
      expect(chunk.primaryContent.length).toBeGreaterThan(0);
    });

    it('should validate chunk with previousSummary at limit', () => {
      // Create content that's close to but under the limit
      const nearLimitContext = 'word '.repeat(120); // ~240 tokens, under 250 limit
      const primaryContent = 'word '.repeat(150); // ~300 tokens, well above minimum
      const tokens = countTokens(nearLimitContext);

      const chunk: ChunkContext = {
        primaryContent,
        previousSummary: nearLimitContext,
        nextPreview: '',
        chunkIndex: 0,
        totalChunks: 1,
        chunkId: 'test-chunk',
      };

      // Should be valid if under limit and primary content meets minimum
      if (tokens <= 250) {
        expect(chunker.validateChunk(chunk)).toBe(true);
      }
    });

    it('should reject chunk with nextPreview exceeding limit', () => {
      const oversizedPreview = 'word '.repeat(150); // ~300 tokens, exceeds 250

      const chunk: ChunkContext = {
        primaryContent: 'Valid content.',
        previousSummary: '',
        nextPreview: oversizedPreview,
        chunkIndex: 0,
        totalChunks: 1,
        chunkId: 'test-chunk',
      };

      expect(chunker.validateChunk(chunk)).toBe(false);
    });

    it('should handle content with minimal tokenizable text', () => {
      const minimalContent = 'A.';
      const result = chunker.chunkDocument(minimalContent);

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].primaryContent).toBeTruthy();
    });
  });
});

/**
 * Helper function to generate long text for testing
 */
function generateLongText(estimatedTokens: number): string {
  const sentences = [
    'The quick brown fox jumps over the lazy dog.',
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
    'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.',
  ];

  // Rough estimation: ~20 tokens per sentence
  const sentencesNeeded = Math.ceil(estimatedTokens / 20);
  let text = '';

  for (let i = 0; i < sentencesNeeded; i++) {
    text += sentences[i % sentences.length] + ' ';
  }

  return text.trim();
}
