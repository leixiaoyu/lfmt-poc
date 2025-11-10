# Proposal: Add CloudFront Distribution to CDK Infrastructure

**Change ID**: `add-cloudfront-to-cdk`
**Status**: In Progress - Phase 1 Complete
**Priority**: P1 - HIGH (Infrastructure Team Priority per Team Lead)
**Related Issues**: PR #54 Review Comments, PR #58 (Approved), PR #59 (Merged - Phase 1)
**Owner**: Infrastructure Team
**Created**: 2025-11-09
**Phase 1 Completed**: 2025-11-10

---

## Why

The CloudFront distribution for frontend hosting is currently managed manually outside of the CDK infrastructure stack. This creates several critical problems:

1. **Configuration Drift**: Manual infrastructure changes (like the recent 403 error fix) are not version-controlled
2. **Deployment Fragility**: Hardcoded CloudFront URL (`https://d1yysvwo9eg20b.cloudfront.net`) in multiple places
3. **No Disaster Recovery**: Cannot recreate distribution if accidentally deleted
4. **Environment Inconsistency**: Different configuration across dev/staging/prod environments
5. **Security Risk**: Manual changes bypass IaC security reviews and validations

### Recent Evidence

The CloudFront 403 error fix (PR #54) required manual AWS CLI commands to update the distribution. This highlighted the critical need for Infrastructure as Code management:
- Manual update: `aws cloudfront update-distribution --id EY0NDD10UXFN4`
- No git history of infrastructure changes
- Cannot replicate fix across environments
- Team lead explicitly identified this as highest priority for infrastructure team

### Team Lead Guidance

From PR #54 review (xlei-raymond):
> "The next logical and highest-priority step for our infrastructure team is to bring the CloudFront distribution into our CDK stack as Infrastructure as Code to prevent any future configuration drift."

## What Changes

This change will migrate the manually-created CloudFront distribution to AWS CDK Infrastructure as Code:

1. **Add CloudFront Distribution Construct** to `lfmt-infrastructure-stack.ts`:
   - S3 origin with Origin Access Control (OAC)
   - Custom error responses for SPA routing (403 → `/index.html`, 404 → `/index.html`)
   - Cache behaviors optimized for React SPA
   - Security headers (CSP, HSTS, X-Frame-Options)
   - Regional edge caching for cost optimization

2. **Create Frontend S3 Bucket**:
   - Static website hosting disabled (CloudFront-only access)
   - Block all public access
   - Lifecycle policies for old deployment cleanup
   - Versioning enabled for rollback capability

3. **Update Deployment Workflow**:
   - Modify `.github/workflows/deploy.yml` to use CDK-outputted CloudFront URL
   - Remove hardcoded distribution ID and URL
   - Add CloudFront invalidation after frontend deployment

4. **Remove Hardcoded References**:
   - Replace `https://d1yysvwo9eg20b.cloudfront.net` with CDK outputs
   - Update API Gateway CORS allowed origins to use CloudFront domain
   - Update E2E tests to use environment-specific CloudFront URL

5. **Documentation**:
   - Document CloudFront configuration in `CLAUDE.md`
   - Add SPA routing best practices to project documentation
   - Update infrastructure README with CloudFront management

## Impact

### Affected Specs
- **frontend-hosting** (NEW): CloudFront distribution management, SPA routing configuration, security headers

### Affected Code
- **CDK Infrastructure** (`backend/infrastructure/lib/lfmt-infrastructure-stack.ts`):
  - Add `createFrontendHosting()` method (~150 lines)
  - Add `frontendBucket` and `frontendDistribution` properties
  - Update `createOutputs()` to export CloudFront URL and domain

- **Deployment Workflow** (`.github/workflows/deploy.yml`):
  - Replace hardcoded CloudFront URL with CDK stack output
  - Add CloudFront invalidation step after frontend deployment
  - Update E2E test environment variables

- **API Gateway** (`backend/infrastructure/lib/lfmt-infrastructure-stack.ts:337-400`):
  - Update CORS allowed origins to use CloudFront URL from CDK outputs

- **E2E Tests** (`frontend/e2e/playwright.config.ts`):
  - Read CloudFront URL from environment variable instead of hardcoded value

### Breaking Changes
- **BREAKING**: Existing manual CloudFront distribution will be replaced with CDK-managed distribution
- **BREAKING**: CloudFront distribution ID will change (requires DNS update if using custom domain)
- **Migration Required**: Gradual rollover deployment to avoid downtime

### Risk Mitigation
- Create new CloudFront distribution before deleting old one
- Use blue-green deployment strategy
- Test thoroughly in dev environment before production rollout
- Keep manual distribution as backup for 30 days

### Benefits
1. **Version Control**: All infrastructure changes tracked in git
2. **Reproducibility**: Can recreate entire infrastructure from code
3. **Environment Parity**: Consistent configuration across dev/staging/prod
4. **Automated Deployment**: Infrastructure updates via standard PR workflow
5. **Security**: CloudFront configuration reviewed and validated like any code change
6. **Cost Visibility**: CloudFront resources tagged and tracked in CDK

### Estimated Effort
- **Design & Proposal**: 2 hours ✅ DONE (PR #58)
- **Phase 1 - CDK Infrastructure**: 4-6 hours ✅ DONE (PR #59)
- **Phase 2 - Deployment Workflow**: 1-2 hours (PENDING)
- **Phase 3 - Documentation**: 1 hour (PENDING)
- **Phase 4 - Testing & Validation**: 2-3 hours (PENDING)
- **Total**: 10-14 hours (~1.5-2 days)

## Progress

### ✅ Phase 1: CDK Infrastructure (Complete - PR #59)
**Completed**: 2025-11-10
**PR**: https://github.com/leixiaoyu/lfmt-poc/pull/59

**Implemented**:
- ✅ CloudFront distribution with Origin Access Control (OAC)
- ✅ Custom error responses for SPA routing (403/404 → `/index.html`)
- ✅ Security headers policy (HSTS, CSP, X-Frame-Options, etc.)
- ✅ Frontend S3 bucket with versioning and lifecycle policies
- ✅ API Gateway CORS updated to use CloudFront URL
- ✅ Removed hardcoded CloudFront URL (`d1yysvwo9eg20b.cloudfront.net`)
- ✅ CDK stack outputs (FrontendBucketName, CloudFrontDistributionId, FrontendUrl)
- ✅ Infrastructure tests (33 tests passing, including 7 CloudFront/CORS tests)

**Deliverables**:
- `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`:
  - Added `createFrontendHosting()` method (135 lines)
  - Added `frontendBucket` and `frontendDistribution` properties
  - Updated constructor ordering (CloudFront before API Gateway)
- `backend/infrastructure/lib/__tests__/infrastructure.test.ts`:
  - Added 6 CloudFront-specific tests
  - Added 1 CORS verification test
  - Updated resource count validation

### ✅ Phase 2: Deployment Workflow (Complete - PR #61)
**Completed**: 2025-11-10
**PR**: https://github.com/leixiaoyu/lfmt-poc/pull/61

**Implemented**:
- ✅ Updated environment URL to use CDK stack output
- ✅ Added step to retrieve FrontendBucketName from CDK outputs
- ✅ Updated S3 sync commands to use dynamic bucket name
- ✅ Replaced manual CloudFront distribution lookup with CDK output
- ✅ Updated CloudFront URL retrieval to use CDK FrontendUrl output
- ✅ Updated deployment summary to display CDK-managed resources
- ✅ E2E test configuration already using CDK outputs via job outputs

**Deliverables**:
- `.github/workflows/deploy.yml`:
  - Removed hardcoded CloudFront URL (`d1yysvwo9eg20b.cloudfront.net`)
  - Removed hardcoded S3 bucket name (`lfmt-poc-frontend`)
  - All infrastructure references now use CDK stack outputs
  - CloudFront invalidation already configured (no changes needed)

### 📋 Phase 3: Documentation (Pending)
**Status**: Pending
**Target**: Update project documentation

**Tasks**:
- Update `CLAUDE.md` with CloudFront configuration details
- Document SPA routing best practices
- Add migration guide for blue-green deployment

### 🧪 Phase 4: Testing & Validation (Pending)
**Status**: Pending
**Target**: Deploy and validate in dev environment

**Tasks**:
- Deploy CDK stack to dev environment
- Verify CloudFront distribution creation
- Test SPA routing (403 error handling)
- Validate security headers
- Run E2E tests against CloudFront URL

---

**Next Step**: Proceed with Phase 2 - Update deployment workflow
**Validation**: `openspec validate add-cloudfront-to-cdk --strict`
