/**
 * Build-time environment variable validation
 * Ensures required variables are set before building
 */

const requiredVars = ['VITE_API_URL'];

const missing = requiredVars.filter(key => !process.env[key]);

if (missing.length > 0) {
  console.error('\x1b[31m%s\x1b[0m', '\n❌ Build failed: Missing required environment variables:');
  missing.forEach(key => {
    console.error('\x1b[31m%s\x1b[0m', `   - ${key}`);
  });
  console.error('\n\x1b[33m%s\x1b[0m', 'Please set these variables in your .env file or environment.');
  console.error('\x1b[33m%s\x1b[0m', 'See .env.example for reference.\n');
  process.exit(1);
}

console.log('\x1b[32m%s\x1b[0m', '✅ Environment variables validated');
console.log('\x1b[36m%s\x1b[0m', `   API_URL: ${process.env.VITE_API_URL}`);
