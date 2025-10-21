# AWS Deployment Setup - CDK Bootstrap Fix

## 🚨 Current Issue

**Error**: `AccessDeniedException: User: arn:aws:iam::XXXXXXXXXXXX:user/lfmt-poc-deployment is not authorized to perform: ssm:GetParameter`

**Root Cause**: The GitHub Actions IAM user lacks SSM permissions required for CDK bootstrap version verification.

## ✅ **Solution 1: Add SSM Permissions (Recommended)**

Add the following IAM policy to the `lfmt-poc-deployment` user:

### Required IAM Policy

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CDKBootstrapSSMAccess",
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters"
            ],
            "Resource": [
                "arn:aws:ssm:us-east-1:XXXXXXXXXXXX:parameter/cdk-bootstrap/*"
            ]
        }
    ]
}
```

### AWS Console Steps

1. **Navigate to IAM Console**:
   - Go to https://console.aws.amazon.com/iam/
   - Go to Users → `lfmt-poc-deployment`

2. **Add Inline Policy**:
   - Click "Add permissions" → "Create inline policy"
   - Choose JSON tab and paste the policy above
   - Name: `CDKBootstrapSSMAccess`
   - Click "Create policy"

### AWS CLI Steps

```bash
# Save the policy to a file
cat > cdk-bootstrap-ssm-policy.json << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CDKBootstrapSSMAccess",
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters"
            ],
            "Resource": [
                "arn:aws:ssm:us-east-1:XXXXXXXXXXXX:parameter/cdk-bootstrap/*"
            ]
        }
    ]
}
EOF

# Apply the policy
aws iam put-user-policy \
    --user-name lfmt-poc-deployment \
    --policy-name CDKBootstrapSSMAccess \
    --policy-document file://cdk-bootstrap-ssm-policy.json
```

## 🔧 **Solution 2: CDK Bootstrap (Required After SSM Fix)**

✅ **UPDATE**: SSM permissions have been applied successfully!  
❌ **NEW ISSUE**: CDK environment not bootstrapped yet

### Automated Bootstrap (Recommended)

```bash
# Run the automated bootstrap script
./scripts/bootstrap-cdk.sh
```

### Manual Bootstrap

```bash
# Navigate to infrastructure directory
cd backend/infrastructure

# Bootstrap CDK (one-time setup per account/region)
npx cdk bootstrap aws://XXXXXXXXXXXX/us-east-1
```

### What Bootstrap Creates:
- CDK staging S3 bucket for deployment assets
- IAM roles for CloudFormation operations
- SSM parameter `/cdk-bootstrap/hnb659fds/version`
- Required infrastructure for CDK deployments

**Note**: Bootstrap is a one-time operation per AWS account/region combination.

## ⚡ **Solution 3: Enhanced Deployment User Policy**

For a more comprehensive approach, replace the existing deployment user policy with:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "CDKDeploymentCore",
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "iam:CreateRole",
                "iam:PutRolePolicy",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:DeleteRole",
                "iam:GetRole",
                "iam:PassRole",
                "iam:TagRole",
                "iam:GetRolePolicy"
            ],
            "Resource": "*"
        },
        {
            "Sid": "CDKBootstrapAccess",
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters"
            ],
            "Resource": [
                "arn:aws:ssm:*:*:parameter/cdk-bootstrap/*"
            ]
        },
        {
            "Sid": "LFMTResourceAccess",
            "Effect": "Allow",
            "Action": [
                "dynamodb:*",
                "s3:*",
                "apigateway:*",
                "cognito-idp:*",
                "logs:*",
                "lambda:*",
                "states:*"
            ],
            "Resource": "*"
        }
    ]
}
```

## 🎯 **Recommended Quick Fix**

**For immediate deployment**: Use Solution 1 (Add SSM permissions) - it's the minimal change needed.

1. Add the SSM policy to the `lfmt-poc-deployment` user
2. Re-run the GitHub Actions pipeline
3. The deployment should proceed successfully

## 🔄 **After Applying Fix**

1. **Re-run GitHub Actions**: Trigger the workflow again
2. **Monitor Deployment**: Watch for successful CDK deployment
3. **Verify Resources**: Check AWS Console for created resources:
   - DynamoDB tables
   - S3 buckets  
   - API Gateway
   - Cognito User Pool

## 🛡️ **Security Note**

The recommended policy is scoped to:
- Only CDK bootstrap SSM parameters
- Specific AWS account (XXXXXXXXXXXX)
- Follows principle of least privilege

## 📞 **Need Help?**

If you encounter additional permission issues, the error messages will specify exactly what permissions are missing, and we can add them incrementally.

---

**Next Steps**: Apply Solution 1, then re-run the GitHub Actions pipeline. The deployment should complete successfully!