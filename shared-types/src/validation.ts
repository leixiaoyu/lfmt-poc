// Validation Utilities and Schemas
import { z } from 'zod';

// Common validation patterns
export const uuidSchema = z.string().uuid();
export const emailSchema = z.string().email();
export const timestampSchema = z.string().datetime();

// File validation
export const filenamePatter = /^[a-zA-Z0-9._-]+\.txt$/;
export const filenameSchema = z.string().regex(filenamePatter, 'Invalid filename format');

// Language validation
export const supportedLanguages = ['spanish', 'french', 'italian', 'german', 'chinese'] as const;
export const languageSchema = z.enum(supportedLanguages);

// Word count validation for documents
export const wordCountSchema = z.number().min(65000).max(400000);

// File size validation (1KB to 100MB)
export const fileSizeSchema = z.number().min(1000).max(100 * 1024 * 1024);

// Token count validation for chunks
export const tokenCountSchema = z.number().min(3000).max(4000);

// Progress percentage validation
export const progressSchema = z.number().min(0).max(100);

// Cost validation (in USD)
export const costSchema = z.number().min(0).max(1000); // Maximum $1000 per job

// Priority levels
export const prioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH']);

// Quality levels
export const qualityLevelSchema = z.enum(['STANDARD', 'PREMIUM']);

// Status enums
export const jobStatusSchema = z.enum([
  'QUEUED',
  'PROCESSING', 
  'RETRYING',
  'RATE_LIMITED',
  'RECOVERING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'RESUMED'
]);

// Error severity levels
export const errorSeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

// Utility validation functions
export class ValidationUtils {
  static isValidUUID(value: string): boolean {
    return uuidSchema.safeParse(value).success;
  }

  static isValidEmail(email: string): boolean {
    return emailSchema.safeParse(email).success;
  }

  static isValidFilename(filename: string): boolean {
    return filenameSchema.safeParse(filename).success;
  }

  static isValidLanguage(language: string): boolean {
    return languageSchema.safeParse(language).success;
  }

  static isValidWordCount(count: number): boolean {
    return wordCountSchema.safeParse(count).success;
  }

  static isValidFileSize(size: number): boolean {
    return fileSizeSchema.safeParse(size).success;
  }

  static validatePassword(password: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];
    
    if (password.length < 8) {
      errors.push('Password must be at least 8 characters long');
    }
    
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

// Generic validation result type
export interface ValidationResult<T = any> {
  isValid: boolean;
  data?: T;
  errors: string[];
  warnings?: string[];
}

// Validation error class
export class ValidationError extends Error {
  public errors: string[];
  
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }
}