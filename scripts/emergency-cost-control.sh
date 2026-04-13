#!/bin/bash

###############################################################################
# Emergency Cost Control Script
#
# Stops all billable AWS resources to prevent runaway costs.
#
# Usage:
#   ./scripts/emergency-cost-control.sh <stack-name> [--yes]
#
# Examples:
#   ./scripts/emergency-cost-control.sh LfmtPocDev
#   ./scripts/emergency-cost-control.sh LfmtPocProd --yes   # Skip confirmation
#
# Actions Taken:
#   1. Stop all running Step Functions executions
#   2. Disable API Gateway (throttle to 0 requests/sec)
#   3. Set all Lambda functions to 0 concurrency
#   4. Configure S3 lifecycle policy to abort incomplete multipart uploads
#
# WARNING: This will cause complete service outage!
###############################################################################

set -euo pipefail

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check arguments
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Missing stack name${NC}"
    echo "Usage: $0 <stack-name> [--yes]"
    echo ""
    echo "Examples:"
    echo "  $0 LfmtPocDev"
    echo "  $0 LfmtPocProd --yes"
    exit 1
fi

STACK_NAME="$1"
AUTO_CONFIRM="${2:-}"

echo -e "${RED}========================================${NC}"
echo -e "${RED}⚠️  EMERGENCY COST CONTROL ⚠️${NC}"
echo -e "${RED}========================================${NC}"
echo ""
echo "Stack: $STACK_NAME"
echo ""
echo "This script will:"
echo "  1. Stop all running Step Functions executions"
echo "  2. Disable API Gateway (throttle to 0 requests/sec)"
echo "  3. Set all Lambda functions to 0 concurrency"
echo "  4. Configure S3 lifecycle policy to abort incomplete multipart uploads"
echo ""
echo -e "${RED}WARNING: This will cause COMPLETE SERVICE OUTAGE${NC}"
echo ""

if [ "$AUTO_CONFIRM" != "--yes" ]; then
    read -p "Are you absolutely sure? Type 'EMERGENCY' to confirm: " CONFIRM
    if [ "$CONFIRM" != "EMERGENCY" ]; then
        echo "Cancelled"
        exit 0
    fi
fi

# 1. Stop all Step Functions executions
echo ""
echo "Step 1: Stopping all Step Functions executions..."

STATE_MACHINE_ARN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`TranslationStateMachineArn`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -n "$STATE_MACHINE_ARN" ]; then
    RUNNING_EXECUTIONS=$(aws stepfunctions list-executions \
        --state-machine-arn "$STATE_MACHINE_ARN" \
        --status-filter RUNNING \
        --query 'executions[].executionArn' \
        --output text)

    if [ -n "$RUNNING_EXECUTIONS" ]; then
        echo "$RUNNING_EXECUTIONS" | xargs -n1 aws stepfunctions stop-execution --execution-arn || true
        echo -e "${GREEN}✓ Stopped $(echo "$RUNNING_EXECUTIONS" | wc -w) executions${NC}"
    else
        echo "No running executions found"
    fi
else
    echo -e "${YELLOW}Warning: Could not find Step Functions state machine${NC}"
fi

# 2. Disable API Gateway
echo ""
echo "Step 2: Disabling API Gateway..."

API_ID=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiId`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -n "$API_ID" ]; then
    aws apigateway update-stage \
        --rest-api-id "$API_ID" \
        --stage-name v1 \
        --patch-operations \
            op=replace,path=/throttle/rateLimit,value=0 \
            op=replace,path=/throttle/burstLimit,value=0 \
        > /dev/null
    echo -e "${GREEN}✓ API Gateway throttled to 0 requests/sec${NC}"
else
    echo -e "${YELLOW}Warning: Could not find API Gateway${NC}"
fi

# 3. Set all Lambda concurrency to 0
echo ""
echo "Step 3: Setting Lambda concurrency to 0..."

LAMBDA_FUNCTIONS=$(aws lambda list-functions \
    --query "Functions[?ends_with(FunctionName, '-${STACK_NAME}')].FunctionName" \
    --output text 2>/dev/null || echo "")

if [ -n "$LAMBDA_FUNCTIONS" ]; then
    COUNT=0
    for FUNCTION in $LAMBDA_FUNCTIONS; do
        aws lambda put-function-concurrency \
            --function-name "$FUNCTION" \
            --reserved-concurrent-executions 0 \
            > /dev/null
        COUNT=$((COUNT + 1))
    done
    echo -e "${GREEN}✓ Set $COUNT Lambda functions to 0 concurrency${NC}"
else
    echo -e "${YELLOW}Warning: No Lambda functions found for stack${NC}"
fi

# 4. Add S3 lifecycle policy to abort incomplete multipart uploads
# ⚠️  LIMITATION: This only prevents NEW incomplete uploads from accumulating costs.
#    It does NOT stop existing multipart uploads or delete existing data.
#    For emergency cleanup of existing uploads, you must:
#      1. List incomplete uploads: aws s3api list-multipart-uploads --bucket <bucket>
#      2. Abort them manually: aws s3api abort-multipart-upload --bucket <bucket> --key <key> --upload-id <id>
echo ""
echo "Step 4: Configuring S3 lifecycle policy for incomplete multipart uploads..."

S3_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`UploadBucket`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -n "$S3_BUCKET" ]; then
    # Create lifecycle policy to abort incomplete multipart uploads after 1 day
    LIFECYCLE_POLICY=$(cat <<'EOF'
{
  "Rules": [
    {
      "Id": "AbortIncompleteMultipartUpload",
      "Status": "Enabled",
      "Prefix": "",
      "AbortIncompleteMultipartUpload": {
        "DaysAfterInitiation": 1
      }
    }
  ]
}
EOF
)
    echo "$LIFECYCLE_POLICY" | aws s3api put-bucket-lifecycle-configuration \
        --bucket "$S3_BUCKET" \
        --lifecycle-configuration file:///dev/stdin \
        > /dev/null 2>&1
    echo -e "${GREEN}✓ S3 lifecycle policy configured (aborts incomplete uploads after 1 day)${NC}"
    echo -e "${YELLOW}Note: This only affects NEW incomplete uploads. See comments in script for manual cleanup.${NC}"
else
    echo -e "${YELLOW}Warning: Could not find S3 upload bucket${NC}"
fi

# Summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ EMERGENCY COST CONTROL COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "All billable resources have been stopped for stack: $STACK_NAME"
echo ""
echo "To restore service:"
echo "1. Identify root cause of cost spike"
echo "2. Fix the issue (check CloudWatch Logs, AWS Cost Explorer)"
echo "3. Re-enable resources:"
echo ""
echo "   # Remove Lambda concurrency limits"
echo "   for fn in $LAMBDA_FUNCTIONS; do"
echo "     aws lambda delete-function-concurrency --function-name \$fn"
echo "   done"
echo ""
echo "   # Re-enable API Gateway"
echo "   aws apigateway update-stage \\"
echo "     --rest-api-id $API_ID \\"
echo "     --stage-name v1 \\"
echo "     --patch-operations \\"
echo "       op=replace,path=/throttle/rateLimit,value=100 \\"
echo "       op=replace,path=/throttle/burstLimit,value=200"
echo ""
echo "   # OR redeploy entire stack via CDK"
echo "   cd backend/infrastructure"
echo "   npx cdk deploy --context environment=<env>"
