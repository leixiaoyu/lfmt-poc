#!/bin/bash

#
# Security Scanning Script
#
# This script performs comprehensive security checks before committing code.
# It scans for common security issues including:
# - Hardcoded credentials and API keys
# - Sensitive files in git staging
# - Potential secret leaks
# - Insecure configurations
#
# Usage:
#   ./scripts/security-scan.sh              # Scan all files
#   ./scripts/security-scan.sh --staged     # Scan only staged files
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${2}${1}${NC}"
}

# Function to print section headers
print_header() {
    echo ""
    echo "========================================="
    print_status "$1" "$BLUE"
    echo "========================================="
    echo ""
}

# Parse command line arguments
STAGED_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --staged)
            STAGED_ONLY=true
            shift
            ;;
        *)
            print_status "Unknown option: $1" "$RED"
            exit 1
            ;;
    esac
done

print_header "LFMT POC - Security Scanner"

# Track if any issues were found
ISSUES_FOUND=0

# 1. Check for hardcoded AWS credentials
print_status "🔍 Scanning for hardcoded AWS credentials..." "$BLUE"

if [ "$STAGED_ONLY" = true ]; then
    # Check staged files only
    STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|json|yml|yaml|sh)$' | grep -v "__tests__" | grep -v "test\." | grep -v ".test\." | grep -v ".spec\." || true)

    if [ -n "$STAGED_FILES" ]; then
        if echo "$STAGED_FILES" | xargs grep -HnE "(AKIA[0-9A-Z]{16})" 2>/dev/null | grep -v "test" | grep -v "#"; then
            print_status "❌ SECURITY ISSUE: Hardcoded AWS credentials found in staged files!" "$RED"
            ISSUES_FOUND=1
        else
            print_status "✅ No hardcoded AWS credentials found in staged files" "$GREEN"
        fi
    else
        print_status "✅ No non-test files staged" "$GREEN"
    fi
else
    # Check all tracked non-test files
    if git ls-files | grep -E '\.(ts|tsx|js|jsx|json|yml|yaml|sh)$' | grep -v "__tests__" | grep -v "test\." | grep -v ".test\." | grep -v ".spec\." | xargs grep -HnE "(AKIA[0-9A-Z]{16})" 2>/dev/null; then
        print_status "❌ SECURITY ISSUE: Hardcoded AWS credentials found!" "$RED"
        ISSUES_FOUND=1
    else
        print_status "✅ No hardcoded AWS credentials found" "$GREEN"
    fi
fi

# 2. Check for API keys and tokens (excluding test files)
print_status "🔍 Scanning for API keys and tokens..." "$BLUE"

PATTERNS=(
    "api[_-]?key[_-]?=['\"][a-zA-Z0-9]{32,}"
    "secret[_-]?key[_-]?=['\"][a-zA-Z0-9]{32,}"
    "ghp_[a-zA-Z0-9]{36}"
    "github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}"
    "sk_live_[a-zA-Z0-9]{24}"
    "sk_test_[a-zA-Z0-9]{24}"
    "AIza[0-9A-Za-z\\-_]{35}"
)

API_KEY_ISSUES=0

for pattern in "${PATTERNS[@]}"; do
    if [ "$STAGED_ONLY" = true ]; then
        NON_TEST_STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|json|yml|yaml|sh)$' | grep -v "__tests__" | grep -v "test\." | grep -v ".test\." | grep -v ".spec\." || true)
        if [ -n "$NON_TEST_STAGED" ]; then
            if echo "$NON_TEST_STAGED" | xargs grep -HnEi "$pattern" 2>/dev/null; then
                print_status "❌ SECURITY ISSUE: Potential API key or token found in staged files!" "$RED"
                print_status "   Pattern: $pattern" "$YELLOW"
                API_KEY_ISSUES=1
                ISSUES_FOUND=1
            fi
        fi
    else
        if git ls-files | grep -E '\.(ts|tsx|js|jsx|json|yml|yaml|sh)$' | grep -v "__tests__" | grep -v "test\." | grep -v ".test\." | grep -v ".spec\." | xargs grep -HnEi "$pattern" 2>/dev/null; then
            print_status "❌ SECURITY ISSUE: Potential API key or token found!" "$RED"
            print_status "   Pattern: $pattern" "$YELLOW"
            API_KEY_ISSUES=1
            ISSUES_FOUND=1
        fi
    fi
done

if [ "$API_KEY_ISSUES" -eq 0 ]; then
    print_status "✅ No API keys or tokens found" "$GREEN"
fi

# 3. Check for sensitive environment files
print_status "🔍 Checking for sensitive environment files in git..." "$BLUE"

SENSITIVE_FILES=(
    "^\.env$"
    "^\.env\.local$"
    "^\.env\.production$"
    "^\.env\.development$"
    ".*\.env\..*\.local$"
    "config/prod\..*"
    ".*\.pem$"
    ".*\.key$"
    ".*\.p12$"
    ".*\.pfx$"
    "credentials\.json$"
    "serviceAccount\.json$"
    "google-credentials\.json$"
)

# Exclude .env.example and env.ts files
FOUND_SENSITIVE=false

for file_pattern in "${SENSITIVE_FILES[@]}"; do
    FOUND=$(git ls-files | grep -E "$file_pattern" | grep -v "\.example$" | grep -v "env\.ts$" || true)
    if [ -n "$FOUND" ]; then
        echo "$FOUND" | while read -r file; do
            print_status "❌ SECURITY ISSUE: Sensitive file tracked in git: $file" "$RED"
        done
        FOUND_SENSITIVE=true
        ISSUES_FOUND=1
    fi
done

if [ "$FOUND_SENSITIVE" = false ]; then
    print_status "✅ No sensitive files tracked in git" "$GREEN"
fi

# 4. Check for private keys
print_status "🔍 Scanning for private keys..." "$BLUE"

PRIVATE_KEY_PATTERNS=(
    "-----BEGIN.*PRIVATE KEY-----"
    "-----BEGIN RSA PRIVATE KEY-----"
    "-----BEGIN DSA PRIVATE KEY-----"
    "-----BEGIN EC PRIVATE KEY-----"
    "-----BEGIN OPENSSH PRIVATE KEY-----"
)

FOUND_PRIVATE_KEYS=false

for pattern in "${PRIVATE_KEY_PATTERNS[@]}"; do
    if [ "$STAGED_ONLY" = true ]; then
        if [ -n "$STAGED_FILES" ]; then
            if echo "$STAGED_FILES" | xargs grep -Hn "$pattern" 2>/dev/null; then
                print_status "❌ SECURITY ISSUE: Private key found in staged files!" "$RED"
                FOUND_PRIVATE_KEYS=true
                ISSUES_FOUND=1
            fi
        fi
    else
        if git ls-files | xargs grep -Hn "$pattern" 2>/dev/null; then
            print_status "❌ SECURITY ISSUE: Private key found!" "$RED"
            FOUND_PRIVATE_KEYS=true
            ISSUES_FOUND=1
        fi
    fi
done

if [ "$FOUND_PRIVATE_KEYS" = false ]; then
    print_status "✅ No private keys found" "$GREEN"
fi

# 5. Check for TODO/FIXME security comments
print_status "🔍 Scanning for security-related TODO/FIXME comments..." "$BLUE"

SECURITY_TODO_PATTERNS=(
    "TODO.*security"
    "FIXME.*security"
    "TODO.*auth"
    "FIXME.*auth"
    "TODO.*password"
    "FIXME.*password"
    "TODO.*credential"
    "FIXME.*credential"
    "HACK.*security"
    "XXX.*security"
)

FOUND_TODOS=false

for pattern in "${SECURITY_TODO_PATTERNS[@]}"; do
    if [ "$STAGED_ONLY" = true ]; then
        if [ -n "$STAGED_FILES" ]; then
            if echo "$STAGED_FILES" | xargs grep -HnEi "$pattern" 2>/dev/null; then
                print_status "⚠️  WARNING: Security-related TODO/FIXME found in staged files" "$YELLOW"
                FOUND_TODOS=true
            fi
        fi
    else
        if git ls-files | grep -E '\.(ts|tsx|js|jsx)$' | xargs grep -HnEi "$pattern" 2>/dev/null; then
            print_status "⚠️  WARNING: Security-related TODO/FIXME found" "$YELLOW"
            FOUND_TODOS=true
        fi
    fi
done

if [ "$FOUND_TODOS" = false ]; then
    print_status "✅ No security-related TODO/FIXME comments found" "$GREEN"
fi

# 6. Check for console.log with sensitive data patterns (excluding test files and mock files)
print_status "🔍 Scanning for console.log with potential sensitive data..." "$BLUE"

CONSOLE_PATTERNS=(
    "console\.log.*password[^']"
    "console\.log.*\btoken[^s]"
    "console\.log.*secret[^s]"
    "console\.log.*apiKey"
    "console\.log.*credential"
)

FOUND_CONSOLE_LOGS=false

for pattern in "${CONSOLE_PATTERNS[@]}"; do
    if [ "$STAGED_ONLY" = true ]; then
        NON_TEST_STAGED=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx)$' | grep -v "__tests__" | grep -v "test\." | grep -v ".test\." | grep -v ".spec\." | grep -v "mock" || true)
        if [ -n "$NON_TEST_STAGED" ]; then
            if echo "$NON_TEST_STAGED" | xargs grep -HnEi "$pattern" 2>/dev/null; then
                print_status "⚠️  WARNING: console.log with potential sensitive data in staged files" "$YELLOW"
                FOUND_CONSOLE_LOGS=true
            fi
        fi
    else
        if git ls-files | grep -E '\.(ts|tsx|js|jsx)$' | grep -v "__tests__" | grep -v "test\." | grep -v ".test\." | grep -v ".spec\." | grep -v "mock" | xargs grep -HnEi "$pattern" 2>/dev/null; then
            print_status "⚠️  WARNING: console.log with potential sensitive data" "$YELLOW"
            FOUND_CONSOLE_LOGS=true
        fi
    fi
done

if [ "$FOUND_CONSOLE_LOGS" = false ]; then
    print_status "✅ No console.log with sensitive data patterns found" "$GREEN"
fi

# 7. Check GitHub Secrets usage in workflows
print_status "🔍 Validating GitHub Actions secrets usage..." "$BLUE"

if [ -d ".github/workflows" ]; then
    # Check that AWS credentials use secrets
    if grep -r "AWS_ACCESS_KEY_ID" .github/workflows/*.yml 2>/dev/null | grep -v "secrets\." | grep -v "#"; then
        print_status "❌ SECURITY ISSUE: AWS_ACCESS_KEY_ID not using secrets in workflows!" "$RED"
        ISSUES_FOUND=1
    elif grep -r "AWS_" .github/workflows/*.yml 2>/dev/null | grep -E "(role-to-assume|AWS_ROLE_ARN)" | grep -v "secrets\." | grep -v "#" | grep -v "aws-region"; then
        print_status "❌ SECURITY ISSUE: AWS credentials not using secrets in workflows!" "$RED"
        ISSUES_FOUND=1
    else
        print_status "✅ GitHub Actions properly using secrets for AWS credentials" "$GREEN"
    fi
fi

# 8. Check for exposed URLs with credentials
print_status "🔍 Scanning for URLs with embedded credentials..." "$BLUE"

URL_CRED_PATTERN="https?://[a-zA-Z0-9]+:[a-zA-Z0-9]+@"

if [ "$STAGED_ONLY" = true ]; then
    if [ -n "$STAGED_FILES" ]; then
        if echo "$STAGED_FILES" | xargs grep -HnE "$URL_CRED_PATTERN" 2>/dev/null; then
            print_status "❌ SECURITY ISSUE: URL with embedded credentials found in staged files!" "$RED"
            ISSUES_FOUND=1
        else
            print_status "✅ No URLs with embedded credentials in staged files" "$GREEN"
        fi
    fi
else
    if git ls-files | xargs grep -HnE "$URL_CRED_PATTERN" 2>/dev/null; then
        print_status "❌ SECURITY ISSUE: URL with embedded credentials found!" "$RED"
        ISSUES_FOUND=1
    else
        print_status "✅ No URLs with embedded credentials found" "$GREEN"
    fi
fi

# Final summary
print_header "Security Scan Summary"

if [ "$ISSUES_FOUND" -eq 0 ]; then
    print_status "✅ Security scan passed - no critical issues found!" "$GREEN"
    echo ""
    exit 0
else
    print_status "❌ Security scan failed - $ISSUES_FOUND critical issue(s) found!" "$RED"
    echo ""
    print_status "Please fix the security issues above before committing." "$YELLOW"
    print_status "If you believe these are false positives, you can:" "$YELLOW"
    print_status "  1. Update .gitignore to exclude sensitive files" "$YELLOW"
    print_status "  2. Use GitHub Secrets for sensitive values" "$YELLOW"
    print_status "  3. Remove hardcoded credentials from code" "$YELLOW"
    echo ""
    exit 1
fi
