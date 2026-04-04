# Technical Design: LFMT Production Foundation

**Change ID**: `production-foundation`
**Author**: Raymond Lei
**Created**: 2026-04-03
**Status**: Proposed

---

## Context

LFMT has successfully completed POC development (Phases 1-9) with a working translation workflow deployed to AWS. The system currently has:
- **877 passing tests** (345 backend + 532 frontend + infrastructure)
- **Functional deployment** on CloudFront + API Gateway + Lambda + DynamoDB
- **End-to-end translation** using Gemini 2.5 Flash API
- **CI/CD automation** via GitHub Actions

However, the codebase reflects its POC origins with gaps in production readiness:
- **Test Coverage**: Backend 70%, Frontend unknown, Infrastructure 0%
- **Code Quality**: No enforced linting, manual formatting, inconsistent TypeScript usage
- **Security**: IAM permissions not audited, no backup strategy, encryption optional
- **Operations**: No monitoring dashboards, no incident response procedures, dev-only deployment

**Business Driver**: Before exposing LFMT to real users or adding new features, a production-grade foundation is required to ensure reliability, security, and operational excellence.

**Constraints**:
- Single-person team (Raymond Lei) - simplicity prioritized over enterprise complexity
- AWS-only infrastructure - no multi-cloud
- Budget-conscious - leverage AWS free tier and native tools (CloudWatch over third-party APM)
- 4-week timeline - phased rollout to manage risk

---

## Goals / Non-Goals

### Goals
1. **Achieve 95% test coverage** across all code (backend, frontend, infrastructure, shared types)
2. **Enforce code quality standards** in CI pipeline (TypeScript strict mode, ESLint, Prettier)
3. **Implement IAM least privilege** (zero wildcard permissions)
4. **Enable operational monitoring** (CloudWatch dashboards, alarms, structured logging)
5. **Establish deployment rigor** (staging environment, rollback procedures, smoke tests)
6. **Create runbooks** for deployment, incident response, and troubleshooting

### Non-Goals
1. **NOT adding new features** - this is purely foundational work
2. **NOT migrating to different cloud provider** - AWS remains the platform
3. **NOT implementing advanced observability** (X-Ray tracing, third-party APM deferred to P1)
4. **NOT separating AWS accounts** (dev/staging/prod in same account for now)
5. **NOT refactoring architecture** - existing design is sound for POC scale

---

## Decisions

### Decision 1: Test Coverage Target = 95% (Not 80% or 100%)

**Rationale**:
- **Industry Standard**: Production systems typically target 80-95% coverage
- **Diminishing Returns**: 95% → 100% requires testing unreachable code (e.g., defensive checks)
- **Pragmatic**: Allows exemptions for generated code, third-party libraries
- **Confidence**: 95% coverage catches ~99% of real-world bugs in deterministic code

**Alternatives Considered**:
- **80% coverage**: Too low for production (misses critical error paths)
- **100% coverage**: Unrealistic (requires testing impossible edge cases)

**Implementation**:
- `jest.config.js` and `vitest.config.ts` updated with `coverageThreshold.global: 95%`
- CI fails builds if coverage drops below threshold
- Coverage exemptions require code comments with justification

**Risks**:
- **Risk**: 95% may be too aggressive for 4-week timeline
- **Mitigation**: Phased approach (80% → 90% → 95% over weeks)

---

### Decision 2: TypeScript Strict Mode Enabled Across All Packages

**Rationale**:
- **Type Safety**: Prevents runtime errors from type mismatches
- **Maintainability**: Explicit types improve code readability and refactoring confidence
- **Industry Standard**: All modern TypeScript projects use strict mode
- **Low Risk**: LFMT has <50 `any` types (based on codebase audit)

**Alternatives Considered**:
- **Keep strict mode disabled**: Allows faster development but accumulates technical debt
- **Gradual migration**: Enable per-file (too slow, incomplete adoption)

**Implementation**:
- Set `strict: true`, `noImplicitAny: true` in all `tsconfig.json` files
- Fix existing `any` types incrementally (estimated 12 hours)
- CI fails builds on TypeScript errors

**Risks**:
- **Risk**: Large refactor required if hidden type errors exist
- **Mitigation**: Audit completed, <50 instances found

---

### Decision 3: IAM Permissions Scoped to Exact Resources (No Wildcards)

**Rationale**:
- **Security Best Practice**: AWS Well-Architected Framework recommends least privilege
- **Blast Radius Reduction**: Compromised Lambda cannot access unrelated resources
- **Compliance**: Required for SOC 2, ISO 27001 certifications (future)
- **Audit Trail**: Explicit permissions document system architecture

**Alternatives Considered**:
- **Keep wildcards for simplicity**: Easier to manage but insecure
- **Service Control Policies (SCPs)**: Overkill for single-account setup

**Implementation**:
- Replace `dynamodb:*` with `GetItem`, `PutItem`, `UpdateItem`, `Query`
- Replace `s3:*` with `GetObject`, `PutObject`, `DeleteObject`
- Replace `cognito-idp:*` with `GetUser`, `AdminGetUser`
- Scope resources from `"*"` to exact ARNs (`jobsTable.tableArn`)
- Document each permission in inline comments

**Risks**:
- **Risk**: Overly restrictive IAM breaks functionality
- **Mitigation**: Test in dev for 3 days, run full integration suite

---

### Decision 4: CloudWatch Native Monitoring (Not Third-Party APM)

**Rationale**:
- **Cost**: CloudWatch included in AWS free tier (1M API requests/month free)
- **Simplicity**: No additional vendors, credentials, or integrations
- **Sufficient**: LFMT is low-traffic POC (<1000 requests/day)
- **AWS Integration**: Native metrics for Lambda, DynamoDB, API Gateway

**Alternatives Considered**:
- **Datadog/New Relic**: Superior UX but $100+/month (exceeds budget)
- **Grafana + Prometheus**: Complex setup, overkill for single-person team

**Implementation**:
- Create 6 CloudWatch dashboards (API Gateway, Lambda, DynamoDB, S3, Step Functions, Overview)
- Configure 10+ CloudWatch alarms (Lambda errors, API 5xx, DynamoDB throttling)
- Use CloudWatch Insights for log queries (structured JSON logs)

**Risks**:
- **Risk**: CloudWatch UI is clunky compared to Datadog
- **Mitigation**: Acceptable tradeoff for cost savings

**Future Re-evaluation**: If LFMT scales to >10K requests/day, consider third-party APM

---

### Decision 5: Staging Environment in Same AWS Account (Not Separate Account)

**Rationale**:
- **Simplicity**: Single account reduces administrative overhead
- **Cost**: Avoid cross-account networking charges
- **Sufficient for POC**: Staging validated via resource tags, naming conventions
- **Low Risk**: LFMT is not handling sensitive data (public domain translations)

**Alternatives Considered**:
- **Separate AWS accounts**: Best practice but adds complexity (cross-account roles, VPC peering)
- **No staging environment**: Too risky, prod deployments untested

**Implementation**:
- Tag all resources with `Environment: dev|staging|prod`
- Naming convention: `lfmt-{env}-{resource}` (e.g., `lfmt-staging-jobs-table`)
- Use CDK context to configure environment-specific settings
- GitHub Actions workflow for staging deployment (manual trigger)

**Risks**:
- **Risk**: Dev and staging share AWS quotas (potential resource contention)
- **Mitigation**: Monitor quota usage, separate accounts if needed in Phase B

**Future Migration Path**: When LFMT reaches production scale, migrate to AWS Organizations with separate accounts

---

### Decision 6: Pre-commit Hooks (Husky) for Local Quality Gates

**Rationale**:
- **Fast Feedback**: Catch linting/formatting errors before push (saves CI time)
- **Developer Experience**: Auto-fix simple errors (Prettier formatting)
- **CI Backup**: If pre-commit bypassed (`--no-verify`), CI still enforces

**Alternatives Considered**:
- **CI-only enforcement**: Slower feedback loop (5-10 minute CI runs)
- **Editor plugins**: Inconsistent (depends on developer setup)

**Implementation**:
- Husky + lint-staged installed in project root
- `.husky/pre-commit` runs on every commit
- Staged files only (not entire codebase) for speed
- Run ESLint, Prettier, type-check on changed packages

**Risks**:
- **Risk**: Pre-commit hooks slow down commits
- **Mitigation**: Lint-staged only checks changed files (<2s for typical commit)

---

### Decision 7: Phased Rollout Over 4 Weeks (Not Big-Bang)

**Rationale**:
- **Risk Management**: Incremental changes easier to debug and rollback
- **Learning**: Early phases inform later phases (e.g., IAM audit informs monitoring)
- **Morale**: Weekly milestones provide psychological wins
- **Validation**: Each phase tested in dev before proceeding

**Alternatives Considered**:
- **Big-bang approach**: All changes in 1 week (too risky)
- **Longer timeline (8 weeks)**: Delays feature development

**Implementation**:
- **Week 1**: Test coverage (foundation for quality)
- **Week 2**: Code quality standards (catch errors early)
- **Week 3**: Infrastructure hardening (security and reliability)
- **Week 4**: Monitoring and CI/CD (operational readiness)

**Phase Gates**: Each phase requires sign-off before proceeding (dev deployment successful, tests passing)

**Risks**:
- **Risk**: Phase 3 IAM changes break Phase 1/2 work
- **Mitigation**: Comprehensive integration tests after each phase

---

## Technical Architecture Changes

### Test Coverage Architecture

```
LFMT Repository
├── backend/functions/
│   ├── __tests__/
│   │   ├── unit/           # Existing unit tests
│   │   ├── integration/    # Existing integration tests
│   │   └── smoke/          # NEW: Post-deployment smoke tests
│   ├── jest.config.js      # MODIFIED: coverageThreshold = 95%
│   └── coverage/           # NEW: HTML coverage reports
├── frontend/
│   ├── src/
│   │   └── __tests__/      # NEW: Component/hook/util tests
│   ├── vitest.config.ts    # NEW: Coverage configuration
│   └── coverage/           # NEW: HTML coverage reports
├── backend/infrastructure/
│   ├── __tests__/          # NEW: CDK construct tests
│   ├── jest.config.js      # MODIFIED: coverageThreshold = 95%
│   └── coverage/           # NEW: HTML coverage reports
└── .github/workflows/
    └── deploy.yml          # MODIFIED: Add coverage reporting
```

**Key Changes**:
1. **Frontend Testing**: Vitest configured with `@vitest/coverage-v8`
2. **CDK Testing**: Jest configured for CDK snapshot tests
3. **Smoke Tests**: New directory for critical path tests (run post-deployment)
4. **Coverage Reports**: Uploaded as GitHub artifacts, visible in PR comments

---

### Code Quality Architecture

```
LFMT Repository
├── .husky/
│   └── pre-commit          # NEW: Run lint-staged on commit
├── .lintstagedrc.json      # NEW: ESLint + Prettier on staged files
├── .prettierrc.json        # NEW: Code formatting rules
├── .prettierignore         # NEW: Exclude node_modules, build artifacts
├── .github/
│   ├── pull_request_template.md  # NEW: PR checklist
│   └── workflows/
│       └── deploy.yml      # MODIFIED: Add lint + format checks
├── backend/functions/
│   ├── .eslintrc.cjs       # MODIFIED: TypeScript strict rules
│   └── tsconfig.json       # MODIFIED: strict: true, noImplicitAny: true
├── frontend/
│   ├── .eslintrc.cjs       # MODIFIED: React + a11y rules
│   └── tsconfig.json       # MODIFIED: strict: true
└── docs/
    └── code-review-checklist.md  # NEW: Review guidelines
```

**Key Changes**:
1. **Pre-commit Hooks**: Husky blocks commits with linting/formatting errors
2. **Prettier**: Standardized formatting (100 char width, single quotes, trailing commas)
3. **ESLint**: TypeScript strict rules, React hooks exhaustive deps
4. **CI Enforcement**: Build fails if `npm run lint` or `npm run type-check` fails

---

### IAM Permissions Architecture (Before → After)

**BEFORE (Insecure)**:
```typescript
// ❌ Over-permissive, wildcards everywhere
new iam.PolicyStatement({
  actions: ['dynamodb:*', 's3:*', 'cognito-idp:*'],
  resources: ['*']
})
```

**AFTER (Least Privilege)**:
```typescript
// ✅ Scoped to exact actions and resources
new iam.PolicyStatement({
  actions: [
    'dynamodb:GetItem',
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:Query'
  ],
  resources: [
    jobsTable.tableArn,
    `${jobsTable.tableArn}/index/userIdIndex`,
    chunksTable.tableArn,
    rateLimitTable.tableArn
  ]
}),
new iam.PolicyStatement({
  actions: [
    's3:GetObject',
    's3:PutObject',
    's3:DeleteObject'
  ],
  resources: [
    `${documentBucket.bucketArn}/*`,
    `${resultsBucket.bucketArn}/*`
  ]
}),
new iam.PolicyStatement({
  actions: ['s3:ListBucket'],
  resources: [
    documentBucket.bucketArn,
    resultsBucket.bucketArn
  ]
})
```

**Key Changes**:
1. **DynamoDB**: Replace `dynamodb:*` with 4 specific actions
2. **S3**: Separate object-level (`/*`) and bucket-level permissions
3. **Cognito**: Replace `cognito-idp:*` with read-only `GetUser`, `AdminGetUser`
4. **Step Functions**: Replace `states:*` with `StartExecution`, `DescribeExecution`
5. **Secrets Manager**: Scope to exact secret ARNs (`lfmt/gemini-api-key-*`)

**Validation**: Run full integration test suite after IAM changes to ensure no functionality breaks

---

### CloudWatch Monitoring Architecture

```
CloudWatch Ecosystem
├── Dashboards (6 total)
│   ├── API Gateway       # Request count, 4xx/5xx, latency
│   ├── Lambda            # Invocations, errors, duration, throttles
│   ├── DynamoDB          # Consumed capacity, throttled requests
│   ├── S3                # Bucket size, request metrics
│   ├── Step Functions    # Execution success/failure, duration
│   └── Overview          # Composite dashboard (all services)
├── Alarms (10+ total)
│   ├── Lambda error rate > 5%
│   ├── API Gateway 5xx > 1%
│   ├── DynamoDB throttled requests > 10
│   ├── Translation job failures > 3/hour
│   └── SNS topic → operations@example.com
├── Log Groups (per Lambda)
│   ├── Retention: 7 days (dev), 30 days (prod)
│   ├── Format: JSON structured logs
│   └── Correlation IDs for request tracing
└── Insights Queries
    ├── All errors by Lambda function
    ├── Slow requests (duration > 3s)
    └── Translation job failures with details
```

**Key Changes**:
1. **Dashboards**: Defined in CDK as `cloudwatch.Dashboard` constructs
2. **Alarms**: Defined in CDK with SNS actions for notifications
3. **Structured Logging**: New `logger.ts` utility replaces `console.log`
4. **Correlation IDs**: UUID v4 generated per request, logged in all statements

**Metrics Collected**:
- **API Gateway**: `Count`, `4XXError`, `5XXError`, `Latency`
- **Lambda**: `Invocations`, `Errors`, `Duration`, `Throttles`, `ConcurrentExecutions`
- **DynamoDB**: `ConsumedReadCapacityUnits`, `ConsumedWriteCapacityUnits`, `UserErrors`
- **S3**: `BucketSizeBytes`, `NumberOfObjects`, `AllRequests`, `4xxErrors`
- **Step Functions**: `ExecutionsStarted`, `ExecutionsSucceeded`, `ExecutionsFailed`, `ExecutionTime`

---

### CI/CD Deployment Architecture (Before → After)

**BEFORE (Dev-only)**:
```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  deploy-dev:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
      - run: cdk deploy --context environment=dev
```

**AFTER (Dev → Staging → Prod)**:
```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment: [dev, staging, prod]

jobs:
  quality-gates:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint          # NEW: Fail on linting errors
      - run: npm run type-check    # NEW: Fail on TypeScript errors
      - run: npm run test:coverage # MODIFIED: Enforce 95% coverage

  deploy-dev:
    needs: quality-gates
    if: github.ref == 'refs/heads/main'
    steps:
      - run: cdk deploy --context environment=dev
      - run: npm run test:smoke    # NEW: Post-deployment validation

  deploy-staging:
    needs: quality-gates
    if: github.event.inputs.environment == 'staging'
    environment: staging         # NEW: Manual approval required
    steps:
      - run: cdk deploy --context environment=staging
      - run: npm run test:smoke

  deploy-prod:
    needs: quality-gates
    if: github.event.inputs.environment == 'prod'
    environment: production      # NEW: Manual approval required
    steps:
      - run: cdk diff --context environment=prod  # NEW: Review changes
      - run: cdk deploy --context environment=prod
      - run: npm run test:smoke
```

**Key Changes**:
1. **Quality Gates**: Linting, type-checking, coverage checks run before deployment
2. **Staging Environment**: Manual `workflow_dispatch` trigger, requires approval
3. **Production Deployment**: Requires staging success + manual approval
4. **Smoke Tests**: Critical path tests run post-deployment (login → upload → translate)
5. **Change Sets**: CloudFormation diff shown before prod deployment

---

## Risks / Trade-offs

### Risk 1: 4-Week Timeline is Aggressive
**Impact**: Medium - May not complete all tasks
**Probability**: Medium
**Trade-off**: Quality vs. Speed
**Mitigation**:
- Prioritize P0 items (coverage, IAM, monitoring)
- Defer P1 items (X-Ray tracing, advanced runbooks) to Phase B
- Weekly checkpoints to adjust scope

### Risk 2: IAM Changes Break Existing Functionality
**Impact**: High - Service outage in dev
**Probability**: Low (integration tests will catch)
**Trade-off**: Security vs. Risk
**Mitigation**:
- Test IAM changes in dev for 3 days before staging
- Keep rollback plan ready (previous CDK stack version)
- Run full integration suite after every IAM change

### Risk 3: Coverage Target Too High (95%)
**Impact**: Low - Timeline slip
**Probability**: Medium
**Trade-off**: Coverage vs. Effort
**Mitigation**:
- Allow coverage exemptions for unreachable code (with justification)
- Focus on critical paths first (auth, translation workflow)
- Incremental approach (80% → 90% → 95%)

### Risk 4: Pre-commit Hooks Slow Down Development
**Impact**: Low - Developer friction
**Probability**: Low
**Trade-off**: Convenience vs. Quality
**Mitigation**:
- Lint-staged only checks changed files (<2s for typical commit)
- Developers can bypass with `--no-verify` if needed (CI still enforces)
- Clear documentation on how hooks work

---

## Migration Plan

### Phase 1: Test Coverage (Week 1)
**Migration Steps**:
1. Update coverage thresholds in `jest.config.js` and `vitest.config.ts`
2. Run `npm run test:coverage` to identify gaps
3. Write missing tests for auth, upload, translation handlers
4. Write missing frontend component tests
5. Add CDK construct tests
6. Verify coverage ≥95% in all packages

**Rollback**: Revert coverage threshold changes if timeline slips

**Validation**: CI passes with ≥95% coverage

---

### Phase 2: Code Quality (Week 2)
**Migration Steps**:
1. Audit existing `any` types, create fix plan
2. Enable TypeScript strict mode in all `tsconfig.json`
3. Fix TypeScript errors incrementally
4. Configure ESLint and Prettier
5. Format all code with `npx prettier --write .`
6. Install Husky and lint-staged
7. Update CI to enforce linting and type-checking

**Rollback**: Revert strict mode if errors exceed estimate (>50 occurrences)

**Validation**: `npm run lint` and `npm run type-check` pass in all packages

---

### Phase 3: Infrastructure Hardening (Week 3)
**Migration Steps**:
1. Audit IAM policies, document current state
2. Update PolicyStatements with scoped permissions
3. Deploy to dev, run integration tests
4. Enable DynamoDB PITR on all tables
5. Enable S3 encryption and versioning
6. Update Cognito password policy
7. Create staging environment
8. Deploy to staging, validate

**Rollback**: Redeploy previous CDK stack version if IAM breaks functionality

**Validation**: Integration tests pass, IAM audit shows zero wildcards

---

### Phase 4: Monitoring & CI/CD (Week 4)
**Migration Steps**:
1. Create CloudWatch dashboards in CDK
2. Configure CloudWatch alarms with SNS notifications
3. Add structured logging to all Lambda handlers
4. Create smoke tests
5. Update CI/CD workflow for staging/prod deployments
6. Write deployment and incident response runbooks
7. Test rollback procedure
8. Final validation and sign-off

**Rollback**: Revert monitoring changes if alarm noise is too high

**Validation**: Dashboards visible, alarms fire correctly, smoke tests pass

---

## Resolved Questions

### Q1: Coverage Exemptions — NUCLEAR OPTION ONLY
**Decision**: Coverage exemptions are the absolute last resort. Unless it is truly impossible to test, no exemptions granted. 95% means 95%.
- Generated/external code (`cdk.out/`, `.d.ts`, `node_modules/`) is excluded from reporting — these aren't exemptions, they're not our code.
- If application code can't be tested, the first question is whether that code should exist at all.

### Q2: Same AWS Account for All Environments
**Decision**: Keep dev/staging/prod in the same AWS account. Separate via resource tags and naming conventions (`lfmt-{env}-{resource}`). Revisit account separation if/when scale demands it.

### Q3: CloudWatch Native, Cost-Conscious
**Decision**: CloudWatch only. Be mindful of metrics costs — basic dashboards and essential alarms only, given current low traffic. No third-party APM. Re-evaluate if traffic exceeds 10K requests/day.

### Q4: MFA Admin-Only, All-Users in Backlog
**Decision**: Enable MFA for admin users in production only. "MFA for all users" added to product backlog for future implementation when handling sensitive data.

---

## References

### Industry Standards
- **AWS Well-Architected Framework**: Security Pillar (IAM least privilege)
- **Google SRE Book**: Chapter 6 (Monitoring Distributed Systems)
- **DORA Metrics**: Deployment frequency, lead time, MTTR, change failure rate
- **OWASP**: Top 10 Security Risks (IAM misconfigurations, missing monitoring)

### Internal Documentation
- **Current Infrastructure**: `docs/INFRASTRUCTURE-SETUP.md`
- **CDK Best Practices**: `docs/CDK-BEST-PRACTICES.md`
- **CORS Configuration**: `docs/CORS-REFERENCE.md`
- **Current Progress**: `PROGRESS.md` (Phase 10 demo preparation)

### Related Changes
- **Phase A Stabilization**: PR #115 (translation workflow fixes)
- **Security Hardening**: `openspec/changes/harden-security/` (IAM patterns)

---

**Status**: Proposed - Open Questions Resolved, Awaiting Final Approval
**Next Steps**: Final review → Approve → Begin Week 1 implementation
