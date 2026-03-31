/**
 * Build-time environment variable validation
 * Ensures required variables are set before building
 */

// List of required environment variables for the frontend build
// Add new variables here as needed
const REQUIRED_ENV_VARS = ['VITE_API_URL'];

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
