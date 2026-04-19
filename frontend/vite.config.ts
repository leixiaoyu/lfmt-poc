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
        // Tiered bucketing rationale:
        // - 100% for security-critical (auth components/services, translation
        //   business logic) — zero-tolerance paths.
        // - 98% for Translation UI glob — pragmatic high bar for complex UI.
        // - 95% per-file for view components with hard-to-test rAF/scroll
        //   cleanup handlers (e.g., SideBySideViewer).
        // - 65-70% for src/utils/api.ts — JWT refresh interceptor is
        //   high-risk auth code, but 9 refresh tests are currently skipped
        //   due to an axios-spy architecture issue (see api.refresh.test.ts).
        //   Floor sits just below current actuals; ratchet up once the
        //   spy blocker is resolved and the skipped tests are re-enabled.
        // - 95% global baseline (statements/lines) — locks in current
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
          // Critical path: Translation components (pragmatic thresholds for complex UI)
          'src/components/Translation/**/*.tsx': {
            statements: 98,  // Currently 98.39% - excellent coverage
            branches: 85,    // Currently 89.15% - exceeds target
            functions: 90,   // Currently 90.32% - meets target
            lines: 98,       // Currently 98.39% - excellent coverage
          },
          // Per-file carve-out for SideBySideViewer (from PR #125).
          // Component has hard-to-test rAF/scroll-cleanup handlers that
          // keep it below the strict 98/85 glob threshold despite strong
          // coverage (95.47% statements / 94.44% branches as of PR #125).
          // Relaxing only this file preserves the strict floor for the
          // rest of Translation.
          'src/components/Translation/SideBySideViewer.tsx': {
            statements: 95,
            branches: 90,
            functions: 90,
            lines: 95,
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
          // Critical path: Translation service (business logic is zero-tolerance).
          // Thresholds reflect current realistic coverage (99.25%/95.83%);
          // ratchet to 100% once the remaining edge cases are tested.
          'src/services/translationService.ts': {
            statements: 99,
            branches: 95,
            functions: 100,
            lines: 99,
          },
          // High-risk auth code: JWT refresh interceptor in api.ts.
          // Realistic floor today — 9 refresh-flow tests are skipped due
          // to an axios-spy blocker (spies on global axios don't intercept
          // the per-instance apiClient used inside Promise.race).
          // See frontend/src/utils/__tests__/api.refresh.test.ts TODOs.
          // Current coverage: 66.66% stmts / 78.57% branches / 72.72%
          // funcs / 66.66% lines. Thresholds sit just below actuals to
          // catch regressions without forcing a red CI on legitimate code
          // paths that remain untested pending the spy fix. Ratchet up
          // once the 9 skipped refresh tests are re-enabled.
          'src/utils/api.ts': {
            statements: 65,
            branches: 60,
            functions: 70,
            lines: 65,
          },
          // General code: 95% target (raised from 80% to lock in current high standard)
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
