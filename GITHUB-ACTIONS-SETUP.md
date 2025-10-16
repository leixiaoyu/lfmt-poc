# GitHub Actions CI/CD Setup Guide

**Security**: This guide uses AWS OIDC (OpenID Connect) authentication - the **most secure method** for GitHub Actions. No AWS access keys are stored in GitHub!

**Your AWS Account**: `427262291085`
**Your Region**: `us-east-1`
**Monthly Budget**: $10

---

## 🎯 What You'll Get

Once configured, this CI/CD pipeline will:

✅ **Automatically run tests** on every push to main
✅ **Validate infrastructure** with CDK synth
✅ **Deploy to AWS dev** automatically on main branch pushes
✅ **Manual staging/prod deploys** via GitHub Actions UI
✅ **No AWS credentials in GitHub** - uses secure OIDC
✅ **Cost monitoring** built-in

---

## 📋 Prerequisites

- [x] GitHub repository created at: https://github.com/leixiaoyu/lfmt-poc
- [x] AWS Account ID: `427262291085`
- [x] AWS Region: `us-east-1`
- [ ] AWS IAM permissions to create OIDC provider and roles

---

## 🔐 Step 1: Create AWS OIDC Provider (One-Time Setup)

This allows GitHub Actions to authenticate with AWS without access keys.

### Option A: Using AWS Console (Recommended for first-time users)

1. **Go to IAM Console**:
   - https://console.aws.amazon.com/iam/

2. **Create Identity Provider**:
   - Click "Identity providers" → "Add provider"
   - Provider type: **OpenID Connect**
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
   - Click "Add provider"

### Option B: Using AWS CLI (Faster if you're comfortable)

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
  --region us-east-1
```

**Verify it was created**:
```bash
aws iam list-open-id-connect-providers
```

You should see an ARN like: `arn:aws:iam::427262291085:oidc-provider/token.actions.githubusercontent.com`

---

## 🔑 Step 2: Create IAM Role for GitHub Actions

This role grants GitHub Actions permission to deploy your infrastructure.

### Create the Role

Save this as `github-actions-trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::427262291085:oidc-provider/token.actions.githubusercontent.com"
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

**Create the role**:
```bash
aws iam create-role \
  --role-name GitHubActionsLFMTDeploy \
  --assume-role-policy-document file://github-actions-trust-policy.json \
  --description "Role for GitHub Actions to deploy LFMT infrastructure"
```

**Attach deployment permissions**:
```bash
# CDK deployment requires broad permissions
aws iam attach-role-policy \
  --role-name GitHubActionsLFMTDeploy \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**⚠️ Note on AdministratorAccess**:
For a POC with budget=$10/month, AdministratorAccess is acceptable. For production, you should create a custom policy with only the required permissions:
- CloudFormation (full)
- Lambda (full)
- API Gateway (full)
- DynamoDB (full)
- S3 (full)
- Cognito (full)
- IAM (role creation)
- CloudWatch Logs (full)

**Get the Role ARN** (you'll need this for GitHub):
```bash
aws iam get-role --role-name GitHubActionsLFMTDeploy --query 'Role.Arn' --output text
```

Should output: `arn:aws:iam::427262291085:role/GitHubActionsLFMTDeploy`

---

## 🔧 Step 3: Configure GitHub Repository Secrets

1. **Go to your GitHub repository**:
   - https://github.com/leixiaoyu/lfmt-poc

2. **Navigate to Settings → Secrets and variables → Actions**

3. **Click "New repository secret"**

4. **Add the following secret**:
   - **Name**: `AWS_ROLE_ARN`
   - **Value**: `arn:aws:iam::427262291085:role/GitHubActionsLFMTDeploy`
   - Click "Add secret"

**That's it!** No AWS access keys, no secret access keys. Just the role ARN.

---

## 📊 Step 4: Set Up AWS Budget Alerts (Recommended)

Protect yourself from unexpected costs:

```bash
# Create a budget with email alerts
aws budgets create-budget \
  --account-id 427262291085 \
  --budget file://budget-config.json \
  --notifications-with-subscribers file://budget-notifications.json
```

**budget-config.json**:
```json
{
  "BudgetName": "LFMT-POC-Monthly-Budget",
  "BudgetLimit": {
    "Amount": "10",
    "Unit": "USD"
  },
  "TimeUnit": "MONTHLY",
  "BudgetType": "COST"
}
```

**budget-notifications.json**:
```json
[
  {
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      {
        "SubscriptionType": "EMAIL",
        "Address": "YOUR_EMAIL@example.com"
      }
    ]
  },
  {
    "Notification": {
      "NotificationType": "FORECASTED",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 100,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [
      {
        "SubscriptionType": "EMAIL",
        "Address": "YOUR_EMAIL@example.com"
      }
    ]
  }
]
```

**Replace `YOUR_EMAIL@example.com`** with your actual email.

---

## 🚀 Step 5: Test GitHub Actions Deployment

### Method 1: Push Code to GitHub (Automatic Deployment)

```bash
cd "/Users/raymondl/Documents/LFMT POC/LFMT/lfmt-poc"

# Push all commits to GitHub
git push -u origin main
```

This will:
1. Trigger the GitHub Actions workflow
2. Run all tests
3. Build infrastructure
4. Deploy to AWS dev environment automatically

**Watch the deployment**:
- Go to: https://github.com/leixiaoyu/lfmt-poc/actions
- Click on the latest workflow run
- Watch each step execute in real-time

### Method 2: Manual Deployment (For Staging/Prod)

1. **Go to Actions tab**: https://github.com/leixiaoyu/lfmt-poc/actions
2. **Click "Deploy LFMT Infrastructure"** (left sidebar)
3. **Click "Run workflow"** button (right side)
4. **Select environment**: dev / staging / prod
5. **Click "Run workflow"**

---

## 📈 Step 6: Verify Deployment Success

### Check CloudFormation Stack

```bash
aws cloudformation describe-stacks \
  --stack-name lfmt-dev \
  --region us-east-1 \
  --query "Stacks[0].StackStatus" \
  --output text
```

Expected output: `CREATE_COMPLETE` or `UPDATE_COMPLETE`

### Get API Gateway URL

```bash
aws cloudformation describe-stacks \
  --stack-name lfmt-dev \
  --region us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" \
  --output text
```

Save this URL - you'll need it for testing!

### Test Authentication Endpoint

```bash
# Replace with your actual API URL
API_URL="<YOUR_API_URL_HERE>"

# Test registration
curl -X POST ${API_URL}/v1/auth \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!",
    "confirmPassword": "TestPass123!",
    "firstName": "Test",
    "lastName": "User",
    "acceptedTerms": true,
    "acceptedPrivacy": true
  }'
```

**Expected response**:
```json
{
  "message": "User registered successfully. Please check your email to verify your account.",
  "requestId": "abc-123-xyz"
}
```

---

## 🔍 Monitoring & Troubleshooting

### View Lambda Logs

```bash
# List log groups
aws logs describe-log-groups \
  --log-group-name-prefix /aws/lambda/lfmt \
  --region us-east-1

# Tail logs for register function
aws logs tail /aws/lambda/lfmt-register-lfmt-dev \
  --follow \
  --region us-east-1
```

### Check GitHub Actions Logs

1. Go to https://github.com/leixiaoyu/lfmt-poc/actions
2. Click on a workflow run
3. Click on a specific job (e.g., "Deploy to Development")
4. Expand steps to see detailed logs

### Common Issues

**Issue: "Role not found" error**
- Solution: Wait 10-15 seconds after creating the role, then retry

**Issue: "OIDC provider not found"**
- Solution: Verify the provider exists: `aws iam list-open-id-connect-providers`

**Issue: "Permission denied"**
- Solution: Check that AdministratorAccess is attached to the role

**Issue: "Docker not available"**
- Solution: GitHub Actions runners have Docker pre-installed, this shouldn't happen

---

## 💰 Cost Monitoring

### View Current Costs

```bash
# Get month-to-date costs
aws ce get-cost-and-usage \
  --time-period Start=$(date -u -d "$(date +%Y-%m-01)" +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --region us-east-1 \
  --query "ResultsByTime[0].Total.UnblendedCost.Amount" \
  --output text
```

### Expected Monthly Costs

| Service | Expected Cost |
|---------|---------------|
| DynamoDB | $0-2 (on-demand, light usage) |
| S3 | $0-1 (minimal storage) |
| API Gateway | $0-3 (within free tier initially) |
| Lambda | $0 (within free tier) |
| Cognito | $0 (free up to 50K users) |
| CloudWatch | $0-1 (logs) |
| **Total** | **$0-7/month** |

Your $10/month budget has plenty of headroom!

---

## 🎉 Success Checklist

Once everything is set up:

- [ ] OIDC provider created in AWS
- [ ] IAM role `GitHubActionsLFMTDeploy` created
- [ ] GitHub secret `AWS_ROLE_ARN` configured
- [ ] Budget alerts configured (optional but recommended)
- [ ] Code pushed to GitHub
- [ ] GitHub Actions workflow ran successfully
- [ ] CloudFormation stack `lfmt-dev` shows CREATE_COMPLETE
- [ ] API Gateway URL obtained
- [ ] Authentication endpoint tested with curl
- [ ] Lambda logs accessible in CloudWatch

---

## 🔐 Security Best Practices

✅ **Using OIDC** - No long-lived AWS credentials in GitHub
✅ **Least privilege** - Role limited to your repository only
✅ **Budget alerts** - Automatic cost monitoring
✅ **Environment protection** - Staging/prod require manual approval
✅ **Audit trail** - All deployments logged in GitHub Actions

**⚠️ For Production:**
- Replace AdministratorAccess with a custom policy
- Enable CloudTrail for AWS API auditing
- Add approval requirements for prod deployments
- Implement automated security scanning
- Set up additional budget alerts

---

## 📞 Next Steps After Deployment

Once deployment succeeds:

1. **Test All Endpoints**:
   - Register a user
   - Login and get JWT tokens
   - Refresh tokens
   - Reset password

2. **Build Frontend** (Phase 2):
   - React login/registration forms
   - JWT token management
   - User dashboard

3. **Document Processing** (Phase 3):
   - Upload functions
   - Claude API integration
   - Translation workflow

---

## 🆘 Need Help?

**Common Questions:**

**Q: Can I use AWS access keys instead of OIDC?**
A: Yes, but it's less secure. OIDC is strongly recommended.

**Q: How do I roll back a deployment?**
A: Use AWS CloudFormation console to revert to a previous stack version, or redeploy an older git commit.

**Q: How do I delete everything?**
A: Run `cdk destroy` or delete the CloudFormation stack. Set retention policies to DESTROY in the stack for dev environment.

**Q: Can I deploy from my local machine instead?**
A: Yes! Run `npx cdk deploy` from backend/infrastructure directory with AWS CLI configured.

---

**Ready to deploy?** Follow the steps above and you'll have automated CI/CD in ~15 minutes! 🚀
