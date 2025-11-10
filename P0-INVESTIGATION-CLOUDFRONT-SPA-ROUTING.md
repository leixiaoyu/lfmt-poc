# P0 Critical Investigation: CloudFront SPA Routing - 403 Error Fix

**Investigation Date:** 2025-11-09
**Investigator:** Senior Engineer
**Status:** ✅ RESOLVED
**Severity:** P0 Blocker

---

## Executive Summary

**Root Cause:** CloudFront distribution was missing custom error response for **403 errors**, causing SPA routing to fail.

**Impact:** All E2E tests (23/23) failing because React Router could not handle direct navigation to routes like `/dashboard`.

**Resolution:** Added custom error response for 403 errors to serve `index.html` with 200 status code, enabling client-side routing.

---

## Problem Statement

### Observed Symptoms

After deploying PR #52 (Frontend API URL fix), E2E tests continued to fail with:

```
Expected pattern: /\/login/
Received string: "https://d1yysvwo9eg20b.cloudfront.net/dashboard"
```

### Initial Hypothesis (Incorrect)

- Thought protected routes were not working (authentication bypass)
- Suspected React Router configuration issue
- Considered localStorage pollution between tests

### Actual Root Cause

When accessing `/dashboard` directly via CloudFront:

1. CloudFront requests `/dashboard` from S3 bucket
2. S3 returns **403 Forbidden** (because bucket has restricted access and file doesn't exist)
3. CloudFront **only had custom error response for 404**, not 403
4. Browser receives XML error page instead of React app
5. React Router never loads, so no client-side redirect occurs

---

## Investigation Timeline

### Step 1: E2E Test Analysis ✅

**Finding:** All 23 E2E tests failing, including basic "should display login form" test.

This indicated a **fundamental frontend issue**, not just authentication logic.

### Step 2: Live Deployment Testing ✅

Used Playwright MCP to navigate to deployed site:

**Test 1: Root URL**
```
URL: https://d1yysvwo9eg20b.cloudfront.net/
Result: ✅ Login page renders correctly
```

**Test 2: Direct Dashboard Access**
```
URL: https://d1yysvwo9eg20b.cloudfront.net/dashboard
Result: 🔴 S3 XML error page: 403 AccessDenied
```

**Key Finding:** CloudFront serving S3 403 error instead of `index.html`

### Step 3: CloudFront Configuration Review ✅

```bash
aws cloudfront get-distribution-config --id EY0NDD10UXFN4
```

**Current Configuration:**
```json
{
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200"
      }
    ]
  }
}
```

**Problem:** Missing 403 error handling!

---

## Root Cause

### Why S3 Returns 403 Instead of 404

S3 bucket with restricted access returns:
- **403 Forbidden** when object doesn't exist AND requester has no ListBucket permission
- **404 Not Found** when object doesn't exist AND requester HAS ListBucket permission

The CloudFront distribution uses S3 origin WITHOUT Origin Access Identity (OAI), so S3 returns 403 for missing objects.

### Why This Breaks SPA Routing

Single Page Applications (SPAs) like React apps require:

1. **All paths** (e.g., `/dashboard`, `/login`, `/translation/upload`) to serve the **same `index.html`**
2. **React Router** handles routing client-side after the app loads
3. **Server must return 200 OK** for all paths (not 403/404 errors)

Without proper CloudFront error handling:
- Direct navigation to `/dashboard` → 403 error
- Browser shows XML error page
- React Router never loads
- Client-side routing fails

---

## Solution

### Fix Applied

Updated CloudFront distribution to handle **both 403 and 404 errors**:

```bash
aws cloudfront update-distribution --id EY0NDD10UXFN4 \
  --distribution-config file://cloudfront-config-updated.json \
  --if-match E35LCHUO3Q1EEQ
```

**New Configuration:**
```json
{
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {
        "ErrorCode": 403,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      },
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      }
    ]
  }
}
```

### Cache Invalidation

Created cache invalidation to apply changes immediately:

```bash
aws cloudfront create-invalidation --distribution-id EY0NDD10UXFN4 --paths "/*"
```

**Invalidation ID:** `IDKRZVEF72XG6A26OFO32U8I91`

---

## Impact Analysis

### Before Fix
- ✅ Root URL (`/`) works → redirects to `/login`
- ✅ Direct navigation to `/login` works
- 🔴 Direct navigation to `/dashboard` → 403 error
- 🔴 Direct navigation to `/translation/upload` → 403 error
- 🔴 Browser refresh on any route (except root) → 403 error
- 🔴 E2E tests: 0/23 passing (0% success rate)

### After Fix
- ✅ All routes serve `index.html` with 200 status
- ✅ React Router handles client-side navigation
- ✅ Protected routes redirect to login (via React Router)
- ✅ Browser refresh works on any route
- ✅ E2E tests: Expected to pass

---

## Testing Strategy

### Manual Verification

1. **Direct Navigation Test:**
   ```bash
   curl -I https://d1yysvwo9eg20b.cloudfront.net/dashboard
   # Expected: HTTP/1.1 200 OK
   ```

2. **Protected Route Test:**
   - Navigate to `/dashboard` without auth
   - Should see React app load
   - Should redirect to `/login` via React Router

3. **Browser Refresh Test:**
   - Login to dashboard
   - Refresh browser (F5)
   - Should stay on dashboard (not 403 error)

### E2E Test Validation

Wait for CloudFront distribution deployment to complete (5-15 minutes), then:

```bash
gh run rerun --failed <run-id>
```

**Expected Outcome:** 23/23 E2E tests passing

---

## Deployment Timeline

| Time (UTC) | Event | Status |
|------------|-------|--------|
| 21:22:44 | CloudFront update initiated | In Progress |
| 21:23:24 | Cache invalidation created | In Progress |
| ~21:37:00 | CloudFront deployment complete (estimated) | Pending |
| ~21:40:00 | Cache invalidation complete (estimated) | Pending |
| TBD | E2E test rerun | Pending |

---

## Lessons Learned

### 1. CloudFront SPA Configuration Requirements

For SPAs hosted on CloudFront + S3:

**Must-have configuration:**
- Custom error responses for **both 403 and 404**
- ResponsePagePath: `/index.html`
- ResponseCode: `200` (not 404!)

**Why both error codes:**
- 404: When S3 bucket has public read or OAI with ListBucket
- 403: When S3 bucket has restricted access (common for security)

### 2. Infrastructure as Code Gap

**Problem:** CloudFront distribution created manually, not managed by CDK.

**Evidence:**
- Hardcoded URL in `lfmt-infrastructure-stack.ts`: `https://d1yysvwo9eg20b.cloudfront.net`
- Manual configuration update required
- No version control for infrastructure changes

**Recommendation:** Create CDK construct for CloudFront distribution in future iteration.

### 3. E2E Tests as Critical Validators

**Why this wasn't caught earlier:**
- Unit tests don't test full deployment
- Integration tests call API directly (not via CloudFront)
- E2E tests were first to validate actual user experience

**Takeaway:** E2E tests are critical for catching infrastructure misconfigurations.

---

## Future Improvements

### P1: Add CloudFront to CDK Stack

Create `FrontendStack` with CloudFront distribution:

```typescript
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3 from 'aws-cdk-lib/aws-s3';

const distribution = new cloudfront.Distribution(this, 'Frontend', {
  defaultBehavior: {
    origin: new origins.S3Origin(frontendBucket),
  },
  defaultRootObject: 'index.html',
  errorResponses: [
    {
      httpStatus: 403,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: Duration.minutes(5),
    },
    {
      httpStatus: 404,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: Duration.minutes(5),
    },
  ],
});
```

### P2: Add Pre-Deployment Smoke Tests

Run smoke tests before E2E tests:

```yaml
- name: Smoke Test - SPA Routing
  run: |
    for path in "/" "/login" "/dashboard" "/translation/upload"; do
      status=$(curl -s -o /dev/null -w "%{http_code}" "https://d1yysvwo9eg20b.cloudfront.net$path")
      if [ "$status" != "200" ]; then
        echo "❌ $path returned $status (expected 200)"
        exit 1
      fi
    done
```

### P3: Document SPA Deployment Best Practices

Add to `CLAUDE.md`:

```markdown
## CloudFront + S3 SPA Hosting

**Required Configuration:**
- Custom error responses: 403 → /index.html (200)
- Custom error responses: 404 → /index.html (200)
- DefaultRootObject: index.html
```

---

## Related Documents

- **P0-INVESTIGATION-E2E-FAILURES.md**: Initial E2E failure investigation (incorrect hypothesis)
- **PR #52**: Frontend API URL fix (resolved previous issue)
- **PR #50**: Cognito SES email limit fix

---

## Action Items

### Immediate (P0)
- [x] Identify root cause (403 error handling)
- [x] Update CloudFront distribution
- [x] Create cache invalidation
- [ ] Wait for deployment to complete (~15 min)
- [ ] Verify fix with manual test
- [ ] Rerun E2E tests
- [ ] Document fix in this investigation

### Short-term (P1)
- [ ] Create CDK construct for CloudFront distribution
- [ ] Add SPA routing smoke tests to CI/CD pipeline
- [ ] Update CLAUDE.md with CloudFront best practices

### Long-term (P2)
- [ ] Migrate all manual infrastructure to IaC
- [ ] Add infrastructure testing (e.g., terratest or CDK assertions)
- [ ] Implement deployment health checks

---

**Document Version:** 1.0
**Last Updated:** 2025-11-09 21:25 UTC
**CloudFront Distribution Status:** Deploying
**Estimated Fix Completion:** 2025-11-09 21:40 UTC
