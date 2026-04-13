#!/bin/bash

###############################################################################
# Automated CDK Stack Rollback Script
#
# Rolls back a CloudFormation stack to a previous stable state.
#
# Usage:
#   ./scripts/rollback-cdk-stack.sh <stack-name> [--yes]
#
# Examples:
#   ./scripts/rollback-cdk-stack.sh LfmtPocDev
#   ./scripts/rollback-cdk-stack.sh LfmtPocProd --yes   # Skip confirmation
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - Permissions: cloudformation:DescribeStacks, cloudformation:UpdateStack, cloudformation:ContinueUpdateRollback
#
# Safety:
#   - Requires explicit confirmation before rollback (unless --yes flag)
#   - Validates stack exists and is in rollback-able state
#   - Monitors rollback progress with detailed status updates
###############################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 1 ]; then
    echo -e "${RED}Error: Missing required arguments${NC}"
    echo "Usage: $0 <stack-name> [--yes]"
    echo ""
    echo "Examples:"
    echo "  $0 LfmtPocDev"
    echo "  $0 LfmtPocProd --yes"
    exit 1
fi

STACK_NAME="$1"
AUTO_CONFIRM="${2:-}"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}CDK Stack Rollback Script${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# 1. Validate stack exists
echo "Step 1: Validating CloudFormation stack..."
if ! aws cloudformation describe-stacks --stack-name "$STACK_NAME" > /dev/null 2>&1; then
    echo -e "${RED}Error: Stack '$STACK_NAME' not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Stack exists${NC}"
echo ""

# 2. Get current stack status
echo "Step 2: Getting current stack status..."
STACK_INFO=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME")
CURRENT_STATUS=$(echo "$STACK_INFO" | jq -r '.Stacks[0].StackStatus')
CREATION_TIME=$(echo "$STACK_INFO" | jq -r '.Stacks[0].CreationTime')
LAST_UPDATE=$(echo "$STACK_INFO" | jq -r '.Stacks[0].LastUpdatedTime // "Never"')

echo "Stack Name: $STACK_NAME"
echo "Status: $CURRENT_STATUS"
echo "Created: $CREATION_TIME"
echo "Last Updated: $LAST_UPDATE"
echo ""

# 3. Check if stack is in a rollback-able state
case "$CURRENT_STATUS" in
    UPDATE_FAILED|UPDATE_ROLLBACK_FAILED)
        echo -e "${YELLOW}⚠️  Stack is in failed state: $CURRENT_STATUS${NC}"
        echo "Rollback is recommended."
        ;;
    UPDATE_IN_PROGRESS|UPDATE_COMPLETE_CLEANUP_IN_PROGRESS)
        echo -e "${RED}Error: Stack is currently being updated${NC}"
        echo "Wait for the current operation to complete before rolling back."
        exit 1
        ;;
    UPDATE_ROLLBACK_IN_PROGRESS|ROLLBACK_IN_PROGRESS)
        echo -e "${YELLOW}Info: Stack rollback already in progress${NC}"
        echo "Monitoring rollback status..."
        ;;
    CREATE_IN_PROGRESS|DELETE_IN_PROGRESS)
        echo -e "${RED}Error: Cannot rollback stack in $CURRENT_STATUS state${NC}"
        exit 1
        ;;
    UPDATE_COMPLETE|CREATE_COMPLETE)
        echo -e "${YELLOW}⚠️  Stack is in stable state: $CURRENT_STATUS${NC}"
        echo "Rolling back will revert to the previous stable state."
        ;;
    *)
        echo -e "${YELLOW}Warning: Unusual stack status: $CURRENT_STATUS${NC}"
        ;;
esac
echo ""

# 4. Get stack events (last 10)
echo "Step 3: Recent stack events:"
aws cloudformation describe-stack-events --stack-name "$STACK_NAME" \
    --max-items 10 \
    | jq -r '.StackEvents[] | "\(.Timestamp)\t\(.ResourceStatus)\t\(.LogicalResourceId)\t\(.ResourceStatusReason // "")"' \
    | column -t -s $'\t' -N "TIMESTAMP,STATUS,RESOURCE,REASON" \
    | head -n 11
echo ""

# 5. Confirmation
if [ "$AUTO_CONFIRM" != "--yes" ]; then
    echo -e "${YELLOW}⚠️  WARNING: This will rollback the CloudFormation stack${NC}"
    echo ""
    echo "Stack: $STACK_NAME"
    echo "Current Status: $CURRENT_STATUS"
    echo ""
    echo "This action will:"
    echo "  1. Revert infrastructure changes to the previous stable state"
    echo "  2. May cause downtime for affected services"
    echo "  3. Cannot be undone (except by redeploying)"
    echo ""
    read -p "Are you sure you want to proceed? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        echo -e "${YELLOW}Rollback cancelled${NC}"
        exit 0
    fi
fi

# 6. Initiate rollback based on current status
echo ""
echo "Step 4: Initiating rollback..."

case "$CURRENT_STATUS" in
    UPDATE_ROLLBACK_FAILED|UPDATE_FAILED)
        # Continue rollback for failed update
        echo "Continuing rollback for failed update..."
        aws cloudformation continue-update-rollback --stack-name "$STACK_NAME"
        ;;
    UPDATE_COMPLETE|CREATE_COMPLETE)
        # For stable stacks, we need to trigger a new update-rollback
        # This requires canceling the current update first (if in progress)
        echo "Triggering rollback via cancel-update-stack..."
        aws cloudformation cancel-update-stack --stack-name "$STACK_NAME" 2>/dev/null || true
        sleep 5
        aws cloudformation continue-update-rollback --stack-name "$STACK_NAME" 2>/dev/null || {
            echo -e "${YELLOW}Note: Stack may already be in stable state. Manual rollback required via:${NC}"
            echo "  cd backend/infrastructure"
            echo "  git checkout <previous-commit>"
            echo "  npx cdk deploy --context environment=<env>"
            exit 1
        }
        ;;
    UPDATE_ROLLBACK_IN_PROGRESS|ROLLBACK_IN_PROGRESS)
        echo "Rollback already in progress. Monitoring..."
        ;;
    *)
        echo -e "${RED}Error: Cannot initiate rollback from status: $CURRENT_STATUS${NC}"
        exit 1
        ;;
esac

echo -e "${GREEN}✓ Rollback initiated${NC}"
echo ""

# 7. Monitor rollback progress
echo "Step 5: Monitoring rollback progress..."
echo "Press Ctrl+C to stop monitoring (rollback will continue in background)"
echo ""

LAST_EVENT_ID=""
while true; do
    # Get current stack status
    CURRENT_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
        | jq -r '.Stacks[0].StackStatus')

    # Get latest stack event
    LATEST_EVENT=$(aws cloudformation describe-stack-events --stack-name "$STACK_NAME" --max-items 1)
    EVENT_ID=$(echo "$LATEST_EVENT" | jq -r '.StackEvents[0].EventId')
    EVENT_TIME=$(echo "$LATEST_EVENT" | jq -r '.StackEvents[0].Timestamp')
    EVENT_STATUS=$(echo "$LATEST_EVENT" | jq -r '.StackEvents[0].ResourceStatus')
    EVENT_RESOURCE=$(echo "$LATEST_EVENT" | jq -r '.StackEvents[0].LogicalResourceId')
    EVENT_REASON=$(echo "$LATEST_EVENT" | jq -r '.StackEvents[0].ResourceStatusReason // ""')

    # Print new events
    if [ "$EVENT_ID" != "$LAST_EVENT_ID" ]; then
        echo -e "${BLUE}[$EVENT_TIME]${NC} $EVENT_STATUS - $EVENT_RESOURCE"
        if [ -n "$EVENT_REASON" ]; then
            echo "  Reason: $EVENT_REASON"
        fi
        LAST_EVENT_ID="$EVENT_ID"
    fi

    # Check if rollback is complete
    case "$CURRENT_STATUS" in
        UPDATE_ROLLBACK_COMPLETE|ROLLBACK_COMPLETE)
            echo ""
            echo -e "${GREEN}========================================${NC}"
            echo -e "${GREEN}✓ Rollback completed successfully!${NC}"
            echo -e "${GREEN}========================================${NC}"
            echo ""
            echo "Stack: $STACK_NAME"
            echo "Status: $CURRENT_STATUS"
            echo ""
            echo "Next steps:"
            echo "1. Verify application functionality"
            echo "2. Check CloudWatch Logs for errors"
            echo "3. If issues persist, review stack events in AWS Console"
            exit 0
            ;;
        UPDATE_ROLLBACK_FAILED|ROLLBACK_FAILED)
            echo ""
            echo -e "${RED}========================================${NC}"
            echo -e "${RED}✗ Rollback failed${NC}"
            echo -e "${RED}========================================${NC}"
            echo ""
            echo "Stack: $STACK_NAME"
            echo "Status: $CURRENT_STATUS"
            echo ""
            echo "Manual intervention required:"
            echo "1. Check AWS CloudFormation console for details"
            echo "2. Review stack events for specific failures"
            echo "3. May need to manually fix resources or delete stack"
            exit 1
            ;;
        *)
            # Still in progress, continue monitoring
            ;;
    esac

    sleep 10
done
