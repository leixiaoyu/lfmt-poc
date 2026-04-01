import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Load environment variables
  const env = loadEnv(mode, process.cwd(), '');

  // Validate required environment variables for production builds
  // Skip validation in CI during initial build step (will be rebuilt with correct API URL after deployment)
  if (command === 'build' && process.env.CI !== 'true' && !env.VITE_API_URL) {
    throw new Error(
      '❌ Build failed: VITE_API_URL is required for production builds.\n' +
      '   Please set it in your .env file or environment.\n' +
      '   See .env.example for reference.'
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
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/setupTests.ts',
        'e2e/**', // Exclude E2E tests from coverage
      ],
    },
  },
  };
});
