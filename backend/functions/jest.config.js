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
    // Critical path: Authentication - High coverage required (baseline established)
    // TODO: Increase to 100% in follow-up PRs
    './auth/register.ts': {
      branches: 80,    // Current: 80.95% (Target: 100%)
      functions: 100,
      lines: 90,       // Current: 90.9% (Target: 100%)
      statements: 91,  // Current: 91.11% (Target: 100%)
    },
    './auth/login.ts': {
      branches: 60,    // Current: 60% (Target: 100%)
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './auth/refreshToken.ts': {
      branches: 58,    // Current: 58.33% (Target: 100%)
      functions: 100,
      lines: 94,       // Current: 94.28% (Target: 100%)
      statements: 94,  // Current: 94.44% (Target: 100%)
    },
    './auth/resetPassword.ts': {
      branches: 69,    // Current: 69.23% (Target: 100%)
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './auth/getCurrentUser.ts': {
      branches: 80,    // Current: 80% (Target: 100%)
      functions: 100,
      lines: 100,
      statements: 100,
    },
    // Critical path: Translation - High coverage required (baseline established)
    // TODO: Increase to 100% in follow-up PRs
    './translation/translateChunk.ts': {
      branches: 86,    // Current: 86.27% (Target: 100%)
      functions: 100,
      lines: 100,
      statements: 100,
    },
    './translation/geminiClient.ts': {
      branches: 78,    // Current: 78.33% (Target: 100%)
      functions: 100,
      lines: 97,       // Current: 97.97% (Target: 100%)
      statements: 98,  // Current: 98% (Target: 100%)
    },
    './translation/rateLimiter.ts': {
      branches: 80,    // Current: 80% (Target: 100%)
      functions: 100,
      lines: 95,       // Current: 95.31% (Target: 100%)
      statements: 93,  // Current: 93.84% (Target: 100%)
    },
  },
  moduleNameMapper: {
    '^@lfmt/shared-types$': '<rootDir>/../../shared-types/src',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
};
