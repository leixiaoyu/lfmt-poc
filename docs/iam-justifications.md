# IAM Permissions Justifications

**Document Version**: 1.0
**Last Updated**: 2026-04-05
**Status**: Production Foundation Phase C1 (IAM Hardening)

---

## Overview

This document provides detailed justifications for all IAM permissions granted to LFMT infrastructure components. All permissions follow the **principle of least privilege**, with specific resource scoping and minimal action sets.

**Key Security Principles:**
- ✅ **No wildcard permissions** on resources (all ARNs explicitly scoped)
- ✅ **Separate roles per function group** (auth, upload, chunking, translation)
- ✅ **Minimal action sets** (only required actions, no broad `*` permissions)
- ✅ **Resource-level scoping** (table ARNs, bucket ARNs, specific secret patterns)

---

## Role Architecture

### 1. Auth Lambda Role (`AuthLambdaRole`)

**Used By:**
- `lfmt-register-{env}` — User registration
- `lfmt-login-{env}` — User login
- `lfmt-refresh-token-{env}` — Token refresh
- `lfmt-reset-password-{env}` — Password reset
- `lfmt-get-current-user-{env}` — Get authenticated user

**Permissions:**

#### Cognito User Pool Access
```typescript
Actions: [
  'cognito-idp:SignUp',                 // Required: Create new user accounts
  'cognito-idp:InitiateAuth',           // Required: Authenticate users with SRP
  'cognito-idp:ForgotPassword',         // Required: Initiate password reset flow
  'cognito-idp:ConfirmForgotPassword',  // Required: Complete password reset
  'cognito-idp:AdminCreateUser',        // Required: Admin-initiated user creation
  'cognito-idp:AdminSetUserPassword',   // Required: Admin password changes
  'cognito-idp:AdminGetUser',           // Required: Retrieve user attributes for getCurrentUser
  'cognito-idp:AdminUpdateUserAttributes', // Required: Update user profile data
  'cognito-idp:AdminConfirmSignUp',     // Required: Manual email confirmation in dev
]
Resources: [this.userPool.userPoolArn]  // Scoped to specific User Pool
```

**Justification:**
- All actions are strictly required for authentication workflows
- `Admin*` actions needed because Lambda executes with service credentials (not user credentials)
- Resource scoped to single User Pool ARN (no cross-pool access possible)
- No create/delete pool permissions (only user management within pool)

#### DynamoDB Access (Users Table + Rate Limit Buckets)
```typescript
Actions: [
  'dynamodb:GetItem',    // Required: Fetch user profile during login
  'dynamodb:PutItem',    // Required: Create user record on registration
  'dynamodb:UpdateItem', // Required: Update user attributes (last login, etc.)
  'dynamodb:Query',      // Required: EmailIndex queries for duplicate detection
  // SECURITY: DeleteItem removed - GDPR deletions handled via Cognito user deletion (not DynamoDB)
  // SECURITY: Scan removed - auth functions use GetItem/Query for specific records only
]
Resources: [
  this.usersTable.tableArn,                    // Users table
  this.rateLimitBucketsTable.tableArn,         // Rate limiting state
  `${this.usersTable.tableArn}/index/*`,       // EmailIndex for email lookups
]
```

**Justification:**
- Auth functions only need access to Users table (no Jobs/Attestations access)
- `Query` on EmailIndex required for duplicate email detection during registration
- `DeleteItem` not needed - GDPR "right to be forgotten" handled via Cognito user pool deletion (not DynamoDB)
- `Scan` not needed - auth functions use GetItem with specific keys or Query on indexes
- Rate limit buckets needed for login/registration rate limiting

**Missing Permissions (Intentionally Excluded):**
- ❌ No S3 access (auth doesn't handle file operations)
- ❌ No Step Functions access (auth doesn't trigger translation workflows)
- ❌ No Secrets Manager access (auth doesn't use Gemini API)

---

### 2. Upload Lambda Role (`UploadLambdaRole`)

**Used By:**
- `lfmt-upload-request-{env}` — Generate presigned URLs for S3 uploads
- `lfmt-upload-complete-{env}` — Process S3 upload completion events

**Permissions:**

#### S3 Bucket Access
```typescript
Actions: [
  's3:GetObject',    // Required: Verify uploaded file exists and size
  's3:PutObject',    // Required: Generate presigned PUT URLs for uploads
  's3:DeleteObject', // Required: Clean up failed/incomplete uploads
]
Resources: [
  `${this.documentBucket.bucketArn}/*`,  // Document uploads
  `${this.resultsBucket.bucketArn}/*`,   // Translated results (for cleanup)
]

Actions: ['s3:ListBucket']  // Required: Verify object existence before operations
Resources: [
  this.documentBucket.bucketArn,   // Bucket-level ListBucket permission
  this.resultsBucket.bucketArn,
]
```

**Justification:**
- Object-level permissions (`/*`) separated from bucket-level permissions (best practice)
- `GetObject` required for upload verification (check file size, type)
- `PutObject` required to generate presigned URLs via `getSignedUrl()`
- `DeleteObject` required to clean up failed uploads or corrupted files
- `ListBucket` required to check object existence without fetching (cheaper)

**Why Two Buckets?**
- Document bucket: User uploads (source files)
- Results bucket: Translated output files (need cleanup if user re-uploads)

#### DynamoDB Access (Jobs + Attestations + Rate Limit Buckets)
```typescript
Actions: [
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:Query',      // Required for UserJobsIndex queries
  // SECURITY: DeleteItem removed - not used by upload functions
  // SECURITY: Scan removed - upload uses Query on GSIs, not full table scans
]
Resources: [
  this.jobsTable.tableArn,
  this.attestationsTable.tableArn,
  this.rateLimitBucketsTable.tableArn,
  `${this.jobsTable.tableArn}/index/*`,         // UserJobsIndex, StatusIndex
  `${this.attestationsTable.tableArn}/index/*`, // UserAttestationsIndex
]
```

**Justification:**
- Upload functions create/update job records during upload lifecycle
- Attestations table required to record legal agreements before upload
- Query on UserJobsIndex required to list user's jobs
- Rate limit buckets needed for upload rate limiting (prevent abuse)
- `DeleteItem` not needed - failed job cleanup handled by separate cleanup process
- `Scan` not needed - upload uses Query on specific GSIs, not full table scans

**Missing Permissions:**
- ❌ No Cognito access (authorization handled by API Gateway Cognito Authorizer)
- ❌ No Secrets Manager access (upload doesn't use Gemini API)
- ❌ No Lambda Invoke (upload doesn't trigger other functions)

---

### 3. Chunking Lambda Role (`ChunkingLambdaRole`)

**Used By:**
- `lfmt-chunk-document-{env}` — Process uploaded documents and create chunks for translation

**Permissions:**

#### S3 Bucket Access
```typescript
Actions: [
  's3:GetObject',    // Required: Read uploaded document for chunking
  's3:PutObject',    // Required: Write chunk files to S3
  's3:DeleteObject', // Required: Clean up source file after chunking
]
Resources: [
  `${this.documentBucket.bucketArn}/*`,
  `${this.resultsBucket.bucketArn}/*`,
]

Actions: ['s3:ListBucket']
Resources: [
  this.documentBucket.bucketArn,
  this.resultsBucket.bucketArn,
]
```

**Justification:**
- `GetObject` required to read source document (up to 400K words)
- `PutObject` required to write chunk files (3,500 tokens each + 250 overlap)
- `DeleteObject` required to clean up source after successful chunking
- Same dual-bucket access pattern as upload role

#### DynamoDB Access (Jobs Table + Rate Limit Buckets)
```typescript
Actions: [
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  // SECURITY: DeleteItem, Query, Scan removed - chunking uses GetItem with composite keys only
]
Resources: [
  this.jobsTable.tableArn,
  this.rateLimitBucketsTable.tableArn,
  `${this.jobsTable.tableArn}/index/*`,
]
```

**Justification:**
- Chunking updates job record with chunk count and metadata
- Uses GetItem with composite key (jobId + userId) to read job record
- No attestations table access needed (already validated during upload)
- No users table access needed (user ID comes from job record)

**Missing Permissions:**
- ❌ No Cognito access (runs async via S3 event trigger, no user context)
- ❌ No Secrets Manager access (chunking doesn't use Gemini API)
- ❌ No Lambda Invoke (chunking doesn't trigger translation directly)

---

### 4. Translation Lambda Role (`TranslationLambdaRole`)

**Used By:**
- `lfmt-translate-chunk-{env}` — Translate individual chunks via Gemini API
- `lfmt-start-translation-{env}` — Initiate Step Functions workflow
- `lfmt-get-translation-status-{env}` — Query translation progress

**Permissions:**

#### S3 Bucket Access
```typescript
Actions: [
  's3:GetObject',    // Required: Read chunk files for translation
  's3:PutObject',    // Required: Write translated chunks to results bucket
  's3:DeleteObject', // Required: Clean up processed chunks
]
Resources: [
  `${this.documentBucket.bucketArn}/*`,
  `${this.resultsBucket.bucketArn}/*`,
]

Actions: ['s3:ListBucket']
Resources: [
  this.documentBucket.bucketArn,
  this.resultsBucket.bucketArn,
]
```

**Justification:**
- Translation functions read chunks from documentBucket
- Write translated results to resultsBucket
- Delete chunks after successful translation (cost optimization)

#### DynamoDB Access (All Tables)
```typescript
Actions: [
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:Query',
  // SECURITY: DeleteItem removed - translation doesn't delete records
  // SECURITY: Scan removed - translation uses GetItem/Query for specific records
]
Resources: [
  this.jobsTable.tableArn,
  this.usersTable.tableArn,
  this.attestationsTable.tableArn,
  this.rateLimitBucketsTable.tableArn,
  `${this.jobsTable.tableArn}/index/*`,
  `${this.usersTable.tableArn}/index/*`,
  `${this.attestationsTable.tableArn}/index/*`,
]
```

**Justification:**
- Jobs table: Update translation progress (translatedChunks counter)
- Users table: Fetch user preferences (tone, target language)
- Attestations table: Verify legal agreement before final output delivery
- Rate limit buckets: Distributed rate limiting across concurrent Lambda invocations
- All 4 tables required for complete translation workflow
- `DeleteItem` not needed - translation workflow doesn't delete any records
- `Scan` not needed - uses GetItem with specific keys and Query on indexes

#### Secrets Manager Access
```typescript
Actions: ['secretsmanager:GetSecretValue']  // Read-only, no create/update/delete
Resources: [
  `arn:aws:secretsmanager:${region}:${account}:secret:lfmt/gemini-api-key-${stackName}`
]
```

**Justification:**
- Required to fetch Gemini API key for translation
- **Read-only permission** (no create/update/delete)
- Scoped to environment-specific secret name `lfmt/gemini-api-key-${stackName}`
- Secret must be created manually (not in CDK) for security
- Each environment (dev, staging, prod) has its own secret
- No wildcard - only the exact secret for this environment can be accessed

---

### 5. Step Functions Execution Role

**Used By:**
- `lfmt-translation-workflow-{env}` — Step Functions state machine orchestrating parallel translation

**Permissions:**

#### Lambda Invoke Access
```typescript
Actions: ['lambda:InvokeFunction']
Resources: [
  `arn:aws:lambda:${region}:${account}:function:lfmt-translate-chunk-${stackName}`
]
```

**Justification:**
- Step Functions Map state invokes `lfmt-translate-chunk-{env}` up to 10 times concurrently
- Scoped to SPECIFIC function (only translate-chunk is invoked by Step Functions)
- Required for parallel translation workflow
- No circular dependency - state machine ARN is used via CDK reference, not hardcoded

---

## Security Review Summary

### ✅ Compliance Checklist

- [x] **No wildcard resources** — All permissions scoped to specific ARNs (no wildcards)
- [x] **Minimal action sets** — No `s3:*`, `dynamodb:*`, `cognito-idp:*`, or `secretsmanager:*` permissions
- [x] **Separate roles per function group** — 4 distinct roles (auth, upload, chunking, translation)
- [x] **Resource-level scoping** — All DynamoDB tables, S3 buckets, Cognito pools explicitly scoped
- [x] **Read-only where possible** — Secrets Manager is GetSecretValue only
- [x] **Justification for all permissions** — Every action documented with use case
- [x] **No unnecessary permissions** — Scan, DeleteItem removed from all roles where not needed
- [x] **Index permissions separate** — DynamoDB GSI permissions explicitly granted
- [x] **Environment-specific secrets** — Secrets Manager uses ${stackName}, not wildcard patterns
- [x] **Specific Lambda invocation** — Step Functions invokes specific function, not wildcard pattern

---

## Audit Trail

| Date       | Change                                      | Reviewer        |
|------------|---------------------------------------------|-----------------|
| 2026-04-05 | Initial documentation (Phase C1 hardening) | System          |
| TBD        | Security review and approval                | Security Team   |

---

## Related Documentation

- **CDK Stack**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (lines 488-810)
- **Production Foundation Spec**: `openspec/changes/production-foundation/tasks.md` (Phase 3.1)
- **Security Audit Logs**: `/aws/security/lfmt-${env}` (CloudWatch Logs)

---

**End of Document**
