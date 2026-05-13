module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['**/*.ts', '!**/*.test.ts', '!**/node_modules/**', '!**/dist/**'],
  // Issue #153: thresholds raised to approach the documented >90% target.
  // Previous floors (35/68/70/70) allowed silent coverage regression far
  // below the CLAUDE.md / DEVELOPMENT-ROADMAP.md claims of >90% on critical
  // paths. Actual measured coverage as of this change (f16303b):
  //   branches: 75%, functions: 79%, lines: 86%, statements: 88%
  //
  // Strategy: Approach 3 (tiered) — a global floor meaningfully above the old
  // floors and comfortably achievable with the current test suite, with headroom
  // for a few new untested code paths to land without immediately blocking CI.
  // Branches are lower than lines/statements because defensive error paths in
  // Lambda handlers are hard to reach in unit tests (they require AWS SDK mocking
  // of failure modes). Raise incrementally as test coverage improves.
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 75,
      lines: 82,
      statements: 84,
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
