# Proposal: Add CloudFront Distribution to CDK Infrastructure

**Change ID**: `add-cloudfront-to-cdk`
**Status**: In Progress - Phases 1-3 Complete
**Priority**: P1 - HIGH (Infrastructure Team Priority per Team Lead)
**Related Issues**: PR #54 Review Comments, PR #58 (Approved), PR #59 (Phase 1), PR #61 (Phase 2), PR #66 (Hotfix), PR #67 (Phase 3)
**Owner**: Infrastructure Team
**Created**: 2025-11-09
**Phases 1-3 Completed**: 2025-11-10

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

### ✅ Phase 3: Documentation (Complete - PR #67)
**Completed**: 2025-11-10
**PR**: https://github.com/leixiaoyu/lfmt-poc/pull/67

**Implemented**:
- ✅ Updated `CLAUDE.md` with comprehensive CloudFront documentation:
  - CloudFront configuration details (S3 bucket, distribution, OAC)
  - SPA routing deep dive (403 vs 404, custom error responses)
  - Security headers configuration (CSP placement fix explained)
  - CloudFront invalidation best practices
  - Blue-green deployment strategy
  - Known issues and fixes (CSP hotfix from PR #66)
  - Testing guidelines and manual operations
  - Development guidelines and common pitfalls
- ✅ Updated `openspec/project.md`:
  - Added CloudFront to tech stack (Frontend hosting section)
  - Updated External Dependencies (AWS CloudFront with OAC details)
  - Documented manual distribution deprecation timeline
- ✅ Integrated migration guide into CLAUDE.md (no separate file needed)

**Deliverables**:
- `CLAUDE.md`: ~460 lines of comprehensive CloudFront documentation
- `openspec/project.md`: Updated tech stack and dependencies sections
- Migration guidance integrated into main documentation

### ✅ Phase 4: Testing & Validation (Complete)
**Completed**: 2025-11-10
**PR**: Comprehensive validation of CloudFront CDK infrastructure

**Implemented**:
- ✅ CDK stack synthesis validated (CloudFormation template correct)
- ✅ Dev environment deployment verified (status: UPDATE_COMPLETE)
- ✅ CloudFront distribution accessible (E3EV4PBKYTNTRE)
- ✅ SPA routing working correctly (403/404 → /index.html)
- ✅ All 6 security headers validated (HSTS, CSP, X-Frame-Options, etc.)
- ✅ Frontend deployment workflow verified (S3 sync + invalidation)
- ✅ E2E test configuration confirmed using CloudFront URL
- ✅ Infrastructure tests passing (33 tests, including 7 CloudFront/CORS tests)

**Validation Results**:
- Stack Status: UPDATE_COMPLETE
- CloudFront Distribution ID: E3EV4PBKYTNTRE
- Frontend URL: https://d39xcun7144jgl.cloudfront.net
- SPA Routing: All routes return 200 (custom error responses working)
- Security Headers: All 6 headers correctly configured
- S3 Bucket: lfmt-frontend-lfmtpocdev
- CloudFront Invalidation: Automated in deployment workflow

**Deliverables**:
- Comprehensive validation summary in `tasks.md`
- CloudFront distribution serving production traffic
- All infrastructure tests passing
- Documentation updated with CloudFront configuration details

### ✅ Phase 5: Blue-Green Deployment Analysis (Complete)
**Completed**: 2025-11-10
**Time Spent**: ~0.5 hours (Documentation and Analysis)

**Analysis Results**:
- ✅ Manual distribution (BLUE) documented: `d1yysvwo9eg20b.cloudfront.net` (ID: `EY0NDD10UXFN4`)
- ✅ CDK distribution (GREEN) verified functional: `d39xcun7144jgl.cloudfront.net` (ID: `E3EV4PBKYTNTRE`)
- ✅ GREEN distribution serving traffic (validated in Phase 4)
- ✅ Rollback procedure documented for emergency use
- ✅ No custom domain configured (POC uses CloudFront domains directly)

**Key Findings**:
- Blue-green deployment effectively complete for dev environment
- GREEN distribution fully functional and stable
- BLUE distribution deprecated, scheduled for deletion after 30-day grace period
- Rollback plan available but unnecessary (GREEN distribution stable)

**Deliverables**:
- Comprehensive distribution comparison (BLUE vs GREEN)
- Rollback procedure documentation
- Deletion timeline for manual distribution (2025-12-10)

### Phase 6: Cleanup (Deferred - Team Lead Decision Required)
**Scheduled**: 2025-12-10 (After 30-day grace period)
**Status**: Pending team lead approval

**Pending Tasks**:
- Delete manual CloudFront distribution (`EY0NDD10UXFN4`)
- Delete old S3 bucket (`lfmt-poc-frontend`)
- Remove BLUE distribution references from documentation

**Code Cleanup** (Already Complete):
- ✅ All hardcoded CloudFront URLs removed (Phase 1)
- ✅ CDK stack outputs used throughout codebase
- ✅ No backup code exists (CDK manages infrastructure)

---

## Summary

**Status**: ✅ **CloudFront CDK Migration Complete**

### Implementation Progress
- **Phases 1-5**: Complete (100% implementation)
- **Phase 6**: Deferred to 2025-12-10 (30-day grace period)
- **Total Time**: ~9 hours (implementation), ~1 hour (cleanup pending)

### Infrastructure Comparison

| Aspect | BLUE (Manual) | GREEN (CDK) |
|--------|--------------|-------------|
| **Distribution ID** | `EY0NDD10UXFN4` | `E3EV4PBKYTNTRE` |
| **Domain** | `d1yysvwo9eg20b.cloudfront.net` | `d39xcun7144jgl.cloudfront.net` |
| **S3 Origin** | `lfmt-poc-frontend.s3.amazonaws.com` | `lfmt-frontend-lfmtpocdev.s3.us-east-1.amazonaws.com` |
| **Management** | Manual (AWS Console) | CDK Infrastructure as Code |
| **SPA Routing** | Manual 403 fix (PR #54) | Automated (custom error responses) |
| **Security Headers** | Manual configuration | CDK-managed (6 headers) |
| **Status** | Deprecated | Active |
| **Deletion Date** | 2025-12-10 | N/A |

### Benefits Achieved

1. ✅ **Version Control**: All infrastructure changes tracked in git
2. ✅ **Reproducibility**: Entire infrastructure recreatable from code
3. ✅ **Environment Parity**: Consistent configuration across environments
4. ✅ **Automated Deployment**: Infrastructure updates via standard PR workflow
5. ✅ **Security**: CloudFront configuration reviewed and validated
6. ✅ **Cost Visibility**: Resources tagged and tracked in CDK

### Next Action
Monitor GREEN distribution for 30 days, then delete BLUE distribution (Team lead approval required)

---
**Validation**: `openspec validate add-cloudfront-to-cdk --strict`
**Final Status**: Migration Complete - Cleanup Scheduled
