// Workflow Types - From Document 8 (Step Functions Workflow)
import { z } from 'zod';

// Workflow Execution
export interface StartTranslationWorkflowRequest {
  jobId: string;
  documentId: string;
  userId: string;
  targetLanguage: string;
  documentMetadata: {
    filename: string;
    wordCount: number;
    fileSize: number;
    contentHash: string;
  };
  translationOptions: {
    preserveFormatting: boolean;
    qualityLevel: 'STANDARD' | 'PREMIUM';
    customGlossary?: string;
  };
  priority: 'LOW' | 'NORMAL' | 'HIGH';
}

export interface StartWorkflowResponse {
  executionArn: string;
  executionName: string;
  startDate: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
  jobId: string;
}

export interface WorkflowExecutionResponse {
  executionArn: string;
  stateMachineArn: string;
  name: string;
  status: ExecutionStatus;
  startDate: string;
  stopDate?: string;
  input: string;
  output?: string;
  error?: WorkflowError;
  currentState?: string;
  stateHistory: StateHistoryEntry[];
}

export type ExecutionStatus = 
  | 'RUNNING' 
  | 'SUCCEEDED' 
  | 'FAILED' 
  | 'TIMED_OUT' 
  | 'ABORTED';

// Workflow Input/Output
export interface WorkflowInput {
  jobId: string;
  documentId: string;
  userId: string;
  targetLanguage: string;
  documentMetadata: DocumentMetadata;
  translationOptions: TranslationOptions;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  retryCount?: number;
  resumeFromState?: string;
}

export interface DocumentMetadata {
  filename: string;
  wordCount: number;
  fileSize: number;
  contentHash: string;
}

export interface TranslationOptions {
  preserveFormatting: boolean;
  qualityLevel: 'STANDARD' | 'PREMIUM';
  customGlossary?: string;
}

export interface WorkflowOutput {
  jobId: string;
  status: 'COMPLETED' | 'FAILED';
  finalDocumentUrl?: string;
  totalCost: number;
  processingTime: number;
  chunkSummary: {
    totalChunks: number;
    successfulChunks: number;
    failedChunks: number;
  };
  qualityMetrics: {
    averageConfidence: number;
    qualityFlags: string[];
  };
  error?: WorkflowError;
}

// Workflow State Management
export interface StateHistoryEntry {
  timestamp: string;
  stateName: string;
  stateType: string;
  enteredTime: string;
  exitedTime?: string;
  input?: string;
  output?: string;
  error?: WorkflowError;
}

export interface WorkflowError {
  errorCode: string;
  errorMessage: string;
  cause?: string;
  stateName?: string;
  timestamp: string;
  retryable: boolean;
}

// Workflow State Definitions
export interface WorkflowStates {
  ValidateLegalAttestation: ValidationState;
  ChunkDocument: ChunkingState;
  TranslateChunks: TranslationState;
  AssembleDocument: AssemblyState;
  FinalizeJob: FinalizationState;
}

export interface ValidationState {
  type: 'Task';
  resource: string;
  parameters: {
    userId: string;
    documentId: string;
  };
  retry: RetryConfig;
  catch: CatchConfig[];
  next: 'ChunkDocument';
}

export interface ChunkingState {
  type: 'Task';
  resource: string;
  parameters: {
    documentId: string;
    content: string;
    targetLanguage: string;
  };
  retry: RetryConfig;
  catch: CatchConfig[];
  next: 'TranslateChunks';
}

export interface TranslationState {
  type: 'Map';
  itemsPath: '$.chunks';
  maxConcurrency: number;
  iterator: {
    startAt: 'TranslateChunk';
    states: {
      TranslateChunk: {
        type: 'Task';
        resource: string;
        parameters: {
          chunkId: string;
          content: string;
          targetLanguage: string;
        };
        retry: RetryConfig;
        catch: CatchConfig[];
        end: boolean;
      };
    };
  };
  next: 'AssembleDocument';
}

export interface AssemblyState {
  type: 'Task';
  resource: string;
  parameters: {
    jobId: string;
    translatedChunks: any[];
  };
  retry: RetryConfig;
  catch: CatchConfig[];
  next: 'FinalizeJob';
}

export interface FinalizationState {
  type: 'Task';
  resource: string;
  parameters: {
    jobId: string;
    finalDocumentUrl: string;
    costs: any;
  };
  end: boolean;
}

// Retry and Error Handling
export interface RetryConfig {
  errorEquals: string[];
  intervalSeconds: number;
  maxAttempts: number;
  backoffRate: number;
}

export interface CatchConfig {
  errorEquals: string[];
  next: string;
  resultPath?: string;
}

// Workflow Control
export interface StopWorkflowRequest {
  cause?: string;
  error?: string;
}

export interface PauseWorkflowRequest {
  reason: string;
}

export interface ResumeWorkflowRequest {
  resumeFromState?: string;
}

// Workflow Monitoring
export interface WorkflowMetrics {
  executionArn: string;
  duration: number;
  statesExecuted: number;
  statesFailed: number;
  retriesPerformed: number;
  costBreakdown: {
    stepFunctions: number;
    lambda: number;
    other: number;
  };
}

// Validation Schemas
export const startWorkflowRequestSchema = z.object({
  jobId: z.string().uuid(),
  documentId: z.string().uuid(),
  userId: z.string().uuid(),
  targetLanguage: z.enum(['spanish', 'french', 'italian', 'german', 'chinese']),
  documentMetadata: z.object({
    filename: z.string().min(1),
    wordCount: z.number().min(65000).max(400000),
    fileSize: z.number().min(1000),
    contentHash: z.string().min(1)
  }),
  translationOptions: z.object({
    preserveFormatting: z.boolean(),
    qualityLevel: z.enum(['STANDARD', 'PREMIUM']),
    customGlossary: z.string().optional()
  }),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH'])
});