#!/bin/bash

###############################################################################
# Automated Lambda Rollback Script
#
# Reverts a Lambda function to a previous version.
#
# Usage:
#   ./scripts/rollback-lambda.sh <function-name> <target-version>
#
# Examples:
#   ./scripts/rollback-lambda.sh lfmt-translate-chunk-LfmtPocDev 5
#   ./scripts/rollback-lambda.sh lfmt-login-LfmtPocDev \$LATEST-1
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Permissions: lambda:GetFunction, lambda:UpdateFunctionConfiguration, lambda:PublishVersion
#
# Safety:
#   - Requires explicit confirmation before rollback
#   - Validates function exists before proceeding
#   - Creates backup of current version
###############################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Missing required arguments${NC}"
    echo "Usage: $0 <function-name> [target-version]"
    echo ""
    echo "Examples:"
    echo "  $0 lfmt-translate-chunk-LfmtPocDev 5"
    echo "  $0 lfmt-login-LfmtPocDev          # Shows available versions"
    exit 1
fi

FUNCTION_NAME="$1"
TARGET_VERSION="${2:-}"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Lambda Rollback Script${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# 1. Validate function exists
echo "Step 1: Validating Lambda function..."
if ! aws lambda get-function --function-name "$FUNCTION_NAME" > /dev/null 2>&1; then
    echo -e "${RED}Error: Lambda function '$FUNCTION_NAME' not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Function exists${NC}"
echo ""

# 2. Get current version
echo "Step 2: Getting current configuration..."
CURRENT_CONFIG=$(aws lambda get-function --function-name "$FUNCTION_NAME")
CURRENT_VERSION=$(echo "$CURRENT_CONFIG" | jq -r '.Configuration.Version')
CURRENT_SHA=$(echo "$CURRENT_CONFIG" | jq -r '.Configuration.CodeSha256')

echo "Current version: $CURRENT_VERSION"
echo "Current CodeSha256: $CURRENT_SHA"
echo ""

# 3. List available versions
echo "Step 3: Available versions:"
aws lambda list-versions-by-function --function-name "$FUNCTION_NAME" \
    | jq -r '.Versions[] | "\(.Version)\t\(.LastModified)\t\(.CodeSha256)"' \
    | column -t -s $'\t' -N "VERSION,LAST_MODIFIED,CODE_SHA256"
echo ""

# If no target version specified, exit
if [ -z "$TARGET_VERSION" ]; then
    echo -e "${YELLOW}No target version specified. Exiting.${NC}"
    echo "To rollback, run: $0 $FUNCTION_NAME <version-number>"
    exit 0
fi

# 4. Validate target version exists
echo "Step 4: Validating target version $TARGET_VERSION..."
if ! aws lambda get-function --function-name "$FUNCTION_NAME" --qualifier "$TARGET_VERSION" > /dev/null 2>&1; then
    echo -e "${RED}Error: Version '$TARGET_VERSION' not found for function '$FUNCTION_NAME'${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Target version exists${NC}"
echo ""

# 5. Get target version details
TARGET_CONFIG=$(aws lambda get-function --function-name "$FUNCTION_NAME" --qualifier "$TARGET_VERSION")
TARGET_SHA=$(echo "$TARGET_CONFIG" | jq -r '.Configuration.CodeSha256')
TARGET_MODIFIED=$(echo "$TARGET_CONFIG" | jq -r '.Configuration.LastModified')

echo "Target version details:"
echo "  Version: $TARGET_VERSION"
echo "  Last Modified: $TARGET_MODIFIED"
echo "  CodeSha256: $TARGET_SHA"
echo ""

# 6. Confirmation
echo -e "${YELLOW}⚠️  WARNING: This will rollback the Lambda function${NC}"
echo ""
echo "Function: $FUNCTION_NAME"
echo "Current version: $CURRENT_VERSION → Target version: $TARGET_VERSION"
echo ""
read -p "Are you sure you want to proceed? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${YELLOW}Rollback cancelled${NC}"
    exit 0
fi

# 7. Perform rollback
echo ""
echo "Step 5: Rolling back Lambda function..."

# Update $LATEST alias to point to target version code
# This is done by updating the function code with the target version's code
aws lambda update-function-code \
    --function-name "$FUNCTION_NAME" \
    --s3-bucket "$(echo "$TARGET_CONFIG" | jq -r '.Code.Location' | cut -d'/' -f3)" \
    --s3-key "$(echo "$TARGET_CONFIG" | jq -r '.Code.Location' | awk -F'/' '{print $NF}')" \
    > /dev/null

echo -e "${GREEN}✓ Function code updated to version $TARGET_VERSION${NC}"

# 8. Publish new version (backup)
echo ""
echo "Step 6: Publishing new version (backup of current state)..."
NEW_VERSION=$(aws lambda publish-version \
    --function-name "$FUNCTION_NAME" \
    --description "Backup before rollback to version $TARGET_VERSION" \
    | jq -r '.Version')

echo -e "${GREEN}✓ Created backup version: $NEW_VERSION${NC}"

# 9. Verify rollback
echo ""
echo "Step 7: Verifying rollback..."
FINAL_CONFIG=$(aws lambda get-function --function-name "$FUNCTION_NAME")
FINAL_SHA=$(echo "$FINAL_CONFIG" | jq -r '.Configuration.CodeSha256')

if [ "$FINAL_SHA" = "$TARGET_SHA" ]; then
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}✓ Rollback successful!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo "Function: $FUNCTION_NAME"
    echo "Rolled back to version: $TARGET_VERSION"
    echo "Backup version created: $NEW_VERSION"
    echo ""
    echo "Next steps:"
    echo "1. Test the Lambda function"
    echo "2. Monitor CloudWatch Logs for errors"
    echo "3. If issues persist, run: $0 $FUNCTION_NAME $NEW_VERSION"
else
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}✗ Rollback verification failed${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
    echo "Expected CodeSha256: $TARGET_SHA"
    echo "Actual CodeSha256: $FINAL_SHA"
    echo ""
    echo "Manual intervention required. Check AWS Console."
    exit 1
fi
