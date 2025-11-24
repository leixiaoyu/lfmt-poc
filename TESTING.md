# LFMT POC - Testing Guide

Complete guide to testing the LFMT POC application locally and in CI/CD.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Frontend Tests](#frontend-tests)
4. [Backend Tests](#backend-tests)
5. [E2E Tests](#e2e-tests)
6. [CI/CD Pipeline](#cicd-pipeline)
7. [Quick Commands Reference](#quick-commands-reference)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## Overview

The LFMT POC includes comprehensive testing at multiple levels:

- **Frontend Unit Tests**: 499 tests with Vitest + React Testing Library (99% coverage)
- **Backend Unit Tests**: Jest tests for Lambda functions
- **Integration Tests**: End-to-end API workflow testing
- **E2E Tests**: 58 Playwright tests with Page Object Model pattern
- **CI/CD Tests**: Automated testing on pull requests and deployments

**Test Coverage**:
- Frontend: 99% (Translation components)
- Backend: Comprehensive Lambda function coverage
- E2E: Critical user journeys and workflows

---

## Prerequisites

### Required Software

- **Node.js**: v20+ (check: `node --version`)
- **npm**: v9+ (check: `npm --version`)
- **Git**: Latest version
- **Playwright** (for E2E tests): Auto-installed with `npm ci`

### Initial Setup

```bash
# From project root
cd "/Users/raymondl/Documents/LFMT POC/LFMT/lfmt-poc"

# Install dependencies for all packages
cd shared-types && npm ci && cd ..
cd backend/functions && npm ci && cd ../..
cd backend/infrastructure && npm ci && cd ../..
cd frontend && npm ci && cd ..
```

---

## Frontend Tests

### 1. Unit Tests (Vitest)

**Test Suite**: 24 test files, 499 tests (27 skipped)
**Coverage**: 99% average across Translation components
**Location**: `frontend/src/**/__tests__/*.test.tsx`

#### Run All Unit Tests

```bash
cd frontend
npm test                    # Run in watch mode
npm test -- --run          # Run once (CI mode)
```

#### Run Tests with Coverage

```bash
npm run test:coverage

# View coverage report
open coverage/index.html
```

#### Run Specific Test File

```bash
npm test -- TranslationConfig.test.tsx
npm test -- --run FileUpload.test.tsx
```

#### Run Tests in UI Mode

```bash
npm run test:ui
```

**Watch Mode** (default):
- Press `a` to run all tests
- Press `f` to run only failed tests
- Press `p` to filter by filename
- Press `t` to filter by test name
- Press `q` to quit

### 2. E2E Tests (Playwright)

**Test Suite**: 7 test suites, 58 tests
**Framework**: Playwright with Page Object Model
**Location**: `frontend/e2e/tests/**/*.spec.ts`

#### First-Time Setup: Install Browsers

```bash
cd frontend
npx playwright install chromium
```

#### Run All E2E Tests

**Prerequisites**: Dev server must be running on port 3000

```bash
# Terminal 1: Start dev server
cd frontend
npm run dev

# Terminal 2: Run E2E tests
cd frontend
npm run test:e2e           # Headless mode
```

#### Run E2E Tests in Interactive UI Mode

```bash
npm run test:e2e:ui
```

Benefits:
- ✅ Visual test execution
- ✅ Step-by-step debugging
- ✅ Time travel through test steps
- ✅ Watch mode with auto-rerun

#### Run E2E Tests in Headed Mode (See Browser)

```bash
npm run test:e2e:headed
```

#### Debug E2E Tests (Step-by-Step)

```bash
npm run test:e2e:debug
```

Features:
- Pauses before each action
- Opens Playwright Inspector
- Allows breakpoints and step-through
- Console logging

#### Run Specific E2E Test File

```bash
npx playwright test e2e/tests/translation/upload.spec.ts
npx playwright test e2e/tests/auth/login.spec.ts
```

#### Run Specific Test by Name

```bash
npx playwright test -g "should upload file successfully"
```

#### View Last Test Report

```bash
npm run test:e2e:report
```

---

## Backend Tests

### 1. Unit Tests (Jest)

**Location**: `backend/functions/**/__tests__/unit/*.test.ts`

#### Run All Backend Unit Tests

```bash
cd backend/functions
npm test                   # Run all tests
npm test -- --coverage     # With coverage
```

#### Run Specific Test File

```bash
npm test -- auth/register.test.ts
npm test -- translation/uploadDocument.test.ts
```

#### Watch Mode

```bash
npm test -- --watch
```

### 2. Integration Tests

**Location**: `backend/functions/**/__tests__/integration/*.test.ts`

**Prerequisites**:
- AWS credentials configured
- Backend stack deployed to dev environment
- API Gateway endpoint available

#### Run Integration Tests

```bash
cd backend/functions
npm run test:integration
```

**What Integration Tests Cover**:
- Complete translation workflow (upload → chunk → translate → download)
- Auth flow (register → login → protected endpoints)
- File upload and S3 integration
- DynamoDB operations
- API Gateway routing

#### Run Against Specific Environment

```bash
API_BASE_URL=https://your-api-id.execute-api.us-east-1.amazonaws.com/v1 \
npm run test:integration
```

---

## E2E Tests

### Test Scenarios

**Authentication** (`frontend/e2e/tests/auth/*.spec.ts`):
- User registration
- Login/logout
- Protected routes

**Translation Workflow** (`frontend/e2e/tests/translation/*.spec.ts`):
- Document upload with legal attestation
- Progress tracking and polling
- Download completed translations
- Error handling and retry logic

**Multi-Language Support**:
- 5 languages (Spanish, French, German, Italian, Chinese)
- 3 tones (Formal, Informal, Neutral)
- 15 total combinations tested

### Running Specific Test Suites

```bash
# Auth tests only
npx playwright test e2e/tests/auth

# Translation tests only
npx playwright test e2e/tests/translation

# Specific feature
npx playwright test e2e/tests/translation/upload.spec.ts
```

### Debugging E2E Tests

**Step 1**: Run in debug mode
```bash
npm run test:e2e:debug
```

**Step 2**: Use Playwright Inspector
- Set breakpoints
- Step through actions
- Inspect element selectors
- View console logs

**Step 3**: View screenshots/videos
```bash
# Screenshots saved to:
frontend/test-results/**/*-screenshot.png

# Videos (if enabled):
frontend/test-results/**/*.webm
```

---

## CI/CD Pipeline

### Pull Request Workflow (`.github/workflows/ci.yml`)

**Triggered On**:
- Pull request creation
- Pull request updates
- Push to `main` branch

**Test Steps**:

1. **Shared Types**:
   ```bash
   cd shared-types
   npm ci
   npm run build
   npm test
   ```

2. **Backend Functions**:
   ```bash
   cd backend/functions
   npm ci
   npm test
   npm run type-check
   ```

3. **Backend Infrastructure**:
   ```bash
   cd backend/infrastructure
   npm ci
   npm test
   npm run cdk:synth
   ```

4. **Frontend**:
   ```bash
   cd frontend
   npm ci
   npm test -- --run
   npm run type-check
   npm run build
   ```

5. **E2E Tests**: ⚠️ Temporarily disabled
   - Reason: Require live backend API
   - Status: Run manually before deployment

### Deployment Workflow (`.github/workflows/deploy.yml`)

**Triggered On**:
- Push to `main` branch (after PR merge)

**Steps**:
1. Run all CI tests (same as PR workflow)
2. Deploy backend infrastructure (CDK)
3. Deploy Lambda functions
4. Deploy frontend to S3/CloudFront
5. Invalidate CloudFront cache

### ⚠️ IMPORTANT: Local vs CI Test Differences

**CI Environment**:
- ✅ Fresh `npm ci` install (lock file)
- ✅ Runs in headless mode
- ✅ Strict TypeScript checks
- ✅ No cached test results

**Local Environment**:
- ⚠️ May have `node_modules` cache
- ⚠️ May run in watch mode
- ⚠️ Incremental test runs

**Best Practice**: Simulate CI before pushing:
```bash
# Clean install
rm -rf node_modules
npm ci

# Run tests in CI mode
npm test -- --run
npm run type-check
```

---

## Quick Commands Reference

### Frontend Unit Tests

```bash
cd frontend
npm test                    # Watch mode
npm test -- --run          # CI mode (run once)
npm run test:coverage      # With coverage report
npm run test:ui            # Interactive UI mode
npm test -- TranslationConfig.test.tsx  # Specific file
```

### Frontend E2E Tests

```bash
cd frontend
npm run test:e2e           # Headless mode
npm run test:e2e:ui        # Interactive UI mode
npm run test:e2e:headed    # See browser
npm run test:e2e:debug     # Step-by-step debugging
npm run test:e2e:report    # View last report
npx playwright test e2e/tests/auth  # Specific suite
```

### Backend Tests

```bash
cd backend/functions
npm test                   # Unit tests
npm test -- --coverage     # With coverage
npm run test:integration   # Integration tests
npm test -- auth/register.test.ts  # Specific file
```

### Pre-Push Validation

```bash
# Run from project root
.githooks/pre-push origin refs/heads/main
```

---

## Troubleshooting

### Frontend Unit Tests

#### Issue: Tests fail with "Cannot find module '@lfmt/shared-types'"

**Solution**:
```bash
# Build shared types first
cd shared-types
npm ci
npm run build

# Then run frontend tests
cd ../frontend
npm test
```

#### Issue: Tests timeout

**Symptoms**: Tests hang or timeout after 5000ms

**Solutions**:
```bash
# Increase timeout globally
npm test -- --testTimeout=10000

# Or in specific test file:
// Add to test file
jest.setTimeout(10000);
```

#### Issue: Coverage reports are stale

**Solution**:
```bash
# Clean coverage cache
rm -rf coverage
npm run test:coverage
```

### E2E Tests

#### Issue: "Executable doesn't exist" error

**Solution**:
```bash
npx playwright install chromium
```

#### Issue: Dev server fails to start

**Symptoms**: `EADDRINUSE: address already in use :::3000`

**Solution**:
```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9

# Or use different port
PORT=3001 npm run dev
```

#### Issue: Tests fail with "Navigation timeout"

**Symptoms**: `page.goto: Timeout 30000ms exceeded`

**Solutions**:
1. **Check dev server is running**: `curl http://localhost:3000`
2. **Increase timeout**:
   ```typescript
   await page.goto('/', { timeout: 60000 });
   ```
3. **Wait for page load**:
   ```typescript
   await page.waitForLoadState('networkidle');
   ```

#### Issue: Tests fail with "Cannot connect to backend API"

**Symptoms**: E2E tests make real API calls that fail

**Solution** (Temporary):
- E2E tests currently disabled in CI
- Run with local backend or mock API
- Or skip E2E tests: `npm test -- --run` (unit tests only)

### Backend Integration Tests

#### Issue: "API_BASE_URL is not defined"

**Solution**:
```bash
export API_BASE_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1
npm run test:integration
```

#### Issue: "Stack LfmtPocDev does not exist"

**Solution**:
```bash
# Deploy backend first
cd backend/infrastructure
npx cdk deploy --context environment=dev

# Then run integration tests
cd ../functions
npm run test:integration
```

#### Issue: Integration tests timeout

**Solution**:
```bash
# Increase Jest timeout
npm run test:integration -- --testTimeout=30000
```

### Pre-Push Hook Failing

**Symptoms**: Git push rejected by pre-push hook

**Solutions**:
```bash
# Fix test failures
npm test -- --run

# Or bypass hook (NOT RECOMMENDED)
git push --no-verify
```

---

## Best Practices

### Before Committing Code

1. ✅ Run unit tests locally
   ```bash
   npm test -- --run
   ```

2. ✅ Check TypeScript compilation
   ```bash
   npm run type-check
   ```

3. ✅ Review test coverage
   ```bash
   npm run test:coverage
   ```

### Before Creating a PR

1. ✅ Run full test suite
   ```bash
   # Frontend
   cd frontend
   npm ci
   npm test -- --run
   npm run type-check
   npm run build

   # Backend
   cd ../backend/functions
   npm ci
   npm test
   npm run type-check
   ```

2. ✅ Test E2E flows manually
   ```bash
   cd frontend
   npm run test:e2e:headed
   ```

3. ✅ Simulate CI environment
   ```bash
   rm -rf node_modules
   npm ci
   npm test -- --run
   ```

### Debugging Failed Tests

1. **Read the error message carefully**
   - Note the file, line number, and assertion that failed

2. **Run single test in watch mode**
   ```bash
   npm test -- --run TranslationConfig.test.tsx
   ```

3. **Add console.log statements**
   ```typescript
   console.log('Component state:', component.debug());
   ```

4. **Use Playwright Inspector for E2E**
   ```bash
   npm run test:e2e:debug
   ```

5. **Check test artifacts**
   - Screenshots: `frontend/test-results/`
   - Coverage: `frontend/coverage/`
   - E2E reports: `frontend/playwright-report/`

### Test Naming Conventions

```typescript
// ✅ GOOD: Descriptive "should" format
test('should upload file successfully when all fields valid', async () => {
  // ...
});

// ❌ BAD: Vague or imperative
test('upload file', async () => {
  // ...
});
```

### Adding New Tests

1. **Create test file next to source file**:
   ```
   src/components/NewFeature.tsx
   src/components/__tests__/NewFeature.test.tsx
   ```

2. **Follow existing patterns**:
   - Use React Testing Library for component tests
   - Use Page Object Model for E2E tests
   - Mock external dependencies

3. **Run tests to ensure they pass**:
   ```bash
   npm test -- NewFeature.test.tsx
   ```

4. **Update coverage threshold if needed**:
   ```javascript
   // vite.config.ts
   coverage: {
     thresholds: {
       global: {
         lines: 90,
         functions: 90,
         branches: 90,
         statements: 90,
       },
     },
   }
   ```

---

## Test Coverage Requirements

**Minimum Coverage**:
- **Lines**: 90%
- **Functions**: 90%
- **Branches**: 90%
- **Statements**: 90%

**Current Coverage**:
- **Frontend**: 99% (Translation components)
- **Backend**: Comprehensive Lambda coverage

**Check Coverage**:
```bash
cd frontend
npm run test:coverage

# View detailed report
open coverage/index.html
```

---

## Test Artifacts

### Unit Test Coverage

**Location**: `frontend/coverage/`

**Files**:
- `coverage/index.html` - Interactive coverage report
- `coverage/lcov-report/` - Detailed line-by-line coverage
- `coverage/coverage-final.json` - Coverage data

### E2E Test Reports

**Location**: `frontend/playwright-report/`

**View Report**:
```bash
cd frontend
npm run test:e2e:report
```

### E2E Screenshots/Videos

**Location**: `frontend/test-results/`

**Configuration** (`playwright.config.ts`):
```typescript
use: {
  screenshot: 'only-on-failure',
  video: 'retain-on-failure',
}
```

**Access**:
```bash
ls frontend/test-results/**/*-screenshot.png
ls frontend/test-results/**/*.webm
```

---

## Running All Tests

### Complete Test Suite (Sequential)

```bash
#!/bin/bash
# Run from project root

# Shared Types
cd shared-types
npm ci
npm run build
npm test

# Backend Functions
cd ../backend/functions
npm ci
npm test

# Backend Infrastructure
cd ../infrastructure
npm ci
npm test

# Frontend
cd ../../frontend
npm ci
npm test -- --run
npm run test:e2e

echo "✅ All tests complete!"
```

### Parallel Execution (Faster)

```bash
# Terminal 1: Shared types
cd shared-types && npm ci && npm test

# Terminal 2: Backend functions
cd backend/functions && npm ci && npm test

# Terminal 3: Backend infrastructure
cd backend/infrastructure && npm ci && npm test

# Terminal 4: Frontend unit tests
cd frontend && npm ci && npm test -- --run

# Terminal 5: Frontend E2E tests (requires dev server)
cd frontend && npm run dev &
npm run test:e2e
```

---

## Summary

**Test Execution Flow**:
1. Install dependencies: `npm ci`
2. Run unit tests: `npm test`
3. Check TypeScript: `npm run type-check`
4. Run E2E tests: `npm run test:e2e`
5. Build application: `npm run build`

**Key Commands**:
- `npm test` - Run all tests (watch mode)
- `npm test -- --run` - Run once (CI mode)
- `npm run test:coverage` - With coverage
- `npm run test:e2e` - E2E tests
- `npm run type-check` - TypeScript validation

**Best Practices**:
- ✅ Run tests before committing
- ✅ Maintain 90%+ coverage
- ✅ Use descriptive test names
- ✅ Keep tests isolated
- ✅ Mock external dependencies

---

**Last Updated**: 2025-11-23 (Merged from TESTING.md + TESTING-GUIDE.md)
**Related Documentation**:
- `frontend/e2e/README.md` - Playwright E2E testing details
- `docs/TRANSLATION-UI-REFERENCE.md` - Translation UI testing
- `.github/workflows/ci.yml` - CI/CD pipeline configuration
