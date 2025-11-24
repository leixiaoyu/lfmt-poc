# CORS Troubleshooting Guide

**Last Updated**: 2025-11-23
**Project**: LFMT POC
**Critical Issue**: CloudFront Login CORS Error
**Status**: ✅ Root cause identified, fix implemented (PR #92), awaiting deployment

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Timeline of Investigation](#timeline-of-investigation)
3. [Root Cause Analysis](#root-cause-analysis)
4. [The Bug](#the-bug)
5. [The Fix](#the-fix)
6. [Testing and Validation](#testing-and-validation)
7. [Remaining Work](#remaining-work)
8. [Prevention Strategies](#prevention-strategies)

---

## Executive Summary

### Problem Statement

CloudFront login was failing with CORS error despite proper infrastructure configuration:

```
Access to XMLHttpRequest at 'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login'
from origin 'https://d39xcun7144jgl.cloudfront.net' has been blocked by CORS policy:
The 'Access-Control-Allow-Origin' header has a value 'http://localhost:3000'
that is not equal to the supplied origin.
```

### Root Cause

**Lambda functions were not passing the request origin** from `event.headers.origin` to the CORS response helper functions, causing CORS headers to always return the first allowed origin (`http://localhost:3000`) instead of matching the actual request origin.

### Impact

- ❌ Users **cannot log in** from CloudFront URL
- ✅ Local development (localhost:3000) works fine
- ❌ All Lambda responses affected (login, register, refresh-token, etc.)
- ✅ API Gateway OPTIONS preflight works correctly

### Solution

**PR #92**: Pass request origin to all `createSuccessResponse()` and `createErrorResponse()` calls in Lambda functions.

**Status**:
- ✅ Login Lambda fixed
- ⏳ Deployment in progress via CI/CD
- 📋 Remaining Lambdas need same fix (follow-up PR planned)

---

## Timeline of Investigation

### 2025-11-23 (Morning)

**User Report:**
> "I am still getting the following error when trying to log into dev environment."

**Initial Hypothesis:**
CORS configuration issue in API Gateway or CloudFront infrastructure.

### Investigation Phase 1: Infrastructure Check

**Action**: Reviewed PR #91 which attempted to fix CORS by hardcoding CloudFront URL in infrastructure.

```typescript
// backend/infrastructure/lib/lfmt-infrastructure-stack.ts:86
origins.push('https://d39xcun7144jgl.cloudfront.net');
```

**Result**: PR #91 was merged and deployed successfully.

**Problem**: Login still failing with same CORS error!

### Investigation Phase 2: CDK Diff Analysis

**Action**: Ran `cdk diff` to check if infrastructure change was detected.

```bash
cd backend/infrastructure
npx cdk diff --context environment=dev
```

**Result**:
```
Stack LfmtPocDev
There were no differences

✨  Number of stacks with differences: 0
```

**Critical Discovery**: CDK reported **"no differences"** - the infrastructure deployment was a **no-op**!

**Why?**: The hardcoded URL on line 86 was already present from a previous attempt. CDK didn't see any material changes.

### Investigation Phase 3: Lambda Environment Variables

**Action**: Checked if Lambda functions have correct environment variables.

```bash
aws lambda get-function-configuration \
  --function-name "lfmt-login-LfmtPocDev" \
  --query 'Environment.Variables.ALLOWED_ORIGINS'
```

**Result**:
```
http://localhost:3000,https://localhost:3000,https://d39xcun7144jgl.cloudfront.net,https://d39xcun7144jgl.cloudfront.net
```

**Discovery**: Lambda environment variables **are correct** and include CloudFront URL!

### Investigation Phase 4: Playwright CORS Debugging

**Action**: Created comprehensive Playwright test to capture actual CORS headers.

```typescript
// frontend/e2e/tests/cors-debug.spec.ts
test('should capture CORS headers from API Gateway', async ({ page }) => {
  page.on('response', async (response) => {
    if (response.url().includes(API_URL)) {
      const headers = response.headers();
      console.log('Access-Control-Allow-Origin:', headers['access-control-allow-origin']);
    }
  });

  await page.goto(`${CLOUDFRONT_URL}/login`);
  await page.fill('input[name="email"]', 'test@test.io');
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
});
```

**Test Results**:
- ✅ **OPTIONS preflight**: Returns `https://d39xcun7144jgl.cloudfront.net`
- ❌ **POST /auth/login**: Returns `http://localhost:3000`
- ❌ **GET /auth/me**: Returns `http://localhost:3000`

**Key Insight**: API Gateway OPTIONS works, but Lambda responses don't!

### Investigation Phase 5: Lambda Code Review

**Action**: Reviewed `backend/functions/shared/api-response.ts` CORS logic.

```typescript
// backend/functions/shared/api-response.ts:29-39
export function getCorsHeaders(requestOrigin?: string): Record<string, string> {
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map(origin => origin.trim())
    : ['http://localhost:3000'];

  // If requestOrigin matches an allowed origin, use it; otherwise use first allowed origin
  const allowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0];  // ❌ ALWAYS returns localhost:3000 when requestOrigin is undefined
}
```

**Discovery**: The logic is correct! If `requestOrigin` is provided and matches, it returns the matching origin.

**But**: Lambda functions **never pass** `requestOrigin`!

**Action**: Checked how `login.ts` calls `createErrorResponse()`.

```typescript
// backend/functions/auth/login.ts:59-64
return createErrorResponse(
  400,
  'Validation failed',
  requestId,
  validationResult.error.flatten().fieldErrors
  // ❌ Missing: requestOrigin parameter!
);
```

**EUREKA MOMENT**: Lambda functions are **not extracting** `event.headers.origin` and **not passing** it to response functions!

---

## Root Cause Analysis

### The Architecture

```
Browser Request
    ↓
    Origin: https://d39xcun7144jgl.cloudfront.net
    ↓
API Gateway
    ↓
Lambda Function (login.ts)
    ↓
event.headers = {
    origin: 'https://d39xcun7144jgl.cloudfront.net',  // ✅ Present in event
    ...
}
    ↓
handler() {
    const requestOrigin = ???;  // ❌ NEVER EXTRACTED!
    return createErrorResponse(401, 'Invalid', requestId);  // ❌ Missing requestOrigin param
}
    ↓
getCorsHeaders(requestOrigin) {
    // requestOrigin = undefined
    return allowedOrigins[0];  // Returns 'http://localhost:3000'
}
    ↓
Response Headers
    Access-Control-Allow-Origin: http://localhost:3000  // ❌ WRONG!
```

### Why This Happened

1. **Lambda environment variables configured correctly** ✅
2. **API Gateway CORS configured correctly** ✅
3. **`getCorsHeaders()` logic correct** ✅
4. **BUT Lambda functions never extracted `event.headers.origin`** ❌
5. **AND Lambda functions never passed `requestOrigin` to response helpers** ❌

### Why OPTIONS Worked But POST Didn't

**OPTIONS Preflight**:
- Handled by **API Gateway** directly
- Uses `defaultCorsPreflightOptions.allowOrigins` configuration
- Configuration includes CloudFront URL
- **Result**: Returns correct origin ✅

**POST /auth/login**:
- Handled by **Lambda function**
- Uses `getCorsHeaders(requestOrigin)` helper
- `requestOrigin` is `undefined` (never extracted)
- Falls back to first origin: `http://localhost:3000`
- **Result**: Returns wrong origin ❌

---

## The Bug

### Affected Files

**Primary Issue**: `backend/functions/auth/login.ts` (and all other Lambda functions)

```typescript
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  // ❌ MISSING: Extract request origin from event.headers

  try {
    // ... validation logic ...

    return createErrorResponse(
      400,
      'Validation failed',
      requestId,
      validationResult.error.flatten().fieldErrors
      // ❌ MISSING: requestOrigin parameter
    );
  } catch (error) {
    return createErrorResponse(
      500,
      'Internal error',
      requestId
      // ❌ MISSING: undefined (for errors param) and requestOrigin
    );
  }
};
```

### Why It's Critical

**Impact Level**: **CRITICAL** - Blocks all CloudFront users from logging in

**Severity**:
- P0: Highest priority
- Production blocker if deployed to prod
- Affects all Lambda functions with CORS responses

**User Impact**:
- Cannot log in from CloudFront URL
- Cannot register new accounts
- Cannot refresh tokens
- Cannot reset password

---

## The Fix

### PR #92: Login Lambda CORS Request Origin Fix

**Repository**: https://github.com/leixiaoyu/lfmt-poc/pull/92
**Status**: Merged, awaiting deployment
**Files Changed**: `backend/functions/auth/login.ts`

### Changes

#### 1. Extract Request Origin (Case-Insensitive)

```typescript
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  // ✅ NEW: Extract request origin for CORS handling (case-insensitive header lookup)
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Processing login request', { requestId, requestOrigin });
  // ...
};
```

**Why Case-Insensitive?**
- API Gateway may normalize headers to lowercase
- Browser may send `Origin` or `origin`
- Safe fallback ensures we always capture it

#### 2. Pass Request Origin to Error Responses

```typescript
// ✅ BEFORE
return createErrorResponse(
  400,
  'Validation failed',
  requestId,
  validationResult.error.flatten().fieldErrors
);

// ✅ AFTER
return createErrorResponse(
  400,
  'Validation failed',
  requestId,
  validationResult.error.flatten().fieldErrors,
  requestOrigin  // ✅ NEW: Pass request origin
);
```

**For errors without field errors:**

```typescript
// ✅ AFTER
return createErrorResponse(
  500,
  'Authentication failed unexpectedly',
  requestId,
  undefined,     // No field errors
  requestOrigin  // ✅ NEW: Pass request origin
);
```

#### 3. Replace Manual Header Construction

```typescript
// ❌ BEFORE: Manual header construction
return {
  statusCode: 200,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:3000',  // ❌ Wrong!
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': '...',
    'Access-Control-Allow-Methods': '...',
  },
  body: JSON.stringify({...})
};

// ✅ AFTER: Use getCorsHeaders() helper
import { getCorsHeaders } from '../shared/api-response';

return {
  statusCode: 200,
  headers: getCorsHeaders(requestOrigin),  // ✅ Correct: Uses request origin
  body: JSON.stringify({...})
};
```

### Full Diff

```diff
+ import { createSuccessResponse, createErrorResponse, getCorsHeaders } from '../shared/api-response';

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
+  // Extract request origin for CORS handling (case-insensitive header lookup)
+  const requestOrigin = event.headers.origin || event.headers.Origin;

-  logger.info('Processing login request', { requestId });
+  logger.info('Processing login request', { requestId, requestOrigin });

  try {
    // ... validation ...

    return createErrorResponse(
      400,
      'Validation failed',
      requestId,
-      validationResult.error.flatten().fieldErrors
+      validationResult.error.flatten().fieldErrors,
+      requestOrigin
    );

    // ... auth logic ...

    return {
      statusCode: 200,
-      headers: {
-        'Content-Type': 'application/json',
-        'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
-        'Access-Control-Allow-Credentials': 'true',
-        'Access-Control-Allow-Headers': '...',
-        'Access-Control-Allow-Methods': '...',
-      },
+      headers: getCorsHeaders(requestOrigin),
      body: JSON.stringify({...})
    };
  } catch (error) {
    return createErrorResponse(
      500,
      'Internal error',
-      requestId
+      requestId,
+      undefined,
+      requestOrigin
    );
  }
};
```

---

## Testing and Validation

### 1. Playwright CORS Debug Test

**Location**: `frontend/e2e/tests/cors-debug.spec.ts`

**Purpose**:
- Capture actual CORS headers from API responses
- Test OPTIONS preflight and POST requests separately
- Compare localhost vs CloudFront CORS behavior

**Test Cases**:

```typescript
test('should capture CORS headers from API Gateway', async ({ page }) => {
  // Intercept network responses
  page.on('response', async (response) => {
    if (response.url().includes(API_URL)) {
      const headers = response.headers();
      console.log('Access-Control-Allow-Origin:', headers['access-control-allow-origin']);
    }
  });

  // Navigate to CloudFront URL and attempt login
  await page.goto(`${CLOUDFRONT_URL}/login`);
  await page.fill('input[name="email"]', 'test@test.io');
  await page.fill('input[name="password"]', 'TestPassword123!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Verify CORS header matches CloudFront URL
  expect(allowedOrigin).toBe(CLOUDFRONT_URL);
});

test('should test OPTIONS preflight request', async ({ request }) => {
  const response = await request.fetch(`${API_URL}/auth/login`, {
    method: 'OPTIONS',
    headers: {
      'Origin': CLOUDFRONT_URL,
      'Access-Control-Request-Method': 'POST',
    },
  });

  const allowedOrigin = response.headers()['access-control-allow-origin'];
  expect(allowedOrigin).toBe(CLOUDFRONT_URL);
});

test('should test POST request with CORS', async ({ request }) => {
  const response = await request.post(`${API_URL}/auth/login`, {
    headers: {
      'Origin': CLOUDFRONT_URL,
      'Content-Type': 'application/json',
    },
    data: { email: 'test@test.io', password: 'TestPassword123!' },
  });

  const allowedOrigin = response.headers()['access-control-allow-origin'];
  expect(allowedOrigin).toBe(CLOUDFRONT_URL);
});

test('should compare localhost vs CloudFront CORS behavior', async ({ request }) => {
  // Test with localhost
  const localhostResponse = await request.fetch(`${API_URL}/auth/me`, {
    method: 'GET',
    headers: { 'Origin': 'http://localhost:3000' },
  });

  // Test with CloudFront
  const cloudFrontResponse = await request.fetch(`${API_URL}/auth/me`, {
    method: 'GET',
    headers: { 'Origin': CLOUDFRONT_URL },
  });

  // Both should return matching origin
  expect(localhostHeaders['access-control-allow-origin']).toBe('http://localhost:3000');
  expect(cloudFrontHeaders['access-control-allow-origin']).toBe(CLOUDFRONT_URL);
});
```

**Run Test**:
```bash
cd frontend
npm run test:e2e -- e2e/tests/cors-debug.spec.ts
```

**Expected Results After Fix**:
- ✅ All 4 test cases pass
- ✅ CORS headers match request origin for both localhost and CloudFront
- ✅ No CORS errors in browser console

### 2. Manual Validation

**Test CloudFront Login**:

1. Open https://d39xcun7144jgl.cloudfront.net/login
2. Open browser DevTools → Network tab
3. Enter credentials and click "Log In"
4. Check `/auth/login` request headers:
   - Request: `Origin: https://d39xcun7144jgl.cloudfront.net`
   - Response: `Access-Control-Allow-Origin: https://d39xcun7144jgl.cloudfront.net` ✅

**Test Localhost Login** (should still work):

1. Run `npm run dev` → http://localhost:3000
2. Open browser DevTools → Network tab
3. Enter credentials and click "Log In"
4. Check `/auth/login` request headers:
   - Request: `Origin: http://localhost:3000`
   - Response: `Access-Control-Allow-Origin: http://localhost:3000` ✅

### 3. CI/CD Validation

**GitHub Actions Workflow**: `.github/workflows/deploy.yml`

**Validation Steps**:
1. ✅ Unit tests pass (296/296 backend function tests)
2. ✅ Integration tests pass
3. ✅ Infrastructure tests pass (50/50)
4. ✅ CDK synth succeeds
5. ✅ Lambda deployment succeeds
6. ⏳ **E2E CORS test validation** (run after deployment)

**Deployment Status**: Monitor at https://github.com/leixiaoyu/lfmt-poc/pull/92

---

## Remaining Work

### Immediate (PR #92)

- ⏳ **Wait for CI/CD deployment** to dev environment
- ⏳ **Validate CloudFront login works** after deployment
- ⏳ **Run Playwright CORS debug test** to confirm fix
- ⏳ **Close issue** if fix validated

### Short-Term (Follow-Up PR)

The following Lambda functions **need the same fix**:

#### Auth Lambdas
1. ❌ `register.ts` - User registration
2. ❌ `refresh-token.ts` - Token refresh
3. ❌ `reset-password.ts` - Password reset
4. ❌ `get-current-user.ts` - User profile retrieval

#### Upload/Translation Lambdas
5. ❌ `upload-request.ts` - Presigned URL generation
6. ❌ `upload-complete.ts` - Upload confirmation
7. ❌ `get-translation-status.ts` - Status polling

**Action Plan**:
1. Create new branch: `fix/cors-all-lambdas`
2. Apply same fix pattern to all Lambda functions
3. Update all `createSuccessResponse()` calls
4. Update all `createErrorResponse()` calls
5. Run full test suite (unit + integration + E2E)
6. Create PR and merge via CI/CD

**Estimated Effort**: 2-3 hours

### Medium-Term (Testing Infrastructure)

**Auth Lambda Unit Tests**:
- ❌ Update auth tests to mock request origin
- ❌ Add test cases for CORS header validation
- ❌ Ensure tests cover both localhost and CloudFront origins

**Integration Tests**:
- ❌ Add CORS validation to integration test suite
- ❌ Test cross-origin requests in test environment

### Long-Term (Prevention)

**Code Review Checklist**:
- ✅ All Lambda responses extract `event.headers.origin`
- ✅ All response helpers receive `requestOrigin` parameter
- ✅ No manual CORS header construction (use `getCorsHeaders()`)
- ✅ Test CORS with multiple origins (localhost + CloudFront)

**Linting Rules**:
- Consider ESLint rule to enforce CORS parameter passing
- Detect manual CORS header construction

**Documentation**:
- ✅ Update Lambda development guide with CORS best practices
- ✅ Add CORS troubleshooting guide (this document)

---

## Prevention Strategies

### 1. Code Template for Lambda Functions

**Standard Lambda Handler Template**:

```typescript
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { createSuccessResponse, createErrorResponse, getCorsHeaders } from '../shared/api-response';
import Logger from '../shared/logger';

const logger = new Logger('lambda-name');

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  // ✅ ALWAYS extract request origin (case-insensitive)
  const requestOrigin = event.headers.origin || event.headers.Origin;

  logger.info('Processing request', { requestId, requestOrigin });

  try {
    // Business logic here

    // ✅ ALWAYS pass requestOrigin to response functions
    return createSuccessResponse(
      200,
      { data: {...} },
      requestId,
      requestOrigin
    );
  } catch (error) {
    return createErrorResponse(
      500,
      'Internal error',
      requestId,
      undefined,  // errors (if any)
      requestOrigin
    );
  }
};
```

### 2. Response Helper Best Practices

**Never construct CORS headers manually**:

```typescript
// ❌ BAD: Manual header construction
return {
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': 'http://localhost:3000',  // Hardcoded!
    'Access-Control-Allow-Credentials': 'true',
  },
  body: JSON.stringify({...})
};

// ✅ GOOD: Use getCorsHeaders() helper
return {
  statusCode: 200,
  headers: getCorsHeaders(requestOrigin),  // Matches actual request origin
  body: JSON.stringify({...})
};
```

### 3. Testing Checklist

**For every Lambda function:**

- [ ] Extract `event.headers.origin` or `event.headers.Origin`
- [ ] Log `requestOrigin` in initial log statement
- [ ] Pass `requestOrigin` to all `createSuccessResponse()` calls
- [ ] Pass `requestOrigin` to all `createErrorResponse()` calls
- [ ] No manual CORS header construction
- [ ] Unit test validates CORS headers match request origin
- [ ] Integration test validates cross-origin requests

### 4. Deployment Validation

**After every Lambda deployment:**

```bash
# Run Playwright CORS debug test
cd frontend
npm run test:e2e -- e2e/tests/cors-debug.spec.ts

# Manually test CloudFront login
open https://d39xcun7144jgl.cloudfront.net/login

# Check browser DevTools → Network tab → /auth/login response headers
# Verify: Access-Control-Allow-Origin matches CloudFront URL
```

### 5. Monitoring and Alerts

**CloudWatch Log Insights Query**:

```sql
fields @timestamp, @message
| filter @message like /CORS/
| filter @message like /origin/
| stats count() by requestOrigin
| sort count desc
```

**Purpose**: Monitor which origins are making requests and ensure CORS headers are being set correctly.

**Alert**: Set up CloudWatch alarm for CORS errors (4xx responses from cross-origin requests).

---

## Appendix

### A. Related Pull Requests

- **PR #89**: CORS Upload Workflow Fix (S3 presigned URLs) - ✅ Merged
- **PR #90**: CI/CD Health Check Fix - ✅ Merged
- **PR #91**: CloudFront CORS Infrastructure Fix (ATTEMPTED) - ✅ Merged (but was no-op)
- **PR #92**: Login Lambda CORS Request Origin Fix - ⏳ In Progress

### B. Key Infrastructure Files

**Backend Infrastructure**:
- `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:83-95` - `getAllowedApiOrigins()`
- `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:377-389` - API Gateway CORS config

**Lambda Functions**:
- `backend/functions/shared/api-response.ts:29-48` - `getCorsHeaders()` helper
- `backend/functions/auth/login.ts` - Login Lambda (✅ fixed in PR #92)
- `backend/functions/auth/register.ts` - Register Lambda (❌ needs fix)
- `backend/functions/auth/refresh-token.ts` - Refresh token Lambda (❌ needs fix)
- `backend/functions/auth/reset-password.ts` - Reset password Lambda (❌ needs fix)
- `backend/functions/auth/get-current-user.ts` - Get user Lambda (❌ needs fix)

**Frontend Testing**:
- `frontend/e2e/tests/cors-debug.spec.ts` - CORS debugging test suite

### C. Environment Variables

**Lambda Environment Variables** (configured in CDK):

```typescript
ALLOWED_ORIGINS = "http://localhost:3000,https://localhost:3000,https://d39xcun7144jgl.cloudfront.net"
```

**How to Check**:
```bash
aws lambda get-function-configuration \
  --function-name "lfmt-login-LfmtPocDev" \
  --query 'Environment.Variables.ALLOWED_ORIGINS'
```

### D. CORS Flow Diagram

```
┌─────────────────┐
│   Browser       │
│  CloudFront URL │
└────────┬────────┘
         │ Origin: https://d39xcun7144jgl.cloudfront.net
         ▼
┌─────────────────────────────────────────────┐
│           API Gateway                       │
│                                             │
│  OPTIONS (preflight):                       │
│    ✅ Returns CloudFront URL in CORS       │
│       (handled by API Gateway config)       │
│                                             │
│  POST (actual request):                     │
│    Forwards to Lambda function             │
└────────┬────────────────────────────────────┘
         │ event.headers.origin = CloudFront URL
         ▼
┌─────────────────────────────────────────────┐
│        Lambda Function (login.ts)           │
│                                             │
│  ✅ Extract: requestOrigin = event.headers.origin
│  ✅ Pass to: createErrorResponse(..., requestOrigin)
│  ✅ Uses: getCorsHeaders(requestOrigin)    │
│  ✅ Returns matching origin in CORS header │
└────────┬────────────────────────────────────┘
         │ Access-Control-Allow-Origin: https://d39xcun7144jgl.cloudfront.net
         ▼
┌─────────────────┐
│   Browser       │
│  ✅ CORS pass!  │
└─────────────────┘
```

### E. References

- **MDN CORS**: https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS
- **AWS API Gateway CORS**: https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
- **Playwright Testing**: https://playwright.dev/
- **GitHub PR #92**: https://github.com/leixiaoyu/lfmt-poc/pull/92

---

**Document Owner**: Raymond Lei (leixiaoyu@github)
**Last Updated**: 2025-11-23
**Status**: Living document - Update after deployment validation
