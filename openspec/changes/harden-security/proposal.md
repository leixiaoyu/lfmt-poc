# Proposal: Harden Security

**Change ID**: `harden-security`
**Status**: Proposed
**Priority**: P1 - HIGH (Critical Security Vulnerabilities)
**Related Issues**: #11, #14
**Owner**: xlei-raymond (Principal Engineer / Team Lead)
**Created**: 2025-11-08

## Problem Statement

Two critical security vulnerabilities create unacceptable risk:

### Issue #11: High-Risk CORS Vulnerability in API Handlers
- **Severity**: CRITICAL
- **Impact**: Wildcard CORS allows any origin to access API
- **Risk**: Cross-site scripting attacks, data exfiltration
- **Attack Vector**: Malicious sites can make authenticated requests

### Issue #14: Overly Permissive IAM Role Increases Blast Radius
- **Severity**: HIGH
- **Impact**: Lambda execution role has excessive permissions
- **Risk**: Compromised Lambda can access unrelated resources
- **Principle Violated**: Least privilege

## Proposed Solution

### 1. Fix CORS Configuration (#11)

**Current (Insecure)**:
```typescript
headers: {
  'Access-Control-Allow-Origin': '*',  // ❌ WILDCARD
  'Access-Control-Allow-Credentials': 'true'  // ❌ DANGEROUS COMBO
}
```

**Proposed (Secure)**:
```typescript
const allowedOrigins = [
  'https://prod.lfmt.example.com',
  'https://dev.lfmt.example.com',
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
].filter(Boolean);

const origin = event.headers.origin || event.headers.Origin;

headers: {
  'Access-Control-Allow-Origin': allowedOrigins.includes(origin) ? origin : allowedOrigins[0],
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}
```

### 2. Scope Down IAM Permissions (#14)

**Current (Over-Permissive)**:
```typescript
new PolicyStatement({
  actions: ['dynamodb:*', 's3:*', 'cognito-idp:*'],  // ❌ TOO BROAD
  resources: ['*']  // ❌ WILDCARD
})
```

**Proposed (Least Privilege)**:
```typescript
// DynamoDB: Only jobs and chunks tables
new PolicyStatement({
  actions: [
    'dynamodb:GetItem',
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:Query'
  ],
  resources: [
    jobsTable.tableArn,
    chunksTable.tableArn,
    `${jobsTable.tableArn}/index/*`,
    rateLimitTable.tableArn
  ]
})

// S3: Only specific buckets with required operations
new PolicyStatement({
  actions: [
    's3:GetObject',
    's3:PutObject',
    's3:DeleteObject'
  ],
  resources: [
    `${uploadsBucket.bucketArn}/*`,
    `${chunksBucket.bucketArn}/*`,
    `${resultsBucket.bucketArn}/*`
  ]
})

// Cognito: Only user lookup operations
new PolicyStatement({
  actions: [
    'cognito-idp:GetUser',
    'cognito-idp:AdminGetUser'
  ],
  resources: [userPool.userPoolArn]
})
```

## Implementation Plan

### Task 1: Fix CORS (#11) - 3 hours
1. Define allowed origins in environment variables
2. Update all Lambda handlers with origin validation
3. Add CORS validation tests
4. Deploy and verify with security scan

### Task 2: Scope IAM Permissions (#14) - 4 hours
1. Audit current IAM policies
2. Identify minimum required permissions per Lambda
3. Update CDK IAM role definitions
4. Test all Lambda functions still work
5. Run security audit

## Success Criteria

- ✅ CORS only allows whitelisted origins
- ✅ No wildcard CORS with credentials
- ✅ IAM roles follow least privilege principle
- ✅ Each Lambda has only required permissions
- ✅ Security scan shows no CORS vulnerabilities
- ✅ All Lambda functions operate correctly with new permissions

## Security Validation

1. **CORS Testing**: Attempt request from unauthorized origin (should fail)
2. **IAM Testing**: Verify Lambdas cannot access unauthorized resources
3. **Penetration Test**: Run automated security scan
4. **Audit**: Review all IAM policies for wildcards

## Timeline

**Total Effort**: 1 day (7 hours)
**Target Completion**: Within 1 sprint
**Security Review**: Required before merge

## References

- **Team Lead Execution Plan**: project_priorities_proposal.md (Phase 2)
- **GitHub Issues**: #11 (CORS), #14 (IAM)
- **OWASP CORS**: https://owasp.org/www-community/attacks/csrf

---

**Status**: Proposed - Awaiting Security Review & Approval
**Next Step**: Security team review, then implementation
