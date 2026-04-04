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

### 1. Test Coverage to 95% Across ALL Code ✅ **REQUIRED**
- **Backend Functions** (`backend/functions/`): 70% → 95% statement coverage
  - Missing coverage: Error handling paths, edge cases, integration tests
  - Add unit tests for all Lambda handlers
- **Frontend** (`frontend/src/`): Unknown → 95% statement coverage
  - Configure Vitest coverage reporting
  - Test all React components, hooks, contexts, utilities
- **Infrastructure** (`backend/infrastructure/`): 0% → 95% (CDK construct testing)
  - Test CDK stack synthesis and resource creation
  - Validate IAM policies, environment configurations
- **Shared Types** (`shared-types/`): Unknown → 95%
  - Test Zod schema validation edge cases

**CI Enforcement**: Fail builds if coverage drops below 95% (no exceptions)

### 2. Code Quality Standards ✅ **REQUIRED**
- **TypeScript Strict Mode**: Enforce `strict: true`, `noImplicitAny: true` in all `tsconfig.json`
- **ESLint Rules**: Standardize `.eslintrc.cjs` across frontend/backend with auto-fix in CI
- **Prettier Formatting**: Add `.prettierrc.json`, format all code, enforce in pre-commit hooks
- **Pre-commit Hooks**: Husky + lint-staged to run linters, formatters, type-checks
- **PR Templates**: Add `.github/pull_request_template.md` with review checklist
- **CI Quality Gates**:
  - `npm run lint` must pass (0 warnings)
  - `npm run type-check` must pass
  - Code coverage must meet 95% threshold

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
  - Enable MFA for admin users (production only)
  - Configure account lockout after 5 failed login attempts
- **Environment Separation**:
  - Formalize dev/staging/prod CDK context configurations
  - Separate AWS accounts or resource tagging strategy
  - Environment-specific secrets in AWS Secrets Manager

### 4. Monitoring & Observability ✅ **REQUIRED**
- **CloudWatch Dashboards**:
  - API Gateway: Request count, 4xx/5xx errors, latency (p50, p99)
  - Lambda: Invocations, errors, duration, throttles, concurrent executions
  - DynamoDB: Consumed read/write capacity, throttled requests
  - S3: Bucket size, request metrics
  - Step Functions: Execution success/failure rates, duration
- **CloudWatch Alarms**:
  - Lambda error rate > 5% (5-minute period)
  - API Gateway 5xx rate > 1% (5-minute period)
  - DynamoDB throttled requests > 10 (1-minute period)
  - Translation job failures > 3 in 1 hour
  - SNS topic for alarm notifications
- **Structured Logging**:
  - Add correlation IDs to all Lambda logs
  - JSON log format for CloudWatch Insights queries
  - Log retention: 7 days (dev), 30 days (prod)
- **X-Ray Tracing** (Optional P1):
  - Enable AWS X-Ray on Lambda functions
  - Trace API Gateway → Lambda → DynamoDB/S3 flows

### 5. CI/CD Hardening ✅ **REQUIRED**
- **Deployment Strategy**:
  - **Dev**: Auto-deploy on `main` push (current behavior)
  - **Staging**: Manual approval via `workflow_dispatch` (new)
  - **Prod**: Requires staging validation + approval (new)
- **Rollback Procedure**:
  - Document CDK rollback steps (`cdk deploy --previous-version`)
  - CloudFormation change sets for production deployments
  - Database migration rollback strategy
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

### Migration Path
1. **Phase 1 (Week 1)**: Test Coverage - Add missing tests, configure coverage enforcement
2. **Phase 2 (Week 2)**: Code Quality - Add linters, formatters, pre-commit hooks
3. **Phase 3 (Week 3)**: Infrastructure Hardening - IAM audit, encryption, backups
4. **Phase 4 (Week 4)**: Monitoring & CI/CD - Dashboards, alarms, deployment rigor

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

### Risk 1: Coverage Target Too Aggressive (95% is High)
**Probability**: Medium
**Impact**: Medium (timeline slip)
**Mitigation**:
- Break into phases: 80% → 90% → 95% over 4 weeks
- Focus on critical paths first (authentication, translation workflow)
- Allow coverage exemptions for unreachable code (with justification)

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

### Week 1: Test Coverage Foundation
- Days 1-2: Configure coverage reporting across all packages
- Days 3-5: Write missing unit tests (backend Lambda handlers)
- Days 6-7: Write missing frontend component tests

### Week 2: Code Quality Standards
- Days 1-2: Configure ESLint, Prettier, enforce in CI
- Days 3-4: Add pre-commit hooks (Husky + lint-staged)
- Days 5-7: Create PR templates, update documentation

### Week 3: Infrastructure Hardening
- Days 1-3: IAM least privilege audit and fixes
- Days 4-5: Enable DynamoDB backups, S3 encryption
- Days 6-7: Cognito hardening, environment separation

### Week 4: Monitoring & Deployment
- Days 1-3: CloudWatch dashboards and alarms
- Days 4-5: CI/CD hardening (staging, rollback procedures)
- Days 6-7: Operational runbooks, final validation

**Buffer**: 3 days for unexpected issues

---

## Resolved Questions

1. **Coverage Exemptions**: Coverage exemptions are the **nuclear option — last resort only.**
   - **Decision**: Unless absolutely necessary, no exemptions. 95% means 95%. The bar is intentionally high. If code can't be tested, question whether the code should exist.
   - Generated code (`cdk.out/`, `.d.ts` files, `node_modules/`) is excluded from coverage reporting (not "exempted" — it's not our code).

2. **Staging Environment AWS Account**: Same account with resource tagging.
   - **Decision**: Keep dev/staging/prod in the same AWS account. Use resource tags and naming conventions for separation. Migrate to separate accounts if/when scale demands it.

3. **Monitoring Tool**: CloudWatch native, cost-conscious.
   - **Decision**: CloudWatch only. Be mindful of metrics costs — basic dashboards and alarms with low-cost configuration given current low traffic. No third-party APM.

4. **MFA Scope**: Admin-only for now, all-users in backlog.
   - **Decision**: Enable MFA for admin users in production only. Add "MFA for all users" to the product backlog for future implementation.

---

**Status**: Proposed - Open Questions Resolved, Awaiting Final Approval
**Next Steps**: Final review → Approve → Begin Week 1 implementation
