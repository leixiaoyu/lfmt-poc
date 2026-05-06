module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.test.ts', '!**/node_modules/**', '!**/dist/**'],
  coverageThreshold: {
    global: {
      branches: 35,
      functions: 68,
      lines: 70,
      statements: 70,
    },
  },
  moduleNameMapper: {
    '^@lfmt/shared-types$': '<rootDir>/../../shared-types/src',
    // PR #203 R4: shared-types/src/*.ts now uses explicit `.js` extensions
    // on relative imports (required by the dual-package ESM build's
    // `moduleResolution: bundler` which preserves them verbatim into the
    // ESM output where Node-native ESM relies on them). Jest resolves
    // those imports against the SOURCE (.ts files) via the path mapper
    // above; without this strip, the `.js` suffix would route to
    // non-existent files. Same pattern as shared-types/jest.config.js.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
};
