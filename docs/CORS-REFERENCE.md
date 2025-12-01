# CORS Configuration Guide

## Overview

This document describes the Cross-Origin Resource Sharing (CORS) configuration for the LFMT POC application, including how multiple origins are supported, how CORS headers are generated dynamically, and troubleshooting common CORS issues.

## Architecture

### Multi-Origin CORS Support

The LFMT application supports CORS requests from multiple origins:
- **Local Development**: `http://localhost:3000`, `https://localhost:3000`
- **CloudFront CDN**: `https://<distribution-id>.cloudfront.net` (dynamically added)
- **Custom Domain**: (future) production domain when configured

### Dynamic Origin Configuration

CORS origins are managed at **two levels**:

1. **API Gateway CORS Preflight** - Handles OPTIONS requests
2. **Lambda Function Response Headers** - Handles actual API requests

Both configurations share the same allowed origins list to ensure consistency.

## Implementation Details

### 1. CDK Infrastructure Layer

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`

#### getAllowedApiOrigins() Method

```typescript
/**
 * Get allowed API origins for CORS configuration
 * Returns array of allowed origins including localhost and CloudFront URL
 */
private getAllowedApiOrigins(): string[] {
  const origins: string[] = [];

  switch (this.node.tryGetContext('environment')) {
    case 'prod':
      origins.push('https://lfmt.yourcompany.com');
      break;
    case 'staging':
      origins.push('https://staging.lfmt.yourcompany.com');
      break;
    default:
      origins.push('http://localhost:3000');
      origins.push('https://localhost:3000');
  }

  // Add CloudFront distribution URL if it exists
  if (this.frontendDistribution) {
    origins.push(`https://${this.frontendDistribution.distributionDomainName}`);
  }

  return origins;
}
```

**Key Points**:
- Environment-specific origin configuration
- Dynamically includes CloudFront URL from CDK resources
- No hardcoded URLs (except localhost for dev)

#### API Gateway CORS Configuration

```typescript
// Line 378
defaultCorsPreflightOptions: {
  allowOrigins: this.getAllowedApiOrigins(),
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token',
  ],
  allowCredentials: true,
}
```

#### Lambda Environment Variables

```typescript
// Lines 597-601
GEMINI_API_KEY_SECRET_NAME: `lfmt/gemini-api-key-${this.stackName}`,
// Pass all allowed origins as comma-separated list (includes localhost + CloudFront URL)
ALLOWED_ORIGINS: this.getAllowedApiOrigins().join(','),
```

**CRITICAL**: The constructor order matters! `createFrontendHosting()` must be called **before** `createLambdaFunctions()` to ensure `this.frontendDistribution` is available when setting Lambda environment variables.

### 2. Lambda Response Layer

**Location**: `backend/functions/shared/api-response.ts`

#### getCorsHeaders() Function

```typescript
/**
 * Get CORS headers based on environment
 * Supports multiple allowed origins (comma-separated in ALLOWED_ORIGINS env var)
 * Returns the matching origin from the request's Origin header
 */
export function getCorsHeaders(requestOrigin?: string): Record<string, string> {
  // Get allowed origins from environment variable (comma-separated list)
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN;
  const allowedOrigins = allowedOriginsEnv
    ? allowedOriginsEnv.split(',').map(origin => origin.trim())
    : ['http://localhost:3000']; // Fallback to localhost

  // Match the request origin against allowed origins
  const allowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : allowedOrigins[0]; // Default to first allowed origin

  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  };
}
```

**Key Features**:
- Reads `ALLOWED_ORIGINS` environment variable (comma-separated)
- Matches incoming request origin against allowed list
- Returns matched origin or defaults to first allowed origin
- Supports legacy `ALLOWED_ORIGIN` (singular) for backward compatibility

#### Response Helper Functions

```typescript
export function createSuccessResponse<T = any>(
  statusCode: number,
  data: ApiSuccessResponse<T>,
  requestId?: string,
  requestOrigin?: string  // NEW PARAMETER
): ApiResponse {
  return {
    statusCode,
    headers: getCorsHeaders(requestOrigin),
    body: JSON.stringify({
      ...data,
      requestId,
    }),
  };
}

export function createErrorResponse(
  statusCode: number,
  message: string,
  requestId?: string,
  errors?: Record<string, string[]>,
  requestOrigin?: string  // NEW PARAMETER
): ApiResponse {
  return {
    statusCode,
    headers: getCorsHeaders(requestOrigin),
    body: JSON.stringify({
      error: {
        message,
        errors,
      },
      requestId,
    }),
  };
}
```

**Usage Pattern**: All Lambda functions extract `requestOrigin` from headers and pass it to response functions.

### 3. Lambda Function Integration

**Example**: `backend/functions/auth/register.ts`

```typescript
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const requestId = event.requestContext.requestId;
  const requestOrigin = event.headers.origin || event.headers.Origin;  // Extract origin

  // ... validation and business logic ...

  return createSuccessResponse(
    201,
    {
      message: AUTO_CONFIRM_USERS
        ? 'User registered successfully. You can now log in.'
        : 'User registered successfully. Please check your email to verify your account.',
    },
    requestId,
    requestOrigin  // Pass to response function
  );
}
```

**Pattern Applied To**:
- `backend/functions/auth/register.ts`
- `backend/functions/auth/login.ts`
- All other Lambda functions returning HTTP responses

## CORS Flow Diagram

```
Browser Request → API Gateway → Lambda Function
     │                │              │
     │         OPTIONS Request        │
     │    ←──────────────────────     │
     │    CORS Preflight Response     │
     │    (getAllowedApiOrigins)      │
     │                                │
     │         Actual Request         │
     │    ──────────────────────►     │
     │                           Extract origin
     │                           from headers
     │                                │
     │                           Match against
     │                           ALLOWED_ORIGINS
     │                           env variable
     │                                │
     │    Response with CORS          │
     │    headers (matching origin)   │
     │    ◄──────────────────────     │
```

## Configuration by Environment

### Development Environment

**Allowed Origins**:
- `http://localhost:3000` (Vite dev server)
- `https://localhost:3000` (HTTPS local dev)
- `https://d39xcun7144jgl.cloudfront.net` (CloudFront dev distribution)

**Lambda Environment Variable**:
```bash
ALLOWED_ORIGINS=http://localhost:3000,https://localhost:3000,https://d39xcun7144jgl.cloudfront.net
```

**Verification**:
```bash
aws lambda get-function-configuration \
  --function-name lfmt-register-LfmtPocDev \
  --query 'Environment.Variables.ALLOWED_ORIGINS'
```

### Staging Environment (Future)

**Allowed Origins**:
- `https://staging.lfmt.yourcompany.com` (custom domain)
- `https://<staging-cloudfront>.cloudfront.net` (CloudFront staging distribution)

### Production Environment (Future)

**Allowed Origins**:
- `https://lfmt.yourcompany.com` (custom domain)
- `https://<prod-cloudfront>.cloudfront.net` (CloudFront production distribution)

## Testing CORS Configuration

### Manual Testing with curl

**Test CORS Preflight (OPTIONS)**:
```bash
curl -X OPTIONS https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/register \
  -H "Origin: https://d39xcun7144jgl.cloudfront.net" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: Content-Type,Authorization" \
  -v
```

**Expected Response Headers**:
```
Access-Control-Allow-Origin: https://d39xcun7144jgl.cloudfront.net
Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS
Access-Control-Allow-Headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token
Access-Control-Allow-Credentials: true
```

**Test Actual Request (POST)**:
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login \
  -H "Origin: https://d39xcun7144jgl.cloudfront.net" \
  -H "Content-Type: application/json" \
  -d @/tmp/login-payload.json \
  -v
```

**Expected Response Headers**:
```
Access-Control-Allow-Origin: https://d39xcun7144jgl.cloudfront.net
Access-Control-Allow-Credentials: true
```

### Browser Testing

**Open Browser Console**:
1. Navigate to https://d39xcun7144jgl.cloudfront.net
2. Open Developer Tools → Network tab
3. Attempt login or registration
4. Inspect request/response headers

**Check for CORS Errors**:
- ✅ No CORS errors → Configuration working
- ❌ `Access-Control-Allow-Origin` mismatch → Check Lambda env var
- ❌ `CORS policy: No 'Access-Control-Allow-Origin'` → Check API Gateway config

### Automated Testing

**Location**: `backend/infrastructure/lib/__tests__/infrastructure.test.ts`

**Test: CloudFront URL in CORS origins** (Lines 687-713):
```typescript
it('should include CloudFront distribution URL in CORS allowed origins', () => {
  const template = Template.fromStack(stack);

  // Get API Gateway resource
  template.hasResourceProperties('AWS::ApiGateway::RestApi', {
    Name: 'lfmt-api-LfmtPocDev',
  });

  // Verify CORS configuration includes CloudFront URL
  const apiGateway = template.findResources('AWS::ApiGateway::RestApi');
  const apiGatewayKey = Object.keys(apiGateway)[0];
  const corsConfig = apiGateway[apiGatewayKey].Properties.Body['x-amazon-apigateway-cors'];

  expect(corsConfig.allowOrigins).toBeDefined();
  expect(corsConfig.allowOrigins).toContain('http://localhost:3000');
  expect(corsConfig.allowOrigins.some((origin: string) =>
    origin.includes('.cloudfront.net')
  )).toBe(true);
});
```

**Run Tests**:
```bash
cd backend/infrastructure
npm test
```

## Troubleshooting

### Issue: CORS Error with CloudFront URL

**Error Message**:
```
Access to XMLHttpRequest at 'https://API_URL' from origin 'https://CLOUDFRONT_URL'
has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header has a
value 'http://localhost:3000' that is not equal to the supplied origin.
```

**Root Cause**: Lambda environment variable `ALLOWED_ORIGINS` doesn't include CloudFront URL

**Solution**:
1. Verify CDK constructor order: `createFrontendHosting()` before `createLambdaFunctions()`
2. Redeploy infrastructure: `npx cdk deploy --context environment=dev`
3. Verify Lambda env var:
   ```bash
   aws lambda get-function-configuration \
     --function-name lfmt-register-LfmtPocDev \
     --query 'Environment.Variables.ALLOWED_ORIGINS'
   ```
4. Expected output should include CloudFront URL

### Issue: CORS Error with localhost

**Error Message**:
```
Access to XMLHttpRequest at 'https://API_URL' from origin 'http://localhost:3000'
has been blocked by CORS policy: Response to preflight request doesn't pass access
control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**Root Cause**: API Gateway CORS not configured for localhost

**Solution**:
1. Check `getAllowedApiOrigins()` includes `http://localhost:3000`
2. Redeploy infrastructure
3. Clear browser cache and retry

### Issue: OPTIONS Preflight Succeeds but POST Fails

**Error Message**:
```
CORS error on actual request but not on preflight
```

**Root Cause**: Lambda function not extracting `requestOrigin` from headers and passing to response functions

**Solution**:
1. Verify Lambda extracts origin: `const requestOrigin = event.headers.origin || event.headers.Origin;`
2. Verify response functions receive origin: `createSuccessResponse(..., requestOrigin)`
3. Redeploy Lambda functions

### Issue: Wrong Origin in Response Header

**Error Message**:
```
Access-Control-Allow-Origin: http://localhost:3000 (expected: https://cloudfront.url)
```

**Root Cause**: `getCorsHeaders()` defaulting to first origin in list instead of matching request origin

**Solution**:
1. Verify browser sends `Origin` header in request
2. Check Lambda logs for `requestOrigin` value
3. Verify `getCorsHeaders()` logic matches origin against allowed list

## Best Practices

### 1. Never Hardcode Origins

❌ **BAD**:
```typescript
const ALLOWED_ORIGIN = 'https://d39xcun7144jgl.cloudfront.net';
```

✅ **GOOD**:
```typescript
const allowedOrigins = this.getAllowedApiOrigins();
```

### 2. Always Extract Request Origin

❌ **BAD**:
```typescript
return createSuccessResponse(200, data, requestId);
```

✅ **GOOD**:
```typescript
const requestOrigin = event.headers.origin || event.headers.Origin;
return createSuccessResponse(200, data, requestId, requestOrigin);
```

### 3. Use Environment-Specific Configuration

❌ **BAD**:
```typescript
const origins = ['http://localhost:3000', 'https://prod.example.com'];
```

✅ **GOOD**:
```typescript
const origins = [];
switch (this.node.tryGetContext('environment')) {
  case 'prod':
    origins.push('https://lfmt.yourcompany.com');
    break;
  case 'dev':
    origins.push('http://localhost:3000');
    if (this.frontendDistribution) {
      origins.push(`https://${this.frontendDistribution.distributionDomainName}`);
    }
    break;
}
```

### 4. Test CORS in Browser Console

Always verify CORS configuration in browser Developer Tools:
1. Check Network tab for preflight OPTIONS requests
2. Verify response headers include correct `Access-Control-Allow-Origin`
3. Look for CORS-related errors in Console tab

### 5. Keep API Gateway and Lambda in Sync

Ensure both API Gateway CORS preflight and Lambda response headers use the same origin list:
- API Gateway: `getAllowedApiOrigins()` for preflight
- Lambda: `ALLOWED_ORIGINS` env var for actual requests

## Security Considerations

### 1. Origin Whitelisting

Only allow origins you control:
- ✅ Your CloudFront distributions
- ✅ Your custom domains
- ✅ localhost for development
- ❌ Wildcard origins (`*`)
- ❌ Third-party domains

### 2. Credentials Support

`Access-Control-Allow-Credentials: true` allows cookies/auth headers:
- Required for JWT token authentication
- Only use with whitelisted origins (never with `*`)
- Ensure HTTPS for production origins

### 3. Header Restrictions

Only allow necessary headers:
```typescript
allowHeaders: [
  'Content-Type',        // Required for JSON requests
  'Authorization',       // Required for JWT tokens
  'X-Amz-Date',         // AWS signature
  'X-Api-Key',          // API Gateway auth
  'X-Amz-Security-Token' // Temporary credentials
]
```

Avoid allowing all headers (`*`) in production.

## Migration from Single to Multi-Origin

### Before (Single Origin)

**CDK**:
```typescript
ALLOWED_ORIGIN: 'http://localhost:3000'
```

**Lambda**:
```typescript
'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || 'http://localhost:3000'
```

### After (Multi-Origin)

**CDK**:
```typescript
ALLOWED_ORIGINS: this.getAllowedApiOrigins().join(',')
// Result: "http://localhost:3000,https://localhost:3000,https://d39xcun7144jgl.cloudfront.net"
```

**Lambda**:
```typescript
const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim());
const allowedOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
  ? requestOrigin
  : allowedOrigins[0];
```

## Related Documentation

- [README.md](README.md) - Project overview
- [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) - Deployment procedures
- [CLAUDE.md](CLAUDE.md) - Development guidelines
- [backend/infrastructure/README.md](backend/infrastructure/README.md) - CDK infrastructure details
- [API-REFERENCE.md](API-REFERENCE.md) - API endpoint documentation

---

**Last Updated**: 2025-11-21
**Related PRs**:
- #88 - Deploy Translation UI to dev environment
- #87 - Fix CORS configuration for CloudFront URL support
**Status**: ✅ Implemented and tested

---

## Case Study: PR #92 CORS Fix (2025-11-23)

**Problem**: Lambda functions returned hardcoded `localhost:3000` origin instead of request origin
**Root Cause**: Lambdas not extracting `event.headers.origin` parameter
**Solution**: Pass request origin to all response helper functions

📖 **Full Investigation Report**: See [`docs/archive/CORS-TROUBLESHOOTING.md`](docs/archive/CORS-TROUBLESHOOTING.md)

**Key Learnings**:
- ✅ Always extract request origin from `event.headers.origin`
- ✅ Pass origin to all response helpers (success AND error)
- ✅ Test with Playwright before/after comparison
- ✅ Use case-insensitive header lookup
