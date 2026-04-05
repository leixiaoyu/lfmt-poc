# Deployment Runbook

**Last Updated**: 2025-04-05
**Owner**: DevOps Team
**Severity**: P2 (Standard operational procedure)

---

## Overview

This runbook covers the deployment process for LFMT infrastructure and application code to dev, staging, and production environments.

**Estimated Time**: 15-30 minutes per environment

---

## Prerequisites

- [ ] AWS CLI configured with appropriate credentials
- [ ] CDK CLI installed (`npm install -g aws-cdk`)
- [ ] Access to GitHub repository
- [ ] All tests passing locally (`npm test` in all packages)
- [ ] Code review approved (for staging/prod)

---

## Pre-Deployment Checklist

### 1. Verify Local Environment

```bash
# Check Node.js version (required: 18.x)
node --version

# Check AWS credentials
aws sts get-caller-identity

# Check CDK version
cdk --version
```

### 2. Run All Tests

```bash
# Backend tests
cd backend/functions
npm test

# Frontend tests
cd ../../frontend
npm test

# Integration tests (optional, time-consuming)
cd ../backend/functions
npm run test:integration
```

**Expected**: All tests pass (0 failures)

### 3. Build Frontend

```bash
cd frontend
npm run build
```

**Expected**: `dist/` directory created without errors

---

## Deployment Procedures

### Dev Environment Deployment

**Trigger**: Automatic on push to `main` branch (via GitHub Actions)

**Manual Deployment**:

```bash
# 1. Navigate to infrastructure directory
cd backend/infrastructure

# 2. Deploy CDK stack
npx cdk deploy --context environment=dev

# 3. Upload frontend assets to S3
cd ../../frontend
aws s3 sync dist/ s3://lfmt-frontend-lfmtpocdev/

# 4. Invalidate CloudFront cache
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
    --stack-name LfmtPocDev \
    --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDistributionId`].OutputValue' \
    --output text)
aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"
```

**Estimated Time**: 15 minutes

---

### Staging Environment Deployment

**Trigger**: Manual via GitHub Actions workflow

**Procedure**:

1. Go to GitHub Actions: https://github.com/leixiaoyu/lfmt-poc/actions
2. Select "Deploy to Staging" workflow
3. Click "Run workflow"
4. Select branch: `main`
5. Click "Run workflow" (green button)
6. Monitor deployment progress in GitHub Actions logs
7. After deployment completes, run smoke tests:

```bash
# Run smoke tests against staging
cd backend/functions
ENVIRONMENT=staging npm run test:smoke
```

**Estimated Time**: 20 minutes

---

### Production Environment Deployment

**Trigger**: Manual via GitHub Actions workflow (requires approval)

**Procedure**:

1. **Verify staging deployment successful**
   - Check CloudWatch dashboards for errors
   - Verify smoke tests passed in staging
   - Review recent commits for breaking changes

2. **Create deployment window**
   - Notify users of potential downtime (if applicable)
   - Schedule deployment during low-traffic period

3. **Deploy to production**
   ```bash
   # Option 1: Via GitHub Actions (recommended)
   # 1. Go to GitHub Actions
   # 2. Select "Deploy to Production" workflow
   # 3. Requires approval from project owner
   # 4. Monitor deployment progress

   # Option 2: Manual deployment
   cd backend/infrastructure
   npx cdk deploy --context environment=prod
   ```

4. **Run smoke tests**
   ```bash
   cd backend/functions
   ENVIRONMENT=prod npm run test:smoke
   ```

5. **Verify deployment**
   - Check CloudWatch alarms (should be green)
   - Test critical user journeys (login, upload, translation)
   - Monitor CloudWatch Logs for errors

**Estimated Time**: 30 minutes

---

## Post-Deployment Verification

### 1. Check CloudWatch Alarms

```bash
# List all alarms in alarm state
aws cloudwatch describe-alarms \
    --state-value ALARM \
    --query 'MetricAlarms[?Namespace==`AWS/ApiGateway` || Namespace==`AWS/Lambda`].AlarmName'
```

**Expected**: No alarms in ALARM state

### 2. Test API Endpoints

```bash
# Get API URL from CloudFormation outputs
API_URL=$(aws cloudformation describe-stacks \
    --stack-name LfmtPocDev \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text)

# Test health check (if implemented)
curl -X GET "${API_URL}health"

# Test authentication
curl -X POST "${API_URL}auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"TestPassword123!"}'
```

**Expected**: HTTP 200 responses

### 3. Check Frontend Availability

```bash
# Get CloudFront URL
FRONTEND_URL=$(aws cloudformation describe-stacks \
    --stack-name LfmtPocDev \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' \
    --output text)

# Test frontend (should return HTML)
curl -I $FRONTEND_URL
```

**Expected**: HTTP 200, Content-Type: text/html

---

## Rollback Procedures

### Automated Rollback (Recommended)

**If deployment fails or introduces critical bugs:**

1. **Rollback CDK stack**
   ```bash
   ./scripts/rollback-cdk-stack.sh LfmtPocDev
   # Follow prompts and monitor progress
   ```

2. **Rollback specific Lambda function** (if stack rollback not needed)
   ```bash
   # List available versions
   ./scripts/rollback-lambda.sh lfmt-translate-chunk-LfmtPocDev

   # Rollback to version 5
   ./scripts/rollback-lambda.sh lfmt-translate-chunk-LfmtPocDev 5
   ```

3. **Verify rollback successful**
   ```bash
   # Check CloudWatch alarms
   aws cloudwatch describe-alarms --state-value ALARM

   # Test critical endpoints
   curl -X GET "${API_URL}auth/me" -H "Authorization: Bearer <token>"
   ```

**Estimated Time**: 5-10 minutes

### Manual Rollback

**If automated rollback fails:**

1. Identify last stable Git commit:
   ```bash
   git log --oneline -n 10
   ```

2. Checkout previous commit:
   ```bash
   git checkout <previous-commit-sha>
   ```

3. Redeploy infrastructure:
   ```bash
   cd backend/infrastructure
   npx cdk deploy --context environment=dev
   ```

4. Redeploy frontend:
   ```bash
   cd ../../frontend
   npm run build
   aws s3 sync dist/ s3://lfmt-frontend-lfmtpocdev/
   aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"
   ```

**Estimated Time**: 20 minutes

---

## Database Migration Rollback

**If database schema changes cause issues:**

```bash
# Restore DynamoDB table to point-in-time
./scripts/rollback-database.sh lfmt-jobs-LfmtPocDev "2025-04-05T10:30:00Z"

# Follow manual steps in script output to swap tables
```

**Estimated Time**: 10-15 minutes (restore) + manual steps

---

## Troubleshooting

### Issue: CDK deployment fails with "Stack is in UPDATE_ROLLBACK_FAILED state"

**Solution**:
```bash
# Continue rollback
aws cloudformation continue-update-rollback --stack-name LfmtPocDev

# Monitor progress
./scripts/rollback-cdk-stack.sh LfmtPocDev
```

### Issue: CloudFront invalidation not working (old content still served)

**Solution**:
```bash
# Force invalidate all paths
aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/*"

# Wait 5-10 minutes for propagation
```

### Issue: Lambda function has high error rate after deployment

**Solution**:
```bash
# Check CloudWatch Logs
aws logs tail /aws/lambda/lfmt-translate-chunk-LfmtPocDev --follow

# Rollback Lambda to previous version
./scripts/rollback-lambda.sh lfmt-translate-chunk-LfmtPocDev <previous-version>
```

---

## Emergency Contact

- **Primary**: DevOps Team (devops@yourcompany.com)
- **Secondary**: Project Owner (raymond@yourcompany.com)
- **Escalation**: AWS Support (if infrastructure issues)

---

## Appendix

### Useful AWS CLI Commands

```bash
# List all Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `lfmt-`)].FunctionName'

# Get Lambda function configuration
aws lambda get-function --function-name lfmt-translate-chunk-LfmtPocDev

# List DynamoDB tables
aws dynamodb list-tables --query 'TableNames[?starts_with(@, `lfmt-`)]'

# Get S3 bucket details
aws s3 ls s3://lfmt-documents-lfmtpocdev/
```

### CloudFormation Stack Outputs

```bash
# Get all stack outputs
aws cloudformation describe-stacks \
    --stack-name LfmtPocDev \
    --query 'Stacks[0].Outputs'
```
