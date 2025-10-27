#!/bin/bash
# Documentation Sanitization Script
# Removes sensitive information from all markdown files

set -e

PROJECT_ROOT="/Users/raymondl/Documents/LFMT POC/LFMT/lfmt-poc"

echo "🔒 Sanitizing documentation files..."

# Define sensitive patterns and their replacements
declare -A REPLACEMENTS=(
    ["427262291085"]="XXXXXXXXXXXX"
    ["8brwlwf68h"]="YOUR_API_ID"
    ["us-east-1_[A-Za-z0-9]+"]="us-east-1_XXXXXXXXX"
    ["arn:aws:iam::427262291085"]="arn:aws:iam::XXXXXXXXXXXX"
    ["https://8brwlwf68h.execute-api.us-east-1.amazonaws.com"]="https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com"
    ["4qlc7n27ptoad18k3rlj1nipg7"]="YOUR_CLIENT_ID"
)

# Files to sanitize (excluding archived files)
FILES=(
    "API-TESTING-GUIDE.md"
    "DEPLOYMENT-VERIFICATION.md"
    "PRODUCTION-DEPLOYMENT-GUIDE.md"
    "PRODUCTION-SETUP-CHECKLIST.md"
    "PROGRESS.md"
    "README.md"
)

cd "$PROJECT_ROOT"

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  Sanitizing $file..."

        # Create backup
        cp "$file" "${file}.bak"

        # Apply replacements
        for pattern in "${!REPLACEMENTS[@]}"; do
            replacement="${REPLACEMENTS[$pattern]}"
            # Use extended regex with -E flag
            sed -i '' -E "s/${pattern}/${replacement}/g" "$file"
        done

        echo "  ✓ $file sanitized"
    fi
done

echo ""
echo "✅ Documentation sanitization complete!"
echo ""
echo "📝 Note: Backup files created with .bak extension"
echo "   Remove backups with: rm *.bak"
