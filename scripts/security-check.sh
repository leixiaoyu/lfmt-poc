#!/bin/bash

# LFMT POC Security Check Script
# Runs the same security checks as CI/CD pipeline locally

set -e

echo ""
echo "🔒 LFMT POC Security Check"
echo "=========================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${2}${1}${NC}"
}

print_status "🔍 Scanning for hardcoded secrets..." "$YELLOW"

# Check for AWS credentials
print_status "Checking for AWS credentials..." "$YELLOW"
if grep -r -E "(aws_access_key_id|aws_secret_access_key|AKIA[0-9A-Z]{16})" --include="*.ts" --include="*.js" --exclude-dir=node_modules . 2>/dev/null; then
    print_status "❌ AWS credentials found in code" "$RED"
    exit 1
fi

# Check for hardcoded passwords in production code
print_status "Checking for hardcoded passwords..." "$YELLOW"
if grep -r -E "password\s*[:=]\s*['\"][^'\"]{8,}['\"]" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude="*test*" --exclude="*interface*" --exclude="*types*" . 2>/dev/null; then
    print_status "❌ Hardcoded passwords found in production code" "$RED"
    exit 1
fi

# Check for API tokens and secrets
print_status "Checking for API tokens and secrets..." "$YELLOW"
if grep -r -E "(api_?secret|auth_?token|bearer_?token)\s*[:=]\s*['\"][a-zA-Z0-9]{20,}['\"]" --include="*.ts" --include="*.js" --exclude-dir=node_modules --exclude="*test*" . 2>/dev/null; then
    print_status "❌ API secrets or tokens found in production code" "$RED"
    exit 1
fi

# Check for database connection strings
print_status "Checking for database connection strings..." "$YELLOW"
if grep -r -E "(mongodb://|postgres://|mysql://)" --include="*.ts" --include="*.js" --exclude-dir=node_modules . 2>/dev/null; then
    print_status "❌ Database connection strings found in code" "$RED"
    exit 1
fi

print_status "✅ No hardcoded secrets detected" "$GREEN"

# Run npm audit if package-lock.json files exist
print_status "🔍 Running dependency security audits..." "$YELLOW"

if [ -f "shared-types/package-lock.json" ]; then
    print_status "Auditing shared-types dependencies..." "$YELLOW"
    cd shared-types && npm audit --audit-level=high && cd ..
    print_status "✅ Shared-types audit passed" "$GREEN"
fi

if [ -f "backend/infrastructure/package-lock.json" ]; then
    print_status "Auditing infrastructure dependencies..." "$YELLOW"
    cd backend/infrastructure && npm audit --audit-level=high && cd ..
    print_status "✅ Infrastructure audit passed" "$GREEN"
fi

echo ""
print_status "🎯 Security check complete!" "$GREEN"
print_status "✅ No security issues detected" "$GREEN"
echo ""