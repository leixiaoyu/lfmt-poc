# LFMT POC - Testing Guide

Complete guide to testing the LFMT POC application locally and in CI/CD.

## Table of Contents

- [Overview](#overview)
- [Test Types](#test-types)
- [Running Tests Locally](#running-tests-locally)
- [CI/CD Pipeline](#cicd-pipeline)
- [E2E Tests](#e2e-tests)
- [Integration Tests](#integration-tests)
- [Troubleshooting](#troubleshooting)

## Overview

The LFMT POC includes comprehensive testing at multiple levels:

- **Unit Tests**: Test individual components and functions
- **Integration Tests**: Test backend API endpoints and workflows
- **E2E Tests**: Test complete user journeys from registration to translation
- **Pre-push Validation**: Local validation before pushing to GitHub
- **CI/CD Tests**: Automated testing on pull requests and deployments

## Test Types

### 1. Frontend Unit Tests (Vitest)

Located in: `frontend/src/**/__tests__/*.test.ts(x)`

**Coverage:**
- React components
- Services and utilities  
- Context providers
- Form validation
- API client

**Run:**
```bash
cd frontend
npm test                    # Run in watch mode
npm test -- --run          # Run once
npm run test:coverage      # With coverage report
npm run test:ui            # Visual UI mode
```

### 2. Backend Unit Tests (Jest)

Located in: `backend/functions/__tests__/unit/*.test.ts`

**Coverage:**
- Lambda function handlers
- Business logic
- Utility functions
- Error handling

**Run:**
```bash
cd backend/functions
npm test                    # Run all tests
npm run test:coverage      # With coverage (90%+ required)
```

### 3. Integration Tests

Located in: `backend/functions/__tests__/integration/*.test.ts`

**Tests:**
- `health-check.integration.test.ts` - API health endpoints
- `api-integration.test.ts` - Authentication and file upload
- `auth.integration.test.ts` - Complete auth flows
- `translation-flow.integration.test.ts` - End-to-end translation workflow

**Run:**
```bash
cd backend/functions
export API_BASE_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1
npm run test:integration
```

### 4. E2E Tests (Playwright)

Located in: `frontend/e2e/*.spec.ts`

**Coverage:**
- User registration journey
- Login/logout flows
- Protected route access
- Form validation
- Responsive design
- Accessibility (a11y)

**Run:**
```bash
cd frontend
npm run test:e2e            # Run all E2E tests
npm run test:e2e:ui         # Interactive UI mode
npm run test:e2e:headed     # See browser
npm run test:e2e:debug      # Debug mode
npm run test:e2e:report     # View last report
```

## Running Tests Locally

### ⚠️ IMPORTANT: Local vs CI Test Differences

**Tests pass locally but fail in CI?** Here's why:

| Environment | Command | Behavior |
|------------|---------|----------|
| **Local (default)** | `npm test` | Watch mode, doesn't exit, ignores some warnings |
| **CI / Pre-push** | `npm test -- --run` | Runs once, exits, strict mode |

**Solution:** Always use CI simulation before pushing!

### 🚀 CI Simulation (Recommended Before Pushing)

**Run this to catch CI failures locally:**

```bash
# Simulate exact CI environment
./scripts/simulate-ci.sh

# Test only frontend (matches CI exactly!)
./scripts/simulate-ci.sh --frontend

# Test only backend
./scripts/simulate-ci.sh --backend
```

This simulates the **exact** GitHub Actions environment including:
- Same test flags (`--run` for frontend)
- Same build process
- Same linting and security checks
- Immediate feedback before pushing

**Time:** ~3-5 minutes for full suite

### Quick Smoke Tests

Run the most critical tests before pushing:

```bash
./scripts/run-integration-tests.sh --quick
```

This runs:
- Backend health check
- Frontend E2E smoke test

**Time:** ~2 minutes

### Full Local Test Suite

Run all tests locally to catch issues before CI/CD:

```bash
./scripts/run-integration-tests.sh
```

This runs:
- All backend integration tests
- All frontend E2E tests

**Time:** ~15-20 minutes

### Backend Tests Only

```bash
./scripts/run-integration-tests.sh --backend
```

### E2E Tests Only

```bash
./scripts/run-integration-tests.sh --e2e
```

### Pre-Push Validation

The pre-push git hook automatically runs:

1. Shared-types tests
2. Backend function tests (with 90%+ coverage check)
3. Infrastructure TypeScript compilation
4. Infrastructure tests
5. Frontend TypeScript compilation and build
6. Frontend unit tests
7. Security checks (no hardcoded credentials)

**To bypass** (not recommended):
```bash
git push --no-verify
```

## CI/CD Pipeline

### Pull Request Workflow (ci.yml)

Runs on every PR to `main` or `develop`:

**Jobs:**
1. `test` - Backend unit tests + coverage
2. `build-infrastructure` - Infrastructure compilation + CDK synth
3. `lint-and-format` - Code quality checks
4. `security-scan` - Dependency audit
5. `test-frontend` - Frontend tests + build
6. `ci-summary` - Overall status

**Required for merge:** `test`, `build-infrastructure`, `test-frontend`

### Deployment Workflow (deploy.yml)

Runs on merge to `main`:

**Jobs:**
1. `test` - Run backend tests
2. `build-infrastructure` - Validate infrastructure
3. `build-frontend` - Build and test frontend
4. `deploy-dev` - Deploy to AWS dev environment
   - Deploy backend infrastructure (CDK)
   - Deploy frontend to S3 + CloudFront
   - Invalidate CloudFront cache
5. `integration-tests` - Backend API integration tests
6. `e2e-tests` - Frontend E2E tests against deployed environment

**Deployment Flow:**
```
Code Push → Build → Deploy Backend → Deploy Frontend → Integration Tests → E2E Tests
```

## E2E Tests

### Test Scenarios

1. **User Registration Flow**
   - Load home page
   - Navigate to registration
   - Fill registration form
   - Accept terms
   - Submit and verify success

2. **Authentication Flow**
   - Login with credentials
   - Access protected routes
   - Logout successfully

3. **Protected Routes**
   - Redirect unauthenticated users
   - Allow authenticated access

4. **Form Validation**
   - Email validation
   - Password strength
   - Password confirmation
   - Required fields

5. **Responsive Design**
   - Mobile (iPhone)
   - Tablet (iPad)
   - Desktop

### Running Specific Tests

```bash
# Run tests matching pattern
npm run test:e2e -- -g "should register"

# Run on specific browser
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:webkit

# Run against deployed environment
PLAYWRIGHT_BASE_URL=https://d1yysvwo9eg20b.cloudfront.net npm run test:e2e
```

### Debugging E2E Tests

```bash
# Debug mode - step through tests
npm run test:e2e:debug

# Headed mode - see browser
npm run test:e2e:headed

# View trace from failed tests
npx playwright show-trace test-results/*/trace.zip
```

## Integration Tests

### Backend Integration Tests

Test real API endpoints in deployed environment.

**Prerequisites:**
```bash
export API_BASE_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1
```

**Test Categories:**

1. **Health Check** (`health-check.integration.test.ts`)
   - Basic connectivity
   - Auth endpoint availability

2. **API Integration** (`api-integration.test.ts`)
   - User registration
   - User login
   - Token refresh
   - File upload request
   - Error handling

3. **Auth Integration** (`auth.integration.test.ts`)
   - Complete registration flow
   - Login/logout cycle
   - Session management

4. **Translation Flow** (`translation-flow.integration.test.ts`)
   - Upload document
   - Start translation job
   - Poll for status
   - Download result

### Running Against Local Backend

If running backend locally (e.g., SAM local):

```bash
export API_BASE_URL=http://localhost:3001
npm run test:integration
```

## Troubleshooting

### Frontend Tests Pass Locally But Fail in CI

**Problem:** Tests run in watch mode locally but CI uses `--run` flag (strict mode).

**Solution:**
```bash
# Option 1: Run CI simulation (recommended)
./scripts/simulate-ci.sh --frontend

# Option 2: Run tests exactly like CI
cd frontend
npm test -- --run
```

**Why this happens:**
- Local: `npm test` runs in watch mode (permissive)
- CI: `npm test -- --run` exits after running (strict)
- Pre-push hook now matches CI with `--run` flag

### Frontend Tests Failing

```bash
# Clear cache and reinstall
cd frontend
rm -rf node_modules dist .vite
npm ci
npm test -- --run
```

### E2E Tests Timing Out

```bash
# Increase timeout in playwright.config.ts
timeout: 120 * 1000  # 2 minutes instead of 1

# Or run with longer timeout
npm run test:e2e -- --timeout=120000
```

### Playwright Browser Issues

```bash
# Reinstall browsers
npx playwright install --with-deps chromium
```

### Integration Tests Can't Reach API

1. Check API is deployed:
   ```bash
   curl https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/me
   ```

2. Verify API_BASE_URL is set:
   ```bash
   echo $API_BASE_URL
   ```

3. Check AWS credentials:
   ```bash
   aws sts get-caller-identity
   ```

### Pre-Push Hook Failing

If pre-push hook fails on unrelated tests:

```bash
# Option 1: Fix the failing tests
npm test

# Option 2: Bypass for emergency (not recommended)
git push --no-verify
```

## Test Coverage Requirements

- **Backend Functions**: 90%+ code coverage required
- **Frontend Components**: No minimum (recommended 80%+)
- **Integration Tests**: All critical user paths
- **E2E Tests**: Complete user journeys

## Continuous Improvement

### Adding New Tests

1. **Unit Test**: Add to `__tests__` folder next to source file
2. **Integration Test**: Add to `backend/functions/__tests__/integration/`
3. **E2E Test**: Add to `frontend/e2e/`

### Test Naming Conventions

- **Unit**: `component-name.test.ts(x)`
- **Integration**: `feature-name.integration.test.ts`
- **E2E**: `user-journey.spec.ts`

### Best Practices

✅ **DO:**
- Write tests before implementation (TDD)
- Test user behavior, not implementation
- Use descriptive test names
- Keep tests isolated and independent
- Clean up test data after each test

❌ **DON'T:**
- Test implementation details
- Share state between tests
- Hardcode test data
- Skip flaky tests (fix them!)
- Commit commented-out tests

---

For questions or issues, check:
- GitHub Actions logs
- `frontend/playwright-report/`
- `frontend/test-results/`
- `backend/functions/coverage/`
