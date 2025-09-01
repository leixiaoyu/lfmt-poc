#!/bin/bash

# LFMT Infrastructure Deployment Script
# Implementation Plan - Phase 1, Milestone 1.1

set -e  # Exit on any error

echo "🚀 LFMT Infrastructure Deployment Script"
echo "========================================"

# Configuration
ENVIRONMENT=${1:-dev}
REGION=${2:-us-east-1}
PROFILE=${3:-default}

echo "📋 Configuration:"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $REGION"
echo "   AWS Profile: $PROFILE"
echo ""

# Validation
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    echo "❌ Error: Environment must be one of: dev, staging, prod"
    exit 1
fi

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is required but not installed"
    exit 1
fi

# Check AWS credentials
echo "🔐 Checking AWS credentials..."
if ! aws sts get-caller-identity --profile $PROFILE &> /dev/null; then
    echo "❌ Error: AWS credentials not configured or invalid"
    echo "   Run: aws configure --profile $PROFILE"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --profile $PROFILE --query Account --output text)
echo "✅ AWS credentials valid (Account: $ACCOUNT_ID)"

# Check CDK CLI
if ! command -v cdk &> /dev/null; then
    echo "❌ Error: AWS CDK is required but not installed"
    echo "   Run: npm install -g aws-cdk"
    exit 1
fi

# Bootstrap CDK if needed
echo "🔧 Checking CDK bootstrap status..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --profile $PROFILE --region $REGION &> /dev/null; then
    echo "⚙️  Bootstrapping CDK for region $REGION..."
    cdk bootstrap aws://$ACCOUNT_ID/$REGION --profile $PROFILE
else
    echo "✅ CDK already bootstrapped"
fi

# Navigate to infrastructure directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRASTRUCTURE_DIR="$SCRIPT_DIR/../backend/infrastructure"

if [[ ! -d "$INFRASTRUCTURE_DIR" ]]; then
    echo "❌ Error: Infrastructure directory not found: $INFRASTRUCTURE_DIR"
    exit 1
fi

cd "$INFRASTRUCTURE_DIR"
echo "📁 Changed to infrastructure directory: $(pwd)"

# Install dependencies
echo "📦 Installing dependencies..."
if [[ ! -d "node_modules" ]]; then
    npm install
else
    echo "✅ Dependencies already installed"
fi

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Run tests
echo "🧪 Running infrastructure tests..."
npm test

# Synthesize CloudFormation
echo "🔄 Synthesizing CloudFormation templates..."
cdk synth --context environment=$ENVIRONMENT --profile $PROFILE

# Show diff if stack exists
STACK_NAME="LfmtPoc$(echo $ENVIRONMENT | sed 's/^./\U&/')"  # Capitalize first letter
echo "📊 Checking for changes..."
if aws cloudformation describe-stacks --stack-name $STACK_NAME --profile $PROFILE --region $REGION &> /dev/null; then
    echo "🔍 Stack exists, showing diff..."
    cdk diff --context environment=$ENVIRONMENT --profile $PROFILE || true
else
    echo "🆕 New stack will be created"
fi

# Deployment confirmation
echo ""
echo "🎯 Ready to deploy:"
echo "   Stack: $STACK_NAME"
echo "   Environment: $ENVIRONMENT"
echo "   Region: $REGION"
echo "   Account: $ACCOUNT_ID"
echo ""

read -p "Do you want to proceed with deployment? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deployment cancelled"
    exit 1
fi

# Deploy
echo "🚀 Deploying infrastructure..."
cdk deploy --context environment=$ENVIRONMENT --profile $PROFILE --require-approval never

# Post-deployment validation
echo "✅ Deployment completed successfully!"
echo ""
echo "🔍 Validating deployment..."

# Check stack status
STACK_STATUS=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --profile $PROFILE \
    --region $REGION \
    --query 'Stacks[0].StackStatus' \
    --output text)

if [[ "$STACK_STATUS" == "CREATE_COMPLETE" ]] || [[ "$STACK_STATUS" == "UPDATE_COMPLETE" ]]; then
    echo "✅ Stack status: $STACK_STATUS"
else
    echo "⚠️  Stack status: $STACK_STATUS"
fi

# Get stack outputs
echo ""
echo "📋 Stack Outputs:"
aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --profile $PROFILE \
    --region $REGION \
    --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
    --output table

echo ""
echo "🎉 LFMT Infrastructure deployment complete!"
echo ""
echo "🔄 Next steps:"
echo "1. Note down the stack outputs above"
echo "2. Configure environment variables for Lambda functions"
echo "3. Deploy Lambda functions using the function deployment script"
echo "4. Test API endpoints"
echo ""
echo "📖 For troubleshooting, check CloudFormation events:"
echo "   aws cloudformation describe-stack-events --stack-name $STACK_NAME --profile $PROFILE"