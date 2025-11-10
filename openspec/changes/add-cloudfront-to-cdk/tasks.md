# Implementation Tasks: Add CloudFront to CDK

## Phase 1: CDK Infrastructure ✅ COMPLETE (PR #59)
**Completed**: 2025-11-10
**Time Spent**: ~5 hours

### 1.1 Create Frontend S3 Bucket ✅
- [x] 1.1.1 Add `frontendBucket` property to LfmtInfrastructureStack class
- [x] 1.1.2 Implement bucket with:
  - [x] Public access blocked
  - [x] Static website hosting disabled (CloudFront-only access)
  - [x] Versioning enabled
  - [x] Lifecycle policy (delete old deployments after 90 days)
  - [x] Encryption (S3-managed)
  - [x] Removal policy based on environment (DESTROY for dev, RETAIN for prod)

### 1.2 Create CloudFront Distribution ✅
- [x] 1.2.1 Add `frontendDistribution` property to LfmtInfrastructureStack class
- [x] 1.2.2 Configure S3 origin with Origin Access Control (OAC)
- [x] 1.2.3 Add custom error responses:
  - [x] 403 → `/index.html` with 200 status (SPA routing)
  - [x] 404 → `/index.html` with 200 status (SPA routing)
  - [x] Error caching TTL: 300 seconds (5 minutes)
- [x] 1.2.4 Configure cache behaviors:
  - [x] Default cache behavior for static assets
  - [x] Cache policy for `index.html` (no cache or short TTL)
  - [x] Viewer protocol policy: HTTPS only (redirect HTTP to HTTPS)
  - [x] Compression enabled (gzip, brotli)
- [x] 1.2.5 Add security headers via response headers policy:
  - [x] `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - [x] `X-Content-Type-Options: nosniff`
  - [x] `X-Frame-Options: DENY`
  - [x] `X-XSS-Protection: 1; mode=block`
  - [x] `Content-Security-Policy` (strict CSP for SPA)
  - [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] 1.2.6 Configure default root object: `index.html`
- [x] 1.2.7 Enable IPv6

### 1.3 Grant CloudFront Access to S3 ✅
- [x] 1.3.1 Create Origin Access Control (OAC) for CloudFront
- [x] 1.3.2 Update frontend bucket policy to allow CloudFront OAC access
- [x] 1.3.3 Deny all other access to frontend bucket

### 1.4 Update CDK Stack Outputs ✅
- [x] 1.4.1 Add `FrontendBucketName` output
- [x] 1.4.2 Add `CloudFrontDistributionId` output
- [x] 1.4.3 Add `CloudFrontDistributionDomain` output (e.g., `d1abc123.cloudfront.net`)
- [x] 1.4.4 Add `FrontendUrl` output (HTTPS URL of CloudFront distribution)

### 1.5 Update API Gateway CORS ✅
- [x] 1.5.1 Read CloudFront URL from CDK context or outputs
- [x] 1.5.2 Update `getAllowedApiOrigins()` to use CloudFront domain
- [x] 1.5.3 Remove hardcoded `https://d1yysvwo9eg20b.cloudfront.net` reference
- [x] 1.5.4 Keep localhost origins for local development

### 1.6 Infrastructure Tests ✅
- [x] 1.6.1 Add test: CloudFront distribution exists
- [x] 1.6.2 Add test: Custom error responses configured correctly
- [x] 1.6.3 Add test: HTTPS-only viewer protocol policy
- [x] 1.6.4 Add test: S3 bucket has block public access enabled
- [x] 1.6.5 Add test: Stack outputs include CloudFront URL
- [x] 1.6.6 Add test: CloudFront URL included in CORS origins (BONUS)

## Phase 2: Deployment Workflow Updates (1-2 hours)

### 2.1 Update Frontend Build Step
- [ ] 2.1.1 Ensure `VITE_API_URL` uses API Gateway URL from CDK outputs
- [ ] 2.1.2 Add environment variable for CloudFront URL (if needed)

### 2.2 Update Frontend Deployment Step
- [ ] 2.2.1 Retrieve `FrontendBucketName` from CDK stack outputs:
  ```bash
  FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name lfmt-infrastructure-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
    --output text)
  ```
- [ ] 2.2.2 Update S3 sync command to use CDK-managed bucket:
  ```bash
  aws s3 sync frontend/dist s3://$FRONTEND_BUCKET/ --delete
  ```

### 2.3 Add CloudFront Invalidation Step
- [ ] 2.3.1 Retrieve `CloudFrontDistributionId` from CDK stack outputs
- [ ] 2.3.2 Add invalidation command after S3 sync:
  ```bash
  aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/*"
  ```
- [ ] 2.3.3 Add check for invalidation completion (optional, for critical deployments)

### 2.4 Update E2E Test Configuration
- [ ] 2.4.1 Retrieve `FrontendUrl` from CDK stack outputs
- [ ] 2.4.2 Pass CloudFront URL to E2E tests via environment variable:
  ```bash
  FRONTEND_URL=$(aws cloudformation describe-stacks \
    --stack-name lfmt-infrastructure-dev \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' \
    --output text)
  ```
- [ ] 2.4.3 Update `frontend/e2e/playwright.config.ts` to use `process.env.FRONTEND_URL`

## Phase 3: Documentation (1 hour)

### 3.1 Update CLAUDE.md
- [ ] 3.1.1 Add CloudFront configuration section
- [ ] 3.1.2 Document SPA routing best practices:
  - [ ] Custom error responses required (403 and 404)
  - [ ] Why S3 returns 403 vs 404 (restricted bucket access)
  - [ ] Security headers configuration
- [ ] 3.1.3 Add CloudFront invalidation notes
- [ ] 3.1.4 Document blue-green deployment strategy for CloudFront updates

### 3.2 Update Project Documentation
- [ ] 3.2.1 Add CloudFront to tech stack in `openspec/project.md`
- [ ] 3.2.2 Update infrastructure section with frontend hosting details
- [ ] 3.2.3 Document manual distribution deprecation timeline

### 3.3 Add Migration Guide
- [ ] 3.3.1 Create `CLOUDFRONT-MIGRATION.md` with:
  - [ ] Pre-migration checklist
  - [ ] Deployment steps (blue-green strategy)
  - [ ] Rollback procedure
  - [ ] Post-migration validation
  - [ ] DNS update instructions (if using custom domain)

## Phase 4: Testing & Validation (2-3 hours)

### 4.1 Local CDK Synthesis
- [ ] 4.1.1 Run `npm run cdk:synth` to validate CloudFormation template
- [ ] 4.1.2 Review generated CloudFormation for CloudFront resources
- [ ] 4.1.3 Verify stack outputs are correct

### 4.2 Dev Environment Deployment
- [ ] 4.2.1 Deploy to dev environment: `npx cdk deploy --context environment=dev`
- [ ] 4.2.2 Verify CloudFront distribution created
- [ ] 4.2.3 Check CloudFront URL is accessible
- [ ] 4.2.4 Test SPA routing:
  - [ ] Root URL (`/`) → redirects to `/login`
  - [ ] Direct navigation to `/dashboard` → serves React app (403 fix validation)
  - [ ] Direct navigation to `/translation/upload` → serves React app
  - [ ] Browser refresh on any route → stays on route
- [ ] 4.2.5 Verify security headers present in response

### 4.3 Frontend Deployment Test
- [ ] 4.3.1 Build frontend with `npm run build`
- [ ] 4.3.2 Deploy frontend to new S3 bucket
- [ ] 4.3.3 Create CloudFront invalidation
- [ ] 4.3.4 Wait for invalidation completion (~3-5 minutes)
- [ ] 4.3.5 Access CloudFront URL and verify updated frontend

### 4.4 E2E Test Validation
- [ ] 4.4.1 Run E2E tests against new CloudFront URL
- [ ] 4.4.2 Verify all 23 tests pass
- [ ] 4.4.3 Check E2E test logs for any CloudFront-related errors

### 4.5 Infrastructure Tests
- [ ] 4.5.1 Run CDK infrastructure tests: `npm test`
- [ ] 4.5.2 Add new tests for CloudFront resources
- [ ] 4.5.3 Verify all tests pass

### 4.6 Manual Smoke Tests
- [ ] 4.6.1 Test authentication flow end-to-end
- [ ] 4.6.2 Test file upload workflow
- [ ] 4.6.3 Verify API Gateway CORS with new CloudFront origin
- [ ] 4.6.4 Check CloudWatch logs for errors

## Phase 5: Blue-Green Deployment (Staging/Production)

### 5.1 Pre-Deployment
- [ ] 5.1.1 Document current manual CloudFront distribution ID
- [ ] 5.1.2 Create backup of current distribution configuration
- [ ] 5.1.3 Notify team of planned infrastructure change
- [ ] 5.1.4 Set up monitoring alerts for CloudFront errors

### 5.2 Blue-Green Strategy
- [ ] 5.2.1 Deploy new CloudFront distribution via CDK (GREEN)
- [ ] 5.2.2 Deploy frontend to new S3 bucket
- [ ] 5.2.3 Test GREEN distribution thoroughly
- [ ] 5.2.4 Update DNS (if using custom domain) to point to GREEN distribution
- [ ] 5.2.5 Monitor for 24 hours
- [ ] 5.2.6 Delete old manual distribution (BLUE) after 30-day grace period

### 5.3 Rollback Plan
- [ ] 5.3.1 Document rollback steps:
  - [ ] Revert DNS to old CloudFront distribution (if changed)
  - [ ] Redeploy frontend to old S3 bucket
  - [ ] Update API Gateway CORS to old CloudFront URL
- [ ] 5.3.2 Test rollback in dev environment
- [ ] 5.3.3 Document decision criteria for rollback

## Phase 6: Cleanup

### 6.1 Remove Manual Distribution (After 30-Day Grace Period)
- [ ] 6.1.1 Verify new CloudFront distribution stable
- [ ] 6.1.2 Delete old manual CloudFront distribution
- [ ] 6.1.3 Delete old S3 bucket (if separate from CDK-managed bucket)
- [ ] 6.1.4 Update documentation to remove references to manual distribution

### 6.2 Code Cleanup
- [ ] 6.2.1 Remove all hardcoded CloudFront URLs
- [ ] 6.2.2 Remove backup/rollback code after grace period
- [ ] 6.2.3 Archive `CLOUDFRONT-MIGRATION.md` to `docs/archive/`

---

**Total Estimated Tasks**: 88
**Completed**: 30 (Phase 1 complete)
**Remaining**: 58 (Phases 2-6)
**Progress**: 34%

**Critical Path**: ~~Phase 1 (CDK)~~ ✅ → **Phase 2 (Deployment)** → Phase 4 (Testing)
**Total Duration**: 10-14 hours (~1.5-2 days)
**Time Spent**: ~5 hours (Phase 1)
**Time Remaining**: 5-9 hours (Phases 2-6)

**Next Phase**: Phase 2 - Deployment Workflow Updates (1-2 hours)
