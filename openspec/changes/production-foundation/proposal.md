# Proposal: LFMT Production Foundation

**Change ID**: `production-foundation`
**Status**: Proposed
**Priority**: P0 - CRITICAL (Production Readiness)
**Owner**: Raymond Lei (Project Owner)
**Created**: 2026-04-03
**Target Completion**: 2026-05-01 (4 weeks)

---

## Why

LFMT is currently a proof-of-concept with ~877 tests and working end-to-end deployment. However, before adding new features or exposing to real users, the codebase requires a production-ready foundation to ensure reliability, security, and maintainability.

**Current State (POC Quality)**:
- Test coverage: Backend 70% (target: 95%), Frontend unmeasured
- Code quality: No enforced standards in CI, manual reviews only
- Infrastructure: IAM permissions not audited for least privilege
- Monitoring: No CloudWatch dashboards or alerting
- Deployment: Dev environment only, no staging/prod separation
- Security: DynamoDB backups disabled, S3 encryption not enforced

**Business Risk**:
- **Without 95% coverage**: Silent bugs in production, customer data loss
- **Without code standards**: Technical debt compounds, onboarding slows
- **Without hardened IAM**: Security breach blast radius increases
- **Without monitoring**: Outages go undetected, user trust erodes
- **Without deployment rigor**: Production incidents from untested changes

This change establishes the **minimum production-grade foundation** required before scaling beyond POC.

---

## What Changes

### 1. Test Coverage with Tiered Targets ✅ **REQUIRED**
**Tiered Coverage Approach** (realistic for production quality):
- **Critical Path (Auth + Translation)**: 100% coverage (zero tolerance for bugs)
  - `backend/functions/auth/*`: 100% (authentication = security critical)
  - `backend/functions/translation/*`: 100% (core business logic)
  - `frontend/src/components/auth/*`: 100%
  - `frontend/src/components/translation/*`: 100%
- **General Code**: 80% coverage (pragmatic balance)
  - All other frontend/backend application code
  - Shared types and utilities
- **Infrastructure (CDK)**: 40-50% coverage (avoid testing the framework)
  - Focus on custom logic, not CDK construct validation
  - Test IAM policy generation, environment config logic
  - **Note**: CDK snapshot tests are brittle/noisy — use sparingly, focus on unit tests for custom constructs

**Why Tiered?**
- **Reviewer Feedback**: 95% across all code (including infra) is unrealistic for one person in 1 week
- **95% CDK coverage = testing AWS's framework**, not our logic
- **Focus effort where it matters**: Security (auth) and business value (translation)

**CI Enforcement**: Fail builds if critical path < 100%, general < 80%, infra < 40%

### 2. Code Quality Standards ✅ **REQUIRED**
- **TypeScript Strict Mode**: Enforce `strict: true`, `noImplicitAny: true` in all `tsconfig.json`
- **ESLint Rules**: Standardize `.eslintrc.cjs` across frontend/backend with auto-fix in CI
- **Prettier Formatting**: Add `.prettierrc.json`, format all code, enforce in pre-commit hooks
- **Pre-commit Hooks**: Husky + lint-staged to run linters, formatters, type-checks
- **PR Templates**: Add `.github/pull_request_template.md` with review checklist
- **CI Quality Gates**:
  - `npm run lint` must pass (0 warnings)
  - `npm run type-check` must pass
  - Code coverage must meet tiered thresholds (Critical Path 100%, General 80%, Infra 40-50%)

### 3. Infrastructure Hardening ✅ **REQUIRED**
- **IAM Least Privilege Audit**:
  - Review all 10 PolicyStatements in `lfmt-infrastructure-stack.ts` (lines 502-1027)
  - Remove wildcards, scope to exact resources
  - Document justification for each permission
- **DynamoDB Backup & Point-in-Time Recovery**:
  - Enable PITR on `jobsTable`, `usersTable`, `attestationsTable`
  - Configure backup retention (7 days dev, 30 days prod)
- **S3 Security**:
  - Enable server-side encryption (AES-256) on all buckets
  - Add bucket policies blocking public access
  - Enable versioning on `documentBucket` and `resultsBucket`
- **Cognito Hardening**:
  - Enforce password complexity (12+ chars, uppercase, lowercase, numbers, symbols)
  - **Migration Plan for Existing Users**: Password policy change (8→12 chars) will break existing users
    - Strategy: Grandfather existing users (allow 8+ chars), enforce 12+ only for new registrations and password resets
    - Document in migration runbook
  - Enable MFA for admin users (production only)
  - Configure account lockout after 5 failed login attempts
- **Environment Separation** ⚠️ **CRITICAL CHANGE**:
  - **Separate AWS Accounts for Production** (not single account)
    - **Dev/Staging**: Can share one account (lower risk)
    - **Production**: Dedicated AWS account via AWS Organizations
    - **Rationale**: Single account = blast radius nightmare (dev bug → prod outage, dev IAM change → prod access leak)
  - Formalize dev/staging/prod CDK context configurations
  - Environment-specific secrets in AWS Secrets Manager
- **Secrets Management**:
  - **Add Secrets Rotation Policy**: Rotate Gemini API key every 90 days
  - Configure AWS Secrets Manager rotation for production
  - Document manual rotation procedure for dev/staging
- **Cost Controls** 🆕 **CRITICAL GAP**:
  - **AWS Budgets**: Create $50/month budget with 80% notification threshold
  - **Cost Anomaly Detection**: Enable AWS Cost Anomaly Detection (catch runaway Lambda/Gemini loops)
  - **Daily cost tracking**: CloudWatch metric for daily spend
- **Data Privacy & GDPR** 🆕 **CRITICAL GAP**:
  - **Formal Data Retention Policy**: User-uploaded documents deleted after 30 days (or immediate post-translation)
  - **S3 Lifecycle Policies**: Enforce retention rules automatically
  - **User Consent**: Update terms of service with data handling disclosure
  - **Right to Deletion**: API endpoint for users to request immediate document deletion

### 4. Monitoring & Observability ✅ **REQUIRED**
- **Backend Observability (CloudWatch)**:
  - **Dashboards**: API Gateway, Lambda, DynamoDB, S3, Step Functions
  - **Alarms**: Lambda errors > 5%, API 5xx > 1%, DynamoDB throttling, translation failures
  - **Structured Logging**:
    - **Correlation ID Origin**: Born at **API Gateway** (`event.requestContext.requestId`), propagated through all Lambda layers
    - JSON log format for CloudWatch Insights queries
    - Log retention: 7 days (dev), 30 days (prod)
- **Frontend Observability** 🆕 **CRITICAL GAP**:
  - **Problem**: Frontend is currently a black hole for errors (no visibility into client-side failures)
  - **Solution Options**:
    - **CloudWatch RUM** (AWS native, $1/100K events)
    - **Sentry** (better UX, free tier 5K events/mo)
  - **Decision**: CloudWatch RUM for cost consistency with backend
  - **Metrics**: JS errors, page load time, React component crashes, API call failures
- **Gemini API Rate Limiting** 🆕 **CRITICAL GAP**:
  - **Problem**: Current rate limiter (DynamoDB-based) doesn't handle Gemini 429 errors gracefully
  - **Circuit Breaker Pattern**: Halt translation job after 3 consecutive 429s, exponential backoff
  - **UI Handling**: Show "Translation paused due to rate limits, retrying in 2 minutes..." (not generic error)
  - **Metrics**: Track 429 rate, circuit breaker trips
- **X-Ray Tracing** (Optional P1):
  - Enable AWS X-Ray on Lambda functions
  - Trace API Gateway → Lambda → DynamoDB/S3 flows

### 5. CI/CD Hardening ✅ **REQUIRED**
- **Deployment Strategy**:
  - **Dev**: Auto-deploy on `main` push (current behavior)
  - **Staging**: Manual approval via `workflow_dispatch` (new)
  - **Prod**: Requires staging validation + approval (new)
- **Automated Rollback** ⚠️ **CRITICAL CHANGE**:
  - **Problem**: Task 4.5.2 is documentation-only (not tested, not automated)
  - **Solution**: Tested, automated rollback scripts
    - `scripts/rollback-lambda.sh`: Revert Lambda function to previous version
    - `scripts/rollback-cdk-stack.sh`: Rollback CloudFormation stack to previous version
    - `scripts/rollback-database.sh`: Restore DynamoDB from PITR
  - **Testing**: Execute rollback in dev every sprint (muscle memory + validation)
  - **Documentation**: Runbooks reference these scripts, not manual steps
- **Smoke Tests**:
  - Post-deployment health checks (API /health endpoint)
  - Critical path tests: login → upload → translation → download
  - Run in CI after staging/prod deployments
- **Dependency Management**:
  - Dependabot for automated security updates
  - Pin exact versions in `package-lock.json`
  - Quarterly dependency audit

### 6. Operational Procedures ✅ **REQUIRED**
- **Deployment Runbooks**:
  - Step-by-step deployment guides for staging/prod
  - Rollback procedures with time estimates
  - Database migration checklists
- **Incident Response**:
  - On-call rotation setup (if team > 1 person)
  - Incident severity levels (P0-P3)
  - Post-mortem template
- **Monitoring Runbooks**:
  - CloudWatch alarm response procedures
  - Debugging guides for common errors
  - Performance tuning playbook

---

## Impact

### Affected Specs
This is a **cross-cutting foundational change** affecting all existing capabilities:
- **ALL** backend Lambda functions (testing, IAM, logging)
- **ALL** frontend components (testing, linting, formatting)
- **ALL** infrastructure resources (hardening, monitoring)
- **CI/CD workflows** (quality gates, deployment strategy)

**No delta specs required** - this change improves quality/security without altering functional behavior.

### Affected Code
- **Test Configuration**: `jest.config.js`, `vitest.config.ts` (3 files)
- **Linting**: `.eslintrc.cjs`, `.prettierrc.json` (4+ files)
- **Infrastructure**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (1,523 lines)
- **CI/CD**: `.github/workflows/deploy.yml` (559 lines)
- **Lambda Functions**: All 11 Lambda handlers (IAM, logging, error handling)
- **Frontend**: All React components and hooks (testing, linting)
- **New Files**:
  - `docs/runbooks/deployment.md`
  - `docs/runbooks/incident-response.md`
  - `docs/monitoring-guide.md`
  - `.github/pull_request_template.md`
  - `.prettierrc.json`

### Breaking Changes
**NONE** - This change is backward-compatible. All changes are additive or internal improvements.

### Migration Path ⚠️ **CRITICAL: PHASE REORDERING**

**Reviewer Feedback**: Phase 1 (Test Coverage) before Phase 2 (TypeScript Strict) is backwards — writing tests against incorrect types wastes effort. Fix types FIRST, then write tests.

**REVISED Phase Order**:
1. **Phase 1 (Week 1)**: Code Quality - TypeScript Strict, ESLint, Prettier (fix foundation first)
2. **Phase 2 (Week 2)**: Test Coverage - Add missing tests against correct types (realistic timeline, tiered targets)
3. **Phase 3 (Week 3)**: Infrastructure Hardening - IAM audit, encryption, backups, AWS account separation
4. **Phase 4 (Week 4)**: Monitoring & CI/CD - Dashboards, alarms, deployment rigor, automated rollback

**Rollout Strategy**: All changes deploy to dev environment first, validate for 1 week before considering staging/prod.

---

## Success Criteria

### Quantitative Metrics
- ✅ **Test Coverage**: ≥95% across backend, frontend, infrastructure, shared-types
- ✅ **CI Quality Gates**: All builds pass linting, type-checking, coverage thresholds
- ✅ **IAM Audit**: Zero wildcard permissions, all resources scoped to exact ARNs
- ✅ **Monitoring**: 8+ CloudWatch dashboards, 10+ alarms configured
- ✅ **Deployment Rigor**: Staging environment operational, rollback tested

### Qualitative Metrics
- ✅ **Code Review**: PR template reduces review time by 30%
- ✅ **Debugging**: CloudWatch dashboards reduce incident triage time by 50%
- ✅ **Confidence**: Team can deploy to production without anxiety
- ✅ **Security**: Pass AWS Trusted Advisor security checks

### Acceptance Tests
1. **Coverage Enforcement**: Temporarily delete a test → CI build fails
2. **Linting Enforcement**: Introduce a linting error → Pre-commit hook blocks commit
3. **IAM Validation**: Attempt unauthorized DynamoDB access → Access denied
4. **Monitoring**: Trigger a Lambda error → CloudWatch alarm fires within 5 minutes
5. **Rollback**: Deploy a broken change → Rollback completes in < 10 minutes

---

## Risks & Mitigation

### Risk 1: Coverage Target Too Aggressive (95% Uniform is Unrealistic)
**Probability**: High ⚠️ **REVIEWER CONFIRMED**
**Impact**: Medium (timeline slip OR meaningless green-wash tests)
**Reviewer Feedback**: Going from 0% to 95% across frontend + infra in 5 days for one person = recipe for garbage tests just to hit numbers
**Mitigation**:
- **Tiered Coverage Targets**: Critical 100%, General 80%, Infra 40-50% (see What Changes section)
- Focus on security-critical code first (auth = 100%), then business logic (translation = 100%)
- Infrastructure tests focus on custom logic, not CDK framework validation

### Risk 2: Breaking Changes from Strict TypeScript
**Probability**: Low
**Impact**: High (requires significant refactoring)
**Mitigation**:
- Audit current codebase for `any` types (estimated <50 occurrences)
- Fix incrementally, file-by-file
- Allocate 2 days for TypeScript strict mode migration

### Risk 3: IAM Changes Break Existing Functionality
**Probability**: Medium
**Impact**: High (service outage)
**Mitigation**:
- Test IAM changes in dev environment for 3 days before staging
- Run full integration test suite after IAM updates
- Keep rollback plan ready (previous CDK stack version)

### Risk 4: Timeline Pressure (4 Weeks is Ambitious)
**Probability**: Medium
**Impact**: Medium (delayed production readiness)
**Mitigation**:
- Prioritize P0 items (coverage, IAM, monitoring)
- Defer P1 items if necessary (X-Ray tracing, advanced runbooks)
- Weekly progress reviews with stakeholders

---

## Dependencies

### External Dependencies
- AWS Services: CloudWatch, X-Ray, SNS (for alarms)
- GitHub Actions: No additional runners required
- Tools: Husky, lint-staged, Prettier (npm packages)

### Internal Dependencies
- **Blocked By**: Phase A stabilization (PR #115) - **COMPLETED** ✅
- **Blocks**: All future feature development (Phase B+)
- **Concurrent Work**: Demo content preparation (Phase 10) can proceed in parallel

---

## References

### Related Work
- **Phase A Stabilization**: PR #115 (merged Mar 31, 2026) - Translation workflow fixes
- **Existing Security Work**: `openspec/changes/harden-security/` (IAM patterns)
- **Test Infrastructure**: `backend/functions/jest.config.js` (current 70% threshold)

### Documentation
- **AWS CDK Best Practices**: `docs/CDK-BEST-PRACTICES.md`
- **CORS Configuration**: `docs/CORS-REFERENCE.md`
- **Infrastructure Setup**: `docs/INFRASTRUCTURE-SETUP.md`
- **Current Progress**: `PROGRESS.md` (Phase 10 status)

### Industry Standards
- **Test Coverage**: Industry standard 80-95% for production systems
- **IAM Least Privilege**: AWS Well-Architected Framework, Security Pillar
- **Monitoring**: Google SRE Book - Chapter 6 (Monitoring Distributed Systems)
- **CI/CD**: DORA Metrics (deployment frequency, lead time, MTTR)

---

## Timeline

### Week 1: Code Quality Standards (MOVED TO FIRST - FIX TYPES BEFORE TESTS)
- Days 1-2: Audit `any` types, enable TypeScript strict mode across all packages
- Days 3-4: Configure ESLint, Prettier, enforce in CI
- Days 5: Add pre-commit hooks (Husky + lint-staged)
- Days 6-7: Fix TypeScript errors incrementally, validate with type-check

### Week 2: Test Coverage Foundation (REALISTIC TIMELINE, TIERED TARGETS)
- Days 1-2: Configure coverage reporting with tiered thresholds (Critical 100%, General 80%, Infra 40-50%)
- Days 3-5: Write missing unit tests for **critical path** (auth 100%, translation 100%)
- Days 6-7: Write missing tests for general code (80% target), frontend components (80% target)

### Week 3: Infrastructure Hardening (+ AWS ACCOUNT SEPARATION)
- Days 1-2: IAM least privilege audit and fixes
- Days 3: Enable DynamoDB backups, S3 encryption
- Day 4: Cognito hardening (password policy + migration plan for existing users)
- Days 5-6: **AWS Organizations setup** - Create prod account, configure cross-account IAM roles
- Day 7: Deploy prod stack to new account, validate

### Week 4: Monitoring & Deployment (+ AUTOMATED ROLLBACK + COST CONTROLS)
- Day 1: CloudWatch dashboards (backend + **frontend RUM**)
- Day 2: CloudWatch alarms + SNS notifications
- Day 3: **AWS Budgets + Cost Anomaly Detection** setup
- Day 4: **Automated rollback scripts** (Lambda, CDK, DynamoDB PITR restore)
- Day 5: CI/CD hardening (staging, smoke tests, **Gemini circuit breaker**)
- Days 6-7: Operational runbooks (reference automated scripts), final validation

**Buffer**: 3 days for unexpected issues

---

## Resolved Questions

1. **Coverage Exemptions**: Coverage exemptions are the **nuclear option — last resort only.**
   - **Decision**: Unless absolutely necessary, no exemptions. 95% means 95%. The bar is intentionally high. If code can't be tested, question whether the code should exist.
   - Generated code (`cdk.out/`, `.d.ts` files, `node_modules/`) is excluded from coverage reporting (not "exempted" — it's not our code).

2. **Production AWS Account Separation**: SEPARATE account via AWS Organizations ⚠️ **CRITICAL CHANGE**
   - **OLD Decision (REJECTED)**: Keep dev/staging/prod in same account
   - **Reviewer Feedback**: Single account for prod = "blast radius nightmare" — dev bug can nuke prod, dev IAM leak = prod access compromise
   - **NEW Decision**:
     - **Dev + Staging**: Share one AWS account (acceptable risk, both non-prod)
     - **Production**: Dedicated AWS account via AWS Organizations
     - **Migration**: Set up AWS Org, create prod account, deploy prod stack in Week 3
   - **Timeline Impact**: +2 days for AWS Org setup and cross-account IAM roles

3. **Monitoring Tool**: CloudWatch native, cost-conscious.
   - **Decision**: CloudWatch only. Be mindful of metrics costs — basic dashboards and alarms with low-cost configuration given current low traffic. No third-party APM.

4. **MFA Scope**: Admin-only for now, all-users in backlog.
   - **Decision**: Enable MFA for admin users in production only. Add "MFA for all users" to the product backlog for future implementation.

---

**Status**: Proposed - Open Questions Resolved, Awaiting Final Approval
**Next Steps**: Final review → Approve → Begin Week 1 implementation
