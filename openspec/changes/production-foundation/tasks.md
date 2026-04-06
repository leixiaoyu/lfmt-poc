# Implementation Tasks: LFMT Production Foundation

**Change ID**: `production-foundation`
**Total Estimated Effort**: 4 weeks (160 hours)
**Phases**: 4 phases over 4 weeks

---

## Phase 1: Code Quality Standards (Week 1 - 40 hours) ⚠️ **REORDERED - FIX TYPES FIRST**

**Reviewer Feedback**: Writing tests before fixing types = wasted effort. Fix foundation first, then test against correct types.

### 1.1 TypeScript Strict Mode Migration (MOVED FROM PHASE 2)

- [ ] 1.1.1 Audit current `any` types across codebase
  - Run `grep -r "any" --include="*.ts" --include="*.tsx"` to find all instances
  - Create inventory spreadsheet (file path, line number, justification needed)
  - **Estimated Count**: <50 instances
  - **Estimated Time**: 2 hours
- [ ] 1.1.2 Enable strict mode in all `tsconfig.json` files
  - `backend/functions/tsconfig.json`: Set `strict: true`, `noImplicitAny: true`
  - `frontend/tsconfig.json`: Set `strict: true`, `noImplicitAny: true`
  - `backend/infrastructure/tsconfig.json`: Set `strict: true`
  - `shared-types/tsconfig.json`: Set `strict: true`
  - **Estimated Time**: 1 hour
- [ ] 1.1.3 Fix TypeScript errors incrementally
  - Fix backend Lambda functions (highest risk first: auth, translation)
  - Fix frontend components (auth, translation workflow)
  - Fix infrastructure CDK code
  - Fix shared types
  - **Estimated Time**: 12 hours (2 full days)
- **Files Modified**: 4 `tsconfig.json` files, 50+ TypeScript files
- **Success Criteria**: `npm run type-check` passes in all packages with 0 errors

### 1.2 ESLint Configuration Standardization (MOVED FROM PHASE 2)

- [ ] 1.2.1 Create standardized `.eslintrc.cjs` for backend
  - Extend `@typescript-eslint/recommended-requiring-type-checking`
  - Add rules: `no-console: warn`, `no-unused-vars: error`, `prefer-const: error`
  - Configure parser options for TypeScript strict mode
  - **Estimated Time**: 2 hours
- [ ] 1.2.2 Update frontend `.eslintrc.cjs`
  - Add React-specific rules: `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`
  - Add accessibility rules: `jsx-a11y/recommended`
  - Align with backend rules for consistency
  - **Estimated Time**: 2 hours
- [ ] 1.2.3 Fix all ESLint errors and warnings
  - Run `npm run lint -- --fix` in all packages
  - Manually fix remaining errors (estimated 20-30 errors)
  - **Estimated Time**: 4 hours
- [ ] 1.2.4 Add ESLint to CI pipeline
  - Modify `.github/workflows/deploy.yml` to run `npm run lint` in all packages
  - Fail build if any errors found (warnings allowed initially)
  - **Estimated Time**: 1 hour
- **Files Modified**: `backend/functions/.eslintrc.cjs`, `frontend/.eslintrc.cjs`, `.github/workflows/deploy.yml`
- **Success Criteria**: `npm run lint` passes with 0 errors across all packages

### 1.3 Prettier Formatting (MOVED FROM PHASE 2)

- [ ] 1.3.1 Create `.prettierrc.json` configuration
  - `printWidth: 100`, `tabWidth: 2`, `semi: true`, `singleQuote: true`
  - `trailingComma: 'es5'`, `arrowParens: 'always'`
  - Place in project root to apply to all packages
  - **Estimated Time**: 1 hour
- [ ] 1.3.2 Create `.prettierignore` file
  - Ignore `node_modules/`, `dist/`, `build/`, `cdk.out/`, `coverage/`
  - **Estimated Time**: 0.5 hours
- [ ] 1.3.3 Format all code
  - Run `npx prettier --write .` in project root
  - Verify changes don't break functionality (run all tests)
  - **Estimated Time**: 2 hours
- [ ] 1.3.4 Add Prettier to package.json scripts
  - Add `"format": "prettier --write ."` to all `package.json` files
  - Add `"format:check": "prettier --check ."` for CI
  - **Estimated Time**: 0.5 hours
- **Files Created**: `.prettierrc.json`, `.prettierignore`
- **Files Modified**: All TypeScript files (formatting only)
- **Success Criteria**: `npm run format:check` passes

### 1.4 Pre-commit Hooks (MOVED FROM PHASE 2)

- [ ] 1.4.1 Install Husky and lint-staged
  - `npm install --save-dev husky lint-staged` in project root
  - Run `npx husky init` to create `.husky/` directory
  - **Estimated Time**: 1 hour
- [ ] 1.4.2 Configure pre-commit hook
  - Create `.husky/pre-commit` script
  - Run `npx lint-staged` on staged files
  - **Estimated Time**: 1 hour
- [ ] 1.4.3 Configure lint-staged
  - Add `.lintstagedrc.json` in project root
  - Run ESLint on `*.ts` and `*.tsx` files
  - Run Prettier on all files
  - Run type-check on changed packages
  - **Estimated Time**: 1 hour
- [ ] 1.4.4 Test pre-commit hooks
  - Introduce intentional linting error → Commit should fail
  - Fix error → Commit should succeed
  - **Estimated Time**: 0.5 hours
- **Files Created**: `.husky/pre-commit`, `.lintstagedrc.json`
- **Success Criteria**: Pre-commit hooks block commits with linting/formatting errors

### 1.5 PR Templates and Review Process (MOVED FROM PHASE 2)

- [ ] 1.5.1 Create PR template
  - Add `.github/pull_request_template.md`
  - Sections: Description, Changes, Testing, Checklist (tests added, coverage meets targets, linting passed)
  - **Estimated Time**: 1 hour
- [ ] 1.5.2 Create code review checklist document
  - Add `docs/code-review-checklist.md`
  - Include: SOLID principles, error handling, security, performance
  - **Estimated Time**: 2 hours
- [ ] 1.5.3 Configure GitHub branch protection
  - Require PR reviews before merging to `main`
  - Require status checks (tests, linting, type-check)
  - Require linear history (no merge commits)
  - **Estimated Time**: 0.5 hours
- **Files Created**: `.github/pull_request_template.md`, `docs/code-review-checklist.md`
- **Success Criteria**: PRs cannot merge without passing checks

---

## Phase 2: Test Coverage Foundation (Week 2 - 40 hours) ⚠️ **TIERED TARGETS - REALISTIC FOR ONE PERSON**

**Reviewer Feedback**: 0% → 95% in 5 days = unrealistic, leads to meaningless green-wash tests. Use tiered approach.

### 2.1 Configure Tiered Coverage Reporting Infrastructure 🆕

- [ ] 2.1.1 Update `backend/functions/jest.config.js` with **tiered** coverage thresholds
  - **Critical Path** (auth/, translation/): `coverageThreshold.critical: 100%`
  - **General Code**: `coverageThreshold.global: 80%`
  - Add `coveragePathIgnorePatterns` for generated code
  - **Estimated Time**: 2 hours
- [ ] 2.1.2 Create `frontend/vitest.config.ts` with **tiered** coverage configuration
  - Install `@vitest/coverage-v8` (already in devDependencies)
  - Configure `coverage.provider: 'v8'`, `coverage.reporter: ['text', 'json', 'html', 'lcov']`
  - **Critical Path** (auth, translation components): 100%
  - **General Code**: 80%
  - **Estimated Time**: 2 hours
- [ ] 2.1.3 Update `backend/infrastructure/jest.config.js` for CDK testing
  - **Infrastructure Coverage**: 40-50% (custom logic only, not CDK framework)
  - Configure `testMatch` for CDK construct tests
  - **Note**: Avoid CDK snapshot tests (brittle/noisy), prefer unit tests for custom constructs
  - **Estimated Time**: 2 hours
- [ ] 2.1.4 Add coverage reporting to CI pipeline (`.github/workflows/deploy.yml`)
  - Modify `test` job to run `npm run test:coverage` instead of `npm test`
  - Add coverage report upload as GitHub artifact
  - Fail build if critical < 100%, general < 80%, infra < 40%
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/functions/jest.config.js`, `frontend/vitest.config.ts`, `backend/infrastructure/jest.config.js`, `.github/workflows/deploy.yml`
- **Estimated Time**: 8 hours
- **Success Criteria**: Tiered coverage thresholds configured, CI enforces them

### 2.2 Critical Path Tests (100% Coverage) - Backend Auth

- [ ] 2.2.1 Add missing tests for authentication handlers
  - `auth/register.ts`: Test validation errors, duplicate email, password hashing
  - `auth/login.ts`: Test invalid credentials, account lockout, token generation
  - `auth/refresh-token.ts`: Test expired tokens, invalid tokens, rotation
  - `auth/reset-password.ts`: Test email validation, password complexity, reset flow
  - `auth/getCurrentUser.ts`: Test unauthorized access, token validation
  - **Target Coverage**: 100% for all auth handlers (ZERO TOLERANCE)
  - **Estimated Time**: 10 hours
- **Files Created**: 5+ new test files in `backend/functions/__tests__/auth/`
- **Success Criteria**: `npm run test:coverage` shows 100% coverage for auth/

### 2.3 Critical Path Tests (100% Coverage) - Backend Translation

- [ ] 2.3.1 Add missing tests for translation workflow
  - `translation/chunkDocument.ts`: Test edge cases (empty file, single sentence, 500K words)
  - `translation/translateChunk.ts`: Test Gemini API errors, rate limiting, retries, **circuit breaker**
  - `translation/startTranslation.ts`: Test Step Functions errors, invalid job IDs
  - `translation/getTranslationStatus.ts`: Test missing jobs, corrupted state
  - **Target Coverage**: 100% for translation handlers (BUSINESS LOGIC = ZERO TOLERANCE)
  - **Estimated Time**: 12 hours
- **Files Created**: 4+ new test files in `backend/functions/__tests__/translation/`
- **Success Criteria**: `npm run test:coverage` shows 100% coverage for translation/

### 2.4 General Code Tests (80% Coverage) - Backend & Frontend

- [ ] 2.4.1 Add tests for general backend handlers (upload, utils)
  - `upload/uploadPresignedUrl.ts`: Test file size limits, file type validation, S3 errors
  - `upload/uploadComplete.ts`: Test S3 verification, metadata updates, missing files
  - Error handling paths: DynamoDB throttling, S3 access denied, Cognito errors
  - **Target Coverage**: 80% for general backend code
  - **Estimated Time**: 6 hours
- [ ] 2.4.2 Add tests for frontend auth components (100% - also critical path)
  - `src/components/auth/LoginForm.tsx`: Test form validation, submit, error display
  - `src/components/auth/RegisterForm.tsx`: Test password validation, terms acceptance
  - **Target Coverage**: 100% for auth components
  - **Estimated Time**: 4 hours
- [ ] 2.4.3 Add tests for frontend translation components (100% - also critical path)
  - `src/components/translation/UploadForm.tsx`: Test file selection, legal attestation, upload
  - `src/components/translation/TranslationStatus.tsx`: Test progress display, polling, **circuit breaker UI**
  - **Target Coverage**: 100% for translation components
  - **Estimated Time**: 6 hours
- [ ] 2.4.4 Add tests for general frontend code (80%)
  - Hooks, contexts, utilities (80% target for supporting code)
  - **Estimated Time**: 4 hours
- **Files Created**: 20+ new test files in `backend/functions/__tests__/` and `frontend/src/__tests__/`
- **Success Criteria**: Critical path 100%, general code 80%

### 2.5 Infrastructure Tests (40-50% Coverage) - Custom Logic Only

- [ ] 2.5.1 Test custom CDK constructs (NOT framework validation)
  - Test IAM policy generation logic (custom PolicyStatements)
  - Test environment-specific configurations (dev vs staging vs prod)
  - **Avoid CDK snapshot tests** (brittle/noisy per reviewer feedback)
  - **Target Coverage**: 40-50% (focus on custom logic, not CDK framework)
  - **Estimated Time**: 6 hours
- **Files Created**: `backend/infrastructure/__tests__/lfmt-infrastructure-stack.test.ts`
- **Success Criteria**: 40-50% coverage on custom CDK logic, all tests pass

---

## Phase 3: Infrastructure Hardening (Week 3 - 40 hours)

### 3.1 IAM Least Privilege Audit

- [ ] 3.1.1 Audit all PolicyStatements in CDK stack
  - Review 10 PolicyStatements in `lfmt-infrastructure-stack.ts` (lines 502-1027)
  - Document current permissions and resources
  - Identify wildcards and overly broad permissions
  - **Estimated Time**: 4 hours
- [ ] 3.1.2 Scope down DynamoDB permissions
  - Replace `dynamodb:*` with specific actions:
    - `GetItem`, `PutItem`, `UpdateItem`, `Query`, `Scan` (only where needed)
  - Scope resources to exact table ARNs (no `/*` wildcards)
  - Test: Run full integration suite after changes
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:558-577`
  - **Estimated Time**: 3 hours
- [ ] 3.1.3 Scope down S3 permissions
  - Replace `s3:*` with specific actions:
    - `GetObject`, `PutObject`, `DeleteObject` (no ListBucket unless required)
  - Scope resources to bucket ARNs + object paths (`${bucket.bucketArn}/*`)
  - Separate ListBucket permissions (bucket-level) from object permissions
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:502-526`
  - **Estimated Time**: 3 hours
- [ ] 3.1.4 Scope down Cognito permissions
  - Replace `cognito-idp:*` with specific actions:
    - `GetUser`, `AdminGetUser` (read-only operations)
  - Scope resources to user pool ARN
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:580-593`
  - **Estimated Time**: 2 hours
- [ ] 3.1.5 Scope down Step Functions permissions
  - Replace `states:*` with specific actions:
    - `StartExecution`, `DescribeExecution`, `StopExecution`
  - Scope resources to state machine ARN
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1027-1037`
  - **Estimated Time**: 2 hours
- [ ] 3.1.6 Scope down Secrets Manager permissions
  - Limit to `GetSecretValue` only (no create/update/delete)
  - Scope resources to specific secret ARNs (`lfmt/gemini-api-key-*`)
  - **Estimated Time**: 2 hours
- [ ] 3.1.7 Document IAM justifications
  - Add inline comments for each PolicyStatement explaining why permission is needed
  - Create `docs/iam-justifications.md` with detailed audit trail
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`
- **Files Created**: `docs/iam-justifications.md`
- **Success Criteria**: Zero wildcard permissions, all integration tests pass

### 3.2 DynamoDB Backup and Recovery

- [ ] 3.2.1 Enable Point-in-Time Recovery (PITR)
  - Modify `jobsTable` definition: Add `pointInTimeRecovery: true`
  - Modify `usersTable` definition: Add `pointInTimeRecovery: true`
  - Modify `attestationsTable` definition: Add `pointInTimeRecovery: true`
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:102-170`
  - **Estimated Time**: 2 hours
- [ ] 3.2.2 Configure backup retention policies
  - Dev environment: 7 days retention
  - Staging environment: 14 days retention
  - Prod environment: 30 days retention
  - Use CDK context to configure per environment
  - **Estimated Time**: 2 hours
- [ ] 3.2.3 Test PITR restore procedure
  - Create test table, write data, enable PITR
  - Wait 5 minutes (PITR min retention)
  - Restore to new table, verify data integrity
  - Document restore steps in runbook
  - **Estimated Time**: 3 hours
- [ ] 3.2.4 Create backup monitoring alarm
  - CloudWatch alarm if PITR is disabled on any table
  - SNS notification to operations team
  - **Estimated Time**: 1 hour
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`
- **Files Created**: `docs/runbooks/dynamodb-restore.md`
- **Success Criteria**: PITR enabled on all tables, restore tested successfully

### 3.3 S3 Security Hardening

- [ ] 3.3.1 Enable server-side encryption (SSE-S3)
  - Modify `documentBucket`: `encryption: s3.BucketEncryption.S3_MANAGED`
  - Modify `resultsBucket`: `encryption: s3.BucketEncryption.S3_MANAGED`
  - Modify `frontendBucket`: `encryption: s3.BucketEncryption.S3_MANAGED`
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:172-221`
  - **Estimated Time**: 2 hours
- [ ] 3.3.2 Enable versioning on data buckets
  - Modify `documentBucket`: `versioned: true`
  - Modify `resultsBucket`: `versioned: true`
  - Do NOT enable on `frontendBucket` (immutable assets)
  - **Estimated Time**: 1 hour
- [ ] 3.3.3 Add bucket policies blocking public access
  - `blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL`
  - Already configured, verify in CDK code
  - **Estimated Time**: 0.5 hours
- [ ] 3.3.4 Add lifecycle policies for cost optimization
  - Document bucket: Delete uploaded files >30 days (after translation)
  - Results bucket: Transition to Glacier after 90 days
  - Frontend bucket: N/A (active serving)
  - **Estimated Time**: 2 hours
- [ ] 3.3.5 Test encryption and versioning
  - Upload file to document bucket, verify encryption in S3 console
  - Upload 2 versions of same file, verify version IDs
  - **Estimated Time**: 1 hour
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`
- **Success Criteria**: All buckets encrypted, versioning enabled on data buckets

### 3.4 Cognito Security Hardening (+ PASSWORD MIGRATION PLAN) 🆕

- [ ] 3.4.1 Enforce password complexity
  - Update `userPool` password policy:
    - `minLength: 12` (currently 8) ⚠️ **BREAKING FOR EXISTING USERS**
    - `requireUppercase: true`
    - `requireLowercase: true`
    - `requireDigits: true`
    - `requireSymbols: true`
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:224-267`
  - **Estimated Time**: 2 hours
- [ ] 3.4.2 **Create Password Policy Migration Plan** 🆕 **CRITICAL**
  - **Problem**: Existing users with 8-char passwords will break
  - **Solution**: Grandfather existing users (allow 8+ chars), enforce 12+ only for:
    - New registrations
    - Password resets
  - **Implementation**: Custom Lambda trigger in Cognito (Pre Authentication)
    - Check user creation date
    - If created before policy change → allow 8+ chars
    - If created after policy change → enforce 12+ chars
  - Document migration strategy in `docs/runbooks/cognito-password-migration.md`
  - **Estimated Time**: 4 hours
- [ ] 3.4.3 Configure account lockout policy
  - Add `accountRecoverySetting` configuration
  - Lock account after 5 failed login attempts
  - Unlock after 15 minutes or admin intervention
  - **Estimated Time**: 2 hours
- [ ] 3.4.4 Enable MFA for production environment
  - Add `mfa: cognito.Mfa.OPTIONAL` for prod context
  - Keep disabled for dev/staging (usability)
  - Document MFA setup in user guide
  - **Estimated Time**: 3 hours
- [ ] 3.4.5 Configure session timeout
  - Access token: 15 minutes (short-lived)
  - Refresh token: 30 days (current)
  - ID token: 15 minutes
  - **Estimated Time**: 1 hour
- [ ] 3.4.6 Test password policy enforcement + migration
  - Attempt registration with weak password → Should fail
  - Test existing user with 8-char password → Should still login (grandfathered)
  - Attempt 5 failed logins → Account locked
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`
- **Files Created**: `docs/runbooks/cognito-password-migration.md`, Lambda trigger for password validation
- **Success Criteria**: Password policy enforced, existing users not broken, migration documented

### 3.5 Environment Separation (+ AWS ORGANIZATIONS FOR PROD) ⚠️ **CRITICAL CHANGE**

- [ ] 3.5.1 **Set up AWS Organizations** 🆕 **REVIEWER REQUIRED**
  - Create AWS Organization from current AWS account (becomes management account)
  - Create new AWS account for **production** (via AWS Console or CLI)
  - Configure cross-account IAM roles for deployment (GitHub Actions → Prod account)
  - **Rationale**: Separate blast radius (dev bug can't nuke prod)
  - **Estimated Time**: 6 hours (2 days allocated in timeline)
- [ ] 3.5.2 Formalize dev/staging/prod CDK contexts
  - Create `cdk.context.json` with environment-specific values
  - Define resource naming conventions (e.g., `lfmt-{env}-{resource}`)
  - Configure retention policies per environment
  - **Add production account ID** to context
  - **Estimated Time**: 3 hours
- [ ] 3.5.3 Add environment tagging
  - Tag all resources with `Environment: dev|staging|prod`
  - Tag with `Project: lfmt`, `Owner: raymond@example.com`
  - Use tags for cost allocation reports
  - **Estimated Time**: 2 hours
- [ ] 3.5.4 Deploy production stack to new AWS account
  - Update `.github/workflows/deploy.yml` with prod deployment job (cross-account assume role)
  - Test deployment to prod account
  - **Estimated Time**: 4 hours
- [ ] 3.5.5 Document environment strategy
  - Create `docs/environment-strategy.md`
  - Explain dev → staging → prod promotion process
  - Document AWS Organizations setup, cross-account IAM
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/bin/lfmt-infrastructure.ts`, `.github/workflows/deploy.yml`
- **Files Created**: `cdk.context.json`, `docs/environment-strategy.md`, `docs/aws-organizations-setup.md`
- **Success Criteria**: Prod stack deployed to separate AWS account, cross-account IAM working

### 3.6 Secrets Management & Rotation 🆕 **CRITICAL GAP**

- [ ] 3.6.1 Configure secrets rotation policy for Gemini API key
  - **Production**: AWS Secrets Manager automatic rotation (90 days)
    - Create rotation Lambda (generate new Gemini key via API, update Secrets Manager, invalidate old key)
  - **Dev/Staging**: Manual rotation (90 days), document in runbook
  - **Estimated Time**: 4 hours
- [ ] 3.6.2 Track secret age in CloudWatch
  - Create CloudWatch metric for Gemini API key age
  - Alarm if key age > 100 days (10 days grace period)
  - SNS notification to operations email
  - **Estimated Time**: 2 hours
- [ ] 3.6.3 Test rotation procedure in dev
  - Manually rotate Gemini key in dev environment
  - Verify translation jobs complete with new key
  - Document rotation steps in runbook
  - **Estimated Time**: 2 hours
- **Files Created**: `backend/infrastructure/lib/constructs/secret-rotation-lambda.ts`, `docs/runbooks/secrets-rotation.md`
- **Success Criteria**: Rotation Lambda deployed, CloudWatch alarm configured, tested in dev

### 3.7 Cost Controls (AWS BUDGETS + ANOMALY DETECTION) 🆕 **CRITICAL GAP**

- [ ] 3.7.1 Create AWS Budget ($50/month with 80% alert)
  - Set up $50/month budget via AWS Budgets console or CDK
  - Configure SNS alerts at:
    - 80% ($40) — Warning notification
    - 100% ($50) — Critical notification + investigation required
  - Subscribe operations email to SNS topic
  - **Estimated Time**: 2 hours
- [ ] 3.7.2 Enable AWS Cost Anomaly Detection
  - Enable Cost Anomaly Detection via AWS Console
  - Configure ML-based anomaly alerts (catch runaway Lambda/Gemini loops within 6 hours)
  - Subscribe operations email to anomaly notifications
  - **Estimated Time**: 1 hour
- [ ] 3.7.3 Create daily cost tracking metric
  - CloudWatch metric for daily spend (visualize in dashboards)
  - Create alarm if daily spend > $5 (unusual spike)
  - **Estimated Time**: 2 hours
- [ ] 3.7.4 Document emergency kill switch procedure
  - Add `docs/runbooks/emergency-cost-control.md`
  - Steps to disable API Gateway if runaway loop detected
  - Steps to halt all Step Functions executions
  - **Estimated Time**: 1 hour
- **Files Created**: `docs/runbooks/emergency-cost-control.md`
- **Success Criteria**: Budget configured, anomaly detection enabled, cost alarms firing correctly

### 3.8 Data Privacy & GDPR Compliance 🆕 **CRITICAL GAP**

- [ ] 3.8.1 Implement formal data retention policy
  - **Policy**: User-uploaded documents deleted 30 days after translation (or immediate if user opts in)
  - S3 Lifecycle Policies: Auto-delete from `documentBucket` after 30 days
  - S3 Lifecycle Policies: Auto-delete from `resultsBucket` after 30 days
  - **Estimated Time**: 3 hours
- [ ] 3.8.2 Create user deletion API endpoint
  - New endpoint: `DELETE /api/documents/:jobId`
  - Immediate S3 deletion (both source and translated documents)
  - Update DynamoDB job status to "deleted"
  - Audit trail: Log deletion in CloudWatch
  - **Estimated Time**: 4 hours
- [ ] 3.8.3 Update terms of service with data handling disclosure
  - Add section explaining data retention policy
  - User consent checkbox during upload (required)
  - **Estimated Time**: 2 hours
- [ ] 3.8.4 Implement right to deletion UI
  - Add "Delete Document" button in translation job list
  - Confirmation modal: "Are you sure? This action cannot be undone."
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (S3 lifecycle), backend Lambda (new delete endpoint), frontend (delete button)
- **Files Created**: `docs/data-privacy-policy.md`, `docs/gdpr-compliance.md`
- **Success Criteria**: Data retention policy enforced, deletion endpoint working, GDPR-compliant

---

## Phase 4: Monitoring & CI/CD Hardening (Week 4 - 40 hours)

### 4.1 CloudWatch Dashboards (Backend + FRONTEND RUM) 🆕

- [ ] 4.1.1 Create API Gateway dashboard
  - Widgets: Request count, 4xx/5xx errors, latency (p50, p90, p99)
  - **Estimated Time**: 3 hours
- [ ] 4.1.2 Create Lambda dashboard
  - Widgets: Invocations, errors, duration, throttles, concurrent executions per function
  - **Estimated Time**: 4 hours
- [ ] 4.1.3 Create DynamoDB dashboard
  - Widgets: Consumed capacity, throttled requests
  - **Estimated Time**: 3 hours
- [ ] 4.1.4 Create S3 dashboard
  - Widgets: Bucket size, request count, 4xx/5xx errors
  - **Estimated Time**: 2 hours
- [ ] 4.1.5 Create Step Functions dashboard
  - Widgets: Execution count, success/failure rate, duration
  - **Estimated Time**: 2 hours
- [ ] 4.1.6 **Create Frontend Observability (CloudWatch RUM)** 🆕 **CRITICAL GAP**
  - Add CloudWatch RUM app monitor in CDK stack
  - Inject RUM script into frontend HTML (Vite plugin or index.html)
  - Track: JS errors, page load time, React component crashes, API call failures, user sessions
  - Create CloudWatch dashboard for frontend metrics (separate from backend)
  - **Estimated Time**: 4 hours
- [ ] 4.1.7 Create composite overview dashboard
  - Combine key metrics from backend + frontend
  - Overall system health at-a-glance
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`, `frontend/index.html` or Vite config
- **Success Criteria**: 7 CloudWatch dashboards deployed (6 backend + 1 frontend RUM), metrics visible

### 4.1b Cost Controls Dashboard 🆕 **CRITICAL GAP (FROM PHASE 3)**

- [ ] 4.1.8 **Create AWS Budget ($50/month with 80% alert)** 🆕 **REVIEWER REQUIRED**
  - Set up $50/month budget via AWS Budgets console or CDK
  - Configure SNS alerts at 80% ($40) and 100% ($50)
  - Subscribe operations email to SNS topic
  - **Estimated Time**: 2 hours
- [ ] 4.1.9 Enable AWS Cost Anomaly Detection
  - Enable Cost Anomaly Detection via AWS Console
  - Configure ML-based anomaly alerts
  - **Estimated Time**: 1 hour
- [ ] 4.1.10 Create daily cost tracking metric
  - CloudWatch metric for daily spend (visualize in dashboards)
  - Create alarm if daily spend > $5 (unusual spike)
  - **Estimated Time**: 2 hours
- **Success Criteria**: Budget configured, anomaly detection enabled, cost visibility in dashboards

### 4.2 CloudWatch Alarms

- [ ] 4.2.1 Create SNS topic for alarm notifications
  - Topic: `lfmt-alarms-{env}`
  - Subscribe operations email address
  - Configure email confirmation
  - **Estimated Time**: 1 hour
- [ ] 4.2.2 Create Lambda error rate alarms
  - Alarm: Lambda error rate > 5% (5-minute period, 2 consecutive)
  - Action: Publish to SNS topic
  - Create separate alarm per Lambda function
  - **Estimated Time**: 3 hours
- [ ] 4.2.3 Create API Gateway 5xx alarm
  - Alarm: API Gateway 5xx rate > 1% (5-minute period, 2 consecutive)
  - Action: Publish to SNS topic
  - **Estimated Time**: 1 hour
- [ ] 4.2.4 Create DynamoDB throttling alarm
  - Alarm: Throttled requests > 10 (1-minute period, 3 consecutive)
  - Action: Publish to SNS topic
  - **Estimated Time**: 1 hour
- [ ] 4.2.5 Create translation job failure alarm
  - Alarm: Translation job failures > 3 in 1 hour
  - Action: Publish to SNS topic
  - Query DynamoDB job status or Step Functions failures
  - **Estimated Time**: 2 hours
- [ ] 4.2.6 Test alarm notifications
  - Trigger Lambda error → Verify SNS email received
  - Trigger API Gateway 5xx → Verify alarm fires
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`
- **Success Criteria**: 10+ alarms configured, test notifications received

### 4.3 Structured Logging (+ CORRELATION ID ORIGIN) 🆕

- [ ] 4.3.1 Add correlation IDs to all Lambda handlers ⚠️ **REVIEWER CLARIFICATION**
  - **Correlation ID Origin**: **API Gateway** (`event.requestContext.requestId`)
    - Born when request enters AWS infrastructure (NOT in frontend)
    - Automatically propagated to Lambda via event context
    - Consistent across all backend services (Lambda, CloudWatch Logs, X-Ray)
  - Extract `correlationId = event.requestContext.requestId` at handler entry
  - Include in all log statements
  - **Return in response headers** (`X-Correlation-ID`) for frontend logging/support tickets
  - **Estimated Time**: 4 hours
- [ ] 4.3.2 Standardize JSON log format
  - Create `logger.ts` utility with structured logging
  - Format: `{ timestamp, level, correlationId, message, metadata }`
  - Replace all `console.log` with `logger.info()`, `logger.error()`, etc.
  - **Estimated Time**: 6 hours
- [ ] 4.3.3 Configure CloudWatch log retention
  - Dev: 7 days, Staging: 14 days, Prod: 30 days
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (LogRetention)
  - **Estimated Time**: 2 hours
- [ ] 4.3.4 Create CloudWatch Insights queries
  - Query: All errors by Lambda function
  - Query: Slow requests (duration > 3s)
  - Query: Translation job failures with details
  - **Estimated Time**: 2 hours
- **Files Created**: `backend/functions/utils/logger.ts`
- **Files Modified**: All Lambda handlers (replace console.log)
- **Success Criteria**: All logs include correlationId (from API Gateway), CloudWatch Insights queries work

### 4.4 CI/CD Hardening (+ GEMINI CIRCUIT BREAKER) 🆕

- [ ] 4.4.1 **Implement Gemini Rate Limiting Circuit Breaker** 🆕 **CRITICAL GAP**
  - **Problem**: Current rate limiter doesn't handle Gemini 429 errors gracefully
  - **Circuit Breaker Pattern**:
    - Track consecutive 429 errors per translation job
    - After 3 consecutive 429s → open circuit (halt job for 2 minutes)
    - Exponential backoff: 2min → 4min → 8min
    - After successful request → close circuit
  - **Implementation**:
    - Add circuit breaker logic to `translation/translateChunk.ts` Lambda
    - Store circuit state in DynamoDB (job-level circuit breaker)
    - Create CloudWatch metric for circuit breaker trips
  - **UI Handling**:
    - Update `TranslationStatus.tsx` to show "Translation paused due to rate limits. Retrying in X minutes..." (not generic error)
    - Display circuit breaker state in job status
  - **Estimated Time**: 8 hours
- [ ] 4.4.2 Add deployment smoke tests
  - Create `backend/functions/__tests__/smoke/` directory
  - Test 1: Health check endpoint returns 200
  - Test 2: Login with test user succeeds
  - Test 3: Upload → chunk → translate → download workflow
  - Run smoke tests in CI after staging/prod deployments
  - **Estimated Time**: 6 hours
- [ ] 4.4.3 Implement staging deployment workflow
  - Add `deploy-staging` job to `.github/workflows/deploy.yml`
  - Trigger: Manual `workflow_dispatch` with environment selection
  - Require approval from project owner
  - Run smoke tests after staging deployment
  - **Estimated Time**: 3 hours
- [ ] 4.4.4 Implement production deployment workflow
  - Add `deploy-prod` job to `.github/workflows/deploy.yml`
  - Require: Staging deployment successful + manual approval
  - Use CloudFormation change sets (review before apply)
  - Run smoke tests after production deployment
  - **Estimated Time**: 4 hours
- [ ] 4.4.5 Add dependency security scanning
  - Add Dependabot configuration (`.github/dependabot.yml`)
  - Scan npm dependencies weekly
  - Auto-create PRs for security updates
  - **Estimated Time**: 1 hour
- [ ] 4.4.6 Pin dependency versions
  - Run `npm audit` across all packages
  - Fix critical/high vulnerabilities
  - Update `package-lock.json` to pin exact versions
  - **Estimated Time**: 2 hours
- **Files Modified**: `.github/workflows/deploy.yml`, `backend/functions/translation/translateChunk.ts`, `frontend/src/components/translation/TranslationStatus.tsx`
- **Files Created**: `.github/dependabot.yml`, `backend/functions/__tests__/smoke/`
- **Success Criteria**: Circuit breaker working, staging/prod deployments require approval, smoke tests pass

### 4.5 Operational Runbooks (+ AUTOMATED ROLLBACK SCRIPTS) ⚠️ **CRITICAL CHANGE**

- [ ] 4.5.1 Create deployment runbook
  - Add `docs/runbooks/deployment.md`
  - Sections: Pre-deployment checklist, deployment steps, rollback procedure
  - **Reference automated rollback scripts** (not manual steps)
  - Include time estimates for each step
  - Document database migration process
  - **Estimated Time**: 4 hours
- [ ] 4.5.2 **Create Automated Rollback Scripts** 🆕 **REVIEWER REQUIRED - NOT DOCUMENTATION ONLY**
  - **Problem**: Documentation-only rollback = errors during panic
  - **Solution**: Tested, automated scripts
    - `scripts/rollback-lambda.sh <function-name> <version>`: Revert Lambda to previous version
    - `scripts/rollback-cdk-stack.sh <stack-name>`: Rollback CloudFormation stack
    - `scripts/rollback-database.sh <table-name> <timestamp>`: Restore DynamoDB from PITR
  - **Testing Procedure**: Execute rollback in dev **every sprint** (muscle memory + validation)
  - **Runbooks Reference Scripts**: "Run `./scripts/rollback-cdk-stack.sh LfmtPocProd`" (not 20-step manual checklist)
  - **Estimated Time**: 6 hours
- [ ] 4.5.3 Test automated rollback scripts in dev
  - Deploy intentional breaking change to dev
  - Execute rollback scripts
  - Verify system restored to previous state
  - Measure rollback time (target: <10 minutes)
  - **Estimated Time**: 3 hours
- [ ] 4.5.4 Create incident response runbook
  - Add `docs/runbooks/incident-response.md`
  - Define severity levels (P0-P3)
  - Document escalation procedures
  - Create troubleshooting decision trees
  - **Reference automated rollback scripts for P0/P1 incidents**
  - **Estimated Time**: 4 hours
- [ ] 4.5.5 Create monitoring runbook
  - Add `docs/runbooks/monitoring.md`
  - CloudWatch alarm response procedures
  - Common error debugging guides
  - Performance tuning playbook
  - **Estimated Time**: 3 hours
- [ ] 4.5.6 Test runbooks with simulated incident
  - Simulate production incident (trigger Lambda error alarm)
  - Follow incident response runbook
  - Execute automated rollback scripts
  - Measure MTTR (Mean Time to Recovery) — target: <10 minutes with automation
  - **Estimated Time**: 2 hours
- **Files Created**: `scripts/rollback-lambda.sh`, `scripts/rollback-cdk-stack.sh`, `scripts/rollback-database.sh`, `docs/runbooks/deployment.md`, `docs/runbooks/incident-response.md`, `docs/runbooks/monitoring.md`
- **Success Criteria**: Automated rollback scripts tested, runbooks reference scripts, MTTR < 10 minutes for P1 incidents

---

## Validation & Sign-off

### Validation Checklist

- [ ] All tests pass: `npm test` in all packages
- [ ] Coverage meets threshold: `npm run test:coverage` shows ≥95%
- [ ] Linting passes: `npm run lint` shows 0 errors
- [ ] Type-checking passes: `npm run type-check` shows 0 errors
- [ ] Pre-commit hooks working: Test with intentional error
- [ ] CI/CD pipeline green: All GitHub Actions checks pass
- [ ] IAM audit complete: Zero wildcard permissions
- [ ] Monitoring deployed: 6+ dashboards, 10+ alarms
- [ ] Runbooks tested: Deployment and rollback procedures validated

### Acceptance Criteria

1. **Test Coverage**: ≥95% across all packages, enforced in CI
2. **Code Quality**: 0 linting errors, TypeScript strict mode enabled
3. **Infrastructure**: IAM least privilege, encryption enabled, backups configured
4. **Monitoring**: CloudWatch dashboards operational, alarms firing correctly
5. **CI/CD**: Staging environment deployed, rollback tested successfully

### Sign-off

- [ ] Project Owner approval
- [ ] Technical review complete
- [ ] Documentation reviewed
- [ ] Production deployment authorized

---

## Notes

### Coverage Exclusions & Exemptions

The following code is **excluded from coverage reporting** (not our code):

- Generated code (CDK `cdk.out/` directory)
- Third-party code (`node_modules/`)
- Type definition files (`.d.ts`)
- Configuration files (`.eslintrc.cjs`, `jest.config.js`)

**Application code exemptions are the NUCLEAR OPTION — last resort only.** Unless it is truly impossible to test a piece of application code, no exemptions are granted. 95% means 95%. If code can't be tested, question whether the code should exist.

### Rollback Plan

If any phase introduces breaking changes:

1. Revert Git commit
2. Re-deploy previous CDK stack version
3. Restore DynamoDB from PITR (if data corruption)
4. Post-mortem analysis

### Future Work (Out of Scope)

- AWS X-Ray distributed tracing (P1, can add later)
- Third-party monitoring (Datadog, New Relic)
- Separate AWS accounts for environments
- Advanced runbooks (capacity planning, disaster recovery)
- Automated security scanning (SAST, DAST)
