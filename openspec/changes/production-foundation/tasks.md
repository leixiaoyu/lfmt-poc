# Implementation Tasks: LFMT Production Foundation

**Change ID**: `production-foundation`
**Total Estimated Effort**: 4 weeks (160 hours)
**Phases**: 4 phases over 4 weeks

---

## Phase 1: Test Coverage Foundation (Week 1 - 40 hours)

### 1.1 Configure Coverage Reporting Infrastructure
- [ ] 1.1.1 Update `backend/functions/jest.config.js` coverage threshold to 95%
  - Modify `coverageThreshold.global` for all metrics (branches, functions, lines, statements)
  - Add `coveragePathIgnorePatterns` for generated code
- [ ] 1.1.2 Create `frontend/vitest.config.ts` with coverage configuration
  - Install `@vitest/coverage-v8` (already in devDependencies)
  - Configure `coverage.provider: 'v8'`, `coverage.reporter: ['text', 'json', 'html', 'lcov']`
  - Set `coverage.thresholds` to 95% (lines, functions, branches, statements)
- [ ] 1.1.3 Update `backend/infrastructure/jest.config.js` for CDK testing
  - Add coverage thresholds: 95% across all metrics
  - Configure `testMatch` for CDK construct tests
- [ ] 1.1.4 Add coverage reporting to CI pipeline (`.github/workflows/deploy.yml`)
  - Modify `test` job to run `npm run test:coverage` instead of `npm test`
  - Add coverage report upload as GitHub artifact
  - Add coverage badge to README.md
- **Files Modified**: `backend/functions/jest.config.js`, `frontend/vitest.config.ts`, `backend/infrastructure/jest.config.js`, `.github/workflows/deploy.yml`
- **Estimated Time**: 4 hours
- **Success Criteria**: Coverage reports generate locally and in CI

### 1.2 Backend Lambda Function Tests (Critical Path)
- [ ] 1.2.1 Add missing tests for authentication handlers
  - `auth/register.ts`: Test validation errors, duplicate email, password hashing
  - `auth/login.ts`: Test invalid credentials, account lockout, token generation
  - `auth/refresh-token.ts`: Test expired tokens, invalid tokens, rotation
  - `auth/reset-password.ts`: Test email validation, password complexity, reset flow
  - `auth/getCurrentUser.ts`: Test unauthorized access, token validation
  - **Target Coverage**: 95% for all auth handlers
  - **Estimated Time**: 8 hours
- [ ] 1.2.2 Add missing tests for upload handlers
  - `upload/uploadPresignedUrl.ts`: Test file size limits, file type validation, S3 errors
  - `upload/uploadComplete.ts`: Test S3 verification, metadata updates, missing files
  - **Target Coverage**: 95% for upload handlers
  - **Estimated Time**: 4 hours
- [ ] 1.2.3 Add missing tests for translation workflow
  - `translation/chunkDocument.ts`: Test edge cases (empty file, single sentence, 500K words)
  - `translation/translateChunk.ts`: Test Gemini API errors, rate limiting, retries
  - `translation/startTranslation.ts`: Test Step Functions errors, invalid job IDs
  - `translation/getTranslationStatus.ts`: Test missing jobs, corrupted state
  - **Target Coverage**: 95% for translation handlers
  - **Estimated Time**: 10 hours
- [ ] 1.2.4 Add error handling path tests
  - Test DynamoDB errors (throttling, item not found)
  - Test S3 errors (access denied, bucket not found, network timeouts)
  - Test Cognito errors (user not found, password policy violations)
  - **Target Coverage**: 90%+ branch coverage (error paths)
  - **Estimated Time**: 6 hours
- **Files Created**: 20+ new test files in `backend/functions/__tests__/`
- **Success Criteria**: `npm run test:coverage` shows ≥95% coverage, all tests pass

### 1.3 Frontend Component Tests
- [ ] 1.3.1 Test authentication components
  - `src/components/auth/LoginForm.tsx`: Test form validation, submit, error display
  - `src/components/auth/RegisterForm.tsx`: Test password validation, terms acceptance
  - `src/components/auth/PasswordResetForm.tsx`: Test email validation, success flow
  - **Target Coverage**: 95%
  - **Estimated Time**: 6 hours
- [ ] 1.3.2 Test translation workflow components
  - `src/components/translation/UploadForm.tsx`: Test file selection, legal attestation, upload
  - `src/components/translation/TranslationStatus.tsx`: Test progress display, polling logic
  - `src/components/translation/JobList.tsx`: Test job filtering, sorting, pagination
  - **Target Coverage**: 95%
  - **Estimated Time**: 8 hours
- [ ] 1.3.3 Test hooks and contexts
  - `src/hooks/useAuth.tsx`: Test login, logout, token refresh, error handling
  - `src/contexts/AuthContext.tsx`: Test provider, state updates, persistence
  - `src/hooks/useTranslation.tsx`: Test job creation, status polling, cancellation
  - **Target Coverage**: 95%
  - **Estimated Time**: 6 hours
- [ ] 1.3.4 Test utility functions
  - `src/utils/api.ts`: Test request interceptors, error handling, retries
  - `src/utils/validation.ts`: Test Zod schema edge cases
  - `src/utils/formatting.ts`: Test date formatting, file size formatting
  - **Target Coverage**: 100% (utilities are deterministic)
  - **Estimated Time**: 3 hours
- **Files Created**: 30+ test files in `frontend/src/__tests__/`
- **Success Criteria**: `npm run test:coverage` shows ≥95% coverage

### 1.4 Infrastructure (CDK) Tests
- [ ] 1.4.1 Test CDK stack synthesis
  - Test `LfmtInfrastructureStack` synthesizes without errors
  - Test environment-specific configurations (dev, staging, prod)
  - Snapshot test for generated CloudFormation template
  - **Estimated Time**: 4 hours
- [ ] 1.4.2 Test resource creation
  - Test DynamoDB tables have correct attributes, indexes, PITR enabled
  - Test S3 buckets have encryption, versioning, lifecycle policies
  - Test Lambda functions have correct environment variables, IAM roles
  - Test API Gateway has CORS, authorizers, rate limiting
  - **Estimated Time**: 6 hours
- [ ] 1.4.3 Test IAM policies
  - Test Lambda role has least-privilege permissions
  - Test S3 bucket policies block public access
  - Test Cognito user pool policies enforce password complexity
  - **Estimated Time**: 4 hours
- **Files Created**: `backend/infrastructure/__tests__/lfmt-infrastructure-stack.test.ts`
- **Success Criteria**: CDK unit tests pass, coverage ≥95%

---

## Phase 2: Code Quality Standards (Week 2 - 40 hours)

### 2.1 TypeScript Strict Mode Migration
- [ ] 2.1.1 Audit current `any` types across codebase
  - Run `grep -r "any" --include="*.ts" --include="*.tsx"` to find all instances
  - Create inventory spreadsheet (file path, line number, justification needed)
  - **Estimated Count**: <50 instances
  - **Estimated Time**: 2 hours
- [ ] 2.1.2 Enable strict mode in all `tsconfig.json` files
  - `backend/functions/tsconfig.json`: Set `strict: true`, `noImplicitAny: true`
  - `frontend/tsconfig.json`: Set `strict: true`, `noImplicitAny: true`
  - `backend/infrastructure/tsconfig.json`: Set `strict: true`
  - `shared-types/tsconfig.json`: Set `strict: true`
  - **Estimated Time**: 1 hour
- [ ] 2.1.3 Fix TypeScript errors incrementally
  - Fix backend Lambda functions (highest risk first: auth, translation)
  - Fix frontend components (auth, translation workflow)
  - Fix infrastructure CDK code
  - Fix shared types
  - **Estimated Time**: 12 hours
- **Files Modified**: 4 `tsconfig.json` files, 50+ TypeScript files
- **Success Criteria**: `npm run type-check` passes in all packages with 0 errors

### 2.2 ESLint Configuration Standardization
- [ ] 2.2.1 Create standardized `.eslintrc.cjs` for backend
  - Extend `@typescript-eslint/recommended-requiring-type-checking`
  - Add rules: `no-console: warn`, `no-unused-vars: error`, `prefer-const: error`
  - Configure parser options for TypeScript strict mode
  - **Estimated Time**: 2 hours
- [ ] 2.2.2 Update frontend `.eslintrc.cjs`
  - Add React-specific rules: `react-hooks/rules-of-hooks`, `react-hooks/exhaustive-deps`
  - Add accessibility rules: `jsx-a11y/recommended`
  - Align with backend rules for consistency
  - **Estimated Time**: 2 hours
- [ ] 2.2.3 Fix all ESLint errors and warnings
  - Run `npm run lint -- --fix` in all packages
  - Manually fix remaining errors (estimated 20-30 errors)
  - **Estimated Time**: 4 hours
- [ ] 2.2.4 Add ESLint to CI pipeline
  - Modify `.github/workflows/deploy.yml` to run `npm run lint` in all packages
  - Fail build if any errors found (warnings allowed initially)
  - **Estimated Time**: 1 hour
- **Files Modified**: `backend/functions/.eslintrc.cjs`, `frontend/.eslintrc.cjs`, `.github/workflows/deploy.yml`
- **Success Criteria**: `npm run lint` passes with 0 errors across all packages

### 2.3 Prettier Formatting
- [ ] 2.3.1 Create `.prettierrc.json` configuration
  - `printWidth: 100`, `tabWidth: 2`, `semi: true`, `singleQuote: true`
  - `trailingComma: 'es5'`, `arrowParens: 'always'`
  - Place in project root to apply to all packages
  - **Estimated Time**: 1 hour
- [ ] 2.3.2 Create `.prettierignore` file
  - Ignore `node_modules/`, `dist/`, `build/`, `cdk.out/`, `coverage/`
  - **Estimated Time**: 0.5 hours
- [ ] 2.3.3 Format all code
  - Run `npx prettier --write .` in project root
  - Verify changes don't break functionality (run all tests)
  - **Estimated Time**: 2 hours
- [ ] 2.3.4 Add Prettier to package.json scripts
  - Add `"format": "prettier --write ."` to all `package.json` files
  - Add `"format:check": "prettier --check ."` for CI
  - **Estimated Time**: 0.5 hours
- **Files Created**: `.prettierrc.json`, `.prettierignore`
- **Files Modified**: All TypeScript files (formatting only)
- **Success Criteria**: `npm run format:check` passes

### 2.4 Pre-commit Hooks
- [ ] 2.4.1 Install Husky and lint-staged
  - `npm install --save-dev husky lint-staged` in project root
  - Run `npx husky init` to create `.husky/` directory
  - **Estimated Time**: 1 hour
- [ ] 2.4.2 Configure pre-commit hook
  - Create `.husky/pre-commit` script
  - Run `npx lint-staged` on staged files
  - **Estimated Time**: 1 hour
- [ ] 2.4.3 Configure lint-staged
  - Add `.lintstagedrc.json` in project root
  - Run ESLint on `*.ts` and `*.tsx` files
  - Run Prettier on all files
  - Run type-check on changed packages
  - **Estimated Time**: 1 hour
- [ ] 2.4.4 Test pre-commit hooks
  - Introduce intentional linting error → Commit should fail
  - Fix error → Commit should succeed
  - **Estimated Time**: 0.5 hours
- **Files Created**: `.husky/pre-commit`, `.lintstagedrc.json`
- **Success Criteria**: Pre-commit hooks block commits with linting/formatting errors

### 2.5 PR Templates and Review Process
- [ ] 2.5.1 Create PR template
  - Add `.github/pull_request_template.md`
  - Sections: Description, Changes, Testing, Checklist (tests added, coverage ≥95%, linting passed)
  - **Estimated Time**: 1 hour
- [ ] 2.5.2 Create code review checklist document
  - Add `docs/code-review-checklist.md`
  - Include: SOLID principles, error handling, security, performance
  - **Estimated Time**: 2 hours
- [ ] 2.5.3 Configure GitHub branch protection
  - Require PR reviews before merging to `main`
  - Require status checks (tests, linting, coverage)
  - Require linear history (no merge commits)
  - **Estimated Time**: 0.5 hours
- **Files Created**: `.github/pull_request_template.md`, `docs/code-review-checklist.md`
- **Success Criteria**: PRs cannot merge without passing checks

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

### 3.4 Cognito Security Hardening
- [ ] 3.4.1 Enforce password complexity
  - Update `userPool` password policy:
    - `minLength: 12` (currently 8)
    - `requireUppercase: true`
    - `requireLowercase: true`
    - `requireDigits: true`
    - `requireSymbols: true`
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:224-267`
  - **Estimated Time**: 2 hours
- [ ] 3.4.2 Configure account lockout policy
  - Add `accountRecoverySetting` configuration
  - Lock account after 5 failed login attempts
  - Unlock after 15 minutes or admin intervention
  - **Estimated Time**: 2 hours
- [ ] 3.4.3 Enable MFA for production environment
  - Add `mfa: cognito.Mfa.OPTIONAL` for prod context
  - Keep disabled for dev/staging (usability)
  - Document MFA setup in user guide
  - **Estimated Time**: 3 hours
- [ ] 3.4.4 Configure session timeout
  - Access token: 15 minutes (short-lived)
  - Refresh token: 30 days (current)
  - ID token: 15 minutes
  - **Estimated Time**: 1 hour
- [ ] 3.4.5 Test password policy enforcement
  - Attempt registration with weak password → Should fail
  - Attempt 5 failed logins → Account locked
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`
- **Success Criteria**: Password policy enforced, account lockout working

### 3.5 Environment Separation
- [ ] 3.5.1 Formalize dev/staging/prod CDK contexts
  - Create `cdk.context.json` with environment-specific values
  - Define resource naming conventions (e.g., `lfmt-{env}-{resource}`)
  - Configure retention policies per environment
  - **Estimated Time**: 3 hours
- [ ] 3.5.2 Add environment tagging
  - Tag all resources with `Environment: dev|staging|prod`
  - Tag with `Project: lfmt`, `Owner: raymond@example.com`
  - Use tags for cost allocation reports
  - **Estimated Time**: 2 hours
- [ ] 3.5.3 Create staging environment stack
  - Duplicate `LfmtPocDev` stack as `LfmtPocStaging`
  - Update `.github/workflows/deploy.yml` with staging deployment job
  - Test deployment to staging
  - **Estimated Time**: 4 hours
- [ ] 3.5.4 Document environment strategy
  - Create `docs/environment-strategy.md`
  - Explain dev → staging → prod promotion process
  - Document AWS account separation plan (future)
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/bin/lfmt-infrastructure.ts`, `.github/workflows/deploy.yml`
- **Files Created**: `cdk.context.json`, `docs/environment-strategy.md`
- **Success Criteria**: Staging environment deployed successfully

---

## Phase 4: Monitoring & CI/CD Hardening (Week 4 - 40 hours)

### 4.1 CloudWatch Dashboards
- [ ] 4.1.1 Create API Gateway dashboard
  - Widgets: Request count (sum, 5-min period)
  - 4xx error rate (percentage, 5-min period)
  - 5xx error rate (percentage, 5-min period)
  - Latency (p50, p90, p99, 5-min period)
  - **Estimated Time**: 3 hours
- [ ] 4.1.2 Create Lambda dashboard
  - Widgets: Invocations (sum, 5-min period) per function
  - Errors (sum, 5-min period) per function
  - Duration (p50, p99, 5-min period) per function
  - Throttles (sum, 5-min period)
  - Concurrent executions (max, 5-min period)
  - **Estimated Time**: 4 hours
- [ ] 4.1.3 Create DynamoDB dashboard
  - Widgets: Consumed read capacity (sum, 1-min period) per table
  - Consumed write capacity (sum, 1-min period) per table
  - Throttled read requests (sum, 1-min period)
  - Throttled write requests (sum, 1-min period)
  - **Estimated Time**: 3 hours
- [ ] 4.1.4 Create S3 dashboard
  - Widgets: Bucket size (bytes, daily)
  - Request count (sum, 1-hour period) per bucket
  - 4xx/5xx errors (sum, 1-hour period)
  - **Estimated Time**: 2 hours
- [ ] 4.1.5 Create Step Functions dashboard
  - Widgets: Execution count (sum, 5-min period)
  - Execution success/failure rate (percentage, 5-min period)
  - Execution duration (p50, p99, 5-min period)
  - **Estimated Time**: 2 hours
- [ ] 4.1.6 Create composite overview dashboard
  - Combine key metrics from all services
  - Overall system health at-a-glance
  - Link to detailed dashboards
  - **Estimated Time**: 2 hours
- **Files Modified**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (add monitoring constructs)
- **Success Criteria**: 6 CloudWatch dashboards deployed, metrics visible

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

### 4.3 Structured Logging
- [ ] 4.3.1 Add correlation IDs to all Lambda handlers
  - Generate unique `correlationId` per request (UUID v4)
  - Pass in `event.requestContext.requestId` from API Gateway
  - Include in all log statements
  - **Estimated Time**: 4 hours
- [ ] 4.3.2 Standardize JSON log format
  - Create `logger.ts` utility with structured logging
  - Format: `{ timestamp, level, correlationId, message, metadata }`
  - Replace all `console.log` with `logger.info()`, `logger.error()`, etc.
  - **Estimated Time**: 6 hours
- [ ] 4.3.3 Configure CloudWatch log retention
  - Dev: 7 days retention
  - Staging: 14 days retention
  - Prod: 30 days retention
  - **File**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (LogRetention)
  - **Estimated Time**: 2 hours
- [ ] 4.3.4 Create CloudWatch Insights queries
  - Query: All errors by Lambda function
  - Query: Slow requests (duration > 3s)
  - Query: Translation job failures with details
  - Save queries in CloudWatch console
  - **Estimated Time**: 2 hours
- **Files Created**: `backend/functions/utils/logger.ts`
- **Files Modified**: All Lambda handlers (replace console.log)
- **Success Criteria**: All logs include correlationId, CloudWatch Insights queries work

### 4.4 CI/CD Hardening
- [ ] 4.4.1 Add deployment smoke tests
  - Create `backend/functions/__tests__/smoke/` directory
  - Test 1: Health check endpoint returns 200
  - Test 2: Login with test user succeeds
  - Test 3: Upload → chunk → translate → download workflow
  - Run smoke tests in CI after staging/prod deployments
  - **Estimated Time**: 6 hours
- [ ] 4.4.2 Implement staging deployment workflow
  - Add `deploy-staging` job to `.github/workflows/deploy.yml`
  - Trigger: Manual `workflow_dispatch` with environment selection
  - Require approval from project owner
  - Run smoke tests after staging deployment
  - **Estimated Time**: 3 hours
- [ ] 4.4.3 Implement production deployment workflow
  - Add `deploy-prod` job to `.github/workflows/deploy.yml`
  - Require: Staging deployment successful + manual approval
  - Use CloudFormation change sets (review before apply)
  - Run smoke tests after production deployment
  - **Estimated Time**: 4 hours
- [ ] 4.4.4 Add dependency security scanning
  - Add Dependabot configuration (`.github/dependabot.yml`)
  - Scan npm dependencies weekly
  - Auto-create PRs for security updates
  - **Estimated Time**: 1 hour
- [ ] 4.4.5 Pin dependency versions
  - Run `npm audit` across all packages
  - Fix critical/high vulnerabilities
  - Update `package-lock.json` to pin exact versions
  - **Estimated Time**: 2 hours
- **Files Modified**: `.github/workflows/deploy.yml`
- **Files Created**: `.github/dependabot.yml`, `backend/functions/__tests__/smoke/`
- **Success Criteria**: Staging/prod deployments require approval, smoke tests pass

### 4.5 Operational Runbooks
- [ ] 4.5.1 Create deployment runbook
  - Add `docs/runbooks/deployment.md`
  - Sections: Pre-deployment checklist, deployment steps, rollback procedure
  - Include time estimates for each step
  - Document database migration process
  - **Estimated Time**: 4 hours
- [ ] 4.5.2 Create rollback procedure
  - Document CDK rollback steps
  - CloudFormation stack rollback commands
  - Database rollback strategy (if migrations exist)
  - Test rollback in dev environment
  - **Estimated Time**: 3 hours
- [ ] 4.5.3 Create incident response runbook
  - Add `docs/runbooks/incident-response.md`
  - Define severity levels (P0-P3)
  - Document escalation procedures
  - Create troubleshooting decision trees
  - **Estimated Time**: 4 hours
- [ ] 4.5.4 Create monitoring runbook
  - Add `docs/runbooks/monitoring.md`
  - CloudWatch alarm response procedures
  - Common error debugging guides
  - Performance tuning playbook
  - **Estimated Time**: 3 hours
- [ ] 4.5.5 Test runbooks with team
  - Simulate production incident
  - Follow incident response runbook
  - Measure MTTR (Mean Time to Recovery)
  - Iterate based on feedback
  - **Estimated Time**: 2 hours
- **Files Created**: `docs/runbooks/deployment.md`, `docs/runbooks/incident-response.md`, `docs/runbooks/monitoring.md`
- **Success Criteria**: Runbooks tested, MTTR < 30 minutes for P1 incidents

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
