# CloudFront SPA Routing Fix - Summary

**Date:** 2025-11-09
**Issue:** E2E tests failing due to CloudFront 403 errors on SPA routes
**Resolution:** Added custom error response for 403 errors

## Problem

CloudFront distribution was missing 403 error handling, causing direct navigation to SPA routes like `/dashboard` to return S3 XML error pages instead of serving `index.html` for React Router.

## Root Cause

- S3 bucket with restricted access returns **403 Forbidden** (not 404) for non-existent objects
- CloudFront only had custom error response for 404, not 403
- Result: `/dashboard` → 403 XML error → React app never loads

## Solution Applied

```bash
aws cloudfront update-distribution --id EY0NDD10UXFN4
```

**Configuration Change:**
```json
{
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {"ErrorCode": 403, "ResponsePagePath": "/index.html", "ResponseCode": "200"},
      {"ErrorCode": 404, "ResponsePagePath": "/index.html", "ResponseCode": "200"}
    ]
  }
}
```

## Verification

**Manual Tests:**
```
✅ / → 200 OK (redirects to /login)
✅ /dashboard → 200 OK (serves index.html, React Router handles redirect)
✅ /translation/upload → 200 OK
✅ /nonexistent-route → 200 OK (React Router shows 404 page)
```

**E2E Tests:** Rerun triggered (run ID: 19213458141)

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 21:22:44 | CloudFront update initiated |
| 21:23:24 | Cache invalidation created |
| 21:25:00 | Documentation created |
| 21:36:00 | Deployment completed |
| 21:37:00 | Manual verification successful |
| 21:37:30 | E2E test rerun triggered |

## Impact

- **Before:** 0/23 E2E tests passing (100% failure)
- **After:** Expected 23/23 passing (pending validation)

## Related Documents

- `P0-INVESTIGATION-CLOUDFRONT-SPA-ROUTING.md` - Full investigation details
- `P0-INVESTIGATION-E2E-FAILURES.md` - Previous investigation (incorrect hypothesis)

## Key Learnings

1. **S3 returns 403 (not 404)** when bucket has restricted access
2. **Both 403 and 404** error responses required for CloudFront SPA hosting
3. **E2E tests critical** for catching infrastructure misconfigurations

## Action Items

- [ ] Verify E2E tests pass
- [ ] Add CloudFront to CDK stack (prevent manual config drift)
- [ ] Add SPA routing smoke tests to CI/CD pipeline
- [ ] Document CloudFront best practices in CLAUDE.md
