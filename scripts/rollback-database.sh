#!/bin/bash

###############################################################################
# Automated DynamoDB Point-in-Time Recovery (PITR) Restore Script
#
# Restores a DynamoDB table to a previous point in time using PITR.
#
# Usage:
#   ./scripts/rollback-database.sh <table-name> <timestamp> [--yes] [--dry-run]
#
# Examples:
#   ./scripts/rollback-database.sh lfmt-jobs-LfmtPocDev "2025-04-05T10:30:00Z"
#   ./scripts/rollback-database.sh lfmt-users-LfmtPocDev "2025-04-05T10:30:00Z" --yes
#   ./scripts/rollback-database.sh lfmt-jobs-LfmtPocDev "2025-04-05T10:30:00Z" --dry-run
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
    echo "Usage: $0 <table-name> <timestamp> [--yes] [--dry-run]"
    echo ""
    echo "Timestamp Format: ISO 8601 (UTC), e.g., \"2025-04-05T10:30:00Z\""
    echo ""
    echo "Examples:"
    echo "  $0 lfmt-jobs-LfmtPocDev \"2025-04-05T10:30:00Z\""
    echo "  $0 lfmt-users-LfmtPocDev \"2025-04-05T10:30:00Z\" --yes"
    echo "  $0 lfmt-jobs-LfmtPocDev \"2025-04-05T10:30:00Z\" --dry-run"
    exit 1
fi

SOURCE_TABLE="$1"
RESTORE_TIMESTAMP="$2"
AUTO_CONFIRM="${3:-}"
DRY_RUN=false

# Parse additional flags
for arg in "$@"; do
    if [ "$arg" = "--dry-run" ]; then
        DRY_RUN=true
    fi
done

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

# 7. Dry-run mode check
if [ "$DRY_RUN" = true ]; then
    echo ""
    echo -e "${YELLOW}========================================${NC}"
    echo -e "${YELLOW}DRY-RUN MODE - No changes will be made${NC}"
    echo -e "${YELLOW}========================================${NC}"
    echo ""
    echo "Would restore:"
    echo "  Source Table: $SOURCE_TABLE"
    echo "  Restore Timestamp: $RESTORE_TIMESTAMP"
    echo "  Target Table: $TARGET_TABLE"
    echo ""
    echo "Command that would be executed:"
    echo "  aws dynamodb restore-table-to-point-in-time \\"
    echo "    --source-table-name $SOURCE_TABLE \\"
    echo "    --target-table-name $TARGET_TABLE \\"
    echo "    --restore-date-time $RESTORE_TIMESTAMP"
    echo ""
    echo "To execute, run without --dry-run flag"
    exit 0
fi

# 8. Initiate restore
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

# 9. Monitor restore progress
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
            echo -e "${GREEN}✓ Restore completed!${NC}"
            echo ""
            break
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

# 10. Validate restored data
echo ""
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Step 8: Validating Restored Data${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# 10.1. Compare row counts
echo "10.1. Comparing row counts..."
SOURCE_ITEM_COUNT=$(aws dynamodb describe-table --table-name "$SOURCE_TABLE" | jq -r '.Table.ItemCount')
TARGET_ITEM_COUNT=$(aws dynamodb describe-table --table-name "$TARGET_TABLE" | jq -r '.Table.ItemCount')

echo "  Source table ($SOURCE_TABLE): $SOURCE_ITEM_COUNT items"
echo "  Restored table ($TARGET_TABLE): $TARGET_ITEM_COUNT items"

if [ "$SOURCE_ITEM_COUNT" -eq 0 ] && [ "$TARGET_ITEM_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ Both tables are empty (counts match)${NC}"
elif [ "$SOURCE_ITEM_COUNT" -eq "$TARGET_ITEM_COUNT" ]; then
    echo -e "${GREEN}✓ Row counts match${NC}"
else
    DIFF=$((SOURCE_ITEM_COUNT - TARGET_ITEM_COUNT))
    echo -e "${YELLOW}⚠  Row count mismatch: difference of $DIFF items${NC}"
    echo ""
    echo "This is expected if:"
    echo "  - Data was added/deleted between restore timestamp and now"
    echo "  - You are restoring to an earlier point in time"
    echo ""
fi
echo ""

# 10.2. Spot-check known records
echo "10.2. Spot-checking records..."
echo "To verify data integrity, please provide a known record key to spot-check."
echo "Leave blank to skip spot-check."
echo ""

# Get primary key schema and type
PRIMARY_KEY=$(aws dynamodb describe-table --table-name "$SOURCE_TABLE" \
    | jq -r '.Table.KeySchema[] | select(.KeyType=="HASH") | .AttributeName')
KEY_TYPE=$(aws dynamodb describe-table --table-name "$SOURCE_TABLE" \
    | jq -r '.Table.AttributeDefinitions[] | select(.AttributeName=="'$PRIMARY_KEY'") | .AttributeType')

# Check for sort key (composite key)
SORT_KEY=$(aws dynamodb describe-table --table-name "$SOURCE_TABLE" \
    | jq -r '.Table.KeySchema[] | select(.KeyType=="RANGE") | .AttributeName')

if [ -n "$SORT_KEY" ]; then
    SORT_KEY_TYPE=$(aws dynamodb describe-table --table-name "$SOURCE_TABLE" \
        | jq -r '.Table.AttributeDefinitions[] | select(.AttributeName=="'$SORT_KEY'") | .AttributeType')
    echo "Primary key: $PRIMARY_KEY ($KEY_TYPE)"
    echo "Sort key: $SORT_KEY ($SORT_KEY_TYPE)"
    echo -e "${YELLOW}Note: This table uses a composite key. You must provide both partition and sort key values.${NC}"
else
    echo "Primary key attribute: $PRIMARY_KEY ($KEY_TYPE)"
fi
echo ""

read -p "Enter value for $PRIMARY_KEY to spot-check (or press Enter to skip): " SPOT_CHECK_KEY

if [ -n "$SPOT_CHECK_KEY" ]; then
    # Build key JSON based on whether sort key exists
    if [ -n "$SORT_KEY" ]; then
        read -p "Enter value for $SORT_KEY: " SPOT_CHECK_SORT_KEY
        if [ -z "$SPOT_CHECK_SORT_KEY" ]; then
            echo -e "${YELLOW}Sort key value required for composite key table. Skipping spot-check.${NC}"
            SPOT_CHECK_KEY=""
        else
            KEY_JSON="{\"$PRIMARY_KEY\": {\"$KEY_TYPE\": \"$SPOT_CHECK_KEY\"}, \"$SORT_KEY\": {\"$SORT_KEY_TYPE\": \"$SPOT_CHECK_SORT_KEY\"}}"
        fi
    else
        KEY_JSON="{\"$PRIMARY_KEY\": {\"$KEY_TYPE\": \"$SPOT_CHECK_KEY\"}}"
    fi
fi

if [ -n "$SPOT_CHECK_KEY" ]; then
    # Check if record exists in source
    SOURCE_RECORD=$(aws dynamodb get-item \
        --table-name "$SOURCE_TABLE" \
        --key "$KEY_JSON" \
        2>/dev/null || echo "")

    # Check if record exists in target
    TARGET_RECORD=$(aws dynamodb get-item \
        --table-name "$TARGET_TABLE" \
        --key "$KEY_JSON" \
        2>/dev/null || echo "")

    if [ -z "$SOURCE_RECORD" ] && [ -z "$TARGET_RECORD" ]; then
        echo -e "${YELLOW}⚠  Record not found in either table${NC}"
    elif [ -n "$SOURCE_RECORD" ] && [ -z "$TARGET_RECORD" ]; then
        echo -e "${YELLOW}⚠  Record exists in source but not in restored table${NC}"
        echo "  This is expected if the record was created after $RESTORE_TIMESTAMP"
    elif [ -z "$SOURCE_RECORD" ] && [ -n "$TARGET_RECORD" ]; then
        echo -e "${YELLOW}⚠  Record exists in restored table but not in source${NC}"
        echo "  This is expected if the record was deleted after $RESTORE_TIMESTAMP"
    else
        echo -e "${GREEN}✓ Record found in both tables${NC}"
    fi
else
    echo "Skipped spot-check"
fi
echo ""

# 10.3. Validation summary
echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}Validation Complete${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""
echo "Source Table: $SOURCE_TABLE"
echo "Restored Table: $TARGET_TABLE"
echo "Restore Timestamp: $RESTORE_TIMESTAMP"
echo ""
echo -e "${GREEN}Next steps (MANUAL):${NC}"
echo "1. Review validation results above"
echo "2. Perform additional spot-checks if needed:"
echo "   aws dynamodb scan --table-name $TARGET_TABLE --limit 10"
echo "3. Stop all applications using '$SOURCE_TABLE'"
echo "4. Rename tables to swap (see commands below)"
echo "5. Restart applications"
echo "6. After verification, delete $SOURCE_TABLE-old"
echo ""
echo "AWS CLI commands to rename tables:"
echo "  # Backup source table"
echo "  aws dynamodb create-backup --table-name $SOURCE_TABLE --backup-name ${SOURCE_TABLE}-backup-\$(date +%Y%m%d)"
echo ""
echo "  # Delete source table (CAUTION!)"
echo "  aws dynamodb delete-table --table-name $SOURCE_TABLE"
echo "  aws dynamodb wait table-not-exists --table-name $SOURCE_TABLE"
echo ""
echo "  # Rename restored table (requires manual table recreation or use AWS Backup)"
echo "  # DynamoDB does not support direct table renaming"
echo "  # Alternative: Update application config to point to $TARGET_TABLE"
echo ""

# Exit with error if validation failed critically
if [ "$SOURCE_ITEM_COUNT" -ne "$TARGET_ITEM_COUNT" ] && [ "$SOURCE_ITEM_COUNT" -gt 0 ]; then
    DIFF_PERCENT=$(echo "scale=2; ($DIFF * 100) / $SOURCE_ITEM_COUNT" | bc)
    if (( $(echo "$DIFF_PERCENT > 10" | bc -l) )); then
        echo -e "${RED}⚠  VALIDATION WARNING: Row count differs by more than 10%${NC}"
        echo "  Investigate before proceeding with table swap."
        echo ""
        exit 1
    fi
fi

echo -e "${GREEN}✓ Validation checks passed${NC}"
exit 0
