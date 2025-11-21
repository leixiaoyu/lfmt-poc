<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

---

# LFMT POC - Claude Development Guide

## Project Overview

This is the **Long-Form Translation Service** Proof of Concept (LFMT POC) - a React SPA with AWS serverless backend for translating large documents (65K-400K words) using Claude Sonnet 4 API.

## Authentication & User Management

### Email Verification - Auto-Confirm Feature

**Status**: Implemented for dev environment (as of PR #72, 2025-11-12)

The auto-confirm feature allows users to register and immediately log in without email verification, streamlining the development and testing workflow.

#### Configuration

**Location**: `backend/functions/auth/register.ts:30-36`

```typescript
const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');
const COGNITO_USER_POOL_ID = getRequiredEnv('COGNITO_USER_POOL_ID');
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';

// Auto-confirm users in dev environment (email verification disabled)
const AUTO_CONFIRM_USERS = ENVIRONMENT.includes('Dev');
```

**Environment-based Behavior**:
- **Dev**: Users auto-confirmed immediately after registration (`AUTO_CONFIRM_USERS = true`)
- **Staging/Prod**: Email verification required (`AUTO_CONFIRM_USERS = false`)

#### Implementation Details

**Registration Flow** (`backend/functions/auth/register.ts:87-123`):

1. **User Registration** - Create user in Cognito with `SignUpCommand`
2. **Auto-Confirm** (dev only) - Immediately confirm user with `AdminConfirmSignUpCommand`
3. **Success Response** - Return environment-specific message

```typescript
// After successful SignUp
if (AUTO_CONFIRM_USERS) {
  logger.info('Auto-confirming user (dev environment)', {
    requestId,
    email: email.toLowerCase(),
  });

  const confirmCommand = new AdminConfirmSignUpCommand({
    UserPoolId: COGNITO_USER_POOL_ID,
    Username: email,
  });

  await cognitoClient.send(confirmCommand);
}

return createSuccessResponse(
  201,
  {
    message: AUTO_CONFIRM_USERS
      ? 'User registered successfully. You can now log in.'
      : 'User registered successfully. Please check your email to verify your account.',
  },
  requestId
);
```

#### IAM Permissions

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:520-530`

The Register Lambda requires `cognito-idp:AdminConfirmSignUp` permission:

```typescript
actions: [
  'cognito-idp:SignUp',
  'cognito-idp:InitiateAuth',
  'cognito-idp:ForgotPassword',
  'cognito-idp:ConfirmForgotPassword',
  'cognito-idp:AdminCreateUser',
  'cognito-idp:AdminSetUserPassword',
  'cognito-idp:AdminGetUser',
  'cognito-idp:AdminUpdateUserAttributes',
  'cognito-idp:AdminConfirmSignUp',  // ⭐ Required for auto-confirm
],
```

#### Cognito Configuration

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:278-295`

```typescript
autoVerify: {}, // ⭐ Empty = email verification disabled
selfSignUpEnabled: true,
```

**Important**: Even with `autoVerify: {}`, Cognito creates users with status `UNCONFIRMED` by default. The auto-confirm logic explicitly changes status to `CONFIRMED` using `AdminConfirmSignUpCommand`.

#### Login Lambda Integration

**Location**: `backend/functions/auth/login.ts:155-165`

The Login Lambda handles `UserNotConfirmedException` for users who haven't been auto-confirmed:

```typescript
if (error instanceof UserNotConfirmedException) {
  logger.warn('Login failed: user not confirmed', {
    requestId,
    error: error.message,
  });

  return createErrorResponse(
    403,
    'Please verify your email address before logging in. Check your inbox for the verification link.',
    requestId
  );
}
```

**In dev environment**: This error should never occur due to auto-confirm.

#### Testing

**Unit Tests**: `backend/functions/auth/__tests__/register.test.ts`
**Integration Tests**: `backend/functions/__tests__/integration/translation-flow.integration.test.ts`

**Manual Testing**:
```bash
# Register user (dev environment)
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d @register-payload.json

# Expected response:
{
  "message": "User registered successfully. You can now log in.",
  "requestId": "..."
}

# Login immediately (no email verification required)
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d @login-payload.json

# Expected response:
{
  "user": { "id": "...", "email": "...", "firstName": "...", "lastName": "..." },
  "accessToken": "...",
  "refreshToken": "...",
  "idToken": "..."
}
```

#### Production Considerations

**For Production Deployment**:

1. **Disable Auto-Confirm**:
   - Set `ENVIRONMENT` variable to include "Prod" or "Staging"
   - Users will require email verification

2. **Email Configuration**:
   - Configure Cognito SES email settings
   - Customize verification email templates
   - Set up proper sender email address

3. **Security**:
   - Email verification prevents fake account creation
   - Consider additional bot protection (reCAPTCHA)
   - Monitor registration patterns for abuse

**Rollback**: If auto-confirm causes issues, simply redeploy with `ENVIRONMENT` not including "Dev".

#### Known Issues & Troubleshooting

**Issue**: Users getting 403 "Please verify your email" even in dev

**Troubleshooting**:
1. Check Lambda environment variable: `ENVIRONMENT` should include "Dev"
2. Verify IAM permission: `cognito-idp:AdminConfirmSignUp` in Lambda role
3. Check CloudWatch logs for auto-confirm execution
4. Verify `COGNITO_USER_POOL_ID` environment variable is set

**Issue**: JSON parsing errors with special characters in password

**Solution**: Use file-based JSON payloads instead of inline bash strings:
```bash
cat > /tmp/register.json <<'EOF'
{
  "email": "test@example.com",
  "password": "TestPass123!",
  ...
}
EOF

curl -X POST ... -d @/tmp/register.json
```

---

## Infrastructure Architecture

### Frontend Hosting - CloudFront CDK

**Status**: Fully managed via AWS CDK (as of PR #59, 2025-11-10)

The frontend React SPA is hosted on AWS CloudFront with S3 origin, fully managed as Infrastructure as Code.

#### CloudFront Configuration

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1194-1303`

**Key Components**:

1. **S3 Bucket** (`frontendBucket`):
   ```typescript
   - Public access blocked (CloudFront-only access via OAC)
   - Versioning enabled for rollback capability
   - Lifecycle policy: Delete old deployments after 90 days
   - Server-side encryption (S3-managed)
   - Removal policy: DESTROY (dev), RETAIN (prod)
   ```

2. **CloudFront Distribution** (`frontendDistribution`):
   ```typescript
   - Origin Access Control (OAC) for secure S3 access
   - Default root object: index.html
   - HTTPS-only (redirect HTTP to HTTPS)
   - IPv6 enabled
   - Compression: gzip, brotli
   ```

3. **Custom Error Responses** (SPA Routing):
   ```typescript
   403 → /index.html (status: 200, TTL: 300s)
   404 → /index.html (status: 200, TTL: 300s)
   ```

   **Why 403 instead of 404?**
   - S3 returns 403 (Forbidden) for non-existent objects when bucket has restricted access via OAC
   - Both 403 and 404 redirect to `/index.html` to enable React Router client-side routing
   - Error caching TTL: 5 minutes to balance UX and cache efficiency

4. **Security Headers** (`ResponseHeadersPolicy`):
   ```typescript
   Strict-Transport-Security: max-age=31536000; includeSubDomains
   X-Content-Type-Options: nosniff
   X-Frame-Options: DENY
   X-XSS-Protection: 1; mode=block
   Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
   Referrer-Policy: strict-origin-when-cross-origin
   ```

   **CRITICAL**: CSP **must** be in `securityHeadersBehavior.contentSecurityPolicy`, **NOT** in `customHeadersBehavior.customHeaders[]` (CloudFormation will reject deployment).

5. **Cache Behaviors**:
   ```typescript
   - Default: Caching optimized for static assets
   - index.html: No cache or short TTL for faster deployments
   - Viewer protocol: HTTPS redirect
   ```

#### Stack Outputs

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1435-1457`

```typescript
FrontendBucketName: ${frontendBucket.bucketName}
CloudFrontDistributionId: ${frontendDistribution.distributionId}
CloudFrontDistributionDomain: ${frontendDistribution.distributionDomainName}
FrontendUrl: https://${frontendDistribution.distributionDomainName}
```

**Usage**: Deployment workflow retrieves these outputs dynamically via `aws cloudformation describe-stacks`.

### CORS Configuration

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:337-400`

The API Gateway CORS allowed origins **dynamically include** the CloudFront URL from stack outputs:

```typescript
getAllowedApiOrigins() {
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

**Why this matters**:
- No hardcoded CloudFront URLs
- CORS automatically works with CDK-managed distribution
- Supports local development origins

### Deployment Workflow

**Location**: `.github/workflows/deploy.yml`

**CloudFront Deployment Steps** (Lines 203-261):

1. **Retrieve Frontend Bucket Name** (Lines 203-212):
   ```yaml
   aws cloudformation describe-stacks \
     --stack-name LfmtPocDev \
     --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue"
   ```

2. **Deploy Frontend to S3** (Lines 214-217):
   ```yaml
   aws s3 sync frontend/dist/ s3://$BUCKET_NAME/ --delete
   aws s3 cp frontend/dist/index.html s3://$BUCKET_NAME/index.html
   ```

3. **Retrieve CloudFront Distribution ID** (Lines 219-228):
   ```yaml
   aws cloudformation describe-stacks \
     --stack-name LfmtPocDev \
     --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue"
   ```

4. **Create CloudFront Invalidation** (Lines 241-250):
   ```yaml
   aws cloudfront create-invalidation \
     --distribution-id $DISTRIBUTION_ID \
     --paths "/*"
   ```

5. **Wait for Invalidation** (Lines 252-261):
   ```yaml
   aws cloudfront wait invalidation-completed \
     --distribution-id $DISTRIBUTION_ID \
     --id $INVALIDATION_ID
   ```
   **Timeout**: 15 minutes (typical: 3-5 minutes)

### CloudFront Invalidation Best Practices

**When to Invalidate**:
- ✅ After deploying new frontend build
- ✅ When updating `index.html` (app entry point)
- ✅ When fixing critical bugs (e.g., broken routing)

**What to Invalidate**:
- `/*` - Full distribution (simplest, recommended for POC)
- `/index.html` - Only entry point (faster, but requires careful cache management)

**Invalidation Cost**:
- First 1,000 invalidations per month: FREE
- Additional: $0.005 per path
- POC impact: Negligible (< 100 deployments/month)

**Invalidation Time**:
- Typical: 3-5 minutes
- Maximum: 15 minutes
- Timeout in workflow: 15 minutes (900 seconds)

### SPA Routing Deep Dive

**Problem**:
Direct navigation to `/dashboard` or `/translation/upload` in a CloudFront SPA results in S3 returning 403 (Forbidden) because:
1. S3 bucket has restricted access (OAC)
2. `/dashboard` doesn't exist as an S3 object
3. S3 denies access to non-existent objects with 403 instead of 404

**Solution**:
Custom error responses redirect **both** 403 and 404 to `/index.html` with status 200, allowing React Router to handle client-side routing.

**Configuration** (`backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1257-1272`):
```typescript
errorResponses: [
  {
    httpStatus: 403,
    responsePagePath: '/index.html',
    responseHttpStatus: 200,
    ttl: Duration.seconds(300), // 5 minutes
  },
  {
    httpStatus: 404,
    responsePagePath: '/index.html',
    responseHttpStatus: 200,
    ttl: Duration.seconds(300),
  },
],
```

**Validation**:
Test SPA routing by navigating directly to:
- `/` → redirects to `/login` (React Router)
- `/dashboard` → serves React app (403 fix validation)
- `/translation/upload` → serves React app
- Browser refresh on any route → stays on route

### Blue-Green Deployment Strategy

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

### Known Issues & Fixes

#### Issue: CloudFront CSP Deployment Failure (Fixed in PR #66)

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

### Testing CloudFront Infrastructure

**Location**: `backend/infrastructure/lib/__tests__/infrastructure.test.ts`

**Key Tests** (Lines 568-685):

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

### CloudFront Manual Operations

**Synthesize CloudFormation Template**:
```bash
cd backend/infrastructure
npm run cdk:synth
```

**Deploy to Dev**:
```bash
npx cdk deploy --context environment=dev
```

**View Stack Outputs**:
```bash
aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query 'Stacks[0].Outputs'
```

**Check Distribution Status**:
```bash
aws cloudfront list-distributions \
  --query 'DistributionList.Items[?Comment==`LFMT Frontend - Dev`]'
```

**Create Manual Invalidation**:
```bash
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"
```

---

## Development Guidelines

### When Working with CloudFront

1. **Always use CDK stack outputs** - Never hardcode CloudFront URLs or S3 bucket names
2. **Test SPA routing** - Validate 403 and 404 error responses redirect to `/index.html`
3. **Validate security headers** - Check CSP, HSTS, X-Frame-Options in browser dev tools
4. **Invalidate after deploy** - Ensure users see latest frontend changes
5. **Monitor invalidation time** - Typical 3-5 min, max 15 min

### When Modifying CloudFront Configuration

1. **Update infrastructure tests first** - Test-driven infrastructure changes
2. **Run `npm run cdk:synth`** - Validate CloudFormation before deploying
3. **Deploy to dev environment** - Test thoroughly before production
4. **Check AWS Console** - Verify distribution settings match CDK code
5. **Validate security headers** - Ensure CSP is in `securityHeadersBehavior`, not `customHeadersBehavior`

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

## Migration Notes

### From Manual CloudFront to CDK (Completed 2025-11-10)

**Phase 1**: CDK Infrastructure (PR #59) ✅
**Phase 2**: Deployment Workflow (PR #61) ✅
**Hotfix**: CSP Configuration (PR #66) ✅
**Phase 3**: Documentation (Current)

**Manual Distribution**: `d1yysvwo9eg20b.cloudfront.net`
- **Status**: Deprecated, scheduled for deletion after 30-day grace period
- **Replacement**: CDK-managed distribution (outputs from `LfmtPocDev` stack)

### DNS Update Instructions (If Using Custom Domain)

**Pre-Cutover**:
1. Document current DNS records (CNAME or ALIAS to old distribution)
2. Retrieve new CloudFront distribution domain from stack outputs
3. Plan maintenance window (DNS propagation: 1-48 hours)

**Cutover**:
1. Update CNAME/ALIAS record to point to new distribution domain
2. Monitor DNS propagation: `dig <your-domain>`
3. Test new CloudFront URL: `curl -I https://<your-domain>`

**Post-Cutover**:
1. Monitor CloudWatch metrics for errors
2. Check frontend access logs in S3
3. Validate CORS, security headers, SPA routing

---

## Quick Reference

### CDK Stack Structure

```
backend/infrastructure/lib/lfmt-infrastructure-stack.ts
├── constructor()
│   ├── createS3Buckets()           # Frontend + uploads
│   ├── createDynamoDBTables()      # Jobs, attestations
│   ├── createCognito()             # User authentication
│   ├── createFrontendHosting()     # ⭐ CloudFront + S3 origin
│   ├── createApiGateway()          # REST API (uses CloudFront URL for CORS)
│   ├── createLambdaFunctions()     # Auth, upload, jobs, etc.
│   └── createOutputs()             # CloudFront URL, bucket name, etc.
```

### Deployment Flow

```
1. Developer: git push → GitHub Actions
2. GitHub Actions: npm run build (frontend)
3. CDK: Retrieve FrontendBucketName from stack outputs
4. AWS CLI: aws s3 sync frontend/dist/ s3://$BUCKET_NAME/
5. CDK: Retrieve CloudFrontDistributionId from stack outputs
6. AWS CLI: aws cloudfront create-invalidation --paths "/*"
7. CloudFront: Invalidate cache (3-5 min)
8. Users: Access updated frontend via CloudFront URL
```

### Tech Stack

- **Frontend**: React 18, TypeScript, Material-UI, Vite
- **Hosting**: AWS CloudFront + S3 (CDK-managed)
- **Backend**: AWS Lambda (Node.js), API Gateway, DynamoDB
- **Auth**: AWS Cognito (JWT tokens)
- **Translation**: Claude Sonnet 4 API
- **IaC**: AWS CDK (TypeScript)
- **CI/CD**: GitHub Actions

---

---

## Translation UI Components & Testing

### Translation Workflow UI (Completed 2025-11-20)

**Status**: Fully implemented with comprehensive testing infrastructure (PR #86)

The translation workflow UI provides a complete user experience for uploading documents, tracking translation progress, and downloading translated files.

#### Components

**Location**: `frontend/src/components/Translation/` and `frontend/src/pages/`

1. **TranslationUploadPage** (`src/pages/TranslationUpload.tsx`):
   - Multi-step wizard (Legal Attestation → Configuration → Upload → Review)
   - Language selection (Spanish, French, German, Italian, Chinese)
   - Tone selection (Formal, Informal, Neutral)
   - File upload with drag-and-drop support
   - Legal attestation with checkbox enforcement and IP capture

2. **TranslationDetailPage** (`src/pages/TranslationDetail.tsx`):
   - Real-time progress tracking with polling (adaptive 15s → 30s → 60s intervals)
   - Job status display (PENDING → CHUNKING → CHUNKED → IN_PROGRESS → COMPLETED)
   - Progress percentage and chunk completion tracking
   - Download functionality for completed translations
   - Error handling and retry logic

3. **TranslationHistoryPage** (`src/pages/TranslationHistory.tsx`):
   - Job list with filtering and sorting
   - Status badges and progress indicators
   - Navigation to job detail page
   - Job metadata display (language, tone, file info)

4. **Supporting Components**:
   - `TranslationConfig.tsx` - Language and tone selection
   - `FileUpload.tsx` - Document upload with validation
   - `LegalAttestation.tsx` - Legal checkbox enforcement
   - `ReviewAndSubmit.tsx` - Final review before submission

#### Testing Infrastructure

**Unit Tests** (499 tests, 24 test files, 99% coverage):
- Location: `frontend/src/**/__tests__/*.test.tsx`
- Framework: Vitest + React Testing Library
- Coverage: 99% on all translation components
- Test types: Component rendering, user interactions, error handling, API mocking

**E2E Tests** (58 tests, 7 test suites):
- Location: `frontend/e2e/tests/translation/*.spec.ts`
- Framework: Playwright with Page Object Model pattern
- Test coverage:
  - Upload workflow validation
  - Progress tracking and polling behavior
  - Legal attestation enforcement (12 tests)
  - Download functionality (8 tests)
  - Complete E2E journey (4 tests)
  - Multi-language support (13 tests - 5 languages × 3 tones)
  - Error scenarios (13 tests - network, API failures, retry logic)

**Page Object Models** (7 POMs):
- `BasePage.ts` - Base class with common functionality
- `LoginPage.ts` - Authentication flow
- `RegisterPage.ts` - User registration
- `DashboardPage.ts` - Dashboard interactions
- `TranslationUploadPage.ts` - Upload workflow
- `TranslationDetailPage.ts` - Progress tracking
- `TranslationHistoryPage.ts` - Job history

#### Running Tests

**Unit Tests**:
```bash
cd frontend
npm test                    # All unit tests (499 tests)
npm run test:coverage      # With coverage report
npm run test:ui            # Interactive Vitest UI
npm test -- TranslationConfig.test.tsx  # Specific test file
```

**E2E Tests**:
```bash
cd frontend
npm run test:e2e           # All E2E tests (58 tests, requires local dev server)
npm run test:e2e:ui        # Interactive Playwright UI
npm run test:e2e:headed    # See browser during test execution
npm run test:e2e:debug     # Step-by-step debugging
npm run test:e2e:report    # View last test report
```

**CI/CD Integration**:
- Unit tests: Fully integrated in `.github/workflows/ci.yml`
- E2E tests: Temporarily disabled (lines 200-280) - require backend API or mock API setup
- All tests run on PR creation/updates
- Pre-push hooks enforce local test validation

#### Configuration

**Dev Server Port**: 3000 (updated from 5173)
- **Vite Config**: `frontend/vite.config.ts:18-27`
- **Playwright Config**: `frontend/playwright.config.ts:41,86`
- **Documentation**: All references updated (TESTING-GUIDE.md, e2e/README.md)

**Environment Variables**:
```bash
PLAYWRIGHT_BASE_URL=http://localhost:3000  # Dev server URL
API_BASE_URL=http://localhost:3000         # Backend API URL (for E2E)
CI=true                                     # Enable CI mode in Playwright
```

#### Known Issues & Solutions

**Issue 1: E2E Tests Require Backend API**
- **Status**: Temporarily disabled in CI (PR #86)
- **Root Cause**: All E2E tests make real HTTP requests to backend API
- **Solution**: Configure mock API for E2E tests or deploy test backend
- **Location**: `.github/workflows/ci.yml:200-280` (commented out)

**Issue 2: Port Configuration Mismatch**
- **Status**: ✅ Resolved (PR #86)
- **Root Cause**: Vite dev server on port 3000, Playwright expected 5173
- **Solution**: Updated all Playwright config and documentation to port 3000
- **Files Fixed**: `playwright.config.ts`, `e2e/README.md`, `TESTING-GUIDE.md`

**Issue 3: LoginPage POM Selector Mismatch**
- **Status**: ✅ Resolved (PR #86)
- **Root Cause**: POM expected `h4:has-text("Login")`, actual page had `h1:has-text("Log In")`
- **Solution**: Fixed selector to match actual DOM structure
- **File Fixed**: `frontend/e2e/pages/LoginPage.ts:16`

#### Documentation

**Comprehensive Guides**:
- `TESTING-GUIDE.md` - Complete local testing guide (517 lines)
- `frontend/e2e/README.md` - E2E testing with Playwright (447 lines)
- `frontend/TRANSLATION-UI-IMPLEMENTATION-PLAN.md` - Implementation documentation

**Key Sections**:
- Setup and installation instructions
- Running tests (all modes: watch, coverage, UI, E2E, debug)
- Writing tests (best practices, Page Object Model pattern)
- Troubleshooting common issues
- CI/CD integration details

#### Best Practices

**Unit Testing**:
1. Use React Testing Library for component tests
2. Mock API calls with MSW (Mock Service Worker)
3. Test user interactions, not implementation details
4. Maintain 90%+ coverage on all components
5. Use data-testid sparingly, prefer accessible queries

**E2E Testing**:
1. Use Page Object Model pattern for all page interactions
2. Never interact with page elements directly in tests
3. Generate unique test users with timestamps
4. Wait for elements explicitly (no arbitrary timeouts)
5. Use descriptive test names with "should" format
6. Keep tests isolated and independent

**Development Workflow**:
1. Write unit tests first (TDD approach)
2. Run tests locally before committing
3. Fix all failing tests before pushing to remote
4. Use pre-push hooks to enforce test validation
5. Review test coverage reports regularly

#### Migration Notes

**From No Testing to Comprehensive Testing** (PR #86):
- Added 499 unit tests (from 382)
- Added 58 E2E tests (new)
- Implemented Playwright testing infrastructure
- Created Page Object Model pattern
- Standardized test fixtures and helpers

**Port Configuration Update** (PR #86):
- Changed from 5173 (default Vite port) to 3000 (custom port)
- Updated all documentation and configuration files
- Ensured consistency across dev server, Playwright, and docs

---

**Last Updated**: 2025-11-20 (Phase 8 - Translation UI Testing Infrastructure)
**Latest PR**: #86 (Complete Translation UI Testing Infrastructure)