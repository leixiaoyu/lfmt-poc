#!/bin/bash

# LFMT POC CDK Bootstrap Script
# One-time setup for CDK deployment environment

set -e

echo ""
echo "🚀 LFMT POC CDK Bootstrap"
echo "========================"
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

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_status "❌ AWS credentials not configured. Run 'aws configure' first." "$RED"
    exit 1
fi

print_status "🔍 Current AWS identity:" "$YELLOW"
CURRENT_IDENTITY=$(aws sts get-caller-identity)
echo "$CURRENT_IDENTITY"

ACCOUNT_ID=$(echo "$CURRENT_IDENTITY" | grep -o '"Account": "[^"]*"' | cut -d'"' -f4)
REGION="us-east-1"

echo ""
print_status "📋 CDK Bootstrap Details:" "$YELLOW"
echo "  Account: $ACCOUNT_ID"
echo "  Region: $REGION" 
echo "  Environment: aws://$ACCOUNT_ID/$REGION"
echo ""

# Navigate to infrastructure directory
if [ ! -d "backend/infrastructure" ]; then
    print_status "❌ Not in LFMT POC root directory. Please run from project root." "$RED"
    exit 1
fi

cd backend/infrastructure

# Check if CDK is available
if ! command -v npx &> /dev/null; then
    print_status "❌ Node.js/npx not found. Please install Node.js first." "$RED"
    exit 1
fi

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    print_status "⚠️  Installing dependencies first..." "$YELLOW"
    npm install --cache=/tmp/npm-cache
fi

print_status "🔧 Bootstrapping CDK environment..." "$YELLOW"
echo "This will create:"
echo "  • CDK staging S3 bucket"
echo "  • IAM roles for CloudFormation"
echo "  • SSM parameter for version tracking"
echo ""

# Bootstrap CDK
if npx cdk bootstrap aws://$ACCOUNT_ID/$REGION; then
    print_status "✅ CDK bootstrap completed successfully!" "$GREEN"
else
    print_status "❌ CDK bootstrap failed. Check permissions and try again." "$RED"
    exit 1
fi

echo ""
print_status "🎯 Bootstrap Complete!" "$GREEN"
print_status "✅ CDK environment is now ready for deployments" "$GREEN"
echo ""

# Verify bootstrap
print_status "🔍 Verifying bootstrap..." "$YELLOW"
if aws ssm get-parameter --name "/cdk-bootstrap/hnb659fds/version" --region $REGION >/dev/null 2>&1; then
    BOOTSTRAP_VERSION=$(aws ssm get-parameter --name "/cdk-bootstrap/hnb659fds/version" --region $REGION --query 'Parameter.Value' --output text)
    print_status "✅ Bootstrap verified - Version: $BOOTSTRAP_VERSION" "$GREEN"
else
    print_status "⚠️  Bootstrap verification failed, but deployment may still work" "$YELLOW"
fi

echo ""
print_status "Next steps:" "$YELLOW"
echo "  1. Re-run the GitHub Actions pipeline"
echo "  2. The CDK deployment will now succeed"  
echo "  3. Monitor deployment at: https://github.com/leixiaoyu/lfmt-poc/actions"
echo ""

print_status "🚀 Ready for deployment!" "$GREEN"
echo ""