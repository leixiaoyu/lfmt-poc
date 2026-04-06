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
      // Apply type-checking rules only to non-test files
      // Note: Strict type-checking will be fully enforced in Phase 1.1 (TypeScript Strict Mode Migration)
      files: ['**/*.ts'],
      excludedFiles: ['**/*.test.ts', '**/__tests__/**'],
      extends: ['plugin:@typescript-eslint/recommended-requiring-type-checking'],
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
