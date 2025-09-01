#!/bin/bash

# LFMT POC Git Hooks Setup Script
# Sets up pre-push hooks to enforce local testing before remote pushes

set -e

echo "🔧 LFMT POC Git Hooks Setup"
echo "==========================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${2}${1}${NC}"
}

# Check if we're in a Git repository
if [ ! -d ".git" ]; then
    print_status "❌ Error: Not in a Git repository" "$RED"
    exit 1
fi

# Check if we're in the right directory
if [ ! -d "shared-types" ] || [ ! -d "backend/infrastructure" ]; then
    print_status "❌ Error: Not in LFMT POC root directory" "$RED"
    exit 1
fi

print_status "📁 Setting up Git hooks directory..." "$YELLOW"

# Create .git/hooks directory if it doesn't exist
mkdir -p .git/hooks

# Copy our custom hooks to .git/hooks
print_status "📋 Installing pre-push hook..." "$YELLOW"
cp .githooks/pre-push .git/hooks/pre-push
chmod +x .git/hooks/pre-push

print_status "✅ Git hooks installed successfully!" "$GREEN"
echo ""

print_status "🧪 Testing hook installation..." "$YELLOW"
if [ -x ".git/hooks/pre-push" ]; then
    print_status "✅ Pre-push hook is executable" "$GREEN"
else
    print_status "❌ Pre-push hook is not executable" "$RED"
    exit 1
fi

echo ""
print_status "🎯 Git Hooks Setup Complete!" "$GREEN"
echo ""
print_status "What happens now:" "$YELLOW"
echo "  • Before each 'git push', tests will run automatically"  
echo "  • Push will be blocked if any tests fail"
echo "  • This prevents CI/CD failures and catches issues early"
echo ""
print_status "Available commands:" "$YELLOW"
echo "  • npm run test:all    - Run all tests manually"
echo "  • npm run test:shared - Test shared-types only"
echo "  • npm run test:infra  - Test infrastructure only"
echo "  • npm run validate    - Run full validation (tests + security)"
echo ""
print_status "💡 Tip: Run 'npm run test:all' before committing to catch issues early!" "$YELLOW"
echo ""