// Minimal ESLint config for the security measurement scripts.
//
// Scope: just enough to satisfy the root .lintstagedrc.json "eslint --fix"
// pre-commit hook for *.ts files in this directory. The measurement script
// is NOT part of CI lint (the backend/functions/.eslintrc.cjs is `root: true`
// and only covers backend/functions/). This file exists solely so the
// pre-commit hook does not fail on files in this directory.
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-console': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
