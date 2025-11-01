#!/bin/bash

#
# Local CI Simulation Script
#
# This script simulates the exact GitHub Actions CI environment locally.
# It runs all the same checks that CI runs, helping catch issues before pushing.
#
# Usage:
#   ./scripts/simulate-ci.sh              # Run all CI checks
#   ./scripts/simulate-ci.sh --test       # Run only test jobs
#   ./scripts/simulate-ci.sh --frontend   # Run only frontend tests
#   ./scripts/simulate-ci.sh --backend    # Run only backend tests
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${2}${1}${NC}"
}

# Function to print section headers
print_header() {
    echo ""
    echo "========================================="
    print_status "$1" "$CYAN"
    echo "========================================="
    echo ""
}

# Parse command line arguments
RUN_ALL=true
RUN_TESTS=false
RUN_FRONTEND=false
RUN_BACKEND=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --test)
            RUN_ALL=false
            RUN_TESTS=true
            shift
            ;;
        --frontend)
            RUN_ALL=false
            RUN_FRONTEND=true
            shift
            ;;
        --backend)
            RUN_ALL=false
            RUN_BACKEND=true
            shift
            ;;
        *)
            print_status "Unknown option: $1" "$RED"
            echo "Usage: ./scripts/simulate-ci.sh [--test|--frontend|--backend]"
            exit 1
            ;;
    esac
done

# If no specific flags, run all tests
if [ "$RUN_ALL" = true ]; then
    RUN_TESTS=true
    RUN_FRONTEND=true
    RUN_BACKEND=true
fi

print_header "🚀 LFMT POC - Local CI Simulation"
print_status "Simulating GitHub Actions CI environment" "$BLUE"
echo ""

# Track failures
FAILED_JOBS=()

# Function to mark job as failed
mark_failed() {
    FAILED_JOBS+=("$1")
}

###########################################
# 1. Backend Tests (ci.yml: test job)
###########################################

if [ "$RUN_BACKEND" = true ] || [ "$RUN_TESTS" = true ]; then
    print_header "Job: Run Tests (Backend)"
    print_status "Simulating: .github/workflows/ci.yml - test job" "$BLUE"

    cd shared-types

    if [ ! -d "node_modules" ]; then
        print_status "Installing shared-types dependencies..." "$YELLOW"
        npm ci
    fi

    if npm test; then
        print_status "✅ Shared-types tests passed" "$GREEN"
    else
        print_status "❌ Shared-types tests failed" "$RED"
        mark_failed "shared-types-tests"
    fi

    cd ../backend/functions

    if [ ! -d "node_modules" ]; then
        print_status "Installing backend function dependencies..." "$YELLOW"
        npm ci
    fi

    if npm test; then
        print_status "✅ Backend function tests passed" "$GREEN"
    else
        print_status "❌ Backend function tests failed" "$RED"
        mark_failed "backend-tests"
    fi

    cd ../..
fi

###########################################
# 2. Build Infrastructure (ci.yml: build-infrastructure job)
###########################################

if [ "$RUN_BACKEND" = true ] || [ "$RUN_TESTS" = true ]; then
    print_header "Job: Build Infrastructure"
    print_status "Simulating: .github/workflows/ci.yml - build-infrastructure job" "$BLUE"

    cd shared-types

    if [ ! -d "node_modules" ]; then
        npm ci
    fi

    if npm run build; then
        print_status "✅ Shared-types build passed" "$GREEN"
    else
        print_status "❌ Shared-types build failed" "$RED"
        mark_failed "shared-types-build"
    fi

    cd ../backend/infrastructure

    if [ ! -d "node_modules" ]; then
        print_status "Installing infrastructure dependencies..." "$YELLOW"
        npm ci
    fi

    if npm run build; then
        print_status "✅ Infrastructure TypeScript compilation passed" "$GREEN"
    else
        print_status "❌ Infrastructure build failed" "$RED"
        mark_failed "infrastructure-build"
    fi

    # Run CDK synth to validate infrastructure
    print_status "Running CDK synth..." "$YELLOW"
    if npx cdk synth --context environment=dev --context skipLambdaBundling=true > /dev/null; then
        print_status "✅ CDK synth passed" "$GREEN"
    else
        print_status "❌ CDK synth failed" "$RED"
        mark_failed "cdk-synth"
    fi

    cd ../..
fi

###########################################
# 3. Frontend Tests (ci.yml: test-frontend job)
###########################################

if [ "$RUN_FRONTEND" = true ] || [ "$RUN_TESTS" = true ]; then
    print_header "Job: Test Frontend"
    print_status "Simulating: .github/workflows/ci.yml - test-frontend job" "$BLUE"

    cd frontend

    if [ ! -d "node_modules" ]; then
        print_status "Installing frontend dependencies..." "$YELLOW"
        npm ci
    fi

    # Run tests with --run flag (exact CI behavior)
    print_status "Running frontend tests with --run flag..." "$YELLOW"
    if npm test -- --run; then
        print_status "✅ Frontend tests passed" "$GREEN"
    else
        print_status "❌ Frontend tests failed" "$RED"
        print_status "These are the EXACT failures that would occur in CI!" "$YELLOW"
        mark_failed "frontend-tests"
    fi

    # Run build
    print_status "Building frontend..." "$YELLOW"
    if npm run build; then
        print_status "✅ Frontend build passed" "$GREEN"
    else
        print_status "❌ Frontend build failed" "$RED"
        mark_failed "frontend-build"
    fi

    cd ..
fi

###########################################
# 4. Lint and Format Check (ci.yml: lint-and-format job)
###########################################

if [ "$RUN_ALL" = true ]; then
    print_header "Job: Lint and Format Check"
    print_status "Simulating: .github/workflows/ci.yml - lint-and-format job" "$BLUE"

    cd backend/functions

    if npm run lint > /dev/null 2>&1; then
        print_status "✅ Backend linting passed" "$GREEN"
    else
        print_status "⚠️  Backend linting issues found (non-blocking)" "$YELLOW"
    fi

    cd ../..
fi

###########################################
# 5. Security Scan (ci.yml: security-scan job)
###########################################

if [ "$RUN_ALL" = true ]; then
    print_header "Job: Security Scan"
    print_status "Simulating: .github/workflows/ci.yml - security-scan job" "$BLUE"

    if [ -f "scripts/security-scan.sh" ]; then
        if ./scripts/security-scan.sh; then
            print_status "✅ Security scan passed" "$GREEN"
        else
            print_status "❌ Security scan failed" "$RED"
            mark_failed "security-scan"
        fi
    else
        print_status "⚠️  Security scan script not found" "$YELLOW"
    fi
fi

###########################################
# Final Summary
###########################################

print_header "CI Simulation Summary"

if [ ${#FAILED_JOBS[@]} -eq 0 ]; then
    print_status "✅ All CI checks passed!" "$GREEN"
    echo ""
    print_status "Your code would pass GitHub Actions CI" "$GREEN"
    echo ""
    exit 0
else
    print_status "❌ Some CI checks failed:" "$RED"
    echo ""
    for job in "${FAILED_JOBS[@]}"; do
        print_status "  ❌ $job" "$RED"
    done
    echo ""
    print_status "These failures would occur in GitHub Actions CI" "$YELLOW"
    print_status "Fix them before pushing to save CI/CD time" "$YELLOW"
    echo ""
    exit 1
fi
