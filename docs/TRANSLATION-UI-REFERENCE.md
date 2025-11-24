# Translation UI Components & Testing - Complete Reference

**Status**: Fully implemented with comprehensive testing infrastructure (since PR #86, 2025-11-20)

This document provides complete technical reference for the Translation Workflow UI components and testing infrastructure.

---

## Table of Contents

1. [Overview](#overview)
2. [UI Components](#ui-components)
3. [Testing Infrastructure](#testing-infrastructure)
4. [Running Tests](#running-tests)
5. [Configuration](#configuration)
6. [Best Practices](#best-practices)
7. [Known Issues & Solutions](#known-issues--solutions)
8. [Migration Notes](#migration-notes)

---

## Overview

The translation workflow UI provides a complete user experience for:
- ✅ Uploading documents with legal attestation
- ✅ Tracking translation progress in real-time
- ✅ Downloading completed translations
- ✅ Managing translation history

**Test Coverage**:
- **Unit Tests**: 499 tests across 24 files (99% coverage)
- **E2E Tests**: 58 tests across 7 test suites
- **Total Test Files**: 31 test files

---

## UI Components

### Component Locations

**Pages**: `frontend/src/pages/`
**Components**: `frontend/src/components/Translation/`

### 1. TranslationUploadPage

**Location**: `frontend/src/pages/TranslationUpload.tsx`

**Features**:
- ✅ Multi-step wizard workflow
  1. Legal Attestation
  2. Configuration (language + tone)
  3. File Upload
  4. Review & Submit
- ✅ Language selection (5 languages)
  - Spanish
  - French
  - German
  - Italian
  - Chinese (Simplified)
- ✅ Tone selection (3 tones)
  - Formal
  - Informal
  - Neutral
- ✅ File upload with drag-and-drop support
- ✅ Legal attestation with checkbox enforcement
- ✅ IP address capture for compliance
- ✅ Input validation and error handling

**User Flow**:
```
1. Legal Attestation → Check all 3 boxes
2. Configuration → Select language + tone
3. Upload → Drag & drop or browse file
4. Review → Confirm all settings
5. Submit → Create translation job
```

### 2. TranslationDetailPage

**Location**: `frontend/src/pages/TranslationDetail.tsx`

**Features**:
- ✅ Real-time progress tracking with adaptive polling
  - Initial: 15-second intervals
  - Mid-progress: 30-second intervals
  - Late-progress: 60-second intervals
- ✅ Job status display
  - `PENDING` → Queued for processing
  - `CHUNKING` → Splitting document
  - `CHUNKED` → Ready for translation
  - `IN_PROGRESS` → Translating chunks
  - `COMPLETED` → Ready for download
  - `FAILED` → Error occurred
- ✅ Progress visualization
  - Percentage complete
  - Chunks completed / total chunks
  - Progress bar with animation
- ✅ Download functionality
  - Download button enabled when completed
  - Automatic filename generation
  - Error handling for download failures
- ✅ Error handling and retry logic
  - Automatic retry for transient failures
  - User-friendly error messages
  - Retry button for manual retry

**Polling Strategy**:
```typescript
// Adaptive polling intervals based on elapsed time
if (elapsedTime < 60000) {
  interval = 15000;  // First minute: 15s
} else if (elapsedTime < 300000) {
  interval = 30000;  // 1-5 minutes: 30s
} else {
  interval = 60000;  // After 5 minutes: 60s
}
```

### 3. TranslationHistoryPage

**Location**: `frontend/src/pages/TranslationHistory.tsx`

**Features**:
- ✅ Job list with pagination
- ✅ Status badges with color coding
- ✅ Progress indicators for in-progress jobs
- ✅ Navigation to job detail page
- ✅ Job metadata display
  - Source language → Target language
  - Tone selection
  - Original filename
  - Upload date
  - Status
- ✅ Filtering and sorting
  - Filter by status
  - Sort by date, status, language
  - Search by filename

### 4. Supporting Components

**TranslationConfig.tsx** - Language and tone selection
- Dropdown selectors with validation
- Visual language flags/icons
- Tone description tooltips

**FileUpload.tsx** - Document upload with validation
- Drag-and-drop area
- File type validation (.txt, .docx, .pdf)
- File size validation (max 10MB)
- Upload progress indicator

**LegalAttestation.tsx** - Legal checkbox enforcement
- 3 required checkboxes:
  1. I own copyright or have permission
  2. I have translation rights
  3. I accept liability
- All checkboxes must be checked to proceed
- IP address capture (automatic, backend)
- Timestamp recording

**ReviewAndSubmit.tsx** - Final review before submission
- Summary of all selections
- Edit buttons to go back to previous steps
- Submit button with loading state
- Confirmation dialog

---

## Testing Infrastructure

### Unit Tests

**Framework**: Vitest + React Testing Library
**Location**: `frontend/src/**/__tests__/*.test.tsx`

**Statistics**:
- **Total Tests**: 499 tests
- **Test Files**: 24 files
- **Coverage**: 99% on translation components
- **Test Types**:
  - Component rendering
  - User interactions (click, type, select)
  - Form validation
  - Error handling
  - API mocking with MSW

**Key Test Files**:
- `TranslationUpload.test.tsx`
- `TranslationDetail.test.tsx`
- `TranslationHistory.test.tsx`
- `TranslationConfig.test.tsx`
- `FileUpload.test.tsx`
- `LegalAttestation.test.tsx`

### E2E Tests

**Framework**: Playwright with Page Object Model pattern
**Location**: `frontend/e2e/tests/translation/*.spec.ts`

**Statistics**:
- **Total Tests**: 58 tests
- **Test Suites**: 7 suites
- **Page Objects**: 7 POMs

**Test Coverage**:

1. **Upload Workflow Validation**
   - Multi-step wizard navigation
   - Legal attestation enforcement
   - File upload success/failure
   - Form validation

2. **Progress Tracking and Polling**
   - Adaptive polling intervals
   - Status updates
   - Progress percentage updates
   - Job completion detection

3. **Legal Attestation Enforcement** (12 tests)
   - All 3 checkboxes required
   - Cannot proceed without attestation
   - IP capture validation
   - Timestamp validation

4. **Download Functionality** (8 tests)
   - Download button state
   - File download success
   - Error handling
   - Filename generation

5. **Complete E2E Journey** (4 tests)
   - Registration → Login → Upload → Track → Download
   - Happy path validation
   - End-to-end workflow

6. **Multi-Language Support** (13 tests)
   - 5 languages × 3 tones = 15 combinations
   - Language selection validation
   - Tone selection validation

7. **Error Scenarios** (13 tests)
   - Network failures
   - API failures (4xx, 5xx)
   - Retry logic
   - Error message display

### Page Object Models

**Framework**: TypeScript classes extending BasePage
**Location**: `frontend/e2e/pages/*.ts`

**POMs**:

1. **BasePage.ts** - Base class with common functionality
   - Navigation helpers
   - Wait utilities
   - Screenshot capture
   - Error handling

2. **LoginPage.ts** - Authentication flow
   - Login form interaction
   - Error message handling
   - Redirect after login

3. **RegisterPage.ts** - User registration
   - Registration form
   - Password validation
   - Success confirmation

4. **DashboardPage.ts** - Dashboard interactions
   - Navigation to upload page
   - Job list display
   - Quick actions

5. **TranslationUploadPage.ts** - Upload workflow
   - Multi-step wizard navigation
   - Legal attestation interaction
   - Language/tone selection
   - File upload

6. **TranslationDetailPage.ts** - Progress tracking
   - Status polling
   - Progress updates
   - Download button

7. **TranslationHistoryPage.ts** - Job history
   - Job list display
   - Filtering/sorting
   - Navigation to detail page

**POM Best Practice Example**:
```typescript
// ✅ GOOD: Use Page Object Model
const uploadPage = new TranslationUploadPage(page);
await uploadPage.goto();
await uploadPage.acceptLegalAttestation();
await uploadPage.selectLanguage('Spanish');
await uploadPage.uploadFile('test.txt');
await uploadPage.submit();

// ❌ BAD: Direct element interaction in test
await page.goto('/translation/upload');
await page.locator('#checkbox-1').click();
await page.locator('#language-select').selectOption('es');
```

---

## Running Tests

### Unit Tests

**Run All Unit Tests**:
```bash
cd frontend
npm test                    # Watch mode
npm test -- --run          # Run once
```

**With Coverage Report**:
```bash
npm run test:coverage
```

**Interactive UI Mode**:
```bash
npm run test:ui
```

**Specific Test File**:
```bash
npm test -- TranslationConfig.test.tsx
```

**Watch Specific Component**:
```bash
npm test -- TranslationUpload
```

### E2E Tests

**Prerequisites**:
- Frontend dev server must be running on port 3000
- Backend API must be available (or mock API configured)

**Run All E2E Tests**:
```bash
cd frontend
npm run test:e2e           # Headless mode
```

**Interactive Playwright UI**:
```bash
npm run test:e2e:ui
```

**Headed Mode (See Browser)**:
```bash
npm run test:e2e:headed
```

**Debug Mode (Step-by-Step)**:
```bash
npm run test:e2e:debug
```

**View Last Test Report**:
```bash
npm run test:e2e:report
```

**Run Specific Test Suite**:
```bash
npx playwright test e2e/tests/translation/upload.spec.ts
```

### CI/CD Integration

**GitHub Actions**: `.github/workflows/ci.yml`

**Unit Tests**: ✅ Fully integrated
- Run on every PR
- Run on every push to main
- Must pass before merge
- Coverage report uploaded

**E2E Tests**: ⚠️ Temporarily disabled
- **Status**: Commented out (lines 200-280)
- **Reason**: Require live backend API
- **Solution**: Configure mock API or deploy test backend
- **Location**: `.github/workflows/ci.yml:200-280`

**Pre-Push Hooks**: `.githooks/pre-push`
- Run unit tests locally before push
- Prevent pushing with failing tests
- Can be bypassed with `--no-verify` (not recommended)

---

## Configuration

### Dev Server Port

**Port**: 3000 (changed from 5173 in PR #86)

**Vite Configuration** (`frontend/vite.config.ts:18-27`):
```typescript
export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
  },
});
```

**Playwright Configuration** (`frontend/playwright.config.ts:41,86`):
```typescript
export default defineConfig({
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Environment Variables

**For E2E Tests**:
```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000  # Dev server URL
API_BASE_URL=http://localhost:3000         # Backend API URL
CI=true                                     # Enable CI mode
```

**For Frontend**:
```bash
VITE_API_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1
VITE_APP_ENV=development
```

---

## Best Practices

### Unit Testing Best Practices

1. ✅ **Use React Testing Library** for component tests
   - Query by accessibility (role, label, text)
   - Avoid querying by implementation details (class names, IDs)

2. ✅ **Mock API calls with MSW** (Mock Service Worker)
   - Intercept network requests
   - Return realistic mock data
   - Simulate error scenarios

3. ✅ **Test user interactions, not implementation**
   ```typescript
   // ✅ GOOD: Test user behavior
   fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
   expect(screen.getByText('Success')).toBeInTheDocument();

   // ❌ BAD: Test implementation
   expect(component.state.submitted).toBe(true);
   ```

4. ✅ **Maintain 90%+ coverage** on all components
   - Use `npm run test:coverage` to check
   - Focus on critical paths, not 100%

5. ✅ **Use data-testid sparingly**
   - Prefer accessible queries (getByRole, getByLabel Text)
   - Only use data-testid as last resort

### E2E Testing Best Practices

1. ✅ **Use Page Object Model pattern** for all interactions
   - Never interact with page elements directly in tests
   - Encapsulate page logic in POM classes

2. ✅ **Generate unique test users** with timestamps
   ```typescript
   const testEmail = `test-${Date.now()}@example.com`;
   ```

3. ✅ **Wait for elements explicitly**
   ```typescript
   // ✅ GOOD: Explicit wait
   await page.waitForSelector('[data-testid="upload-complete"]');

   // ❌ BAD: Arbitrary timeout
   await page.waitForTimeout(5000);
   ```

4. ✅ **Use descriptive test names** with "should" format
   ```typescript
   test('should upload file successfully when all fields valid', async () => {
     // ...
   });
   ```

5. ✅ **Keep tests isolated and independent**
   - Each test should run in isolation
   - No dependencies between tests
   - Clean up after each test

### Development Workflow Best Practices

1. ✅ **Write unit tests first** (TDD approach)
   - Write failing test
   - Implement feature
   - Refactor

2. ✅ **Run tests locally before committing**
   ```bash
   npm test -- --run
   ```

3. ✅ **Fix all failing tests before pushing**
   - Pre-push hooks will catch failures
   - Don't bypass with `--no-verify`

4. ✅ **Use pre-push hooks** to enforce validation
   - Installed automatically with `npm install`
   - Located in `.githooks/pre-push`

5. ✅ **Review test coverage reports regularly**
   ```bash
   npm run test:coverage
   open coverage/index.html
   ```

---

## Known Issues & Solutions

### Issue 1: E2E Tests Require Backend API

**Status**: Temporarily disabled in CI (PR #86)

**Symptoms**:
- E2E tests fail in CI
- Tests make real HTTP requests to backend

**Root Cause**:
All E2E tests make real HTTP requests to backend API endpoints. In CI, backend is not deployed.

**Solutions**:

**Option 1**: Configure Mock API
```typescript
// playwright.config.ts
webServer: {
  command: 'npm run dev:mock-api',
  url: 'http://localhost:3000',
}
```

**Option 2**: Deploy Test Backend
- Deploy separate test backend stack
- Configure E2E tests to use test backend URL
- Clean up test data after tests

**Temporary Workaround**:
- E2E tests commented out in CI (`.github/workflows/ci.yml:200-280`)
- Run E2E tests locally before pushing
- Manual E2E testing before production deployment

---

### Issue 2: Port Configuration Mismatch

**Status**: ✅ Resolved (PR #86)

**Symptoms**:
- Playwright tests fail to connect to dev server
- Dev server running on port 3000
- Playwright expecting port 5173

**Root Cause**:
Vite dev server configured for port 3000, but Playwright config had default port 5173.

**Solution**:
Updated all Playwright configuration and documentation to port 3000:
- `playwright.config.ts`
- `e2e/README.md`
- `TESTING-GUIDE.md`

**Files Fixed**:
- `frontend/playwright.config.ts:41,86`
- `frontend/e2e/README.md`
- `TESTING-GUIDE.md`

---

### Issue 3: LoginPage POM Selector Mismatch

**Status**: ✅ Resolved (PR #86)

**Symptoms**:
- LoginPage POM tests fail
- Element not found error

**Root Cause**:
POM expected `h4:has-text("Login")`, but actual page had `h1:has-text("Log In")`.

**Solution**:
Fixed selector in LoginPage POM to match actual DOM structure:
```typescript
// Before
await page.locator('h4:has-text("Login")').waitFor();

// After
await page.locator('h1:has-text("Log In")').waitFor();
```

**File Fixed**: `frontend/e2e/pages/LoginPage.ts:16`

**Lesson**: Always inspect actual DOM structure before writing selectors.

---

## Migration Notes

### From No Testing to Comprehensive Testing (PR #86)

**Before PR #86**:
- 382 unit tests
- 0 E2E tests
- No Page Object Model pattern
- Manual testing only

**After PR #86**:
- 499 unit tests (+117 new tests)
- 58 E2E tests (new)
- 7 Page Object Models (new)
- Comprehensive test infrastructure

**Changes**:
1. ✅ Added 117 new unit tests for translation components
2. ✅ Created 58 E2E tests with Playwright
3. ✅ Implemented Page Object Model pattern
4. ✅ Standardized test fixtures and helpers
5. ✅ Updated all documentation

### Port Configuration Update (PR #86)

**Before**: Vite default port 5173
**After**: Custom port 3000

**Reason**: Consistency with backend API expectations and team preferences.

**Files Updated**:
- `vite.config.ts` - Dev server port
- `playwright.config.ts` - Base URL and webServer URL
- `TESTING-GUIDE.md` - Documentation
- `e2e/README.md` - E2E testing docs

---

## Related Documentation

- **Testing Guide**: `TESTING-GUIDE.md` - Local testing instructions (517 lines)
- **E2E Testing Guide**: `frontend/e2e/README.md` - Playwright guide (447 lines)
- **Implementation Plan**: `frontend/TRANSLATION-UI-IMPLEMENTATION-PLAN.md` - Design docs
- **Component Source**: `frontend/src/components/Translation/` - Component code
- **Page Source**: `frontend/src/pages/` - Page components

---

**Last Updated**: 2025-11-23 (extracted from CLAUDE.md)
**Latest PR**: #86 (Complete Translation UI Testing Infrastructure)
**Status**: Production-ready with comprehensive test coverage
