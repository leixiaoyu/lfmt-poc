module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/lib'],
  testMatch: [
    '**/__tests__/**/*.ts',
    '**/?(*.)+(spec|test).ts'
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'lib/**/*.ts',
    '!lib/**/*.d.ts',
    '!lib/__tests__/**/*.ts',
    '!lib/app.ts', // CDK app entry point (boilerplate)
    '!lib/index.ts', // Re-export files
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/cdk.out/',
    '/__tests__/',
    '\\.test\\.ts$',
    '\\.d\\.ts$',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: [
    'text',
    'lcov',
    'html',
    'json'
  ],
  coverageThreshold: {
    // Infrastructure coverage: 40-50% (custom logic only, not CDK framework boilerplate)
    // Focus on custom constructs, IAM policy logic, and environment-specific config
    global: {
      branches: 40,
      functions: 40,
      lines: 40,
      statements: 40
    }
  },
  testTimeout: 30000
};