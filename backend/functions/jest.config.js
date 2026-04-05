module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.test.ts',
    '!**/node_modules/**',
    '!**/dist/**',
    '!**/__tests__/**',
    '!**/types.ts', // Type definitions
    '!**/index.ts', // Re-export files
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/__tests__/',
    '\\.test\\.ts$',
    '\\.d\\.ts$',
  ],
  coverageReporters: ['text', 'json', 'html', 'lcov'],
  coverageThreshold: {
    // Global baseline for general code
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    // Critical path: Authentication - 100% coverage required
    './auth/register.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './auth/login.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './auth/refreshToken.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './auth/resetPassword.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './auth/getCurrentUser.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    // Critical path: Translation - 100% coverage required
    './translation/translateChunk.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './translation/geminiClient.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './translation/rateLimiter.ts': {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  moduleNameMapper: {
    '^@lfmt/shared-types$': '<rootDir>/../../shared-types/src',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
};
