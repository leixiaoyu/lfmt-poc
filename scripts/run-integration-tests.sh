#!/bin/bash

#
# Local Integration and E2E Test Runner
#
# This script runs all integration and E2E tests locally before pushing to remote.
# It helps catch issues early and ensures tests pass before triggering CI/CD.
#
# Usage:
#   ./scripts/run-integration-tests.sh              # Run all tests
#   ./scripts/run-integration-tests.sh --backend    # Run backend integration tests only
#   ./scripts/run-integration-tests.sh --e2e        # Run E2E tests only
#   ./scripts/run-integration-tests.sh --quick      # Run quick smoke tests
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
RUN_BACKEND=true
RUN_E2E=true
QUICK_MODE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --backend)
            RUN_E2E=false
            shift
            ;;
        --e2e)
            RUN_BACKEND=false
            shift
            ;;
        --quick)
            QUICK_MODE=true
            shift
            ;;
        *)
            print_status "Unknown option: $1" "$RED"
            exit 1
            ;;
    esac
done

print_header "LFMT POC - Local Integration Test Runner"

# Check if API_BASE_URL is set
if [ -z "$API_BASE_URL" ]; then
    print_status "❌ ERROR: API_BASE_URL environment variable is not set." "$RED"
    print_status "   Please export API_BASE_URL to point to your deployed dev environment." "$YELLOW"
    print_status "   Example: export API_BASE_URL='https://your-api-id.execute-api.us-east-1.amazonaws.com/v1'" "$YELLOW"
    echo ""
    exit 1
fi

print_status "API Base URL: $API_BASE_URL" "$BLUE"
print_status "Frontend URL: ${FRONTEND_URL:-http://localhost:3000}" "$BLUE"
echo ""

# Backend Integration Tests
if [ "$RUN_BACKEND" = true ]; then
    print_header "Running Backend Integration Tests"
    
    cd backend/functions
    
    if [ ! -d "node_modules" ]; then
        print_status "Installing backend dependencies..." "$YELLOW"
        npm ci
    fi
    
    if [ "$QUICK_MODE" = true ]; then
        print_status "Running quick health check..." "$YELLOW"
        npm run test:integration -- health-check.integration.test.ts || {
            print_status "❌ Health check failed" "$RED"
            exit 1
        }
        print_status "✅ Health check passed" "$GREEN"
    else
        print_status "Running all backend integration tests..." "$YELLOW"
        
        # Health check
        npm run test:integration -- health-check.integration.test.ts && \
            print_status "✅ Health check tests passed" "$GREEN" || \
            print_status "❌ Health check tests failed" "$RED"
        
        # API integration
        npm run test:integration -- api-integration.test.ts && \
            print_status "✅ API integration tests passed" "$GREEN" || \
            print_status "❌ API integration tests failed" "$RED"
        
        # Translation flow (long-running)
        print_status "Running translation flow tests (this may take a while)..." "$YELLOW"
        npm run test:integration -- translation-flow.integration.test.ts --testTimeout=600000 && \
            print_status "✅ Translation flow tests passed" "$GREEN" || \
            print_status "❌ Translation flow tests failed" "$RED"
    fi
    
    cd ../..
fi

# Frontend E2E Tests
if [ "$RUN_E2E" = true ]; then
    print_header "Running Frontend E2E Tests"
    
    cd frontend
    
    if [ ! -d "node_modules" ]; then
        print_status "Installing frontend dependencies..." "$YELLOW"
        npm ci
    fi
    
    # Install Playwright browsers if needed
    if [ ! -d "$HOME/.cache/ms-playwright" ]; then
        print_status "Installing Playwright browsers..." "$YELLOW"
        npx playwright install chromium
    fi
    
    if [ "$QUICK_MODE" = true ]; then
        print_status "Running quick E2E smoke tests..." "$YELLOW"
        npm run test:e2e -- -g "should load home page" || {
            print_status "❌ E2E smoke tests failed" "$RED"
            exit 1
        }
        print_status "✅ E2E smoke tests passed" "$GREEN"
    else
        print_status "Running all E2E tests..." "$YELLOW"
        npm run test:e2e && \
            print_status "✅ All E2E tests passed" "$GREEN" || \
            print_status "❌ Some E2E tests failed" "$RED"
    fi
    
    cd ..
fi

print_header "Test Run Complete!"

if [ "$RUN_BACKEND" = true ] && [ "$RUN_E2E" = true ]; then
    print_status "✅ All integration and E2E tests completed" "$GREEN"
elif [ "$RUN_BACKEND" = true ]; then
    print_status "✅ Backend integration tests completed" "$GREEN"
else
    print_status "✅ E2E tests completed" "$GREEN"
fi

print_status "" "$NC"
print_status "Tip: Run with --quick for faster smoke tests" "$BLUE"
print_status "     Run with --backend or --e2e to test specific components" "$BLUE"
echo ""
