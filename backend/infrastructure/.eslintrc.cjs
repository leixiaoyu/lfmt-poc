/**
 * ESLint config for @lfmt/infrastructure (CDK stack).
 *
 * Added as a boy-scout fix during the #28 ePub/PDF PR — the husky
 * pre-commit hook (.lintstagedrc.json at the repo root) runs
 * `eslint --fix` on every staged `*.ts` file, but `backend/infrastructure/`
 * previously had no config so any commit that touched this package
 * failed with:
 *
 *   ESLint couldn't find a configuration file. … looked for
 *   configuration files in backend/infrastructure/lib and its ancestors.
 *
 * Mirrors the recommended ruleset used by backend/functions/.eslintrc.cjs
 * but without the project-aware type-checked rules (the CDK stack is
 * synchronous + declarative; no async pitfalls to catch). The repo-wide
 * `lint-staged` hook already runs `prettier --write` for formatting.
 */
module.exports = {
  root: true,
  env: { node: true, es2020: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['cdk.out', 'dist', '.eslintrc.cjs', 'node_modules', 'coverage'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-unused-vars': 'off',
    // `warn` rather than `error` because the CDK stack already contains
    // a handful of intentionally-unused local references (e.g.
    // `stepFunctionsRole` kept around for symmetry / future ARN binding,
    // `requestValidator` retained for boy-scout reuse). Hardening this
    // to `error` is a separate cleanup PR — not in scope for #28.
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
    // CDK constructs commonly use `any` for cross-package type bridges
    // (e.g. cast through `as any` to escape package-internal types).
    // Keep at 'warn' so we surface new occurrences without blocking.
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/explicit-function-return-type': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
      },
    },
  ],
};
