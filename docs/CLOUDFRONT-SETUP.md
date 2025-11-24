# CloudFront Frontend Hosting - Complete Guide

**Status**: Production-ready, fully managed via AWS CDK (since PR #59, 2025-11-10)

This document provides comprehensive technical details for the CloudFront + S3 frontend hosting infrastructure for the LFMT POC React SPA.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [CDK Configuration](#cdk-configuration)
4. [Deployment Workflow](#deployment-workflow)
5. [SPA Routing Configuration](#spa-routing-configuration)
6. [Cache Invalidation](#cache-invalidation)
7. [Testing](#testing)
8. [Manual Operations](#manual-operations)
9. [Development Guidelines](#development-guidelines)
10. [Known Issues & Fixes](#known-issues--fixes)
11. [Migration History](#migration-history)

---

## Overview

The LFMT POC frontend is a React 18 SPA hosted on AWS CloudFront with an S3 origin, fully managed as Infrastructure as Code using AWS CDK.

**Key Benefits**:
- ✅ HTTPS-only with automatic HTTP → HTTPS redirect
- ✅ Global CDN distribution with low latency
- ✅ Secure S3 access via Origin Access Control (OAC)
- ✅ Comprehensive security headers (CSP, HSTS, X-Frame-Options)
- ✅ SPA routing support (403/404 → index.html)
- ✅ Automated deployment via GitHub Actions
- ✅ No hardcoded URLs (dynamic via CDK stack outputs)

---

## Architecture

### Components

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────────────────┐
│  CloudFront CDN (Edge)  │
│  - HTTPS redirect       │
│  - Security headers     │
│  - Cache optimization   │
│  - Gzip/Brotli          │
└──────────┬──────────────┘
           │ OAC (secure)
           ▼
┌──────────────────────┐
│   S3 Bucket (Origin) │
│   - Private (no pub) │
│   - Versioning ON    │
│   - Lifecycle rules  │
│   - Encryption       │
└──────────────────────┘
```

### Infrastructure Resources

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1194-1303`

1. **S3 Bucket** (`frontendBucket`)
2. **CloudFront Distribution** (`frontendDistribution`)
3. **Origin Access Control** (OAC)
4. **Response Headers Policy** (security headers)
5. **Stack Outputs** (bucket name, distribution ID, URL)

---

## CDK Configuration

### S3 Bucket Configuration

```typescript
const frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
  bucketName: `lfmt-frontend-${this.stackName.toLowerCase()}`,

  // Security
  publicReadAccess: false,              // CloudFront-only access via OAC
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  encryption: s3.BucketEncryption.S3_MANAGED,

  // Versioning & Lifecycle
  versioned: true,                      // Enable rollback capability
  lifecycleRules: [
    {
      id: 'DeleteOldDeployments',
      enabled: true,
      expiration: Duration.days(90),    // Clean up after 90 days
    },
  ],

  // Removal Policy
  removalPolicy: environment === 'prod'
    ? RemovalPolicy.RETAIN              // Keep prod buckets
    : RemovalPolicy.DESTROY,            // Auto-delete dev buckets
  autoDeleteObjects: environment !== 'prod',
});
```

### CloudFront Distribution Configuration

```typescript
const frontendDistribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(frontendBucket, {
      originAccessControl: new cloudfront.S3OriginAccessControl(this, 'OAC', {
        originAccessControlName: `LFMT-Frontend-OAC-${environment}`,
        description: 'OAC for LFMT frontend bucket',
        signing: cloudfront.SigningBehavior.ALWAYS,
        originAccessControlOriginType: cloudfront.OriginAccessControlOriginType.S3,
        signingProtocol: cloudfront.SigningProtocol.SIGV4,
      }),
    }),

    // Cache & Compression
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    compress: true,                      // Enable gzip/brotli

    // HTTPS & Security
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,

    // Security Headers
    responseHeadersPolicy: responseHeadersPolicy,
  },

  // SPA Configuration
  defaultRootObject: 'index.html',
  enableIpv6: true,

  // Custom Error Responses (SPA Routing)
  errorResponses: [
    {
      httpStatus: 403,
      responsePagePath: '/index.html',
      responseHttpStatus: 200,
      ttl: Duration.seconds(300),        // 5 min cache
    },
    {
      httpStatus: 404,
      responsePagePath: '/index.html',
      responseHttpStatus: 200,
      ttl: Duration.seconds(300),
    },
  ],

  comment: `LFMT Frontend - ${environment}`,
});
```

### Security Headers Configuration

```typescript
const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
  responseHeadersPolicyName: `LFMT-SecurityHeaders-${environment}`,

  securityHeadersBehavior: {
    // HSTS (HTTP Strict Transport Security)
    strictTransportSecurity: {
      accessControlMaxAge: Duration.seconds(31536000),  // 1 year
      includeSubdomains: true,
      override: true,
    },

    // Content Security Policy
    contentSecurityPolicy: {
      contentSecurityPolicy: [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https://*.execute-api.us-east-1.amazonaws.com",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      override: true,
    },

    // Additional Security Headers
    contentTypeOptions: { override: true },          // X-Content-Type-Options: nosniff
    frameOptions: {                                  // X-Frame-Options: DENY
      frameOption: cloudfront.HeadersFrameOption.DENY,
      override: true,
    },
    xssProtection: {                                 // X-XSS-Protection: 1; mode=block
      protection: true,
      modeBlock: true,
      override: true,
    },
    referrerPolicy: {                                // Referrer-Policy
      referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
      override: true,
    },
  },
});
```

**⚠️ CRITICAL**: CSP **must** be configured in `securityHeadersBehavior.contentSecurityPolicy`, **NOT** in `customHeadersBehavior.customHeaders[]`. CloudFormation will reject deployment if CSP is in custom headers.

### Stack Outputs

```typescript
new CfnOutput(this, 'FrontendBucketName', {
  value: frontendBucket.bucketName,
  description: 'Frontend S3 bucket name',
});

new CfnOutput(this, 'CloudFrontDistributionId', {
  value: frontendDistribution.distributionId,
  description: 'CloudFront distribution ID',
});

new CfnOutput(this, 'CloudFrontDistributionDomain', {
  value: frontendDistribution.distributionDomainName,
  description: 'CloudFront distribution domain name',
});

new CfnOutput(this, 'FrontendUrl', {
  value: `https://${frontendDistribution.distributionDomainName}`,
  description: 'Frontend application URL',
});
```

**Usage**: GitHub Actions deployment workflow retrieves these outputs dynamically via `aws cloudformation describe-stacks`.

---

## Deployment Workflow

### GitHub Actions Workflow

**Location**: `.github/workflows/deploy.yml:203-261`

**Steps**:

1. **Retrieve Frontend Bucket Name**:
   ```bash
   BUCKET_NAME=$(aws cloudformation describe-stacks \
     --stack-name LfmtPocDev \
     --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
     --output text)
   ```

2. **Deploy Frontend to S3**:
   ```bash
   aws s3 sync frontend/dist/ s3://$BUCKET_NAME/ --delete
   aws s3 cp frontend/dist/index.html s3://$BUCKET_NAME/index.html \
     --cache-control "no-cache"
   ```

3. **Retrieve CloudFront Distribution ID**:
   ```bash
   DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
     --stack-name LfmtPocDev \
     --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
     --output text)
   ```

4. **Create CloudFront Invalidation**:
   ```bash
   INVALIDATION_ID=$(aws cloudfront create-invalidation \
     --distribution-id $DISTRIBUTION_ID \
     --paths "/*" \
     --query 'Invalidation.Id' \
     --output text)
   ```

5. **Wait for Invalidation to Complete**:
   ```bash
   aws cloudfront wait invalidation-completed \
     --distribution-id $DISTRIBUTION_ID \
     --id $INVALIDATION_ID
   ```
   **Timeout**: 15 minutes (typical: 3-5 minutes)

### CORS Integration

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:337-400`

The API Gateway CORS configuration **dynamically includes** the CloudFront URL from CDK resources:

```typescript
private getAllowedApiOrigins(): string[] {
  const origins = [
    'http://localhost:5173',
    'http://localhost:3000',
  ];

  // Add CloudFront URL if available
  if (this.frontendDistribution) {
    origins.push(`https://${this.frontendDistribution.distributionDomainName}`);
  }

  return origins;
}
```

**⚠️ CRITICAL**: The CDK constructor order matters! `createFrontendHosting()` must be called **before** `createLambdaFunctions()` to ensure `this.frontendDistribution` is available when setting Lambda environment variables.

---

## SPA Routing Configuration

### Problem Statement

Direct navigation to routes like `/dashboard` or `/translation/upload` in a CloudFront SPA results in S3 returning **403 Forbidden** because:

1. S3 bucket has restricted access (OAC prevents public access)
2. `/dashboard` doesn't exist as an S3 object
3. S3 denies access to non-existent objects with 403 (not 404)

### Solution

Custom error responses redirect **both 403 and 404** to `/index.html` with status 200, allowing React Router to handle client-side routing.

**Configuration** (`backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1257-1272`):

```typescript
errorResponses: [
  {
    httpStatus: 403,
    responsePagePath: '/index.html',
    responseHttpStatus: 200,
    ttl: Duration.seconds(300),          // 5 minutes
  },
  {
    httpStatus: 404,
    responsePagePath: '/index.html',
    responseHttpStatus: 200,
    ttl: Duration.seconds(300),
  },
],
```

**Why 403 AND 404?**
- **403**: S3 with OAC returns 403 for non-existent objects (security feature)
- **404**: Standard HTTP not-found response
- **TTL 5 minutes**: Balance between UX and cache efficiency

### Validation

Test SPA routing by navigating directly to:
- ✅ `/` → redirects to `/login` (React Router)
- ✅ `/dashboard` → serves React app (403 fix working)
- ✅ `/translation/upload` → serves React app
- ✅ Browser refresh on any route → stays on route

---

## Cache Invalidation

### When to Invalidate

- ✅ After deploying new frontend build
- ✅ When updating `index.html` (app entry point)
- ✅ When fixing critical bugs (e.g., broken routing)

### What to Invalidate

**Full Distribution** (Recommended for POC):
```bash
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*"
```

**Specific Paths** (Advanced):
```bash
# Only index.html (faster, requires careful cache management)
aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/index.html"
```

### Invalidation Best Practices

**Cost**:
- First 1,000 invalidations per month: **FREE**
- Additional: $0.005 per path
- POC impact: Negligible (< 100 deployments/month)

**Time**:
- **Typical**: 3-5 minutes
- **Maximum**: 15 minutes
- **Workflow Timeout**: 15 minutes (900 seconds)

**Performance Tip**: Use versioned asset filenames (e.g., `app.abc123.js`) to avoid invalidation for static assets. Only invalidate `index.html`.

---

## Testing

### Unit Tests

**Location**: `backend/infrastructure/lib/__tests__/infrastructure.test.ts:568-713`

**Key Tests**:

1. **CloudFront distribution exists** (Lines 568-572)
2. **S3 bucket has block public access** (Lines 574-587)
3. **Custom error responses configured** (Lines 589-614)
4. **HTTPS-only viewer protocol** (Lines 616-625)
5. **Security headers policy** (Lines 627-685)
   - Validates CSP in `SecurityHeadersConfig.ContentSecurityPolicy`
6. **Stack outputs include CloudFront URL** (Lines 715-732)
7. **CloudFront URL in CORS origins** (Lines 687-713)

**Run Tests**:
```bash
cd backend/infrastructure
npm test
```

### Manual Validation

1. **Check Security Headers**:
   ```bash
   curl -I https://<cloudfront-domain>
   ```
   Expected headers:
   - `strict-transport-security: max-age=31536000; includeSubDomains`
   - `x-content-type-options: nosniff`
   - `x-frame-options: DENY`
   - `content-security-policy: default-src 'self'; ...`

2. **Test SPA Routing**:
   - Navigate to `https://<cloudfront-domain>/dashboard` (should load React app)
   - Refresh browser (should stay on `/dashboard`)

3. **Verify HTTPS Redirect**:
   ```bash
   curl -I http://<cloudfront-domain>
   ```
   Expected: `301 Moved Permanently` with `Location: https://...`

---

## Manual Operations

### Synthesize CloudFormation Template

```bash
cd backend/infrastructure
npm run cdk:synth
```

### Deploy CloudFront Infrastructure

```bash
# Development
npx cdk deploy --context environment=dev

# Production (requires approval for security changes)
npx cdk deploy --context environment=prod
```

### View Stack Outputs

```bash
aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query 'Stacks[0].Outputs'
```

### Check Distribution Status

```bash
aws cloudfront list-distributions \
  --query 'DistributionList.Items[?Comment==`LFMT Frontend - Dev`]'
```

### Create Manual Invalidation

```bash
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"
```

### Monitor Invalidation Progress

```bash
aws cloudfront get-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --id <INVALIDATION_ID>
```

---

## Development Guidelines

### When Working with CloudFront

1. ✅ **Always use CDK stack outputs** - Never hardcode CloudFront URLs or S3 bucket names
2. ✅ **Test SPA routing** - Validate 403 and 404 error responses redirect to `/index.html`
3. ✅ **Validate security headers** - Check CSP, HSTS, X-Frame-Options in browser dev tools
4. ✅ **Invalidate after deploy** - Ensure users see latest frontend changes
5. ✅ **Monitor invalidation time** - Typical 3-5 min, max 15 min

### When Modifying CloudFront Configuration

1. ✅ **Update infrastructure tests first** - Test-driven infrastructure changes
2. ✅ **Run `npm run cdk:synth`** - Validate CloudFormation before deploying
3. ✅ **Deploy to dev environment** - Test thoroughly before production
4. ✅ **Check AWS Console** - Verify distribution settings match CDK code
5. ✅ **Validate security headers** - Ensure CSP is in `securityHeadersBehavior`, not `customHeadersBehavior`

### Common Pitfalls

❌ **DON'T**:
- Hardcode CloudFront URLs anywhere (use stack outputs)
- Put CSP in `customHeadersBehavior` (use `securityHeadersBehavior.contentSecurityPolicy`)
- Skip CloudFront invalidation after deploy (users will see stale content)
- Modify CloudFront distribution manually in AWS Console (breaks IaC)

✅ **DO**:
- Retrieve infrastructure values from CDK stack outputs
- Configure security headers in `securityHeadersBehavior`
- Create invalidations after S3 deploy
- Make all infrastructure changes via CDK code + PR workflow

---

## Known Issues & Fixes

### Issue: CloudFront CSP Deployment Failure (Fixed in PR #66)

**Error**:
```
The parameter CustomHeaders contains Content-Security-Policy that is a security header
and cannot be set as custom header.
```

**Root Cause**:
CSP was incorrectly placed in `customHeadersBehavior.customHeaders[]` instead of `securityHeadersBehavior.contentSecurityPolicy`.

**Fix** (`backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1243-1272`):

```typescript
// ❌ WRONG:
customHeadersBehavior: {
  customHeaders: [
    { header: 'Content-Security-Policy', value: "...", override: true }
  ]
}

// ✅ CORRECT:
securityHeadersBehavior: {
  contentSecurityPolicy: {
    contentSecurityPolicy: "default-src 'self'; ...",
    override: true,
  }
}
```

**Lesson**: AWS CloudFront API requires security headers (CSP, HSTS, X-Frame-Options, etc.) to be configured via dedicated properties in `SecurityHeadersConfig`, not as custom headers.

---

## Migration History

### From Manual CloudFront to CDK (Completed 2025-11-10)

**Phase 1**: CDK Infrastructure (PR #59) ✅
- Created CloudFront distribution via CDK
- Configured S3 bucket with OAC
- Added stack outputs for dynamic configuration

**Phase 2**: Deployment Workflow (PR #61) ✅
- Updated GitHub Actions to use CDK stack outputs
- Automated S3 sync and CloudFront invalidation
- Removed hardcoded distribution IDs

**Hotfix**: CSP Configuration (PR #66) ✅
- Fixed CSP deployment failure
- Moved CSP from `customHeadersBehavior` to `securityHeadersBehavior`

**Phase 3**: Documentation (Current)
- Extracted CloudFront docs from CLAUDE.md
- Created comprehensive reference guide

**Manual Distribution**: `d1yysvwo9eg20b.cloudfront.net`
- **Status**: Deprecated, deleted after 30-day grace period (Dec 10, 2025)
- **Replacement**: CDK-managed distribution (outputs from `LfmtPocDev` stack)

### Blue-Green Deployment Strategy (Future)

**For CDK Infrastructure Updates**:

1. **GREEN Deployment** (New):
   ```bash
   npx cdk deploy --context environment=dev
   ```
   - Creates new CloudFront distribution
   - New S3 bucket
   - New stack outputs

2. **Testing Phase**:
   - Deploy frontend to GREEN S3 bucket
   - Test CloudFront URL thoroughly
   - Validate SPA routing, security headers, CORS

3. **Traffic Cutover**:
   - Update DNS (if using custom domain)
   - Update environment variables in GitHub Actions
   - Monitor for 24 hours

4. **BLUE Deprecation** (Old):
   - Keep manual distribution for 30-day grace period
   - Delete after validation complete

**Rollback Procedure**:
If issues occur with GREEN deployment:
1. Revert DNS to old CloudFront URL (if changed)
2. Redeploy frontend to old S3 bucket
3. Update API Gateway CORS to old CloudFront URL
4. Investigate and fix issues before retry

---

## Related Documentation

- **CORS Configuration**: See `docs/CORS-REFERENCE.md` (when created)
- **Frontend Deployment**: See `FRONTEND-DEPLOYMENT.md` (daily workflow)
- **Production Setup**: See `PRODUCTION-DEPLOYMENT-GUIDE.md` (initial setup)
- **CDK Best Practices**: See `docs/CDK-BEST-PRACTICES.md`

---

**Last Updated**: 2025-11-23 (extracted from CLAUDE.md)
**Related PRs**: #59 (CDK), #61 (Workflow), #66 (CSP Fix)
