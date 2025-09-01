#!/bin/bash

# LFMT POC AWS Permissions Fix Script
# Adds required SSM permissions for CDK bootstrap to deployment user

set -e

echo ""
echo "🔧 LFMT POC AWS Permissions Fix"
echo "==============================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${2}${1}${NC}"
}

# Check if AWS CLI is available
if ! command -v aws &> /dev/null; then
    print_status "❌ AWS CLI not found. Please install AWS CLI first." "$RED"
    exit 1
fi

# Check if user has AWS credentials configured
if ! aws sts get-caller-identity &> /dev/null; then
    print_status "❌ AWS credentials not configured. Run 'aws configure' first." "$RED"
    exit 1
fi

print_status "🔍 Current AWS identity:" "$YELLOW"
aws sts get-caller-identity

echo ""
print_status "📋 Creating CDK Bootstrap SSM policy..." "$YELLOW"

# Create the policy JSON
cat > /tmp/cdk-bootstrap-ssm-policy.json << 'EOF'
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
                "arn:aws:ssm:us-east-1:427262291085:parameter/cdk-bootstrap/*"
            ]
        }
    ]
}
EOF

print_status "📄 Policy created at /tmp/cdk-bootstrap-ssm-policy.json" "$GREEN"

echo ""
print_status "🔐 Adding policy to lfmt-poc-deployment user..." "$YELLOW"

# Apply the policy
if aws iam put-user-policy \
    --user-name lfmt-poc-deployment \
    --policy-name CDKBootstrapSSMAccess \
    --policy-document file:///tmp/cdk-bootstrap-ssm-policy.json; then
    
    print_status "✅ Policy successfully added to lfmt-poc-deployment user!" "$GREEN"
else
    print_status "❌ Failed to add policy. Check your permissions and user name." "$RED"
    exit 1
fi

# Cleanup
rm -f /tmp/cdk-bootstrap-ssm-policy.json

echo ""
print_status "🎯 Permission Fix Complete!" "$GREEN"
echo ""
print_status "What was added:" "$YELLOW"
echo "  • ssm:GetParameter permission"
echo "  • ssm:GetParameters permission"  
echo "  • Scoped to CDK bootstrap parameters only"
echo ""
print_status "Next steps:" "$YELLOW"
echo "  1. Re-run the GitHub Actions pipeline"
echo "  2. The CDK deployment should now succeed"
echo "  3. Monitor the deployment in AWS Console"
echo ""
print_status "🔗 GitHub Actions: https://github.com/leixiaoyu/lfmt-poc/actions" "$YELLOW"
echo ""