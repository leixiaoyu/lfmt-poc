# P0 Critical Investigation: E2E Test Failures - Root Cause Analysis

**Investigation Date:** 2025-11-09
**Investigator:** Senior Engineer
**Status:** ✅ ROOT CAUSE IDENTIFIED
**Severity:** P0 Blocker

---

## Executive Summary

**Initial Hypothesis:** CloudFront propagation delay causing frontend readiness timeouts (5+ minutes)
**Actual Root Cause:** **Frontend built WITHOUT API URL configuration**

The E2E tests fail NOT because CloudFront is slow, but because **the React app is deployed with undefined `VITE_API_URL`**. The frontend loads instantly (<1 second), but the React app never renders because all API calls fail (defaulting to `/api` which doesn't exist).

---

## Investigation Timeline

### Step 1: E2E Test Timeout Analysis ✅

**Observation from CI logs:**
```
2025-11-09T02:20:30.5723572Z Waiting for frontend to be ready...
2025-11-09T02:20:30.9283396Z Frontend is ready!  <-- 0.4 seconds

2025-11-09T02:46:59.1940489Z Error: locator.waitFor: Test timeout of 60000ms exceeded.
2025-11-09T02:46:59.1942194Z - waiting for locator('h4:has-text("Login")') to be visible
```

**Key Finding:**
- CloudFront responds 200 OK in **<1 second** ✅
- React app **never renders** the login page 🔴
- Tests timeout after 60 seconds waiting for UI elements

---

### Step 2: React App Code Review ✅

**App.tsx Analysis (lines 19-28):**
```typescript
import { lazy, Suspense } from 'react';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
// ... other lazy-loaded pages
```

**Finding:** Lazy loading is properly implemented ✅

**Constants.ts Analysis (line 17):**
```typescript
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || '/api',
  // ...
}
```

**Finding:** Falls back to `/api` if `VITE_API_URL` is undefined 🔴

---

### Step 3: CI/CD Workflow Analysis 🔴

**Critical Bug Found in `.github/workflows/deploy.yml`:**

#### Build Frontend Job (lines 92-94)
```yaml
- name: Build frontend (production)
  working-directory: frontend
  run: npm run build
  env:
    NODE_ENV: production
    # ❌ VITE_API_URL is NOT set here!
```

**Vite embeds environment variables at BUILD TIME:**
- `import.meta.env.VITE_API_URL` is replaced with its value during `npm run build`
- If undefined during build, the app is compiled with `BASE_URL: '/api'`

#### Deploy to Development Job (lines 190-194)
```yaml
- name: Create frontend .env.production
  working-directory: frontend
  run: |
    echo "VITE_API_URL=${{ steps.get-url.outputs.api_url }}" > .env.production
    # ⚠️ Too late! Build already happened in previous job
```

**The `.env.production` file is created AFTER the build**, so it has no effect.

---

## Root Cause

**Build-Time vs Runtime Configuration Mismatch**

1. **Build Frontend job** (line 92): Compiles React app WITHOUT `VITE_API_URL`
2. **Upload Artifacts** (line 98): Saves the misconfigured `dist/` folder
3. **Deploy to Dev job** (line 184): Downloads the already-built artifacts
4. **Create .env.production** (line 190): Creates env file AFTER build (has no effect)
5. **Deploy to S3** (line 196): Deploys the misconfigured app

**Result:**
- Deployed app has `API_CONFIG.BASE_URL = '/api'`
- All API calls fail because `/api` proxy doesn't exist in production
- React app loads the shell but fails to fetch data
- UI never renders, E2E tests timeout

---

## Impact Analysis

### Affected Components
1. ✅ **CloudFront**: Healthy, propagates in <1 second
2. 🔴 **Frontend App**: Deployed with incorrect API URL
3. 🔴 **E2E Tests**: Fail because UI never loads
4. 🔴 **User Experience**: App completely broken (would show errors in browser console)

### Why This Wasn't Caught Earlier
- **Backend integration tests**: Pass (they call API directly)
- **Frontend unit tests**: Pass (they mock API calls)
- **E2E tests**: First time running against deployed environment (catch the bug!)

---

## Solution

### Option 1: Pass API URL as Build Argument (Recommended)

Modify the workflow to pass `VITE_API_URL` during the build step:

```yaml
build-frontend:
  name: Build Frontend
  needs: [test, deploy-dev]  # Wait for deploy-dev to get API URL
  steps:
    # ... checkout, setup ...

    - name: Build frontend (production)
      working-directory: frontend
      run: npm run build
      env:
        NODE_ENV: production
        VITE_API_URL: ${{ needs.deploy-dev.outputs.api_url }}
```

**Pros:**
- Clean separation of concerns
- Env vars embedded at build time (Vite's intended behavior)
- No runtime configuration needed

**Cons:**
- Job dependency reversal (frontend build depends on backend deploy)
- Longer pipeline (sequential instead of parallel)

### Option 2: Runtime Configuration with Script

Replace `import.meta.env` with runtime configuration:

```typescript
// src/config/runtime.ts
export const API_CONFIG = {
  BASE_URL: (window as any).__RUNTIME_CONFIG__?.API_URL || '/api',
}
```

Inject config in `index.html`:
```html
<script>
  window.__RUNTIME_CONFIG__ = {
    API_URL: '%%VITE_API_URL%%'
  };
</script>
```

Replace placeholder during deployment:
```yaml
- name: Configure runtime API URL
  run: |
    sed -i 's|%%VITE_API_URL%%|${{ steps.get-url.outputs.api_url }}|g' frontend/dist/index.html
```

**Pros:**
- Maintains parallel build/deploy jobs
- Faster pipeline

**Cons:**
- Requires code changes
- Less secure (config exposed in HTML)
- Not Vite's intended pattern

### Option 3: Rebuild Frontend After Deploy (Quick Fix)

Add a rebuild step in the deploy job:

```yaml
deploy-dev:
  steps:
    # ... CDK deploy ...

    - name: Rebuild frontend with API URL
      working-directory: frontend
      run: npm run build
      env:
        NODE_ENV: production
        VITE_API_URL: ${{ steps.get-url.outputs.api_url }}

    - name: Deploy frontend to S3
      run: aws s3 sync frontend/dist/ s3://lfmt-poc-frontend/ --delete
```

**Pros:**
- Minimal workflow changes
- Preserves Vite's build-time configuration

**Cons:**
- Rebuilds frontend twice (waste of CI time)
- Doesn't use build-frontend job artifacts

---

## Recommended Solution

**Hybrid Approach: Conditional Build Strategy**

1. **For feature branches**: Use existing parallel build (API URL not critical for PR validation)
2. **For main branch deployments**: Use Option 3 (rebuild with API URL)

```yaml
deploy-dev:
  steps:
    # ... CDK deploy and get API URL ...

    - name: Download or rebuild frontend
      run: |
        if [ "${{ github.ref }}" = "refs/heads/main" ]; then
          echo "Rebuilding frontend with production API URL..."
          cd frontend
          npm ci
          npm run build
        else
          echo "Using pre-built artifacts from build-frontend job"
          # Download artifacts as before
        fi
      env:
        NODE_ENV: production
        VITE_API_URL: ${{ steps.get-url.outputs.api_url }}
```

---

## Testing Strategy

### Verification Steps

1. **Fix the workflow** as described above
2. **Deploy to dev** and verify API URL is embedded:
   ```bash
   curl https://d1yysvwo9eg20b.cloudfront.net/assets/index-*.js | grep 'api.us-east-1'
   ```
3. **Run E2E tests** to confirm UI loads
4. **Check browser console** for API call errors (should be none)

### Expected Outcomes

- ✅ E2E tests pass within 60 seconds
- ✅ Frontend loads in <5 seconds
- ✅ API calls succeed (visible in Network tab)
- ✅ No more "waiting for CloudFront" delays

---

## Secondary Issue: CloudFront Wait Improvements

**Status:** Still valid, but lower priority

The CloudFront propagation improvements (PR #51) are still useful for:
- Ensuring cache invalidation completes before tests
- Handling edge cases where propagation takes longer
- Better logging and error messages

**Recommendation:** Keep both fixes:
1. **P0**: Fix API URL build configuration (this document)
2. **P1**: Merge PR #51 for CloudFront robustness

---

## Action Items

### Immediate (P0)
- [x] Root cause identified
- [ ] Implement Option 3 (rebuild frontend with API URL in deploy job)
- [ ] Test locally with environment variable
- [ ] Deploy to dev and verify
- [ ] Run E2E tests to confirm fix
- [ ] Create PR with fix

### Short-term (P1)
- [ ] Merge PR #51 (CloudFront wait improvements)
- [ ] Add CI check to verify VITE_API_URL is embedded in build
- [ ] Document build-time vs runtime env vars in CLAUDE.md

### Long-term (P2)
- [ ] Consider Option 1 (job dependency reversal) for cleaner architecture
- [ ] Add smoke test that verifies API URL configuration
- [ ] Monitor E2E test reliability after fixes

---

## Lessons Learned

1. **Build-time Configuration**: Vite env vars are embedded at build time, not runtime
2. **Job Dependencies**: Parallel builds can't access values from other jobs
3. **E2E Tests Caught It**: First deployment validation caught what unit tests couldn't
4. **Investigate Before Fixing**: Initial CloudFront hypothesis was wrong, good we dug deeper!

---

**Document Version:** 1.0
**Last Updated:** 2025-11-09 19:30 UTC
