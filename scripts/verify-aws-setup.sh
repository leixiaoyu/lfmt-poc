#!/bin/bash

# LFMT POC AWS Setup Verification Script
# This script checks if AWS credentials and CDK bootstrap are properly configured

set -e

echo "🔍 LFMT POC AWS Configuration Verification"
echo "========================================"
echo ""

# Check AWS CLI configuration
echo "1. Checking AWS CLI configuration..."
if aws sts get-caller-identity &> /dev/null; then
    echo "✅ AWS credentials are configured"
    aws sts get-caller-identity --query '[Account,Arn]' --output table
else
    echo "❌ AWS credentials not configured"
    exit 1
fi

echo ""

# Check AWS region
echo "2. Checking AWS region..."
AWS_REGION=$(aws configure get region || echo "us-east-1")
echo "✅ Using AWS region: $AWS_REGION"

echo ""

# Check CDK bootstrap status
echo "3. Checking CDK bootstrap status..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

if aws cloudformation describe-stacks --stack-name CDKToolkit --region $AWS_REGION &> /dev/null; then
    echo "✅ CDK is already bootstrapped in region $AWS_REGION"
else
    echo "⚠️  CDK not bootstrapped. Running bootstrap now..."
    cd backend/infrastructure
    npx cdk bootstrap aws://$ACCOUNT_ID/$AWS_REGION
    echo "✅ CDK bootstrap completed"
fi

echo ""

# Test CDK synthesis
echo "4. Testing CDK synthesis..."
cd backend/infrastructure
if npx cdk synth --context environment=dev &> /dev/null; then
    echo "✅ CDK synthesis successful"
else
    echo "❌ CDK synthesis failed"
    echo "Running with verbose output:"
    npx cdk synth --context environment=dev
    exit 1
fi

echo ""

# Check for existing resources
echo "5. Checking for existing LFMT resources..."
if aws dynamodb describe-table --table-name lfmt-jobs-dev --region $AWS_REGION &> /dev/null; then
    echo "ℹ️  LFMT infrastructure already exists (tables found)"
else
    echo "✅ No conflicting LFMT resources found"
fi

echo ""
echo "🎉 AWS Configuration Verification Complete!"
echo ""
echo "📋 Next Steps:"
echo "1. Check GitHub Actions pipeline at: https://github.com/leixiaoyu/lfmt-poc/actions"
echo "2. Monitor deployment progress"
echo "3. Verify resources in AWS Console"
echo ""
echo "🚀 Ready for deployment!"