// Document Processing Types - From Document 4 (Document Chunking Engine)
import { z } from 'zod';

// Document Chunking
export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  index: number;
  content: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
  contextWindow: {
    preceding: string; // 250 tokens from previous chunk
    following: string; // 250 tokens from next chunk
  };
  sentenceBoundaries: {
    startSentence: number;
    endSentence: number;
  };
  metadata: {
    paragraphCount: number;
    hasCodeBlocks: boolean;
    hasSpecialFormatting: boolean;
    estimatedComplexity: 'LOW' | 'MEDIUM' | 'HIGH';
  };
}

export interface ChunkingRequest {
  documentId: string;
  content: string;
  targetLanguage: string;
  chunkSize?: number; // Default: 3500 tokens
  overlapSize?: number; // Default: 250 tokens
}

export interface ChunkingResponse {
  documentId: string;
  totalChunks: number;
  estimatedTokens: number;
  chunks: DocumentChunk[];
  metadata: ChunkingMetadata;
}

export interface ChunkingMetadata {
  documentWordCount: number;
  estimatedTokenCount: number;
  chunkingStrategy: 'SENTENCE_BOUNDARY' | 'PARAGRAPH_BOUNDARY' | 'SLIDING_WINDOW';
  preservedElements: string[]; // Headers, lists, code blocks, etc.
  processingTime: number;
  qualityScore: number; // 0-100 based on coherence metrics
}

// File Upload and Validation
export interface FileMetadata {
  filename: string;
  fileSize: number;
  wordCount: number;
  contentType: string;
  uploadTimestamp: string;
  contentHash: string;
  validationResults: ValidationResult;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    wordCount: number;
    estimatedProcessingTime: number;
    estimatedCost: number;
  };
}

export interface PresignedUrlRequest {
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  fileId: string;
  expiresIn: number;
  requiredHeaders: Record<string, string>;
}

export interface FileValidationRequest {
  fileId: string;
  expectedHash?: string;
}

export interface FileValidationResponse {
  fileId: string;
  isValid: boolean;
  metadata: FileMetadata;
  errors: string[];
}

// Translation Output
export interface TranslationResult {
  jobId: string;
  documentId: string;
  originalFilename: string;
  targetLanguage: string;
  translatedContent: string;
  metadata: TranslationMetadata;
  qualityMetrics: QualityMetrics;
}

export interface TranslationMetadata {
  processingTime: number;
  wordCount: number;
  chunkCount: number;
  totalCost: number;
  translatedAt: string;
}

export interface QualityMetrics {
  completionRate: number; // Percentage of chunks successfully translated
  consistencyScore: number; // Automated coherence assessment
  processingEfficiency: number; // Words processed per minute
  averageConfidence: number; // Average Claude API confidence
  qualityFlags: string[];
}

// Validation Schemas
export const chunkingRequestSchema = z.object({
  documentId: z.string().uuid(),
  content: z.string().min(1000), // Minimum content length
  targetLanguage: z.enum(['spanish', 'french', 'italian', 'german', 'chinese']),
  chunkSize: z.number().min(3000).max(4000).optional(),
  overlapSize: z.number().min(200).max(300).optional()
});

export const fileValidationSchema = z.object({
  filename: z.string().regex(/^[a-zA-Z0-9._-]+\.txt$/, 'Invalid filename format'),
  fileSize: z.number().min(1000).max(100 * 1024 * 1024), // 1KB to 100MB
  contentType: z.literal('text/plain')
});