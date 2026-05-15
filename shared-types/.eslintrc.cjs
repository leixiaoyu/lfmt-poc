/**
 * ESLint config for @lfmt/shared-types.
 *
 * Added as a boy-scout fix during the #28 ePub/PDF PR — the husky
 * pre-commit hook (.lintstagedrc.json at the repo root) runs
 * `eslint --fix` on every staged `*.ts` file, but `shared-types/`
 * previously had no config so any commit that touched this package
 * failed with:
 *
 *   ESLint couldn't find a configuration file. … looked for
 *   configuration files in shared-types/src and its ancestors.
 *
 * Kept intentionally minimal: this package emits pure type
 * declarations + a handful of runtime-value constants, so the
 * recommended ruleset is sufficient. No type-checked rules are
 * enabled here because the package has no I/O / no async — the
 * higher-cost project-aware lint step is reserved for backend and
 * frontend where it actually catches bugs.
 */
module.exports = {
  root: true,
  env: { node: true, es2020: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  ignorePatterns: ['dist', '.eslintrc.cjs', 'node_modules', 'coverage', 'scripts'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'prefer-const': 'error',
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
