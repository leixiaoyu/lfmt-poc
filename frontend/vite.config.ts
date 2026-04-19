import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), '');

  // Validate required environment variables for production builds
  // Two-stage build process in CI/CD:
  // 1. Initial build (CI=true): Creates temporary artifact without API URL
  //    - Runs early in pipeline for fast feedback on build errors
  //    - Artifact is NOT deployed to production
  // 2. Rebuild (after CDK deploy): Uses actual API URL from CloudFormation outputs
  //    - This is the production-deployed build
  //    - See .github/workflows/deploy.yml lines 197-202
  //
  // Local development builds: VITE_API_URL required (fail fast if missing)
  if (command === 'build' && process.env.CI !== 'true' && !env.VITE_API_URL) {
    throw new Error(
      '❌ Build failed: VITE_API_URL is required for production builds.\n' +
      '   Please set it in your .env file or environment.\n' +
      '   See .env.example for reference.\n\n' +
      '   Note: CI builds skip this validation because they rebuild after deployment.'
    );
  }

  // Warn in CI if rebuilding without API URL (safety check for misconfigured workflow)
  if (command === 'build' && process.env.CI === 'true' && !env.VITE_API_URL) {
    // eslint-disable-next-line no-console -- intentional CI safety warning
    console.warn(
      '⚠️  Warning: Building without VITE_API_URL in CI.\n' +
      '   This is expected for the initial build step.\n' +
      '   The final deployment will rebuild with the correct API URL.'
    );
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@/components': path.resolve(__dirname, './src/components'),
        '@/services': path.resolve(__dirname, './src/services'),
        '@/hooks': path.resolve(__dirname, './src/hooks'),
        '@/contexts': path.resolve(__dirname, './src/contexts'),
        '@/utils': path.resolve(__dirname, './src/utils'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      dangerouslyIgnoreUnhandledErrors: true, // Don't fail on unhandled promise rejections in mocks
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/e2e/**', // Exclude Playwright E2E tests
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html', 'lcov'],
        exclude: [
          'node_modules/',
          'src/setupTests.ts',
          'e2e/**', // Exclude E2E tests from coverage
          'src/main.tsx', // Application entry point
          'src/App.tsx', // Top-level routing component
          'src/theme.ts', // Theme configuration
          '**/*.d.ts', // Type definitions
          '**/index.ts', // Re-export files
          '**/.eslintrc.cjs', // Config files
          '**/playwright.config.ts', // Test config
        ],
        // Tiered coverage thresholds per Production Foundation spec (Phase 2.1).
        //
        // Tiered bucketing rationale (revised per #124 team review):
        // - 100% for security-critical (auth components/services) —
        //   zero-tolerance paths; intentional zero margin.
        // - 95% for Translation UI glob and translationService — strong
        //   bar with 3–5pp safety margin above current actuals (per
        //   reviewer guidance to avoid CI brittleness).
        // - 91% per-file for view components with hard-to-test rAF/scroll
        //   cleanup handlers (e.g., SideBySideViewer — actual ~95.47%,
        //   ~4pp safety margin).
        // - 60-65% for src/utils/api.ts — JWT refresh interceptor is
        //   high-risk auth code, but 9 refresh tests are currently
        //   skipped due to an axios-spy architecture issue (see
        //   api.refresh.test.ts KNOWN ISSUE block). Floor sits 3-5pp
        //   below current actuals so incidental changes don't trip CI.
        //   Ratchet up once the spy blocker is resolved and the skipped
        //   tests are re-enabled (tracked in a GitHub issue referenced
        //   from the test file).
        // - 95% global baseline (statements) — locks in current
        //   high standard, raised from 80% in #124.
        //
        // CI enforces these thresholds via the `test:coverage` step in
        // .github/workflows/ci.yml. Thresholds are dead config without it.
        thresholds: {
          // Critical path: Auth components (authentication is zero-tolerance)
          // 100% coverage is required for all authentication-related code.
          // Please write meaningful tests. If struggling to meet this, consult the team before requesting a reduction.
          'src/components/Auth/**/*.tsx': {
            statements: 100,
            branches: 95,
            functions: 100,
            lines: 100,
          },
          // Translation components glob (complex UI).
          // Actuals: ~98.39%/89.15%/90.32%/98.39%. Floor widened by
          // 3–5pp per team review guidance to prevent CI trips on
          // incidental changes.
          'src/components/Translation/**/*.tsx': {
            statements: 95,
            branches: 80,
            functions: 85,
            lines: 95,
          },
          // Per-file carve-out for SideBySideViewer (from PR #125).
          // Component has hard-to-test rAF/scroll-cleanup handlers.
          // Actuals: 95.47% stmts / 94.44% branches. Floor widened ~4pp
          // below actuals per team review guidance (3–5% safety margin).
          'src/components/Translation/SideBySideViewer.tsx': {
            statements: 91,
            branches: 85,
            functions: 85,
            lines: 91,
          },
          // Critical path: Auth service (business logic is zero-tolerance)
          // 100% coverage is required for all authentication-related code.
          // Please write meaningful tests. If struggling to meet this, consult the team before requesting a reduction.
          'src/services/authService.ts': {
            statements: 100,
            branches: 100,
            functions: 100,
            lines: 100,
          },
          // Critical path: Translation service (business logic).
          // Actuals: 99.25%/95.83%/100%/99.25%. Floor widened by ~4pp
          // per team review guidance (CI fragility concern — former
          // 99/95/100/99 floor had <1pp margin on statements/lines).
          'src/services/translationService.ts': {
            statements: 95,
            branches: 91,
            functions: 95,
            lines: 95,
          },
          // High-risk auth code: JWT refresh interceptor in api.ts.
          // Realistic floor today — 9 refresh-flow tests are skipped due
          // to an axios-spy blocker (spies on global axios don't intercept
          // the per-instance apiClient used inside Promise.race).
          // Tracked in: https://github.com/leixiaoyu/lfmt-poc/issues/132
          // See frontend/src/utils/__tests__/api.refresh.test.ts KNOWN
          // ISSUE block for the remediation plan (migrate to
          // axios-mock-adapter).
          // Current actuals: 66.66%/78.57%/72.72%/66.66%. Floor widened
          // by ~5pp (previously 65/60/70/65) per team review guidance
          // to avoid brittle CI. Ratchet up once issue #132 is resolved
          // and the 9 skipped tests are re-enabled.
          'src/utils/api.ts': {
            statements: 60,
            branches: 55,
            functions: 65,
            lines: 60,
          },
          // General code: 95% statements baseline (raised from 80% to
          // lock in current high standard). Branches/functions floors
          // are intentionally lower to accommodate genuine edge cases
          // in util code while keeping the statement-coverage bar high.
          global: {
            statements: 95,
            branches: 75,
            functions: 80,
            lines: 80,
          },
        },
      },
    },
  };
});
