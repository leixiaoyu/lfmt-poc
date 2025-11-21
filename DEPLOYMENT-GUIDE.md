# LFMT POC - Frontend Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the LFMT Translation UI frontend to AWS CloudFront/S3 infrastructure.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+ and npm installed
- Access to deployed AWS infrastructure (LfmtPocDev or LfmtPocProd stack)
- Proper IAM permissions for S3 and CloudFront operations

## Architecture

The frontend is deployed using:
- **S3 Bucket**: `lfmt-frontend-lfmtpocdev` (dev) or `lfmt-frontend-lfmtpocprod` (prod)
- **CloudFront Distribution**: CDK-managed distribution with OAC (Origin Access Control)
- **Build Tool**: Vite (React 18 + TypeScript)
- **Deployment Method**: AWS CLI (`aws s3 sync` + `aws cloudfront create-invalidation`)

## Environment Configuration

### Development Environment

**Configuration File**: `frontend/.env.dev`

```bash
# API Configuration
VITE_API_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1

# AWS Cognito Configuration
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_tyG2buO70
VITE_COGNITO_CLIENT_ID=4qlc7n27ptoad18k3rlj1nipg7
VITE_COGNITO_DOMAIN=lfmt-lfmtpocdev-ndi3mjyy

# Environment
VITE_APP_ENV=development
VITE_APP_NAME=LFMT Translation Service (Dev)

# Feature Flags
VITE_MOCK_API=false
VITE_FEATURE_DARK_MODE=false
```

### Production Environment

**Configuration File**: `frontend/.env.production`

```bash
# API Configuration
VITE_API_URL=https://8d2ana56e4.execute-api.us-east-1.amazonaws.com/v1

# AWS Cognito Configuration
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_UaerObXsp
VITE_COGNITO_CLIENT_ID=6t6bqupshmg50hiktus46f32hc
VITE_COGNITO_DOMAIN=lfmt-lfmtpocprod-ndi3mjyy

# Environment
VITE_APP_ENV=production
VITE_APP_NAME=LFMT Translation Service

# Feature Flags
VITE_MOCK_API=false
VITE_FEATURE_DARK_MODE=false
```

## Deployment Steps

### Step 1: Prepare Environment Configuration

```bash
# For development deployment
cd frontend
cp .env.dev .env

# For production deployment
# cp .env.production .env
```

### Step 2: Install Dependencies and Build

```bash
# Install dependencies (if not already done)
npm ci

# Build the frontend application
npm run build
```

**Expected Output**:
```
vite v5.4.20 building for production...
✓ 11634 modules transformed.
✓ built in 3.02s
```

**Build Output Location**: `frontend/dist/`

### Step 3: Deploy to S3

```bash
# Get the frontend bucket name from CloudFormation stack outputs
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

echo "Deploying to S3 bucket: $BUCKET_NAME"

# Sync build artifacts to S3 (--delete removes old files)
aws s3 sync dist/ s3://$BUCKET_NAME/ --delete
```

**Expected Output**:
```
upload: dist/index.html to s3://lfmt-frontend-lfmtpocdev/index.html
upload: dist/assets/index-DJtU-4_z.js to s3://lfmt-frontend-lfmtpocdev/assets/index-DJtU-4_z.js
...
Completed 3.4 MiB/6.8 MiB (2.0 MiB/s)
```

### Step 4: Invalidate CloudFront Cache

```bash
# Get the CloudFront distribution ID from stack outputs
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)

echo "Invalidating CloudFront distribution: $DISTRIBUTION_ID"

# Create invalidation for all paths
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id $DISTRIBUTION_ID \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "Invalidation created: $INVALIDATION_ID"

# Wait for invalidation to complete (typically 3-5 minutes)
aws cloudfront wait invalidation-completed \
  --distribution-id $DISTRIBUTION_ID \
  --id $INVALIDATION_ID

echo "Invalidation completed!"
```

### Step 5: Verify Deployment

```bash
# Get the CloudFront URL from stack outputs
FRONTEND_URL=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" \
  --output text)

echo "Frontend deployed to: $FRONTEND_URL"

# Test the deployment
curl -I $FRONTEND_URL
```

**Expected Output**:
```
HTTP/2 200
content-type: text/html
x-cache: Miss from cloudfront (first request after invalidation)
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; ...
strict-transport-security: max-age=31536000; includeSubDomains
x-frame-options: DENY
x-content-type-options: nosniff
```

## Manual Deployment Script

For convenience, you can use the following script:

```bash
#!/bin/bash
set -e

# Configuration
STACK_NAME="${1:-LfmtPocDev}"
ENV_FILE="${2:-.env.dev}"

echo "🚀 Deploying LFMT Frontend to $STACK_NAME"

# Step 1: Prepare environment
cd frontend
cp "$ENV_FILE" .env

# Step 2: Build
echo "📦 Building frontend..."
npm run build

# Step 3: Get stack outputs
echo "📋 Fetching stack outputs..."
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
  --output text)

DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
  --output text)

FRONTEND_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" \
  --output text)

# Step 4: Deploy to S3
echo "☁️  Deploying to S3: $BUCKET_NAME"
aws s3 sync dist/ "s3://$BUCKET_NAME/" --delete

# Step 5: Invalidate CloudFront
echo "♻️  Invalidating CloudFront: $DISTRIBUTION_ID"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "⏳ Waiting for invalidation to complete..."
aws cloudfront wait invalidation-completed \
  --distribution-id "$DISTRIBUTION_ID" \
  --id "$INVALIDATION_ID"

# Step 6: Verify
echo "✅ Deployment complete!"
echo "🌐 Frontend URL: $FRONTEND_URL"
echo ""
echo "Testing deployment..."
curl -I "$FRONTEND_URL"
```

**Usage**:
```bash
# Deploy to development
./deploy-frontend.sh LfmtPocDev .env.dev

# Deploy to production
./deploy-frontend.sh LfmtPocProd .env.production
```

## Deployment Verification Checklist

After deployment, verify the following:

### 1. Frontend Accessibility
- [ ] CloudFront URL returns HTTP 200
- [ ] Homepage loads correctly
- [ ] No console errors in browser dev tools

### 2. Security Headers
- [ ] `Content-Security-Policy` header present
- [ ] `Strict-Transport-Security` header present (HSTS)
- [ ] `X-Frame-Options: DENY` header present
- [ ] `X-Content-Type-Options: nosniff` header present
- [ ] `Referrer-Policy` header present

### 3. SPA Routing
- [ ] Direct navigation to `/dashboard` works
- [ ] Direct navigation to `/translation/upload` works
- [ ] Browser refresh on any route stays on the same route
- [ ] No 403 or 404 errors for app routes

### 4. API Integration
- [ ] Login page connects to Cognito
- [ ] User registration works
- [ ] Translation upload triggers backend API
- [ ] Progress polling works correctly

### 5. CORS Configuration
- [ ] API requests from CloudFront URL succeed
- [ ] No CORS errors in browser console
- [ ] Preflight OPTIONS requests succeed

## Troubleshooting

### Issue: CloudFront Returns 403 for All Routes

**Cause**: S3 bucket permissions or OAC configuration issue

**Solution**:
```bash
# Check S3 bucket policy
aws s3api get-bucket-policy --bucket lfmt-frontend-lfmtpocdev

# Verify CloudFront distribution origin configuration
aws cloudfront get-distribution --id E3EV4PBKYTNTRE
```

### Issue: Old Frontend Version Visible After Deployment

**Cause**: CloudFront cache not invalidated

**Solution**:
```bash
# Create new invalidation
aws cloudfront create-invalidation \
  --distribution-id E3EV4PBKYTNTRE \
  --paths "/*"
```

### Issue: API Requests Fail with CORS Errors

**Cause**: CloudFront URL not in API Gateway CORS origins

**Solution**:
1. Verify API Gateway CORS configuration includes CloudFront URL
2. Check `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:337-400`
3. Redeploy infrastructure if needed: `npx cdk deploy --context environment=dev`

### Issue: Environment Variables Not Applied

**Cause**: Build used wrong `.env` file or variables not prefixed with `VITE_`

**Solution**:
```bash
# Ensure .env file is copied correctly
cp .env.dev .env

# Rebuild
npm run build

# Verify build contains correct values
grep -r "VITE_API_URL" dist/
```

### Issue: Security Headers Not Present

**Cause**: CloudFront ResponseHeadersPolicy not applied

**Solution**:
```bash
# Check CloudFront distribution configuration
aws cloudfront get-distribution-config --id E3EV4PBKYTNTRE \
  --query 'DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId'

# Verify in infrastructure code
# backend/infrastructure/lib/lfmt-infrastructure-stack.ts:1243-1272
```

## Monitoring Deployment

### CloudWatch Metrics

Monitor the following CloudFront metrics:
- **Requests**: Total requests to distribution
- **BytesDownloaded**: Total bytes served
- **4xxErrorRate**: Client error rate (should be low)
- **5xxErrorRate**: Server error rate (should be near zero)

```bash
# View CloudFront metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name Requests \
  --dimensions Name=DistributionId,Value=E3EV4PBKYTNTRE \
  --start-time 2025-11-21T00:00:00Z \
  --end-time 2025-11-21T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

### S3 Access Logs

Enable S3 access logging for detailed request tracking:
```bash
# Configure access logging (optional)
aws s3api put-bucket-logging \
  --bucket lfmt-frontend-lfmtpocdev \
  --bucket-logging-status file://logging-config.json
```

## Cost Optimization

### CloudFront Invalidation Costs
- First 1,000 invalidations per month: **FREE**
- Additional invalidations: **$0.005 per path**
- POC impact: Negligible (< 100 deployments/month)

### S3 Storage Costs
- Standard storage: **$0.023 per GB/month**
- Frontend build size: ~3-4 MB
- Monthly cost: < $0.01

### CloudFront Data Transfer
- First 10 TB/month: **$0.085 per GB**
- POC traffic: < 1 GB/month
- Monthly cost: < $0.10

**Total Estimated Cost**: **< $0.20/month** for frontend hosting

## Rollback Procedure

If issues occur after deployment:

### 1. Rollback to Previous S3 Version
```bash
# List S3 versions
aws s3api list-object-versions \
  --bucket lfmt-frontend-lfmtpocdev \
  --prefix index.html

# Restore previous version (example)
aws s3api copy-object \
  --bucket lfmt-frontend-lfmtpocdev \
  --copy-source lfmt-frontend-lfmtpocdev/index.html?versionId=PREVIOUS_VERSION_ID \
  --key index.html
```

### 2. Redeploy Previous Build
```bash
# Checkout previous commit
git checkout <previous-commit-hash>

# Rebuild and redeploy
cd frontend
npm run build
aws s3 sync dist/ s3://lfmt-frontend-lfmtpocdev/ --delete

# Invalidate cache
aws cloudfront create-invalidation \
  --distribution-id E3EV4PBKYTNTRE \
  --paths "/*"
```

## Best Practices

1. **Always test locally first**: Run `npm run dev` and test thoroughly before deploying
2. **Use environment-specific configs**: Don't mix dev and prod environment variables
3. **Invalidate after every deployment**: Ensure users see latest version
4. **Monitor CloudWatch metrics**: Watch for 4xx/5xx error spikes
5. **Test SPA routing**: Verify all routes work after deployment
6. **Check security headers**: Ensure CSP, HSTS, etc. are present
7. **Keep .env files gitignored**: Never commit sensitive configuration
8. **Document all changes**: Update PROGRESS.md and CLAUDE.md after deployment

## Automated Deployment (GitHub Actions)

For CI/CD integration, see `.github/workflows/deploy.yml` lines 203-261 for the automated deployment workflow.

**Workflow Trigger**: Manual dispatch or push to main branch (configurable)

---

**Last Updated**: 2025-11-20
**Deployment URL (Dev)**: https://d39xcun7144jgl.cloudfront.net
**Stack Name (Dev)**: LfmtPocDev
**Distribution ID (Dev)**: E3EV4PBKYTNTRE
