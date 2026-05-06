module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  // PR #203 R4: relative imports in src/ now use explicit `.js`
  // extensions (required by the ESM build's `moduleResolution: bundler`
  // setting, which preserves them verbatim into dist/esm/ where Node-
  // native ESM relies on them). Jest resolves modules using its OWN
  // resolver, not TSC's, and would fail to find `./auth.js` because no
  // such file exists on disk — the actual source file is `auth.ts`.
  // This mapping strips the `.js` suffix at resolution time so Jest
  // finds the .ts source. Standard pattern from the ts-jest docs.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
