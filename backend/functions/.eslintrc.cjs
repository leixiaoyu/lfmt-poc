module.exports = {
  root: true,
  env: { node: true, es2020: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules', 'coverage'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    // Error prevention
    'no-console': 'warn',
    'no-unused-vars': 'off', // Use TypeScript version instead
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',

    // TypeScript strict mode rules
    '@typescript-eslint/no-explicit-any': 'warn', // Will be upgraded to error in Phase 1.1 (Strict Mode Migration)
    '@typescript-eslint/explicit-function-return-type': 'off', // Too verbose for Lambda handlers

    // Best practices
    'no-throw-literal': 'error',
    'prefer-promise-reject-errors': 'error',
  },
  overrides: [
    {
      // All test files: relax no-explicit-any only.
      //
      // `no-explicit-any` is turned OFF rather than 'warn' because the CI lint
      // script runs with --max-warnings 0, so 'warn' would block CI just as
      // 'error' would. The trade-off: developers see no editor signal for new
      // `any` introduced in test code. Mitigation: PRs that introduce new `any`
      // in test files should be questioned in review (this comment is the
      // documented reminder). The cast patterns here are genuinely unavoidable:
      //   - aws-sdk-client-mock resolves with raw DynamoDB attribute maps
      //     ({S: '...', N: '...'}) that don't match the SDK return types.
      //   - Partial APIGatewayProxyEvent mocks require `as any` because
      //     supplying every optional field would bloat the test fixtures.
      files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
    {
      // Smoke and integration tests only: also disable no-console.
      //
      // Smoke/integration tests deliberately emit console output (✓/✗ progress
      // lines) so CI logs show which steps passed. These are load-bearing
      // diagnostics, not debug leftovers. Unit tests do NOT get this exemption —
      // they should use the structured Logger or Jest's built-in output instead.
      files: [
        '**/tests/smoke/**/*.ts',
        '**/tests/integration/**/*.ts',
        '**/__tests__/integration/**/*.ts',
      ],
      rules: {
        'no-console': 'off',
      },
    },
    {
      // Apply type-checking rules only to non-test files
      // Note: Strict type-checking will be fully enforced in Phase 1.1 (TypeScript Strict Mode Migration)
      files: ['**/*.ts'],
      excludedFiles: ['**/*.test.ts', '**/__tests__/**'],
      // PR #203 R4: `recommended-requiring-type-checking` was deprecated in
      // @typescript-eslint v6 and removed in v8. The canonical replacement
      // in v7 (which we now pin via ^7.18.0) is `recommended-type-checked`.
      // Same rule set, future-proof name.
      extends: ['plugin:@typescript-eslint/recommended-type-checked'],
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
        '@typescript-eslint/no-misused-promises': 'error',
        // Temporarily disable strict type-checking rules until Phase 1.1
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/no-redundant-type-constituents': 'off',
      },
    },
  ],
};
