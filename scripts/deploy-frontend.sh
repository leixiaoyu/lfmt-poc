#!/bin/bash
# LFMT Frontend Deployment Script
# Usage: ./scripts/deploy-frontend.sh [STACK_NAME] [ENV_FILE]
# Example: ./scripts/deploy-frontend.sh LfmtPocDev .env.dev

set -e

# Configuration
STACK_NAME="${1:-LfmtPocDev}"
ENV_FILE="${2:-.env.dev}"

echo "🚀 Deploying LFMT Frontend to $STACK_NAME"
echo "📄 Using environment file: $ENV_FILE"
echo ""

# Step 1: Prepare environment
cd frontend
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Error: Environment file $ENV_FILE not found"
  exit 1
fi
cp "$ENV_FILE" .env

# Step 2: Build
echo "📦 Building frontend..."
npm run build
echo "✅ Build complete"
echo ""

# Step 3: Get stack outputs
echo "📋 Fetching stack outputs from $STACK_NAME..."
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

echo "  S3 Bucket: $BUCKET_NAME"
echo "  CloudFront ID: $DISTRIBUTION_ID"
echo "  Frontend URL: $FRONTEND_URL"
echo ""

# Step 4: Deploy to S3
echo "☁️  Deploying to S3: $BUCKET_NAME"
aws s3 sync dist/ "s3://$BUCKET_NAME/" --delete
echo "✅ S3 deployment complete"
echo ""

# Step 5: Invalidate CloudFront
echo "♻️  Invalidating CloudFront: $DISTRIBUTION_ID"
INVALIDATION_ID=$(aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*" \
  --query 'Invalidation.Id' \
  --output text)

echo "  Invalidation ID: $INVALIDATION_ID"
echo "⏳ Waiting for invalidation to complete (this may take 3-5 minutes)..."
aws cloudfront wait invalidation-completed \
  --distribution-id "$DISTRIBUTION_ID" \
  --id "$INVALIDATION_ID"
echo "✅ CloudFront invalidation complete"
echo ""

# Step 6: Verify
echo "🔍 Testing deployment..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$FRONTEND_URL")
if [ "$HTTP_STATUS" -eq 200 ]; then
  echo "✅ Deployment successful! HTTP $HTTP_STATUS"
else
  echo "⚠️  Warning: Received HTTP $HTTP_STATUS (expected 200)"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ DEPLOYMENT COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Frontend URL: $FRONTEND_URL"
echo "📦 S3 Bucket: s3://$BUCKET_NAME/"
echo "♻️  CloudFront ID: $DISTRIBUTION_ID"
echo ""
echo "Next steps:"
echo "1. Open $FRONTEND_URL in your browser"
echo "2. Verify login and registration work"
echo "3. Test translation upload workflow"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
