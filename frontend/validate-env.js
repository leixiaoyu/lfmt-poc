/**
 * Build-time environment variable validation
 * Ensures required variables are set before building
 *
 * IMPORTANT: This script validates the production build pipeline where environment
 * variables MUST be set in the actual environment (e.g., CI/CD, shell exports).
 *
 * For local development:
 * - Vite automatically loads .env, .env.local, and .env.development files
 * - This script runs BEFORE Vite starts, so it won't see those .env files
 * - If you see validation failures locally, export the variable in your shell:
 *     export VITE_API_URL=https://your-api.example.com
 * - OR pass it inline when building:
 *     VITE_API_URL=https://your-api.example.com npm run build
 *
 * Why this design?
 * - CI/CD pipelines should NOT rely on .env files (security risk)
 * - Explicit environment validation catches deployment misconfigurations early
 * - Local dev still works seamlessly via Vite's .env file loading
 */

// List of required environment variables for the frontend build
// Add new variables here as needed
const REQUIRED_ENV_VARS = ['VITE_API_URL'];

// Skip validation in CI environment (frontend build step happens before deployment)
// CI will rebuild with correct API URL after CDK deployment
if (process.env.CI === 'true') {
  console.log('\x1b[33m%s\x1b[0m', '⚠️  CI environment detected - skipping env validation');
  console.log('\x1b[36m%s\x1b[0m', '   (Frontend will be rebuilt with correct API URL after deployment)');
  process.exit(0);
}

const missing = REQUIRED_ENV_VARS.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('\x1b[31m%s\x1b[0m', '\n❌ Build failed: Missing required environment variables:');
  missing.forEach(key => {
    console.error('\x1b[31m%s\x1b[0m', `   - ${key}`);
  });
  console.error('\n\x1b[33m%s\x1b[0m', 'Please set these variables in your .env file or environment.');
  console.error('\x1b[33m%s\x1b[0m', 'See .env.example for reference.\n');

  // Exit with non-zero code to halt the build pipeline
  // This prevents building with incomplete configuration which would result in runtime errors
  process.exit(1);
}

console.log('\x1b[32m%s\x1b[0m', '✅ Environment variables validated');
console.log('\x1b[36m%s\x1b[0m', `   API_URL: ${process.env.VITE_API_URL}`);
