# LFMT POC - Local Testing Guide

This guide explains how to run all tests (unit, integration, and E2E) on your local development machine.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Frontend Tests](#frontend-tests)
3. [Backend Tests](#backend-tests)
4. [E2E Tests](#e2e-tests)
5. [Quick Commands Reference](#quick-commands-reference)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- **Node.js**: v20+ (check: `node --version`)
- **npm**: v9+ (check: `npm --version`)
- **Git**: Latest version

### Initial Setup

```bash
# Clone the repository (if not already done)
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

#### Run All Unit Tests

```bash
cd frontend
npm test -- --run
```

**Output**:
```
✓ src/components/Translation/__tests__/TranslationConfig.test.tsx (31 tests)
✓ src/components/Translation/__tests__/FileUpload.test.tsx (29 tests)
✓ src/components/Translation/__tests__/LegalAttestation.test.tsx (27 tests)
...
Test Files  24 passed (24)
Tests       499 passed (27 skipped)
```

#### Run Tests in Watch Mode

```bash
cd frontend
npm test
```

**Features**:
- Auto-reruns tests when files change
- Press `a` to run all tests
- Press `f` to run only failed tests
- Press `t` to filter by test name
- Press `q` to quit

#### Run Specific Test File

```bash
cd frontend
npm test -- src/components/Translation/__tests__/TranslationConfig.test.tsx
```

#### Run Tests with Coverage

```bash
cd frontend
npm run test:coverage
```

**Output**: Opens HTML coverage report in browser
**Location**: `frontend/coverage/index.html`

#### Run Tests with UI

```bash
cd frontend
npm run test:ui
```

**Features**:
- Interactive web interface
- Visual test explorer
- Real-time test execution
- Code coverage visualization
- Opens at `http://localhost:51204/__vitest__/`

---

### 2. E2E Tests (Playwright)

**Test Suite**: 7 test files, 58 tests
**Coverage**: Upload, progress, legal attestation, download, workflows, multi-language, error scenarios

#### First-Time Setup: Install Browsers

```bash
cd frontend
npx playwright install chromium
```

**Optional** (for multi-browser testing):
```bash
npx playwright install firefox webkit
```

#### Run All E2E Tests

```bash
cd frontend
npm run test:e2e
```

**What happens**:
1. Playwright starts dev server on `http://localhost:5173`
2. Runs all 58 E2E tests in Chromium
3. Generates HTML report
4. Stops dev server

**Output**:
```
Running 58 tests using 1 worker
✓ e2e/tests/translation/translation-progress.spec.ts (8 tests)
✓ e2e/tests/translation/legal-attestation.spec.ts (12 tests)
✓ e2e/tests/translation/download-translation.spec.ts (8 tests)
...
58 passed (2m)
```

#### Run E2E Tests in Interactive UI Mode

```bash
cd frontend
npm run test:e2e:ui
```

**Features**:
- Pick which tests to run
- Watch tests execute in browser
- Time travel through test steps
- Inspect DOM at each step
- View network requests
- Opens at `http://localhost:51204/`

#### Run E2E Tests in Headed Mode (See Browser)

```bash
cd frontend
npm run test:e2e:headed
```

**Use case**: Watch tests execute in visible browser window

#### Debug E2E Tests (Step-by-Step)

```bash
cd frontend
npm run test:e2e:debug
```

**Features**:
- Playwright Inspector opens
- Step through test line-by-line
- Inspect page at each step
- Modify selectors on the fly
- View console logs

#### Run Specific E2E Test File

```bash
cd frontend
npx playwright test e2e/tests/translation/translation-progress.spec.ts
```

#### Run Specific Test by Name

```bash
cd frontend
npx playwright test -g "should show initial PENDING status"
```

#### View Last Test Report

```bash
cd frontend
npm run test:e2e:report
```

**Location**: `frontend/playwright-report/index.html`

---

## Backend Tests

### 1. Unit Tests (Jest)

**Test Suite**: Backend Lambda functions

```bash
cd backend/functions
npm test
```

**Run with Coverage**:
```bash
cd backend/functions
npm run test:coverage
```

### 2. Integration Tests

**Test Suite**: End-to-end API tests against deployed infrastructure

**Prerequisites**:
- Deployed dev environment (run `npx cdk deploy --context environment=dev` first)
- AWS credentials configured

```bash
cd backend/functions

# Run all integration tests
npm run test:integration

# Run specific integration test
npm run test:integration -- health-check.integration.test.ts
npm run test:integration -- api-integration.test.ts
npm run test:integration -- translation-flow.integration.test.ts
```

**Environment Variables**:
```bash
# Get API URL from CloudFormation stack
export API_BASE_URL=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text)

# Run integration tests
npm run test:integration
```

---

## Quick Commands Reference

### Frontend Unit Tests

| Command | Description |
|---------|-------------|
| `npm test -- --run` | Run all unit tests once |
| `npm test` | Run in watch mode |
| `npm run test:ui` | Interactive UI |
| `npm run test:coverage` | With coverage report |
| `npm test -- <file>` | Run specific file |

### Frontend E2E Tests

| Command | Description |
|---------|-------------|
| `npm run test:e2e` | Run all E2E tests |
| `npm run test:e2e:ui` | Interactive UI mode |
| `npm run test:e2e:headed` | See browser |
| `npm run test:e2e:debug` | Step-by-step debugging |
| `npm run test:e2e:report` | View last report |
| `npm run test:e2e:chromium` | Chromium only |
| `npm run test:e2e:firefox` | Firefox only |
| `npm run test:e2e:webkit` | Safari/WebKit only |

### Backend Tests

| Command | Description |
|---------|-------------|
| `npm test` | Run unit tests |
| `npm run test:coverage` | With coverage |
| `npm run test:integration` | Run integration tests |

---

## Troubleshooting

### Frontend Unit Tests

#### Issue: Tests fail with "Cannot find module '@lfmt/shared-types'"

**Solution**:
```bash
cd shared-types
npm ci
npm run build
cd ../frontend
npm test
```

#### Issue: Tests timeout

**Solution**: Increase timeout in test file:
```typescript
test('should do something', async () => {
  // ...
}, 30000); // 30 seconds
```

---

### E2E Tests

#### Issue: "Executable doesn't exist" error

**Solution**: Install browsers
```bash
cd frontend
npx playwright install chromium
```

#### Issue: Dev server fails to start

**Solution**: Check if port 5173 is available
```bash
lsof -i :5173  # Check if port is in use
kill -9 <PID>  # Kill process if needed
```

#### Issue: Tests fail with "Navigation timeout"

**Solution**: Increase timeout in `playwright.config.ts`:
```typescript
timeout: 90 * 1000, // 90 seconds
```

#### Issue: Tests fail with "Cannot connect to backend API"

**Expected**: E2E tests use mock data, not real backend API
- Auth tests use in-memory user store
- Translation tests mock backend responses
- No backend required for local E2E tests

---

### Backend Integration Tests

#### Issue: "API_BASE_URL is not defined"

**Solution**: Set environment variable
```bash
export API_BASE_URL=<your-api-url>
npm run test:integration
```

#### Issue: "Stack LfmtPocDev does not exist"

**Solution**: Deploy infrastructure first
```bash
cd backend/infrastructure
npx cdk deploy --context environment=dev
```

#### Issue: Integration tests timeout

**Solution**: Increase timeout
```bash
npm run test:integration -- --testTimeout=600000
```

---

## Running All Tests

### Complete Test Suite (Sequential)

```bash
# 1. Backend unit tests
cd backend/functions
npm test

# 2. Infrastructure tests
cd ../infrastructure
npm test

# 3. Frontend unit tests
cd ../../frontend
npm test -- --run

# 4. Frontend E2E tests
npm run test:e2e

# 5. Backend integration tests (requires deployed env)
cd ../backend/functions
export API_BASE_URL=<your-api-url>
npm run test:integration
```

### Parallel Execution (Faster)

```bash
# Terminal 1: Backend tests
cd backend/functions && npm test

# Terminal 2: Frontend unit tests
cd frontend && npm test -- --run

# Terminal 3: Frontend E2E tests
cd frontend && npm run test:e2e
```

---

## Test Artifacts

### Unit Test Coverage

**Location**: `frontend/coverage/index.html`
**Generate**: `npm run test:coverage`

### E2E Test Reports

**Location**: `frontend/playwright-report/index.html`
**Generate**: Automatically after `npm run test:e2e`
**View**: `npm run test:e2e:report`

### E2E Screenshots/Videos

**Location**: `frontend/test-results/`
**When**: Only on test failures
**Contents**: Screenshots, videos, traces

---

## Best Practices

### Before Committing Code

Run this minimal test suite:

```bash
# 1. Frontend unit tests
cd frontend
npm test -- --run

# 2. Type checking
npm run type-check

# 3. Linting
npm run lint

# 4. Quick E2E smoke test (specific file)
npx playwright test e2e/tests/translation/complete-workflow.spec.ts
```

### Before Creating a PR

Run the full test suite (same as CI):

```bash
# Run all unit tests
cd frontend && npm test -- --run

# Run all E2E tests
npm run test:e2e

# Check coverage
npm run test:coverage
```

### Debugging Failed Tests

**Unit Tests**:
1. Run in watch mode: `npm test`
2. Run specific file: `npm test -- <file>`
3. Add `console.log()` statements
4. Use `test.only()` to focus on failing test

**E2E Tests**:
1. Run in debug mode: `npm run test:e2e:debug`
2. Run in headed mode: `npm run test:e2e:headed`
3. Use `page.pause()` to freeze execution
4. Check screenshots in `test-results/`

---

## Summary

- ✅ **Frontend Unit Tests**: 499 tests, run with `npm test`
- ✅ **Frontend E2E Tests**: 58 tests, run with `npm run test:e2e`
- ✅ **Backend Unit Tests**: Run with `npm test` in `backend/functions`
- ✅ **Backend Integration Tests**: Run with `npm run test:integration` (requires deployed env)

All tests can be run locally without any external dependencies (except backend integration tests which require deployed infrastructure).

---

**Last Updated**: 2025-11-19
**Questions?** Check the individual README files:
- `frontend/README.md` - Frontend overview
- `frontend/e2e/README.md` - E2E testing guide
- `backend/functions/README.md` - Backend testing guide
