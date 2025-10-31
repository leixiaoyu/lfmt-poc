# Integration Tests for LFMT Translation Service

This directory contains comprehensive integration tests that verify the end-to-end functionality of the LFMT translation service against deployed AWS infrastructure.

## Table of Contents

- [Overview](#overview)
- [Test Suites](#test-suites)
- [Prerequisites](#prerequisites)
- [Running Tests](#running-tests)
- [Test Configuration](#test-configuration)
- [CI/CD Integration](#cicd-integration)
- [Writing New Tests](#writing-new-tests)
- [Troubleshooting](#troubleshooting)

## Overview

Integration tests validate the complete workflow from user authentication through document translation completion. Unlike unit tests that use mocks, integration tests call actual deployed AWS services including:

- API Gateway endpoints
- Lambda functions
- Cognito user pools
- S3 buckets
- DynamoDB tables
- Gemini API (via translation Lambda)

### Test Philosophy

- **Real Services**: Tests interact with actual deployed infrastructure
- **End-to-End**: Validate complete workflows, not just individual endpoints
- **Isolated**: Each test creates its own test data and cleans up afterward
- **Fast Feedback**: Health checks complete in seconds, full translations in minutes
- **CI/CD Friendly**: Designed to run automatically after deployments

## Test Suites

### 1. Health Check Tests (`health-check.integration.test.ts`)

**Purpose**: Verify API availability, performance, and infrastructure health

**Coverage**:
- Authentication endpoints availability
- Jobs and translation endpoints availability
- Response time benchmarks
- CORS configuration
- API Gateway health
- Lambda function responsiveness
- Concurrent request handling
- Error response format consistency

**Duration**: ~30-60 seconds

**Run Command**:
```bash
npm run test:integration -- health-check.integration.test.ts
```

**Example Output**:
```
=== API Health Report ===
Total Endpoints: 9
Healthy: 9
Unhealthy: 0
Avg Response Time: 234ms
Max Response Time: 890ms

By Category:
  Auth: 5/5 healthy
  Jobs: 2/2 healthy
  Translation: 2/2 healthy
```

### 2. API Integration Tests (`api-integration.test.ts`)

**Purpose**: Validate API contracts, response formats, and error handling

**Coverage**:
- User registration validation
- Login authentication
- Token refresh mechanism
- Password reset flow
- CORS headers
- Response format consistency
- Error message structure

**Duration**: ~1-2 minutes

**Run Command**:
```bash
npm run test:integration -- api-integration.test.ts
```

### 3. Authentication Tests (`auth.integration.test.ts`)

**Purpose**: Test complete authentication workflows

**Coverage**:
- User registration with validation
- Login with correct/incorrect credentials
- Password requirements enforcement
- Duplicate email handling
- Token management
- Performance benchmarks

**Duration**: ~1-2 minutes

**Run Command**:
```bash
npm run test:integration -- auth.integration.test.ts
```

### 4. Translation Flow Tests (`translation-flow.integration.test.ts`)

**Purpose**: Verify end-to-end translation workflows

**Coverage**:
- Complete workflow: register → upload → chunk → translate → complete
- Translation progress tracking with polling
- Multiple target languages (es, fr, de, it, zh)
- Translation tone options (formal, informal, neutral)
- Error handling (unauthorized, not found, invalid language)
- Performance benchmarks
- Cost estimation tracking

**Duration**: ~5-15 minutes (depending on document size)

**Run Command**:
```bash
npm run test:integration -- translation-flow.integration.test.ts --testTimeout=600000
```

**Example Output**:
```
✓ Complete workflow: register, upload, chunk, translate (145234ms)
  Step 1: Authenticating...
  Step 2: Uploading document...
  Job ID: job-abc123
  Step 3: Waiting for chunking...
  Chunking complete!
  Step 4: Starting translation...
  Translation started!
  Step 5: Checking translation status...
  Step 6: Waiting for translation to complete...
  Translation workflow completed successfully!
  Total chunks: 5
  Tokens used: 12500
  Estimated cost: $0.000938
```

## Prerequisites

### 1. Deployed Infrastructure

Integration tests require a deployed AWS environment:

```bash
# Deploy to dev environment
cd backend/infrastructure
npx cdk deploy --context environment=dev
```

### 2. Environment Configuration

The tests automatically use the dev API endpoint, but you can override:

```bash
export API_BASE_URL=https://your-api-gateway-id.execute-api.us-east-1.amazonaws.com/v1
```

### 3. Dependencies

Install all required dependencies:

```bash
cd backend/functions
npm install
```

### 4. AWS Services

Verify these services are running:
- API Gateway with CORS configured
- Cognito User Pool
- S3 buckets (documents and chunks)
- DynamoDB tables (jobs)
- Lambda functions (all endpoints)
- Secrets Manager (Gemini API key)

## Running Tests

### Run All Integration Tests

```bash
npm run test:integration
```

### Run Specific Test Suite

```bash
# Health checks only
npm run test:integration -- health-check.integration.test.ts

# Translation flow only
npm run test:integration -- translation-flow.integration.test.ts

# Auth tests only
npm run test:integration -- auth.integration.test.ts
```

### Run with Custom Timeout

```bash
npm run test:integration -- translation-flow.integration.test.ts --testTimeout=600000
```

### Run in Watch Mode

```bash
npm run test:integration -- --watch health-check.integration.test.ts
```

### Run with Detailed Output

```bash
npm run test:integration -- --verbose translation-flow.integration.test.ts
```

## Test Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `API_BASE_URL` | Base URL for API Gateway | `https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1` |
| `TEST_TIMEOUT` | Global test timeout in ms | `300000` (5 minutes) |
| `TEST_EMAIL_DOMAIN` | Domain for test emails | `@integration-test.com` |

### Test Data

Test documents are provided in `fixtures/test-documents.ts`:

- **MINIMAL** (~200 words): Fast tests, 1 chunk, ~30-60 seconds
- **SMALL** (~500 words): Standard tests, 2-3 chunks, ~1-2 minutes
- **MEDIUM** (~1500 words): Realistic tests, 5-7 chunks, ~3-5 minutes
- **LARGE** (~3000 words): Stress tests, 10+ chunks, ~8-12 minutes

Example usage:
```typescript
import { getTestDocument, DOCUMENT_METADATA } from './fixtures/test-documents';

const content = getTestDocument('SMALL');
console.log(DOCUMENT_METADATA.SMALL.estimatedChunks); // 2-3
```

### Test Helpers

Reusable utilities are in `helpers/test-helpers.ts`:

```typescript
import {
  registerAndLogin,
  uploadDocument,
  waitForChunking,
  startTranslation,
  waitForTranslation,
  completeTranslationWorkflow,
  TestContext,
} from './helpers/test-helpers';

// Simple workflow
const tokens = await registerAndLogin();
const jobId = await uploadDocument(tokens.accessToken, content, 'test.txt');
await waitForChunking(tokens.accessToken, jobId);

// Complete workflow with one call
const { jobId, translationStatus } = await completeTranslationWorkflow(
  tokens.accessToken,
  content,
  'test.txt',
  'es',
  'formal'
);

// Using TestContext for automatic cleanup
const ctx = new TestContext();
await ctx.initialize();
const authToken = ctx.getAccessToken();
// ... run tests ...
await ctx.cleanup();
```

## CI/CD Integration

### Automatic Execution

Integration tests run automatically in GitHub Actions after every deployment to dev:

1. **Deploy** to dev environment
2. **Wait** for API to be ready (up to 5 minutes)
3. **Run Health Checks** (verify infrastructure)
4. **Run API Tests** (verify contracts)
5. **Run Translation Tests** (verify end-to-end)

### Workflow Configuration

See `.github/workflows/deploy.yml`:

```yaml
integration-tests:
  name: Run Integration Tests
  runs-on: ubuntu-latest
  needs: deploy-dev
  steps:
    - name: Run Health Check Integration Tests
      run: npm run test:integration -- health-check.integration.test.ts
    - name: Run API Integration Tests
      run: npm run test:integration -- api-integration.test.ts
    - name: Run Translation Flow Integration Tests
      run: npm run test:integration -- translation-flow.integration.test.ts --testTimeout=600000
```

### Viewing Results

Check GitHub Actions for test results:
1. Go to repository → Actions tab
2. Click on the latest workflow run
3. Expand "Run Integration Tests" job
4. View detailed test output and timing

## Writing New Tests

### Test Structure

```typescript
/**
 * Test Suite Title
 *
 * Description of what this test suite validates
 */

import { registerAndLogin, uploadDocument } from './helpers/test-helpers';
import { getTestDocument } from './fixtures/test-documents';

describe('Feature Name Integration Tests', () => {
  let authTokens: AuthTokens;
  const testUser = generateTestUser();

  beforeAll(async () => {
    authTokens = await registerAndLogin(testUser.email, testUser.password);
  });

  describe('Specific functionality', () => {
    it('should do something specific', async () => {
      // Arrange
      const content = getTestDocument('MINIMAL');

      // Act
      const jobId = await uploadDocument(
        authTokens.accessToken,
        content,
        'test.txt'
      );

      // Assert
      expect(jobId).toBeTruthy();
      expect(jobId).toMatch(/^job-/);
    });
  });
});
```

### Best Practices

1. **Use Test Helpers**: Don't rewrite common workflows
2. **Use Test Fixtures**: Use provided test documents
3. **Clean Test Data**: Use unique emails/IDs per test
4. **Set Timeouts**: Long-running tests need explicit timeouts
5. **Handle Errors**: Expect and test error scenarios
6. **Log Progress**: Use console.log for debugging long tests
7. **Test Incrementally**: Start with health checks, then build up

### Example: Testing New Feature

```typescript
describe('New Feature Integration Tests', () => {
  it('should complete new feature workflow', async () => {
    // Use TestContext for automatic setup/cleanup
    const ctx = new TestContext();
    await ctx.initialize();

    try {
      // Your test logic here
      const result = await someNewFeature(ctx.getAccessToken());
      expect(result).toBeDefined();
    } finally {
      await ctx.cleanup();
    }
  });
});
```

## Troubleshooting

### Common Issues

#### 1. API Not Accessible

**Symptom**: `ECONNREFUSED` or timeout errors

**Solutions**:
- Verify deployment completed: `aws cloudformation describe-stacks --stack-name LfmtPocDev`
- Check API Gateway URL: `aws cloudformation describe-stacks --stack-name LfmtPocDev --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue"`
- Verify Lambda functions are deployed: `aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'lfmt-')]"`

#### 2. Test Timeouts

**Symptom**: Tests fail with `Timeout - Async callback was not invoked within the 5000ms timeout`

**Solutions**:
- Increase test timeout: `jest.setTimeout(300000);` in test file
- Or pass `--testTimeout=300000` flag
- Check CloudWatch logs for Lambda errors
- Verify Gemini API key is configured

#### 3. Authentication Failures

**Symptom**: `401 Unauthorized` on all requests

**Solutions**:
- Verify Cognito User Pool exists
- Check API Gateway authorizer configuration
- Ensure user registration completed successfully
- Try logging in manually to verify credentials

#### 4. Translation Stuck

**Symptom**: Translation never completes

**Solutions**:
- Check CloudWatch logs for `lfmt-translate-chunk` Lambda
- Verify Gemini API key in Secrets Manager: `aws secretsmanager get-secret-value --secret-id lfmt/gemini-api-key-dev`
- Check rate limiting in Gemini API quota
- Verify chunks exist in S3: `aws s3 ls s3://lfmt-chunks-dev/chunks/`

#### 5. CORS Errors

**Symptom**: Tests fail with CORS-related errors

**Solutions**:
- Verify CORS configuration in API Gateway
- Check allowed origins in infrastructure code
- Ensure `Access-Control-Allow-Origin` header is present

### Debugging Tips

1. **Enable Verbose Logging**:
```bash
npm run test:integration -- --verbose translation-flow.integration.test.ts
```

2. **Run Single Test**:
```bash
npm run test:integration -- --testNamePattern="should complete full workflow"
```

3. **Check CloudWatch Logs**:
```bash
aws logs tail /aws/lambda/lfmt-translate-chunk-LfmtPocDev --follow
```

4. **Verify S3 Objects**:
```bash
aws s3 ls s3://lfmt-chunks-dev/chunks/job-123/ --recursive
```

5. **Check DynamoDB Records**:
```bash
aws dynamodb get-item --table-name lfmt-jobs-dev --key '{"jobId":{"S":"job-123"}}'
```

### Getting Help

- Check CloudWatch Logs for Lambda errors
- Review API Gateway execution logs
- Check GitHub Actions workflow logs
- Verify all environment variables are set correctly

## Test Coverage Goals

| Component | Target Coverage | Current |
|-----------|----------------|---------|
| Authentication | 100% | ✓ 100% |
| Jobs API | 100% | ✓ 100% |
| Translation API | 100% | ✓ 100% |
| Health Checks | 100% | ✓ 100% |
| Error Scenarios | 90%+ | ✓ 95% |
| End-to-End Workflows | 100% | ✓ 100% |

## Performance Benchmarks

Expected test durations:

| Test Suite | Duration | Parallelizable |
|------------|----------|----------------|
| Health Checks | 30-60s | Yes |
| API Tests | 1-2min | Yes |
| Auth Tests | 1-2min | Yes |
| Translation (MINIMAL) | 2-3min | No |
| Translation (SMALL) | 3-5min | No |
| Translation (MEDIUM) | 5-10min | No |
| Translation (LARGE) | 10-20min | No |
| **Full Suite** | **15-30min** | Partial |

## Contributing

When adding new integration tests:

1. Follow the existing test structure
2. Use test helpers for common operations
3. Add appropriate documentation
4. Ensure tests are idempotent
5. Clean up test data after completion
6. Update this README with new test descriptions

## Related Documentation

- [Backend Functions README](../../README.md)
- [Unit Tests](../README.md)
- [API Documentation](../../../docs/api.md)
- [Deployment Guide](../../../infrastructure/README.md)
