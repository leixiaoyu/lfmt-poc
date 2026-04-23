import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';

/**
 * Layer 2 of the three production-safety layers (per design Decision 5).
 *
 * Throws synchronously inside Vite's `config` hook when the developer
 * attempts a `vite build` with `VITE_MOCK_API=true`. Covers ALL build
 * commands (`npm run build`, `build:dev`, etc.) regardless of `mode`.
 *
 * Layer 1 (UI banner) lives in `MockModeBanner.tsx`. Layer 3
 * (`closeBundle` SW cleanup) is the next plugin below.
 */
function mockApiBuildGuard(): Plugin {
  return {
    name: 'lfmt-mock-api-build-guard',
    apply: 'build',
    config() {
      if (process.env.VITE_MOCK_API === 'true') {
        throw new Error(
          '\n\n' +
            '❌ BUILD BLOCKED: VITE_MOCK_API=true is set during a production build.\n\n' +
            '   The MSW mock layer is dev-only and must NEVER ship to a deployed\n' +
            '   environment. Please unset VITE_MOCK_API (or set it to a value other\n' +
            '   than "true") and re-run the build.\n\n' +
            '   See frontend/LOCAL-TESTING.md for the local mock workflow.\n\n'
        );
      }
      return undefined;
    },
  };
}

/**
 * Layer 3 of the three production-safety layers (per design Decision 5).
 *
 * Even if a developer somehow bypasses Layer 2, the
 * `mockServiceWorker.js` file in `dist/` is the only way the SW can
 * register at runtime. This `closeBundle` hook deletes it after every
 * prod build so the file never reaches CloudFront / S3.
 */
function mockServiceWorkerCleanup(): Plugin {
  return {
    name: 'lfmt-mock-service-worker-cleanup',
    apply: 'build',
    closeBundle() {
      const distSwPath = path.resolve(__dirname, 'dist', 'mockServiceWorker.js');
      if (fs.existsSync(distSwPath)) {
        fs.unlinkSync(distSwPath);
        // eslint-disable-next-line no-console -- intentional build-time notice
        console.log(
          '[lfmt-mock-service-worker-cleanup] Removed dist/mockServiceWorker.js'
        );
      }
    },
  };
}

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
    plugins: [react(), mockApiBuildGuard(), mockServiceWorkerCleanup()],
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
          // MSW handlers — dev-test infrastructure; same rationale as
          // e2e/** (test infra is not "product code" and should not skew
          // global coverage math). Per add-local-mock-api-foundation
          // Decision 8: keeping these in the gate would drop global to
          // ~94.25% and break CI on the same PR that introduces the
          // foundation. Local floor (informational, not gated): 85% on
          // src/mocks/** — see frontend/LOCAL-TESTING.md.
          'src/mocks/**',
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
        // - 93%/84%/85%/93% for src/utils/api.ts — JWT refresh
        //   interceptor is high-risk auth code, now fully covered after
        //   the test suite was rewritten on top of axios-mock-adapter
        //   (the previous axios-spy approach never intercepted instance
        //   calls; all 9 refresh-flow tests had been skipped). Floor sits
        //   ~5pp below current actuals so incidental changes don't trip CI.
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
          // Resolved in PR <resolved-in-pr-this-pr>: refresh-flow tests
          // were rewritten on top of axios-mock-adapter (the prior
          // axios-spy approach never intercepted instance calls). All 9
          // previously-skipped scenarios are now live, plus a token-
          // rotation persistence test.
          // Current actuals: 98.38%/89.58%/90.9%/98.38%. Floor widened
          // ~5pp below actuals per team review guidance (3–5pp safety
          // margin to avoid brittle CI on incidental changes).
          'src/utils/api.ts': {
            statements: 93,
            branches: 84,
            functions: 85,
            lines: 93,
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
