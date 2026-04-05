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
        'src/test-utils.tsx',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'e2e/**', // Exclude E2E tests from coverage
        '**/__tests__/**',
        '**/*.test.tsx',
        '**/*.test.ts',
      ],
      thresholds: {
        // Global baseline for general code
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        // Critical path: Authentication components - 100% coverage required
        'src/components/Auth/LoginForm.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/components/Auth/RegisterForm.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/components/Auth/ForgotPasswordForm.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/components/Auth/ProtectedRoute.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Critical path: Translation components - 100% coverage required
        'src/components/Translation/FileUpload.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/components/Translation/FileUploadForm.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/components/Translation/LegalAttestation.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/components/Translation/TranslationConfig.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        'src/components/Translation/TranslationProgress.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        // Critical path: AuthContext - 100% coverage required
        'src/contexts/AuthContext.tsx': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
  },
  };
});
