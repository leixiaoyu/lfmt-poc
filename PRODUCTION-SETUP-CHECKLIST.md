# Production Setup Checklist

This document provides a complete checklist for setting up LFMT POC for production deployment.

## Automated Steps (✅ COMPLETED)

The following steps have been completed automatically via AWS CLI:

### AWS Infrastructure Setup
- [x] ✅ Verified AWS credentials configured (Account: XXXXXXXXXXXX)
- [x] ✅ Confirmed OIDC provider exists for GitHub Actions
  - ARN: `arn:aws:iam::XXXXXXXXXXXX:oidc-provider/token.actions.githubusercontent.com`
- [x] ✅ Created IAM role: `GitHubActionsLFMTProd`
  - ARN: `arn:aws:iam::XXXXXXXXXXXX:role/GitHubActionsLFMTProd`
  - Trust policy configured for repo: `leixiaoyu/lfmt-poc`
- [x] ✅ Attached AdministratorAccess policy to IAM role
- [x] ✅ Created AWS Budget: `LFMT-Production-Monthly` ($100/month)

### GitHub Configuration
- [x] ✅ Verified GitHub secret `AWS_ROLE_ARN` exists
  - Last updated: 2025-10-17

### Files Created
- [x] ✅ `github-actions-trust-policy.json` - IAM role trust policy
- [x] ✅ `production-budget.json` - AWS budget configuration

---

## Manual Steps Required

The following steps **REQUIRE HUMAN INPUT** and must be completed manually:

### Step 1: Update GitHub Secret

**Why:** The AWS_ROLE_ARN secret needs to be updated with the new production role.

**Action:**
1. Navigate to: https://github.com/leixiaoyu/lfmt-poc/settings/secrets/actions
2. Click on `AWS_ROLE_ARN`
3. Click "Update secret"
4. Replace value with: `arn:aws:iam::XXXXXXXXXXXX:role/GitHubActionsLFMTProd`
5. Click "Update secret"

**Verification:**
```bash
# This will NOT show the value (secrets are hidden)
gh secret list
```

---

### Step 2: Configure GitHub Production Environment

**Why:** Production deployments require manual approval and environment protection.

**Action:**
1. Navigate to: https://github.com/leixiaoyu/lfmt-poc/settings/environments
2. If "production" environment doesn't exist:
   - Click "New environment"
   - Name: `production`
   - Click "Configure environment"

3. Configure protection rules:
   - ✅ **Required reviewers**: Add yourself (leixiaoyu)
   - ✅ **Wait timer**: 0 minutes (or 5 minutes for extra safety)
   - ✅ **Deployment branches**: Select "Protected branches only"

4. Click "Save protection rules"

**Verification:**
- Environment appears in list at: https://github.com/leixiaoyu/lfmt-poc/settings/environments
- Shows "Required reviewers" and other protection rules

---

### Step 3: Enable Branch Protection on `main`

**Why:** Prevent accidental pushes to production and require CI/CD checks.

**Action:**
1. Navigate to: https://github.com/leixiaoyu/lfmt-poc/settings/branches
2. Click "Add rule" (or edit existing rule for `main`)
3. **Branch name pattern**: `main`
4. Enable the following:
   - ✅ Require a pull request before merging
     - ✅ Require approvals: 1
   - ✅ Require status checks to pass before merging
     - ✅ Require branches to be up to date before merging
     - Add status checks: `test`, `build-infrastructure`
   - ✅ Require conversation resolution before merging
   - ✅ Do not allow bypassing the above settings
5. Click "Create" or "Save changes"

**Verification:**
- Branch protection rule shows up at: https://github.com/leixiaoyu/lfmt-poc/settings/branches
- Pull requests to `main` will require approval

---

### Step 4: (Optional) Deploy Security Stack

**Why:** Production environments should have CloudTrail, Config, GuardDuty, and WAF.

**Cost:** ~$15-26/month (see PRODUCTION-SECURITY-DEPLOYMENT.md for details)

**Action Option A - Via GitHub Actions (Recommended):**
1. Navigate to: https://github.com/leixiaoyu/lfmt-poc/actions
2. Select "Deploy LFMT Infrastructure" workflow
3. Click "Run workflow"
4. Select:
   - Branch: `main`
   - Environment: `prod`
5. Click "Run workflow"
6. **IMPORTANT:** Review and approve the deployment when prompted

**Action Option B - Via AWS CLI:**
```bash
cd backend/infrastructure

# Install dependencies
npm ci

# Deploy security stack
npx cdk deploy LfmtSecurityStack \
  --context environment=prod \
  --context alertEmail=YOUR_EMAIL@example.com
```

**Verification:**
```bash
# Verify CloudTrail
aws cloudtrail describe-trails --region us-east-1

# Verify GuardDuty
aws guardduty list-detectors --region us-east-1

# Verify Config
aws configservice describe-configuration-recorders

# Verify WAF
aws wafv2 list-web-acls --scope REGIONAL --region us-east-1
```

**See:** `PRODUCTION-SECURITY-DEPLOYMENT.md` for detailed deployment guide

---

### Step 5: Test Production Deployment

**Why:** Verify GitHub Actions workflow can deploy to production.

**Action:**
1. Navigate to: https://github.com/leixiaoyu/lfmt-poc/actions
2. Select "Deploy LFMT Infrastructure" workflow
3. Click "Run workflow"
4. Select:
   - Branch: `main`
   - Environment: `prod`
5. Click "Run workflow"
6. **IMPORTANT:** When prompted for approval:
   - Review the deployment plan
   - Check `cdk diff` output
   - Approve if changes look correct

**Monitor Progress:**
```bash
# Watch workflow in terminal
gh run watch

# Or view in browser
# https://github.com/leixiaoyu/lfmt-poc/actions
```

**Expected Duration:** 8-12 minutes

**Verification After Deployment:**
```bash
# Check CloudFormation stack
aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query 'Stacks[0].StackStatus'

# Get API Gateway URL
aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text

# Test API endpoint (replace with actual URL from above)
curl -X OPTIONS "https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1/auth/register" \
  -H "Origin: https://your-frontend-domain.com" \
  -H "Access-Control-Request-Method: POST" \
  -v
```

**See:** `PRODUCTION-DEPLOYMENT-GUIDE.md` for detailed verification steps

---

### Step 6: Configure Budget Alert Notifications (Optional)

**Why:** Get email alerts when spending approaches budget threshold.

**Action:**
```bash
# Get your email address ready (e.g., your-email@example.com)

# Create SNS topic for budget alerts
TOPIC_ARN=$(aws sns create-topic \
  --name LFMT-Production-Budget-Alerts \
  --query 'TopicArn' \
  --output text)

echo "Topic ARN: $TOPIC_ARN"

# Subscribe your email to the topic
aws sns subscribe \
  --topic-arn $TOPIC_ARN \
  --protocol email \
  --notification-endpoint YOUR_EMAIL@example.com

# IMPORTANT: Check your email and confirm the subscription!
```

Then update the budget with notification:
```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create budget notification configuration (create a file first)
cat > budget-notification.json <<EOF
{
  "Notification": {
    "NotificationType": "ACTUAL",
    "ComparisonOperator": "GREATER_THAN",
    "Threshold": 80,
    "ThresholdType": "PERCENTAGE"
  },
  "Subscribers": [
    {
      "SubscriptionType": "SNS",
      "Address": "$TOPIC_ARN"
    }
  ]
}
EOF

# Add notification to existing budget
aws budgets create-notification \
  --account-id $ACCOUNT_ID \
  --budget-name "LFMT-Production-Monthly" \
  --notification file://budget-notification.json \
  --subscriber file://budget-subscriber.json
```

**Verification:**
- Check email for SNS subscription confirmation
- Confirm subscription by clicking link in email

---

### Step 7: Update Frontend Environment Variables

**Why:** Frontend needs to connect to production API endpoints.

**Action:**
1. After production deployment completes, get the outputs:
```bash
aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query 'Stacks[0].Outputs' \
  --output table
```

2. Create `frontend/.env.production` file with production values:
```env
VITE_API_URL=https://YOUR_PROD_API_ID.execute-api.us-east-1.amazonaws.com/v1
VITE_COGNITO_USER_POOL_ID=us-east-1_YOUR_PROD_POOL_ID
VITE_COGNITO_CLIENT_ID=YOUR_PROD_CLIENT_ID
VITE_AWS_REGION=us-east-1
```

3. **IMPORTANT:** Add to `.gitignore` if not already there:
```bash
echo ".env.production" >> frontend/.gitignore
```

4. Build and deploy frontend:
```bash
cd frontend
npm run build
# Deploy dist/ to your hosting provider (CloudFront, Netlify, Vercel, etc.)
```

---

## Quick Start Commands

### Update GitHub Secret (Step 1)
```bash
# Copy this ARN
arn:aws:iam::XXXXXXXXXXXX:role/GitHubActionsLFMTProd

# Then manually update at:
# https://github.com/leixiaoyu/lfmt-poc/settings/secrets/actions
```

### Deploy to Production (After Steps 1-3)
```bash
# Via GitHub Actions UI:
# https://github.com/leixiaoyu/lfmt-poc/actions

# OR via CLI:
gh workflow run deploy.yml -f environment=prod
```

### Verify Deployment
```bash
# Check stack status
aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query 'Stacks[0].{Status:StackStatus,Created:CreationTime}' \
  --output table

# Get all outputs
aws cloudformation describe-stacks \
  --stack-name LfmtPocProd \
  --query 'Stacks[0].Outputs' \
  --output table
```

---

## Summary

### ✅ Automated (Already Done)
- AWS IAM role created with OIDC trust policy
- AWS budget configured
- All infrastructure code and workflows ready

### ⏳ Manual Steps Required (Human Input)
1. **Update GitHub Secret** `AWS_ROLE_ARN` (2 minutes)
2. **Configure Production Environment** on GitHub (3 minutes)
3. **Enable Branch Protection** on `main` branch (2 minutes)
4. **Deploy Security Stack** (optional, 10 minutes)
5. **Test Production Deployment** (12 minutes)
6. **Configure Budget Alerts** (optional, 5 minutes)
7. **Update Frontend Env Variables** (5 minutes)

**Total Manual Setup Time:** ~20-40 minutes (depending on optional steps)

---

## Troubleshooting

### Issue: GitHub Actions workflow fails with "Unable to assume role"
**Solution:** Make sure Step 1 (Update GitHub Secret) was completed correctly.

### Issue: Budget alerts not working
**Solution:** Ensure you confirmed the SNS subscription via email in Step 6.

### Issue: Frontend can't connect to API
**Solution:** Verify CORS configuration in API Gateway and update frontend `.env.production` with correct values from Step 7.

### Issue: Production deployment is slow
**Solution:** This is normal - CloudFormation stacks take 8-12 minutes for initial deployment.

---

## Next Steps

After completing manual setup:
1. ✅ Run first production deployment
2. ✅ Verify all services are working
3. ✅ Test user registration and login
4. ✅ Configure monitoring dashboard (see PRODUCTION-DEPLOYMENT-GUIDE.md)
5. ✅ Set up CloudWatch alarms (see PRODUCTION-DEPLOYMENT-GUIDE.md)
6. ✅ Review security posture (see PRODUCTION-SECURITY-DEPLOYMENT.md)

---

## Reference Documentation

- **Full Deployment Guide**: `PRODUCTION-DEPLOYMENT-GUIDE.md`
- **Security Features**: `PRODUCTION-SECURITY-DEPLOYMENT.md`
- **Security Policy**: `SECURITY.md`
- **GitHub Actions Workflow**: `.github/workflows/deploy.yml`

---

**Last Updated:** 2025-10-21
**AWS Account:** XXXXXXXXXXXX
**GitHub Repo:** leixiaoyu/lfmt-poc
**Production Stack:** LfmtPocProd
