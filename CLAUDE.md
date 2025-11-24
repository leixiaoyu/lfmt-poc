<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

---

# LFMT POC - Claude Development Guide

## Project Overview

This is the **Long-Form Translation Service** Proof of Concept (LFMT POC) - a React SPA with AWS serverless backend for translating large documents (65K-400K words) using Claude Sonnet 4 API.

## Authentication & User Management

### Email Verification - Auto-Confirm Feature

**Status**: Implemented for dev environment (PR #72, 2025-11-12)

Auto-confirm allows users to register and immediately log in without email verification in development environments, streamlining testing workflows.

**Key Details**:
- ✅ Enabled only when `ENVIRONMENT` contains "Dev"
- ✅ Uses `AdminConfirmSignUpCommand` to bypass email verification
- ✅ Requires `cognito-idp:AdminConfirmSignUp` IAM permission
- ✅ Production deployments require proper email verification

📖 **Complete Documentation**: See [`docs/AUTH-AUTO-CONFIRM.md`](docs/AUTH-AUTO-CONFIRM.md) for:
- Full implementation details
- IAM permissions and Cognito configuration
- Testing procedures and troubleshooting
- Production deployment considerations

---

## Infrastructure Architecture

### Frontend Hosting - CloudFront CDK

**Status**: Production-ready, fully managed via AWS CDK (PR #59, 2025-11-10)

The frontend React SPA is hosted on AWS CloudFront with S3 origin, fully managed as Infrastructure as Code.

**Key Features**:
- ✅ HTTPS-only with automatic redirect
- ✅ Secure S3 access via Origin Access Control (OAC)
- ✅ Comprehensive security headers (CSP, HSTS, X-Frame-Options)
- ✅ SPA routing support (403/404 → index.html redirects)
- ✅ Automated deployment with cache invalidation
- ✅ Dynamic CORS integration (no hardcoded URLs)

📖 **Complete Documentation**: See [`docs/CLOUDFRONT-SETUP.md`](docs/CLOUDFRONT-SETUP.md) for:
- Full CDK configuration details
- Deployment workflow and cache invalidation
- SPA routing configuration
- Security headers setup
- Testing and manual operations
- Known issues and troubleshooting

---

## Quick Reference

### CDK Stack Structure

```
backend/infrastructure/lib/lfmt-infrastructure-stack.ts
├── constructor()
│   ├── createS3Buckets()           # Frontend + uploads
│   ├── createDynamoDBTables()      # Jobs, attestations
│   ├── createCognito()             # User authentication
│   ├── createFrontendHosting()     # ⭐ CloudFront + S3 origin
│   ├── createApiGateway()          # REST API (uses CloudFront URL for CORS)
│   ├── createLambdaFunctions()     # Auth, upload, jobs, etc.
│   └── createOutputs()             # CloudFront URL, bucket name, etc.
```

### Deployment Flow

```
1. Developer: git push → GitHub Actions
2. GitHub Actions: npm run build (frontend)
3. CDK: Retrieve FrontendBucketName from stack outputs
4. AWS CLI: aws s3 sync frontend/dist/ s3://$BUCKET_NAME/
5. CDK: Retrieve CloudFrontDistributionId from stack outputs
6. AWS CLI: aws cloudfront create-invalidation --paths "/*"
7. CloudFront: Invalidate cache (3-5 min)
8. Users: Access updated frontend via CloudFront URL
```

### Tech Stack

- **Frontend**: React 18, TypeScript, Material-UI, Vite
- **Hosting**: AWS CloudFront + S3 (CDK-managed)
- **Backend**: AWS Lambda (Node.js), API Gateway, DynamoDB
- **Auth**: AWS Cognito (JWT tokens)
- **Translation**: Claude Sonnet 4 API
- **IaC**: AWS CDK (TypeScript)
- **CI/CD**: GitHub Actions

---

---

## Translation UI Components & Testing

### Translation Workflow UI

**Status**: Production-ready with comprehensive testing (PR #86, 2025-11-20)

Complete user experience for document upload, progress tracking, and translation download.

**Key Features**:
- ✅ Multi-step upload wizard with legal attestation
- ✅ 5 languages × 3 tones = 15 translation combinations
- ✅ Real-time progress tracking with adaptive polling
- ✅ 499 unit tests + 58 E2E tests (99% coverage)
- ✅ Page Object Model pattern for E2E testing
- ✅ Comprehensive error handling and retry logic

📖 **Complete Documentation**: See [`docs/TRANSLATION-UI-REFERENCE.md`](docs/TRANSLATION-UI-REFERENCE.md) for:
- Full component architecture and features
- Testing infrastructure (unit + E2E)
- Running tests locally and in CI/CD
- Configuration and best practices
- Known issues and solutions

---

```bash
# Unit Tests
cd frontend
npm test                    # All 499 unit tests
npm run test:coverage      # With coverage report

# E2E Tests (requires dev server running)
npm run test:e2e           # All 58 E2E tests
npm run test:e2e:ui        # Interactive Playwright UI
```

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Material-UI, Vite
- **Hosting**: AWS CloudFront + S3 (CDK-managed)
- **Backend**: AWS Lambda (Node.js), API Gateway, DynamoDB
- **Auth**: AWS Cognito (JWT tokens)
- **Translation**: Claude Sonnet 4 API
- **IaC**: AWS CDK (TypeScript)
- **CI/CD**: GitHub Actions

---

**Last Updated**: 2025-11-23 (Documentation Consolidation - Phase 1)
**Major Changes**: Extracted CloudFront, Auth, and Translation UI details to dedicated docs
