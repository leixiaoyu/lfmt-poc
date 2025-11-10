# Design Document: Add CloudFront Distribution to CDK Infrastructure

## Context

### Background
The LFMT POC currently uses a manually-created CloudFront distribution (`d1yysvwo9eg20b.cloudfront.net`) for frontend hosting. This distribution was created outside of the CDK infrastructure stack, leading to:
- Configuration drift (manual AWS CLI updates not tracked in git)
- Hardcoded URLs in multiple locations (API Gateway CORS, deployment workflow, E2E tests)
- No disaster recovery capability (cannot recreate if deleted)
- Inconsistent configuration across environments

### Recent Trigger
The CloudFront 403 error fix (PR #54) exposed this technical debt:
- Required manual `aws cloudfront update-distribution` command to add 403 error handling
- Configuration change not version-controlled
- Cannot replicate fix across dev/staging/prod environments
- Team lead (xlei-raymond) identified this as highest priority for infrastructure team

### Stakeholders
- **Infrastructure Team**: Responsible for CDK stack and IaC best practices
- **Frontend Team**: Depends on CloudFront for SPA hosting and CORS configuration
- **DevOps Team**: Manages CI/CD pipeline and deployment automation
- **Security Team**: Requires security headers and HTTPS enforcement

## Goals / Non-Goals

### Goals
1. **Version Control**: All CloudFront configuration tracked in git via CDK
2. **Reproducibility**: Recreate entire infrastructure from code in any environment
3. **Environment Parity**: Consistent configuration across dev/staging/prod
4. **Automation**: CloudFront updates via standard CDK deployment workflow
5. **Security**: CloudFront config reviewed and validated like any code change

### Non-Goals
1. **Custom Domain**: Not adding Route 53 custom domain (e.g., `app.lfmt.com`) in this change - use CloudFront default domain for POC
2. **WAF Integration**: Not adding AWS WAF rules (future enhancement if needed)
3. **Lambda@Edge**: Not adding Lambda@Edge functions for request/response manipulation
4. **Multi-Region**: Not implementing multi-region CloudFront distribution (single region for POC)
5. **CDN Analytics**: Not adding detailed CloudFront analytics (use basic CloudWatch metrics)

## Decisions

### Decision 1: Use Origin Access Control (OAC) Instead of Origin Access Identity (OAI)
**What**: Configure CloudFront with Origin Access Control (OAC), the newer AWS-recommended method.

**Why**:
- **OAC is the successor to OAI** (OAI is legacy, OAC is preferred)
- **Better security**: Supports additional signature versions (SigV4)
- **Broader support**: Works with all S3 bucket features (encryption, versioning)
- **AWS Recommendation**: AWS recommends migrating from OAI to OAC

**Alternatives Considered**:
1. **Origin Access Identity (OAI)**: Legacy approach, still works but deprecated
2. **Public S3 Bucket**: Would work but violates least-privilege security principle
3. **S3 Website Endpoint**: Simpler but doesn't support HTTPS, blocks public access

**Trade-offs**:
- OAC requires slightly more complex bucket policy configuration
- OAC is newer, less documented than OAI (but AWS docs are sufficient)

**Implementation**:
```typescript
// CDK code snippet
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';

const oac = new cloudfront.OriginAccessControl(this, 'FrontendOAC', {
  originAccessControlOriginType: cloudfront.OriginAccessControlOriginType.S3,
  signing: cloudfront.Signing.SIGV4_ALWAYS,
});

const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(frontendBucket, {
      originAccessControl: oac,
    }),
  },
});
```

### Decision 2: Handle Both 403 and 404 Errors for SPA Routing
**What**: Configure custom error responses for both HTTP 403 and HTTP 404 errors to serve `/index.html` with 200 status.

**Why**:
- **S3 bucket behavior**: Restricted access buckets return 403 (not 404) for non-existent objects
- **SPA routing requirement**: All paths must serve `index.html` for React Router to work
- **Discovered in production**: PR #54 investigation revealed 403 was the actual error, not 404

**Alternatives Considered**:
1. **Only handle 404 errors**: Insufficient - S3 returns 403 for restricted buckets
2. **Make bucket public**: Works but violates security best practice
3. **S3 website endpoint**: Doesn't support HTTPS, blocks CloudFront OAC

**Trade-offs**:
- Slightly more complex CloudFront configuration (2 error responses instead of 1)
- Users receive 200 OK for non-existent routes (instead of 404), but this is standard SPA behavior

**Implementation**:
```typescript
const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
  errorResponses: [
    {
      httpStatus: 403,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: Duration.minutes(5),
    },
    {
      httpStatus: 404,
      responseHttpStatus: 200,
      responsePagePath: '/index.html',
      ttl: Duration.minutes(5),
    },
  ],
});
```

### Decision 3: Use Blue-Green Deployment Strategy for Migration
**What**: Create new CloudFront distribution via CDK while keeping old manual distribution active, then switch traffic after validation.

**Why**:
- **Zero downtime**: Old distribution stays active during new distribution creation
- **Easy rollback**: Can revert to old distribution if issues discovered
- **Gradual validation**: Test new distribution thoroughly before switching DNS/traffic
- **Risk mitigation**: 30-day grace period before deleting old distribution

**Alternatives Considered**:
1. **Direct replacement**: Delete old distribution, create new one - causes downtime
2. **In-place update**: Update existing distribution via CDK import - risky, harder to rollback
3. **Canary deployment**: Gradual traffic shift - overly complex for POC

**Trade-offs**:
- Temporarily managing two CloudFront distributions (increased complexity)
- Need to manually delete old distribution after grace period (extra cleanup step)

**Migration Steps**:
1. Deploy new CloudFront distribution via CDK (GREEN)
2. Deploy frontend to new S3 bucket
3. Test GREEN distribution with E2E tests
4. Update deployment workflow to use GREEN distribution
5. Monitor for 24 hours
6. Delete old manual distribution (BLUE) after 30-day grace period

### Decision 4: Environment-Specific CloudFront Configuration
**What**: Use CDK context (`environment`) to configure CloudFront differently for dev/staging/prod.

**Why**:
- **Cost optimization**: Dev environment doesn't need global edge locations
- **Iteration speed**: Dev environment can use lower TTL for faster cache updates
- **Production reliability**: Prod environment needs access logging and RETAIN removal policy

**Alternatives Considered**:
1. **Identical configuration**: Simpler but wastes money in dev environment
2. **Separate stacks**: More flexible but increases maintenance burden
3. **Manual configuration**: Defeats purpose of IaC

**Trade-offs**:
- Slight risk of environment configuration drift (dev vs prod not identical)
- Need to test configuration changes in dev before prod (standard practice anyway)

**Configuration Differences**:
| Setting | Dev | Production |
|---------|-----|------------|
| Edge Locations | North America, Europe (cost-optimized) | Global (all edge locations) |
| Cache TTL | Lower (faster iteration) | Optimized (balance freshness/cost) |
| Removal Policy | DESTROY (allow stack deletion) | RETAIN (prevent accidental deletion) |
| Access Logging | Disabled (save costs) | Enabled (audit and analytics) |

### Decision 5: Automate CloudFront Invalidation in Deployment Workflow
**What**: Automatically create CloudFront invalidation (`/*`) after frontend deployment to S3.

**Why**:
- **Immediate updates**: Users receive latest frontend version without waiting for cache expiration
- **Automation**: No manual CloudFront console access required
- **Consistency**: Same invalidation process across all environments

**Alternatives Considered**:
1. **No invalidation**: Rely on cache TTL - slow (could take hours for users to see updates)
2. **Versioned file names**: Webpack hash-based filenames - works but index.html still needs invalidation
3. **Manual invalidation**: Error-prone, requires remembering to do it

**Trade-offs**:
- CloudFront invalidation cost: First 1,000 invalidations/month free, then $0.005 per path
- Invalidation takes 3-15 minutes to complete (deployment slightly slower)

**Implementation**:
```bash
# In .github/workflows/deploy.yml
- name: Invalidate CloudFront cache
  run: |
    DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
      --stack-name lfmt-infrastructure-dev \
      --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
      --output text)

    aws cloudfront create-invalidation \
      --distribution-id $DISTRIBUTION_ID \
      --paths "/*"
```

## Technical Architecture

### Component Overview
```
┌─────────────────────────────────────────────────────────────┐
│                    CDK Infrastructure Stack                  │
│                                                             │
│  ┌────────────────┐         ┌────────────────┐            │
│  │  Frontend      │◄────────│  CloudFront    │            │
│  │  S3 Bucket     │   OAC   │  Distribution  │            │
│  │                │         │                │            │
│  │ - Block Public │         │ - HTTPS Only   │            │
│  │ - Versioning   │         │ - Error: 403→  │            │
│  │ - Lifecycle    │         │   /index.html  │            │
│  └────────────────┘         │ - Error: 404→  │            │
│                             │   /index.html  │            │
│                             │ - Security Hdrs│            │
│                             └────────┬───────┘            │
│                                      │                     │
│  ┌────────────────┐                 │                     │
│  │  API Gateway   │                 │                     │
│  │                │                 │                     │
│  │ - CORS Origins:│◄────────────────┘                    │
│  │   - CloudFront │   (from stack outputs)               │
│  │   - localhost  │                                       │
│  └────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘

         ▲                                    ▲
         │                                    │
    Users (via                          CI/CD Deployment
    browser)                             - S3 sync
                                        - CloudFront invalidation
```

### Request Flow

#### 1. Root Path Request (`/`)
```
User Browser → https://d1abc123.cloudfront.net/
             ↓
CloudFront checks cache → MISS (first request or expired)
             ↓
CloudFront requests /index.html from S3 via OAC
             ↓
S3 returns /index.html with 200 OK
             ↓
CloudFront caches response (default TTL)
             ↓
CloudFront adds security headers
             ↓
Returns index.html to user with 200 OK
             ↓
React app loads, React Router redirects to /login
```

#### 2. Direct Navigation to SPA Route (`/dashboard`)
```
User Browser → https://d1abc123.cloudfront.net/dashboard
             ↓
CloudFront checks cache → MISS
             ↓
CloudFront requests /dashboard from S3 via OAC
             ↓
S3 returns 403 Forbidden (object doesn't exist + restricted bucket)
             ↓
CloudFront matches custom error response (403 → /index.html)
             ↓
CloudFront serves /index.html with 200 OK to client
             ↓
React app loads, React Router renders /dashboard component
             ↓
User sees dashboard page (authenticated or redirected to login)
```

#### 3. API Request from Frontend
```
React App (frontend) → API call to /auth/login
             ↓
axios includes Authorization header (if authenticated)
             ↓
Request goes to API Gateway (https://abc123.execute-api.us-east-1.amazonaws.com)
             ↓
API Gateway checks CORS Origin header
             ↓
Origin header matches CloudFront URL in allowed origins ✓
             ↓
API Gateway invokes Lambda function
             ↓
Lambda processes request, returns response
             ↓
API Gateway adds CORS headers to response
             ↓
React app receives response and updates UI
```

### Infrastructure Code Structure

```
backend/infrastructure/lib/lfmt-infrastructure-stack.ts
│
├── constructor()
│   ├── ... (existing initialization)
│   ├── createFrontendHosting(removalPolicy)  ← NEW METHOD
│   └── ... (existing methods)
│
├── createFrontendHosting(removalPolicy: RemovalPolicy)  ← NEW METHOD
│   ├── Create frontend S3 bucket
│   ├── Create CloudFront Origin Access Control (OAC)
│   ├── Create CloudFront distribution
│   │   ├── S3 origin with OAC
│   │   ├── Custom error responses (403, 404)
│   │   ├── Cache behaviors
│   │   ├── Security headers (response headers policy)
│   │   └── Environment-specific configuration
│   └── Grant CloudFront OAC access to S3 bucket
│
├── createApiGateway()  ← MODIFY EXISTING METHOD
│   ├── ... (existing API Gateway setup)
│   └── Update getAllowedApiOrigins() to use CloudFront from outputs
│
└── createOutputs()  ← MODIFY EXISTING METHOD
    ├── ... (existing outputs)
    ├── FrontendBucketName  ← NEW OUTPUT
    ├── CloudFrontDistributionId  ← NEW OUTPUT
    ├── CloudFrontDistributionDomain  ← NEW OUTPUT
    └── FrontendUrl  ← NEW OUTPUT
```

## Risks / Trade-offs

### Risk 1: CloudFront Distribution Creation Slow
**Risk**: CloudFront distributions take 5-15 minutes to deploy (global edge location propagation)

**Impact**: Medium - Longer initial deployment time

**Mitigation**:
- Document expected deployment time in README
- CI/CD pipeline shows progress indicator
- Dev environment uses cost-optimized edge locations (faster deployment)

### Risk 2: Hardcoded URLs Still Present After Migration
**Risk**: Missing some hardcoded CloudFront URLs during migration, causing runtime errors

**Impact**: High - Application breakage in production

**Mitigation**:
- Comprehensive code search for hardcoded URLs: `rg "d1yysvwo9eg20b.cloudfront.net"`
- E2E tests validate frontend-to-backend connectivity
- Gradual blue-green deployment allows rollback if issues discovered
- Test thoroughly in dev environment before prod migration

### Risk 3: S3 Bucket Policy Misconfiguration
**Risk**: Incorrectly configured bucket policy could allow public access or block CloudFront

**Impact**: High - Security vulnerability or application breakage

**Mitigation**:
- Use CDK L2 construct for CloudFront distribution (handles OAC policy automatically)
- Infrastructure tests validate public access is blocked
- Manual smoke test after deployment (verify CloudFront access works, direct S3 access denied)
- AWS Config rules detect public buckets (if enabled)

### Risk 4: Cache Invalidation Delays
**Risk**: CloudFront invalidation takes 3-15 minutes, users may see stale content immediately after deployment

**Impact**: Low - Cosmetic issue, not functional breakage

**Mitigation**:
- Document invalidation timing in deployment guide
- E2E tests wait for invalidation completion before running
- Consider versioned file names for critical assets (future enhancement)
- Cache TTL already set to 5 minutes for error responses

### Risk 5: Blue-Green Deployment Coordination
**Risk**: Confusion during migration about which distribution is active (BLUE vs GREEN)

**Impact**: Medium - Potential downtime if wrong distribution deleted

**Mitigation**:
- Create detailed migration runbook with step-by-step instructions
- Tag CloudFront distributions clearly (`Environment: dev-BLUE`, `Environment: dev-GREEN`)
- 30-day grace period before deleting old distribution (ample rollback time)
- Document rollback procedure in advance

## Migration Plan

### Phase 1: Pre-Migration (Day 1, 1 hour)
1. **Audit Current State**:
   - Document current manual CloudFront distribution ID: `EY0NDD10UXFN4`
   - Export current distribution config: `aws cloudfront get-distribution-config --id EY0NDD10UXFN4 > cloudfront-backup.json`
   - List all hardcoded URLs in codebase: `rg "d1yysvwo9eg20b.cloudfront.net"`

2. **Prepare Team**:
   - Notify team of planned infrastructure change
   - Schedule migration window (low-traffic period)
   - Assign rollback owner (on-call engineer)

3. **Set Up Monitoring**:
   - Create CloudWatch dashboard for CloudFront metrics
   - Set up alarms for 5XX errors
   - Configure Slack/email notifications

### Phase 2: Dev Environment Migration (Day 1-2, 6 hours)
1. **Deploy New CloudFront via CDK**:
   ```bash
   cd backend/infrastructure
   npx cdk deploy --context environment=dev
   ```
   - Expected: New CloudFront distribution created (GREEN)
   - Retrieve new CloudFront URL from stack outputs

2. **Deploy Frontend to New S3 Bucket**:
   ```bash
   npm run build
   aws s3 sync frontend/dist s3://lfmt-frontend-dev/ --delete
   aws cloudfront create-invalidation --distribution-id <NEW_ID> --paths "/*"
   ```

3. **Test New Distribution**:
   - Manual smoke tests (login, upload, translation)
   - E2E test suite against new CloudFront URL
   - Verify API Gateway CORS works with new origin
   - Test SPA routing (403 fix validation)

4. **Update Deployment Workflow**:
   - Modify `.github/workflows/deploy.yml` to use CDK outputs
   - Test workflow on feature branch
   - Merge to main after validation

5. **Monitor for 24 Hours**:
   - Watch CloudWatch metrics for errors
   - Check user feedback (if any)
   - Compare performance to old distribution

### Phase 3: Staging/Production Migration (Day 3-4, 4 hours each)
1. **Repeat Phase 2 for Staging**:
   - Deploy CDK stack to staging environment
   - Run full regression test suite
   - Validate performance and error rates

2. **Repeat Phase 2 for Production**:
   - Deploy CDK stack to production environment
   - Run smoke tests and E2E tests
   - Monitor for 48 hours before cleanup

### Phase 4: Cleanup (Day 30-35, 1 hour)
1. **Delete Old Manual Distribution** (after 30-day grace period):
   ```bash
   # First disable distribution
   aws cloudfront update-distribution --id EY0NDD10UXFN4 --distribution-config file://cloudfront-disabled.json

   # Wait for status: Deployed

   # Then delete
   aws cloudfront delete-distribution --id EY0NDD10UXFN4 --if-match <ETAG>
   ```

2. **Clean Up Code**:
   - Remove backup/rollback code
   - Archive `CLOUDFRONT-MIGRATION.md` to `docs/archive/`
   - Update project documentation

3. **Post-Migration Review**:
   - Document lessons learned
   - Update infrastructure runbooks
   - Share knowledge with team

### Rollback Procedure

If issues discovered after migration:

1. **Immediate Rollback** (< 5 minutes):
   ```bash
   # Revert deployment workflow to use old CloudFront URL
   git revert <COMMIT_SHA>
   git push origin main

   # Redeploy frontend to old S3 bucket (if still exists)
   aws s3 sync frontend/dist s3://old-frontend-bucket/ --delete
   ```

2. **API Gateway CORS Rollback**:
   ```bash
   # Manually update API Gateway CORS via AWS Console
   # OR
   # Revert CDK stack to previous version
   npx cdk deploy --context environment=dev
   ```

3. **Validate Rollback**:
   - Run E2E tests against old CloudFront URL
   - Check API Gateway CORS works with old origin
   - Monitor for 1 hour

4. **Post-Rollback**:
   - Create incident report
   - Identify root cause
   - Fix issues in development before retry

## Open Questions

### Q1: Should we use custom domain (e.g., `app.lfmt.com`) now or later?
**Answer**: Later (non-goal for this change). Use CloudFront default domain for POC. Can add Route 53 custom domain in future PR.

**Rationale**:
- Reduces scope of this change (avoid domain registration, DNS configuration, SSL certificate setup)
- CloudFront default domain works fine for POC
- Custom domain can be added later without disrupting existing functionality

### Q2: Should we enable CloudFront access logging?
**Answer**: Yes for production, no for dev/staging (cost optimization).

**Implementation**:
```typescript
const logBucket = new s3.Bucket(this, 'CloudFrontLogBucket', {
  // ... config
});

const distribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
  enableLogging: this.node.tryGetContext('environment') === 'prod',
  logBucket: this.node.tryGetContext('environment') === 'prod' ? logBucket : undefined,
});
```

### Q3: Should we version frontend assets with webpack hashes?
**Answer**: No (out of scope for this change, but recommended for future).

**Rationale**:
- Current Vite build already includes content hashes in filenames
- `index.html` still needs CloudFront invalidation
- Versioned assets provide better caching but require more complex deployment logic
- Can be added later as optimization

### Q4: How do we handle rollback if CDK stack fails to deploy?
**Answer**: CloudFormation automatic rollback handles most cases.

**Details**:
- CloudFormation automatically rolls back failed stack updates
- Manual rollback: `npx cdk deploy --rollback` (force rollback to previous version)
- Worst case: Delete entire stack and redeploy (acceptable for POC, not for production)

### Q5: Should we implement Lambda@Edge for advanced request handling?
**Answer**: No (out of scope, not needed for POC).

**Rationale**:
- Lambda@Edge adds complexity and cost
- Current SPA routing requirement met with custom error responses
- If future requirements need request/response manipulation, can add Lambda@Edge later
