# E2E Testing with Playwright

This directory contains end-to-end (E2E) tests for the LFMT frontend using Playwright.

## Directory Structure

```
e2e/
├── tests/           # Test specifications
│   ├── auth/        # Authentication tests
│   ├── translation/ # Translation workflow tests (TBD)
│   └── integration/ # Full integration tests (TBD)
├── pages/           # Page Object Models (POM)
├── fixtures/        # Test fixtures and utilities
└── utils/           # Shared utilities (TBD)
```

## Setup

### Installation

Playwright and dependencies are already installed. To reinstall or update:

```bash
npm install -D @playwright/test
npx playwright install chromium
```

### Configuration

The Playwright configuration is in `playwright.config.ts` at the project root. Key settings:

- **Test Directory**: `./e2e/tests`
- **Base URL**: `http://localhost:5173` (configurable via `PLAYWRIGHT_BASE_URL` env var)
- **Browsers**: Chromium, Firefox, WebKit, Mobile Chrome, Mobile Safari
- **Auto-start dev server**: Runs `npm run dev` before tests
- **Retries**: 2 retries on CI, 0 locally
- **Timeouts**: 60s per test, 10s per action

## Running Tests

### All Tests (All Browsers)

```bash
npm run test:e2e
```

### Interactive UI Mode

```bash
npm run test:e2e:ui
```

### Headed Mode (See Browser)

```bash
npm run test:e2e:headed
```

### Debug Mode (Step Through)

```bash
npm run test:e2e:debug
```

### Specific Browser

```bash
npm run test:e2e:chromium
npm run test:e2e:firefox
npm run test:e2e:webkit
```

### View Test Report

```bash
npm run test:e2e:report
```

### Environment Variables

- `PLAYWRIGHT_BASE_URL`: Override base URL (default: `http://localhost:5173`)
- `API_BASE_URL`: Backend API URL for API calls (default: `http://localhost:3000`)
- `CI`: Set to `true` to enable CI mode (retries, parallel execution)

Example:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:5173 npm run test:e2e
```

## Page Object Model (POM)

All pages follow the Page Object Model pattern for maintainability and reusability.

### BasePage

`BasePage` provides common functionality for all page objects:

- Navigation (`goto`, `waitForURL`)
- Element interaction (`clickElement`, `fillInput`)
- Waiting and assertions (`waitForElement`, `isVisible`)
- Error handling (`hasErrorMessage`, `getErrorMessage`)

### Existing Page Objects

- **LoginPage** (`e2e/pages/LoginPage.ts`): Login form interactions
- **RegisterPage** (`e2e/pages/RegisterPage.ts`): Registration form interactions
- **DashboardPage** (`e2e/pages/DashboardPage.ts`): Dashboard page interactions

### Creating New Page Objects

```typescript
import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class MyPage extends BasePage {
  // Define locators
  private readonly myButton = 'button[data-testid="my-button"]';

  constructor(page: Page) {
    super(page);
  }

  // Define page-specific methods
  async clickMyButton() {
    await this.clickElement(this.myButton);
  }
}
```

## Test Fixtures

### Test Documents

`e2e/fixtures/test-documents.ts` provides standardized test documents matching backend integration test fixtures:

```typescript
import { TEST_DOCUMENTS, getTestDocument, createTestFile } from '../fixtures/test-documents';

// Get test document content
const doc = TEST_DOCUMENTS.MINIMAL; // or SMALL

// Create File object for upload
const file = createTestFile('MINIMAL');
```

Available documents:
- **MINIMAL**: 1 chunk (~200 words), 30-60 seconds
- **SMALL**: 2-3 chunks (~500 words), 1-2 minutes

### Authentication Helpers

`e2e/fixtures/auth.ts` provides reusable authentication utilities:

```typescript
import { generateTestUser, registerUser, loginUser, registerAndLogin } from '../fixtures/auth';

// Generate unique test user
const user = generateTestUser(); // { email, password, firstName, lastName }

// Register user via UI
await registerUser(page, user);

// Login user via UI
await loginUser(page, user.email, user.password);

// Register and login in one step
const user = await registerAndLogin(page);
```

## Writing Tests

### Test Structure

```typescript
import { test, expect } from '@playwright/test';
import { MyPage } from '../../pages/MyPage';

test.describe('My Feature', () => {
  let myPage: MyPage;

  test.beforeEach(async ({ page }) => {
    myPage = new MyPage(page);
    await myPage.goto();
  });

  test('should do something', async () => {
    // Arrange
    await myPage.fillInput('value');

    // Act
    await myPage.clickButton();

    // Assert
    await expect(myPage.isVisible('.success')).resolves.toBe(true);
  });
});
```

### Best Practices

1. **Use Page Object Model**: Never interact with page elements directly in tests
2. **Unique Test Users**: Always generate unique emails with `generateTestUser()`
3. **Wait for Elements**: Use `waitForElement()` instead of arbitrary timeouts
4. **Descriptive Test Names**: Use `should` format (e.g., "should login with valid credentials")
5. **Test Isolation**: Each test should be independent and not rely on previous tests
6. **Clean Up**: Tests clean up automatically, but verify no side effects

### Assertions

Playwright provides async matchers that auto-wait:

```typescript
// Page assertions
await expect(page).toHaveURL('/dashboard');
await expect(page).toHaveTitle('Dashboard');

// Element assertions
await expect(page.locator('.success')).toBeVisible();
await expect(page.locator('h1')).toHaveText('Welcome');

// Custom assertions with POM
await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
```

## Test Coverage

### Current Coverage

- ✅ Login functionality (valid/invalid credentials, validation)
- ✅ Registration functionality (valid/invalid data, duplicate users)
- ✅ Session management (persistence, logout)
- ✅ Navigation between auth pages

### Planned Coverage (TBD)

- ⏳ Translation upload workflow
- ⏳ Legal attestation
- ⏳ Translation progress tracking
- ⏳ Translation history
- ⏳ Translation detail page
- ⏳ Download completed translations

## CI/CD Integration

E2E tests will be integrated into CI/CD pipeline in future iterations:

```yaml
- name: Run E2E Tests
  run: npm run test:e2e
  env:
    PLAYWRIGHT_BASE_URL: ${{ steps.deploy.outputs.url }}
    API_BASE_URL: ${{ steps.deploy.outputs.api_url }}
```

## Debugging

### Interactive Debugging

Use Playwright Inspector for step-by-step debugging:

```bash
npm run test:e2e:debug
```

### Screenshots and Videos

- **Screenshots**: Captured on failure (in `playwright-report/`)
- **Videos**: Captured on failure (in `playwright-report/`)
- **Traces**: Captured on first retry (view in Playwright trace viewer)

### Viewing Test Results

After test run:

```bash
npm run test:e2e:report
```

This opens an interactive HTML report with:
- Test results and timings
- Screenshots and videos of failures
- Trace viewer for debugging

## Troubleshooting

### Dev Server Not Starting

If tests fail because dev server doesn't start:

1. Verify port 5173 is available
2. Check `npm run dev` works independently
3. Increase timeout in `playwright.config.ts`:
   ```typescript
   webServer: {
     timeout: 180 * 1000, // 3 minutes
   }
   ```

### Browser Not Installed

If you see "Executable doesn't exist" errors:

```bash
npx playwright install chromium
```

### Test Timeouts

If tests timeout frequently:

1. Check network connectivity to backend API
2. Increase test timeout in `playwright.config.ts`:
   ```typescript
   timeout: 90 * 1000, // 90 seconds
   ```
3. Check if backend is running and healthy

### API Connection Issues

If tests fail to connect to backend API:

1. Verify backend is running: `curl http://localhost:3000/v1/health`
2. Check `API_BASE_URL` environment variable
3. Verify no CORS issues in browser console

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)
- [Debugging Tests](https://playwright.dev/docs/debug)
