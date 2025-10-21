# Production Deployment Guide

Complete guide for deploying LFMT POC to production with CI/CD enabled.

## Table of Contents

1. [Pre-Deployment Checklist](#pre-deployment-checklist)
2. [AWS Account Setup](#aws-account-setup)
3. [GitHub Setup](#github-setup)
4. [Production Deployment](#production-deployment)
5. [Post-Deployment Verification](#post-deployment-verification)
6. [Monitoring and Maintenance](#monitoring-and-maintenance)
7. [Rollback Procedures](#rollback-procedures)
8. [Troubleshooting](#troubleshooting)

---

## Pre-Deployment Checklist

### Code Quality
- [ ] All tests passing (31/31)
- [ ] No TypeScript compilation errors
- [ ] Security scan completed
- [ ] Code review approved
- [ ] Documentation up to date

### AWS Prerequisites
- [ ] Production AWS account created
- [ ] Account ID documented: `_________________`
- [ ] IAM permissions configured
- [ ] Budget alerts configured
- [ ] CloudTrail enabled
- [ ] Region selected: `us-east-1` (recommended)

### GitHub Prerequisites
- [ ] Repository: `github.com/leixiaoyu/lfmt-poc`
- [ ] Protected branch rules configured for `main`
- [ ] GitHub Actions enabled
- [ ] Secrets configured (see below)

### Security Prerequisites
- [ ] Static credentials removed (✅ already done)
- [ ] Sensitive IDs redacted (✅ already done)
- [ ] `.env.local` never committed (✅ verified)
- [ ] Secret scanning enabled (✅ already done)

---

## AWS Account Setup

### Step 1: Create OIDC Provider for GitHub Actions

```bash
# 1. Create OIDC provider
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# 2. Verify creation
aws iam list-open-id-connect-providers
```

**Expected Output:**
```
arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com
```

### Step 2: Create IAM Role for GitHub Actions

Create file `github-actions-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:leixiaoyu/lfmt-poc:*"
        }
      }
    }
  ]
}
```

**Create the role:**

```bash
# Replace YOUR_ACCOUNT_ID with your actual account ID
sed -i '' 's/YOUR_ACCOUNT_ID/XXXXXXXXXXXX/g' github-actions-trust-policy.json

# Create role
aws iam create-role \
  --role-name GitHubActionsLFMTProd \
  --assume-role-policy-document file://github-actions-trust-policy.json \
  --description "Role for GitHub Actions to deploy LFMT POC to production"

# Get role ARN (save this for GitHub secrets)
aws iam get-role --role-name GitHubActionsLFMTProd --query 'Role.Arn' --output text
```

### Step 3: Attach Permissions to Role

```bash
# Attach AdministratorAccess (for initial setup)
# For production, use least-privilege custom policy
aws iam attach-role-policy \
  --role-name GitHubActionsLFMTProd \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**Production Note:** Replace `AdministratorAccess` with a custom policy that includes only:
- CloudFormation full access
- S3 access for CDK assets
- Lambda deployment permissions
- DynamoDB access
- Cognito access
- API Gateway access
- CloudWatch Logs access
- IAM role creation (for Lambda execution roles)

### Step 4: Configure AWS Budget Alerts

```bash
# Create a budget for production environment
aws budgets create-budget \
  --account-id YOUR_ACCOUNT_ID \
  --budget file://production-budget.json
```

**production-budget.json:**
```json
{
  "BudgetName": "LFMT-Production-Monthly",
  "BudgetLimit": {
    "Amount": "100",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST",
  "CostFilters": {
    "TagKeyValue": ["user:Environment$production"]
  }
}
```

---

## GitHub Setup

### Step 1: Configure GitHub Environments

Navigate to: `Settings → Environments → New environment`

**Create Production Environment:**
- Name: `production`
- Protection rules:
  - ✅ Required reviewers: 1 (add yourself)
  - ✅ Wait timer: 0 minutes (or 5 for extra safety)
  - ✅ Deployment branches: Only `main` branch

### Step 2: Configure GitHub Secrets

Navigate to: `Settings → Secrets and variables → Actions → New repository secret`

**Required Secret:**

| Secret Name | Value | Description |
|------------|-------|-------------|
| `AWS_ROLE_ARN` | `arn:aws:iam::XXXXXXXXXXXX:role/GitHubActionsLFMTProd` | IAM role ARN from Step 2 |

**Verification:**
```bash
# List secrets (names only)
gh secret list
```

### Step 3: Enable Branch Protection

Navigate to: `Settings → Branches → Add rule`

**Branch name pattern:** `main`

**Protection rules:**
- ✅ Require a pull request before merging
- ✅ Require approvals: 1
- ✅ Require status checks to pass before merging
  - ✅ Require branches to be up to date
  - Status checks: `test`, `build-infrastructure`
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings

---

## Production Deployment

### Option 1: GitHub Actions (Recommended)

#### Trigger Manual Deployment

1. Navigate to: `Actions → Deploy LFMT Infrastructure → Run workflow`
2. Select branch: `main`
3. Select environment: `prod`
4. Click `Run workflow`

#### Monitor Deployment

```bash
# Watch workflow in real-time
gh run watch
```

**Deployment Steps:**
1. ✅ Run tests (11 shared-types + 20 infrastructure)
2. ✅ Build infrastructure
3. ✅ Verify AWS identity
4. ✅ Install dependencies
5. ✅ CDK bootstrap (if needed)
6. ✅ CDK diff (show changes)
7. ✅ Deploy main infrastructure
8. ✅ Health check
9. ✅ Deployment summary

**Expected Duration:** 8-12 minutes

### Option 2: Manual Deployment (Emergency)

If GitHub Actions is unavailable:

```bash
# 1. Assume the deployment role
aws sts assume-role-with-web-identity \
  --role-arn arn:aws:iam::XXXXXXXXXXXX:role/GitHubActionsLFMTProd \
  --role-session-name manual-deployment \
  --web-identity-token $(gh auth token)

# 2. Configure credentials from assume-role output
export AWS_ACCESS_KEY_ID="..."
export AWS_SECRET_ACCESS_KEY="..."
export AWS_SESSION_TOKEN="..."

# 3. Navigate to infrastructure
cd backend/infrastructure

# 4. Install dependencies
npm ci

# 5. Bootstrap CDK (first time only)
npx cdk bootstrap --context environment=prod

# 6. Show changes
npx cdk diff --context environment=prod

# 7. Deploy
npx cdk deploy LfmtPocProd --context environment=prod
```

---

## Post-Deployment Verification

### Step 1: Verify CloudFormation Stacks

```bash
# List stacks
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[?contains(StackName, `LfmtPocProd`)].StackName' \
  --output table

# Get stack outputs
aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query 'Stacks[0].Outputs' \
  --output table
```

**Expected Outputs:**
- `ApiUrl`: API Gateway endpoint
- `UserPoolId`: Cognito User Pool ID
- `UserPoolClientId`: Cognito Client ID
- `DocumentBucketName`: S3 bucket for documents
- `ResultsBucketName`: S3 bucket for results

### Step 2: Test API Endpoints

```bash
# Get API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text)

# Test health endpoint (if exists)
curl -X GET "${API_URL}/v1/health"

# Test CORS
curl -X OPTIONS "${API_URL}/v1/auth/register" \
  -H "Origin: https://your-frontend-domain.com" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

### Step 3: Test User Registration

```bash
# Register test user
curl -X POST "${API_URL}/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test-prod@example.com",
    "password": "TestProd123!",
    "confirmPassword": "TestProd123!",
    "firstName": "Test",
    "lastName": "User",
    "acceptedTerms": true,
    "acceptedPrivacy": true
  }'
```

**Expected Response:** `201 Created` with user object

### Step 4: Verify DynamoDB Tables

```bash
# List tables
aws dynamodb list-tables \
  --query 'TableNames[?contains(@, `lfmt`) && contains(@, `Prod`)]' \
  --output table

# Describe tables
aws dynamodb describe-table --table-name lfmt-jobs-LfmtPocProd
aws dynamodb describe-table --table-name lfmt-users-LfmtPocProd
aws dynamodb describe-table --table-name lfmt-attestations-LfmtPocProd
```

### Step 5: Verify S3 Buckets

```bash
# List buckets
aws s3 ls | grep lfmt | grep prod

# Check bucket encryption
aws s3api get-bucket-encryption \
  --bucket lfmt-documents-lfmtpocprod-XXXX
```

### Step 6: Verify Cognito

```bash
# Get User Pool details
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
  --output text)

aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID
```

---

## Monitoring and Maintenance

### CloudWatch Dashboards

Create production monitoring dashboard:

1. Navigate to CloudWatch → Dashboards → Create dashboard
2. Name: `LFMT-Production`
3. Add widgets:
   - API Gateway 4XX/5XX errors
   - Lambda invocations and errors
   - DynamoDB read/write capacity
   - Cognito sign-ups and sign-ins

### CloudWatch Alarms

```bash
# Create alarm for API Gateway 5XX errors
aws cloudwatch put-metric-alarm \
  --alarm-name LFMT-Prod-API-5XX-Errors \
  --alarm-description "Alert on API Gateway 5XX errors" \
  --metric-name 5XXError \
  --namespace AWS/ApiGateway \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

### Log Aggregation

```bash
# Tail Lambda logs
aws logs tail /aws/lambda/lfmt-register-LfmtPocProd --follow

# Query logs for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/lfmt-register-LfmtPocProd \
  --filter-pattern "ERROR"
```

---

## Rollback Procedures

### Option 1: Rollback via GitHub Actions

1. Navigate to previous successful deployment in Actions
2. Click "Re-run jobs"
3. Confirm deployment

### Option 2: Manual Rollback

```bash
# List stack history
aws cloudformation list-stack-resources \
  --stack-name LfmtPocProd

# Rollback to previous version
aws cloudformation rollback-stack --stack-name LfmtPocProd
```

### Option 3: CDK Rollback

```bash
cd backend/infrastructure

# Checkout previous version
git checkout <previous-commit-sha>

# Deploy previous version
npx cdk deploy LfmtPocProd --context environment=prod
```

---

## Troubleshooting

### Deployment Fails with "Role Cannot Be Assumed"

**Cause:** OIDC provider or IAM role misconfigured

**Solution:**
```bash
# Verify OIDC provider
aws iam list-open-id-connect-providers

# Verify role trust policy
aws iam get-role --role-name GitHubActionsLFMTProd
```

### CDK Bootstrap Fails

**Cause:** Insufficient permissions

**Solution:**
```bash
# Check current identity
aws sts get-caller-identity

# Verify AdministratorAccess attached
aws iam list-attached-role-policies --role-name GitHubActionsLFMTProd
```

### API Gateway Returns 403 Forbidden

**Cause:** CORS misconfiguration or API key required

**Solution:**
- Verify CORS headers in API Gateway console
- Check API Gateway resource policies
- Verify Lambda execution role permissions

### Cognito User Registration Fails

**Cause:** Password policy not met or email already exists

**Solution:**
```bash
# Check user pool password policy
aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID \
  --query 'UserPool.Policies.PasswordPolicy'

# List existing users
aws cognito-idp list-users --user-pool-id $USER_POOL_ID
```

---

## Production Checklist Summary

After deployment, verify all items:

- [ ] CloudFormation stack created successfully
- [ ] All Lambda functions deployed
- [ ] DynamoDB tables created with encryption
- [ ] S3 buckets created with proper policies
- [ ] Cognito User Pool configured
- [ ] API Gateway accessible
- [ ] CORS configured correctly
- [ ] Test user registration successful
- [ ] Test user login successful
- [ ] CloudWatch logs flowing
- [ ] Budget alerts configured
- [ ] CloudTrail logging enabled
- [ ] GuardDuty monitoring active
- [ ] WAF rules applied
- [ ] Monitoring dashboard created
- [ ] Alarms configured
- [ ] Documentation updated

---

## Additional Resources

- [AWS Well-Architected Framework](https://aws.amazon.com/architecture/well-architected/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [Production Security Guide](./PRODUCTION-SECURITY-DEPLOYMENT.md)
- [Security Policy](./SECURITY.md)

## Support Contacts

- **Security**: `leixiaoyu@users.noreply.github.com`
- **Repository**: https://github.com/leixiaoyu/lfmt-poc
- **Documentation**: This repository

---

**Last Updated**: 2025-10-21
**Version**: 1.0
**Environment**: Production
