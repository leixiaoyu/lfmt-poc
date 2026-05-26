# LFMT POC - Claude Development Guide

> ⭐ **LFMT Development Repository**
>
> This is the active development repository for LFMT. All commits and development work happen here.

## Project Overview

**Long-Form Translation Service** Proof of Concept (POC) - A React SPA with AWS serverless backend for translating large documents (65K-400K words) using Gemini 2.5 Flash API.

**Current Status**: See [PROGRESS.md](PROGRESS.md) for the canonical phase, completion %, and active workstreams. Snapshot (2026-05-25): translation workflow with Gemini 2.5 Flash deployed end-to-end; Phases 1-9 complete; the Phase 10 demo-polish stream is paused while tech-debt + error-UX hardening + targeted security follow-ups land.

---

## Tech Stack

### Frontend

- **Framework**: React 18 + TypeScript (strict) + Material-UI + Vite
- **Hosting**: AWS CloudFront + S3 (CDK-managed)
- **Testing**: Vitest (unit) + Playwright (E2E) — comprehensive coverage; see PROGRESS.md for counts

### Backend

- **Runtime**: Node.js 22 (AWS Lambda)
- **Infrastructure**: AWS CDK v2 (TypeScript)
- **Services**: API Gateway, DynamoDB, S3, Step Functions, Cognito
- **Translation**: Gemini 2.5 Flash (Google AI - free tier)

### DevOps

- **CI/CD**: GitHub Actions (automated test + deploy)
- **IaC**: AWS CDK (no configuration drift)
- **Testing**: Comprehensive unit + integration + E2E coverage across backend, infrastructure, and frontend (>90% on critical paths; current totals tracked in PROGRESS.md)

---

##Tiered Documentation (Load on Demand)

### Tier 1: Current Work (Always Load)

📄 **PROGRESS.md** - Current phase, recent updates, active risks (~2,000 tokens)

### Tier 2: Feature-Specific Docs (Load for Specific Tasks)

#### Infrastructure & Deployment

- **[@/docs/CLOUDFRONT-SETUP.md](docs/CLOUDFRONT-SETUP.md)** - CloudFront CDK configuration, SPA routing, security headers
- **[@/docs/INFRASTRUCTURE-SETUP.md](docs/INFRASTRUCTURE-SETUP.md)** - AWS CDK stack, deployment workflow
- **[@/docs/CDK-BEST-PRACTICES.md](docs/CDK-BEST-PRACTICES.md)** - CDK patterns, testing, troubleshooting
- **[@/docs/CI-CD-ARCHITECTURE.md](docs/CI-CD-ARCHITECTURE.md)** - Split deploy pipelines (`deploy-backend.yml` + `deploy-frontend.yml`), path-filter rationale, branch-protection requirements

#### Feature Implementation

- **[@/docs/TRANSLATION-UI-REFERENCE.md](docs/TRANSLATION-UI-REFERENCE.md)** - Translation workflow UI, testing infrastructure
- **[@/docs/AUTH-AUTO-CONFIRM.md](docs/AUTH-AUTO-CONFIRM.md)** - Email verification auto-confirm (dev environment)

#### Troubleshooting & Reference

- **[@/docs/CORS-REFERENCE.md](docs/CORS-REFERENCE.md)** - CORS configuration, common issues, testing
- **[@/docs/CONTEXT-OPTIMIZATION-ANALYSIS.md](docs/CONTEXT-OPTIMIZATION-ANALYSIS.md)** - Documentation strategy, token optimization

### Tier 3: Historical Context (Archive - Load Only if Needed)

- **[@/docs/archive/PROGRESS-PHASES-1-9.md](docs/archive/PROGRESS-PHASES-1-9.md)** - Completed phases, bug fixes, milestones
- **[@/docs/archive/](docs/archive/)** - 17 archived documents (excluded by `.claudeignore`)

---

## Quick Reference Commands

### Local Development

```bash
# Frontend (port 3000)
cd frontend && npm run dev

# Backend tests
cd backend/functions && npm test

# E2E tests (requires dev server running)
cd frontend && npm run test:e2e
```

### Deployment

```bash
# Deploy to dev
cd backend/infrastructure && npx cdk deploy --context environment=dev

# Manual workflow trigger (backend-side pipeline)
gh workflow run deploy-backend.yml --ref main

# Manual workflow trigger (frontend-side pipeline)
gh workflow run deploy-frontend.yml --ref main
```

### Common Tasks

```bash
# Run all tests (pre-push)
npm test  # In backend/functions, frontend, shared-types

# Check CloudFormation outputs
aws cloudformation describe-stacks --stack-name LfmtPocDev --query 'Stacks[0].Outputs'

# View Lambda logs
aws logs tail /aws/lambda/lfmt-translate-chunk-LfmtPocDev --follow
```

---

## Current Focus (as of 2026-05-25)

PROGRESS.md is the canonical source. Brief snapshot:

- ✅ Tech-debt cleanup Waves 1 + 2 landed (26 issues, PRs #250–#258)
- ✅ Date-pinned + architectural deferrals closed (ePub/PDF #263, StoredSession removal #264, CSP static nonce #265, nested-stacks proposal #262)
- ✅ Error-message UX hardening sweep complete — every page error path now flows through `getApiErrorMessage`; backend handlers emit `errorCode` + UUID `requestId`
- ✅ Targeted security follow-ups: privacy-preserving 404 (#287), per-user rate-limit decision (#290), timing side-channel analysis (#292)
- ⏸️ Phase 10 (investor demo polish): paused — see [deferred items in PROGRESS.md](PROGRESS.md#deferred-phase-10-items)
- 🔲 Still open: #260 (post-deploy smoke/integration on staging+prod), #255 (httpOnly cookie migration — blocked on custom domain), #64 implementation (nested-stacks proposal awaiting approval), #29 (post-translation editor)

---

## Important Notes

### Authentication (Dev Environment)

- **Auto-Confirm Enabled**: Users can login immediately after registration (no email verification)
- **Production**: Email verification required
- **See**: [@/docs/AUTH-AUTO-CONFIRM.md](docs/AUTH-AUTO-CONFIRM.md)

### CloudFront & CORS

- **Frontend URL**: https://d39xcun7144jgl.cloudfront.net
- **API Endpoint**: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
- **CORS Configuration**: CloudFront URL included in API Gateway allowed origins
- **See**: [@/docs/CORS-REFERENCE.md](docs/CORS-REFERENCE.md)

### Translation Workflow

- **Gemini API**: Configured in AWS Secrets Manager (`lfmt/gemini-api-key-LfmtPocDev`)
- **Rate Limiting**: Distributed rate limiter (5 RPM, 250K TPM, 25 RPD)
- **Chunk Size**: 3,500 tokens + 250-token overlap
- **Parallel Processing**: maxConcurrency: 10 (Step Functions Map state)

### Git Workflow

- **Main Branch**: Protected. PR required. Status checks: `Run Tests` + `Build Infrastructure` must pass, branch must be up-to-date with `main`, `enforce_admins` is on, conversation resolution required. **Review approvals: 0 required** (Raymond self-merges).
- **Feature Branches**: `feature/*`, `fix/*`, `docs/*`, `tech-debt/*`, `security/*`, `chore/*`
- **Never Commit Without Request**: Only commit when explicitly asked by user. Never plan or execute commit/branch/merge ops without explicit user request.
- **Secondary Reviewer**: `xlei-raymond` (Gemini CLI) may post formal "Changes Requested" reviews. `dismiss_stale_reviews` is **false** — pushes do not auto-clear these reviews.
- **Pre-push Hook**: Runs all tests automatically.

---

## Development Guidelines

### Code Style

- **TypeScript Strict Mode**: No `any` types in production code
- **Comment Language**: Match existing codebase language (auto-detect)
- **SOLID Principles**: Single responsibility, open/closed, etc.
- **KISS/DRY/YAGNI**: Simplicity, no duplication, no premature features

### Testing

- **Unit Tests**: Required for all new functions
- **Integration Tests**: For API endpoints and workflows
- **E2E Tests**: For critical user journeys
- **Coverage Target**: >90% on critical paths

#### Three-Layer Mock Strategy (Frontend)

The frontend deliberately uses three different mocking primitives —
one per test layer — so the right tool always matches the right layer.
See `frontend/LOCAL-TESTING.md` for the full guide.

| Layer                           | Environment | Tool                                   |
| ------------------------------- | ----------- | -------------------------------------- |
| Unit (jsdom)                    | Vitest      | `axios-mock-adapter` (PR #135 pattern) |
| Component / integration (jsdom) | Vitest      | `msw/node` (shared handlers)           |
| E2E (browser)                   | Playwright  | MSW Service Worker                     |

Quick start for the local mock loop:

```bash
cd frontend
VITE_MOCK_API=true npm run dev
```

A non-dismissible yellow banner confirms mock mode is on. The same MSW
handlers (`frontend/src/mocks/handlers.ts`) serve both browser and
Vitest, so the contract cannot drift. Three independent safety layers
prevent the mock from ever shipping to production (UI banner + Vite
build guard + post-build SW cleanup). See `frontend/LOCAL-TESTING.md`
for `VITE_MOCK_SPEED`, error injection (reserved filename pattern),
and known footguns.

### Infrastructure

- **CDK Only**: No manual AWS console changes
- **Environment Variables**: Use AWS Secrets Manager for sensitive data
- **IAM Permissions**: Least privilege principle
- **Logging**: CloudWatch with 7-day retention

---

## Quick Links

- **Repository**: https://github.com/leixiaoyu/lfmt-poc
- **Current Progress**: [PROGRESS.md](PROGRESS.md)
- **Architecture Docs**: [docs/](docs/)
- **OpenSpec Changes**: [openspec/changes/](openspec/changes/)
- **CI/CD Workflows**: [.github/workflows/](.github/workflows/)

---

**Last Updated**: 2026-05-25

**Previous Major Changes**:

- Post-Wave-2 work (2026-05-15 → 2026-05-18): 15 PRs landed across three themes — closing date-pinned/architectural deferrals (#28 ePub+PDF, #199 StoredSession removal, #254 CSP static nonce, #64 nested-stacks proposal), error-message UX hardening sweep (every page now uses `getApiErrorMessage`; backend emits `errorCode` + UUID `requestId`), and targeted security follow-ups (ownership-404, per-user rate-limit decision record, timing side-channel analysis)
- Wave 1 + Wave 2 tech-debt cleanup landed (26 issues across PRs #250–#258); see [PROGRESS.md](PROGRESS.md) for the per-PR breakdown
- Integration test failures resolved (PR #99)
- Gemini 2.5 Flash migration complete (PR #98)
- Translation workflow fully validated end-to-end
- CI/CD pipeline green; latest test totals tracked in PROGRESS.md (1,570 passed across backend/functions, backend/infrastructure, and frontend Vitest as of 2026-05-25)
