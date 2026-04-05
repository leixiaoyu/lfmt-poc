#!/bin/bash

###############################################################################
# Automated DynamoDB Point-in-Time Recovery (PITR) Restore Script
#
# Restores a DynamoDB table to a previous point in time using PITR.
#
# Usage:
#   ./scripts/rollback-database.sh <table-name> <timestamp> [--yes]
#
# Examples:
#   ./scripts/rollback-database.sh lfmt-jobs-LfmtPocDev "2025-04-05T10:30:00Z"
#   ./scripts/rollback-database.sh lfmt-users-LfmtPocDev "2025-04-05T10:30:00Z" --yes
#
# Timestamp Format: ISO 8601 (UTC), e.g., "2025-04-05T10:30:00Z"
#
# Prerequisites:
#   - AWS CLI configured with appropriate credentials
#   - PITR enabled on the source table
#   - Permissions: dynamodb:DescribeTable, dynamodb:RestoreTableToPointInTime
#
# Safety:
#   - Requires explicit confirmation before restore
#   - Validates PITR is enabled and timestamp is within retention window
#   - Creates new table (does not overwrite source table)
#   - Manual steps required to swap tables
###############################################################################

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check arguments
if [ $# -lt 2 ]; then
    echo -e "${RED}Error: Missing required arguments${NC}"
    echo "Usage: $0 <table-name> <timestamp> [--yes]"
    echo ""
    echo "Timestamp Format: ISO 8601 (UTC), e.g., \"2025-04-05T10:30:00Z\""
    echo ""
    echo "Examples:"
    echo "  $0 lfmt-jobs-LfmtPocDev \"2025-04-05T10:30:00Z\""
    echo "  $0 lfmt-users-LfmtPocDev \"2025-04-05T10:30:00Z\" --yes"
    exit 1
fi

SOURCE_TABLE="$1"
RESTORE_TIMESTAMP="$2"
AUTO_CONFIRM="${3:-}"

# Generate target table name (append -restored-<date>)
RESTORE_DATE=$(echo "$RESTORE_TIMESTAMP" | cut -d'T' -f1)
TARGET_TABLE="${SOURCE_TABLE}-restored-${RESTORE_DATE}"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}DynamoDB Point-in-Time Recovery Script${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# 1. Validate source table exists
echo "Step 1: Validating source table..."
if ! aws dynamodb describe-table --table-name "$SOURCE_TABLE" > /dev/null 2>&1; then
    echo -e "${RED}Error: Table '$SOURCE_TABLE' not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Source table exists${NC}"
echo ""

# 2. Check PITR status
echo "Step 2: Checking Point-in-Time Recovery status..."
TABLE_INFO=$(aws dynamodb describe-table --table-name "$SOURCE_TABLE")
PITR_STATUS=$(aws dynamodb describe-continuous-backups --table-name "$SOURCE_TABLE" \
    | jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.PointInTimeRecoveryStatus')

if [ "$PITR_STATUS" != "ENABLED" ]; then
    echo -e "${RED}Error: Point-in-Time Recovery is not enabled for table '$SOURCE_TABLE'${NC}"
    echo ""
    echo "To enable PITR, run:"
    echo "  aws dynamodb update-continuous-backups \\"
    echo "    --table-name $SOURCE_TABLE \\"
    echo "    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true"
    exit 1
fi
echo -e "${GREEN}✓ PITR is enabled${NC}"
echo ""

# 3. Get PITR earliest restore time
echo "Step 3: Validating restore timestamp..."
EARLIEST_RESTORE_TIME=$(aws dynamodb describe-continuous-backups --table-name "$SOURCE_TABLE" \
    | jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.EarliestRestorableDateTime')
LATEST_RESTORE_TIME=$(aws dynamodb describe-continuous-backups --table-name "$SOURCE_TABLE" \
    | jq -r '.ContinuousBackupsDescription.PointInTimeRecoveryDescription.LatestRestorableDateTime')

echo "PITR Restore Window:"
echo "  Earliest: $EARLIEST_RESTORE_TIME"
echo "  Latest: $LATEST_RESTORE_TIME"
echo "  Requested: $RESTORE_TIMESTAMP"
echo ""

# Validate timestamp is within restore window
EARLIEST_EPOCH=$(date -u -d "$EARLIEST_RESTORE_TIME" +%s 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%S" "$EARLIEST_RESTORE_TIME" +%s)
LATEST_EPOCH=$(date -u -d "$LATEST_RESTORE_TIME" +%s 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%S" "$LATEST_RESTORE_TIME" +%s)
RESTORE_EPOCH=$(date -u -d "$RESTORE_TIMESTAMP" +%s 2>/dev/null || date -j -u -f "%Y-%m-%dT%H:%M:%S" "$RESTORE_TIMESTAMP" +%s)

if [ "$RESTORE_EPOCH" -lt "$EARLIEST_EPOCH" ] || [ "$RESTORE_EPOCH" -gt "$LATEST_EPOCH" ]; then
    echo -e "${RED}Error: Restore timestamp is outside the PITR window${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Timestamp is within PITR window${NC}"
echo ""

# 4. Check if target table already exists
echo "Step 4: Checking target table..."
if aws dynamodb describe-table --table-name "$TARGET_TABLE" > /dev/null 2>&1; then
    echo -e "${YELLOW}Warning: Target table '$TARGET_TABLE' already exists${NC}"
    echo ""
    read -p "Delete existing target table and continue? (yes/no): " DELETE_CONFIRM
    if [ "$DELETE_CONFIRM" = "yes" ]; then
        echo "Deleting existing target table..."
        aws dynamodb delete-table --table-name "$TARGET_TABLE" > /dev/null
        echo "Waiting for table deletion..."
        aws dynamodb wait table-not-exists --table-name "$TARGET_TABLE"
        echo -e "${GREEN}✓ Existing table deleted${NC}"
    else
        echo -e "${YELLOW}Restore cancelled${NC}"
        exit 0
    fi
else
    echo -e "${GREEN}✓ Target table does not exist (will be created)${NC}"
fi
echo ""

# 5. Get source table details
echo "Step 5: Source table details:"
ITEM_COUNT=$(echo "$TABLE_INFO" | jq -r '.Table.ItemCount')
TABLE_SIZE=$(echo "$TABLE_INFO" | jq -r '.Table.TableSizeBytes')
TABLE_STATUS=$(echo "$TABLE_INFO" | jq -r '.Table.TableStatus')

echo "  Table Name: $SOURCE_TABLE"
echo "  Status: $TABLE_STATUS"
echo "  Item Count: $ITEM_COUNT"
echo "  Size: $(numfmt --to=iec-i --suffix=B $TABLE_SIZE 2>/dev/null || echo "$TABLE_SIZE bytes")"
echo ""

# 6. Confirmation
if [ "$AUTO_CONFIRM" != "--yes" ]; then
    echo -e "${YELLOW}⚠️  WARNING: This will restore the DynamoDB table${NC}"
    echo ""
    echo "Source Table: $SOURCE_TABLE"
    echo "Restore Timestamp: $RESTORE_TIMESTAMP"
    echo "Target Table: $TARGET_TABLE"
    echo ""
    echo "This action will:"
    echo "  1. Create a new table '$TARGET_TABLE' with data from $RESTORE_TIMESTAMP"
    echo "  2. NOT modify the source table '$SOURCE_TABLE'"
    echo "  3. Require manual steps to swap tables (see output after restore)"
    echo ""
    read -p "Are you sure you want to proceed? (yes/no): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        echo -e "${YELLOW}Restore cancelled${NC}"
        exit 0
    fi
fi

# 7. Initiate restore
echo ""
echo "Step 6: Initiating Point-in-Time Recovery..."
aws dynamodb restore-table-to-point-in-time \
    --source-table-name "$SOURCE_TABLE" \
    --target-table-name "$TARGET_TABLE" \
    --restore-date-time "$RESTORE_TIMESTAMP" \
    --no-use-latest-restorable-time \
    > /dev/null

echo -e "${GREEN}✓ Restore initiated${NC}"
echo ""

# 8. Monitor restore progress
echo "Step 7: Monitoring restore progress..."
echo "Press Ctrl+C to stop monitoring (restore will continue in background)"
echo ""

while true; do
    TABLE_STATUS=$(aws dynamodb describe-table --table-name "$TARGET_TABLE" 2>/dev/null \
        | jq -r '.Table.TableStatus' || echo "CREATING")

    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} Status: $TABLE_STATUS"

    case "$TABLE_STATUS" in
        ACTIVE)
            echo ""
            echo -e "${GREEN}========================================${NC}"
            echo -e "${GREEN}✓ Restore completed successfully!${NC}"
            echo -e "${GREEN}========================================${NC}"
            echo ""
            echo "Source Table: $SOURCE_TABLE"
            echo "Restored Table: $TARGET_TABLE"
            echo "Restore Timestamp: $RESTORE_TIMESTAMP"
            echo ""
            echo "Next steps (MANUAL):"
            echo "1. Verify restored data in table '$TARGET_TABLE'"
            echo "2. Stop all applications using '$SOURCE_TABLE'"
            echo "3. Rename tables to swap:"
            echo "   a. Rename $SOURCE_TABLE → $SOURCE_TABLE-old"
            echo "   b. Rename $TARGET_TABLE → $SOURCE_TABLE"
            echo "4. Restart applications"
            echo "5. After verification, delete $SOURCE_TABLE-old"
            echo ""
            echo "AWS CLI commands to rename tables:"
            echo "  # Backup source table"
            echo "  aws dynamodb create-backup --table-name $SOURCE_TABLE --backup-name ${SOURCE_TABLE}-backup-$(date +%Y%m%d)"
            echo ""
            echo "  # Delete source table (CAUTION!)"
            echo "  aws dynamodb delete-table --table-name $SOURCE_TABLE"
            echo "  aws dynamodb wait table-not-exists --table-name $SOURCE_TABLE"
            echo ""
            echo "  # Rename restored table"
            echo "  aws dynamodb restore-table-from-backup \\"
            echo "    --target-table-name $SOURCE_TABLE \\"
            echo "    --backup-arn \$(aws dynamodb describe-backup --backup-arn <backup-arn> | jq -r '.BackupDescription.BackupArn')"
            exit 0
            ;;
        CREATING)
            # Still in progress
            ;;
        *)
            echo ""
            echo -e "${RED}========================================${NC}"
            echo -e "${RED}✗ Restore failed or in unexpected state${NC}"
            echo -e "${RED}========================================${NC}"
            echo ""
            echo "Status: $TABLE_STATUS"
            echo ""
            echo "Check AWS Console for details."
            exit 1
            ;;
    esac

    sleep 15
done
