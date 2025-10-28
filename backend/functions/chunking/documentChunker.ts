/**
 * Document Chunking Service
 *
 * Implements sliding window chunking strategy for long-form documents
 * Chunks are 3,500 tokens with 250-token context overlap
 * Based on Technical Architecture Design v2.0
 */

import {
  countTokens,
  splitIntoSentences,
  isValidTokenCount,
} from '../shared/tokenizer';

export interface ChunkContext {
  primaryContent: string; // 3,500 tokens max
  previousSummary: string; // 250 tokens context from previous chunk
  nextPreview: string; // 250 tokens preview of next chunk
  chunkIndex: number; // 0-based index
  totalChunks: number; // Total number of chunks (set after all chunks created)
  chunkId: string; // Unique identifier for this chunk
}

export interface ChunkingResult {
  chunks: ChunkContext[];
  metadata: {
    originalTokenCount: number;
    totalChunks: number;
    averageChunkSize: number;
    processingTimeMs: number;
  };
}

export interface ChunkingOptions {
  primaryChunkSize?: number; // Default: 3500
  contextSize?: number; // Default: 250
  minChunkSize?: number; // Default: 100 (minimum tokens to create a chunk)
}

export class DocumentChunker {
  private readonly PRIMARY_CHUNK_SIZE: number;
  private readonly CONTEXT_SIZE: number;
  private readonly MIN_CHUNK_SIZE: number;

  constructor(options: ChunkingOptions = {}) {
    this.PRIMARY_CHUNK_SIZE = options.primaryChunkSize || 3500;
    this.CONTEXT_SIZE = options.contextSize || 250;
    this.MIN_CHUNK_SIZE = options.minChunkSize || 100;
  }

  /**
   * Chunk a document into processable pieces with sliding window context
   *
   * @param content - The full document text
   * @returns ChunkingResult with chunks and metadata
   */
  public chunkDocument(content: string): ChunkingResult {
    const startTime = Date.now();

    // Validate input
    if (!content || content.trim().length === 0) {
      throw new Error('Content cannot be empty');
    }

    const originalTokenCount = countTokens(content);

    // If content is small enough, return as single chunk
    if (originalTokenCount <= this.PRIMARY_CHUNK_SIZE) {
      const singleChunk: ChunkContext = {
        primaryContent: content.trim(),
        previousSummary: '',
        nextPreview: '',
        chunkIndex: 0,
        totalChunks: 1,
        chunkId: this.generateChunkId(0, 1),
      };

      return {
        chunks: [singleChunk],
        metadata: {
          originalTokenCount,
          totalChunks: 1,
          averageChunkSize: originalTokenCount,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }

    // Split into sentences for better chunk boundaries
    const sentences = splitIntoSentences(content);

    if (sentences.length === 0) {
      throw new Error('Failed to split document into sentences');
    }

    // Create chunks
    const rawChunks = this.createPrimaryChunks(sentences);

    // Add sliding window context
    const chunksWithContext = this.addSlidingWindowContext(rawChunks);

    // Calculate metadata
    const totalTokens = chunksWithContext.reduce(
      (sum, chunk) => sum + countTokens(chunk.primaryContent),
      0
    );
    const averageChunkSize = Math.round(totalTokens / chunksWithContext.length);

    return {
      chunks: chunksWithContext,
      metadata: {
        originalTokenCount,
        totalChunks: chunksWithContext.length,
        averageChunkSize,
        processingTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Create primary chunks from sentences
   * Ensures chunks don't exceed PRIMARY_CHUNK_SIZE and don't split sentences
   */
  private createPrimaryChunks(sentences: string[]): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = countTokens(sentence);

      // If single sentence exceeds chunk size, we need to split it
      if (sentenceTokens > this.PRIMARY_CHUNK_SIZE) {
        // Save current chunk if it has content
        if (currentChunk.trim().length > 0) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
          currentTokens = 0;
        }

        // Split the oversized sentence by words
        const splitSentence = this.splitOversizedSentence(
          sentence,
          this.PRIMARY_CHUNK_SIZE
        );
        chunks.push(...splitSentence);
        continue;
      }

      // Check if adding this sentence would exceed the limit
      if (currentTokens + sentenceTokens > this.PRIMARY_CHUNK_SIZE && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
        currentTokens = sentenceTokens;
      } else {
        currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentence;
        currentTokens += sentenceTokens;
      }
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Split an oversized sentence into smaller chunks
   * Used when a single sentence exceeds the chunk size limit
   */
  private splitOversizedSentence(sentence: string, maxTokens: number): string[] {
    const words = sentence.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk = '';
    let currentTokens = 0;

    for (const word of words) {
      const wordTokens = countTokens(word + ' ');

      if (currentTokens + wordTokens > maxTokens && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = word;
        currentTokens = wordTokens;
      } else {
        currentChunk += (currentChunk.length > 0 ? ' ' : '') + word;
        currentTokens += wordTokens;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Add sliding window context to chunks
   * Adds previousSummary and nextPreview for better translation continuity
   */
  private addSlidingWindowContext(rawChunks: string[]): ChunkContext[] {
    const totalChunks = rawChunks.length;

    return rawChunks.map((content, index) => {
      // Previous context: last CONTEXT_SIZE tokens from previous chunk
      const previousSummary =
        index > 0
          ? this.extractContextFromChunk(rawChunks[index - 1], 'end', this.CONTEXT_SIZE)
          : '';

      // Next preview: first CONTEXT_SIZE tokens from next chunk
      const nextPreview =
        index < totalChunks - 1
          ? this.extractContextFromChunk(rawChunks[index + 1], 'start', this.CONTEXT_SIZE)
          : '';

      return {
        primaryContent: content,
        previousSummary,
        nextPreview,
        chunkIndex: index,
        totalChunks,
        chunkId: this.generateChunkId(index, totalChunks),
      };
    });
  }

  /**
   * Extract context from a chunk (either from start or end)
   * Tries to extract at sentence boundaries when possible
   */
  private extractContextFromChunk(
    chunk: string,
    position: 'start' | 'end',
    tokenLimit: number
  ): string {
    const sentences = splitIntoSentences(chunk);

    if (position === 'end') {
      // Extract from the end
      const reversed = [...sentences].reverse();
      let context = '';
      let tokens = 0;

      for (const sentence of reversed) {
        const sentenceTokens = countTokens(sentence);
        if (tokens + sentenceTokens <= tokenLimit) {
          context = sentence + ' ' + context;
          tokens += sentenceTokens;
        } else {
          break;
        }
      }

      return context.trim();
    } else {
      // Extract from the start
      let context = '';
      let tokens = 0;

      for (const sentence of sentences) {
        const sentenceTokens = countTokens(sentence);
        if (tokens + sentenceTokens <= tokenLimit) {
          context += sentence + ' ';
          tokens += sentenceTokens;
        } else {
          break;
        }
      }

      return context.trim();
    }
  }

  /**
   * Generate a unique chunk identifier
   */
  private generateChunkId(index: number, total: number): string {
    const timestamp = Date.now();
    const paddedIndex = String(index).padStart(4, '0');
    const paddedTotal = String(total).padStart(4, '0');
    return `chunk-${paddedIndex}-of-${paddedTotal}-${timestamp}`;
  }

  /**
   * Validate a chunk meets minimum requirements
   */
  public validateChunk(chunk: ChunkContext): boolean {
    const contentTokens = countTokens(chunk.primaryContent);

    if (contentTokens < this.MIN_CHUNK_SIZE) {
      return false;
    }

    if (contentTokens > this.PRIMARY_CHUNK_SIZE) {
      return false;
    }

    if (chunk.previousSummary && countTokens(chunk.previousSummary) > this.CONTEXT_SIZE) {
      return false;
    }

    if (chunk.nextPreview && countTokens(chunk.nextPreview) > this.CONTEXT_SIZE) {
      return false;
    }

    return true;
  }

  /**
   * Get chunking statistics for a document
   * Useful for cost estimation and progress tracking
   */
  public getChunkingStats(content: string): {
    estimatedChunks: number;
    totalTokens: number;
    averageTokensPerChunk: number;
  } {
    const totalTokens = countTokens(content);
    const estimatedChunks = Math.ceil(totalTokens / this.PRIMARY_CHUNK_SIZE);
    const averageTokensPerChunk =
      estimatedChunks > 0 ? Math.round(totalTokens / estimatedChunks) : 0;

    return {
      estimatedChunks,
      totalTokens,
      averageTokensPerChunk,
    };
  }
}

/**
 * Create a default document chunker instance
 */
export function createChunker(options?: ChunkingOptions): DocumentChunker {
  return new DocumentChunker(options);
}
