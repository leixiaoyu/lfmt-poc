# Workspace Context (Obsidian)

> **NOTE**: This is workspace-level Obsidian guidance, distinct from the project-level [`CLAUDE.md`](../../CLAUDE.md) at the repo root. The canonical Claude Code guide for this repository is the root `CLAUDE.md`; this file documents the broader Obsidian vault that contains the repo and is preserved for historical context.

> **HISTORICAL SNAPSHOT** — This file is an archived snapshot of the Obsidian workspace's orientation doc at the time of repo migration. It is NOT an active project guide. For live project instructions, see [../../CLAUDE.md](../../CLAUDE.md).

## Archived workspace guidance

The content below is preserved verbatim (with light archival rewording) from the original Obsidian vault orientation file. It describes the workspace as it existed at migration time and is kept here for historical reference only. Any apparent instructions reflect the workspace's prior conventions, not the current project's active guidance.

## Project Overview

**Long-Form Translation Service (LFMT)** — A Proof of Concept (POC) that translated 65K-400K word documents using intelligent chunking and the Gemini 2.5 Flash API, deployed on AWS serverless infrastructure.

**Key Technical Challenge (as framed at migration time)**: Process documents up to 400K words through intelligent chunking while maintaining translation coherence.

**Status at migration time**: Phase 10 — Investor Demo & Production Readiness (~80% complete). For current status, see [../../PROGRESS.md](../../PROGRESS.md).

## Repository Structure (historical)

At the time of the original Obsidian workspace, the layout looked approximately like this:

```
/LFMT/                              # Root workspace (Obsidian vault)
├── WORKSPACE-CONTEXT.md            # Former workspace orientation (now archived at docs/architecture/WORKSPACE-CONTEXT.md)
├── LFMT Product Requirements.md    # Product specification
├── Long-Form Translation Service - Technical Architecture Design v2.0.md
├── Low-Level Design - 01 through 10.md
├── project_priorities_proposal.md  # Execution plan (at the time)
│
└── lfmt-poc/                       # Development repository
    ├── CLAUDE.md                   # Project-specific guidance
    ├── PROGRESS.md                 # Current phase status
    ├── README.md                   # Project overview
    ├── backend/                    # AWS Lambda functions + CDK
    ├── frontend/                   # React 18 SPA
    ├── shared-types/               # TypeScript interfaces
    ├── demo/                       # Demo materials
    └── openspec/                   # Feature specifications
```

This file now lives at `docs/architecture/WORKSPACE-CONTEXT.md` inside the `lfmt-poc` repository. For the repository's current structure, refer to the root [README.md](../../README.md) and [CLAUDE.md](../../CLAUDE.md).

## Architecture Documentation (historical)

### Core Documents (Obsidian Vault)

At migration time, the following documents were referenced from the workspace root. Several were dataless in iCloud and are tracked as placeholders under [./pending/](./pending/):

- `LFMT Product Requirements.md` — Complete product specification (pending migration).
- `Long-Form Translation Service - Technical Architecture Design v2.0.md` — V2 recommended architecture (pending migration).
- `Low-Level Design - 01 through 10.md` — Detailed system specifications (pending migration).

### Implementation Status (as of migration)

The implementation in `lfmt-poc/` was deployed and operational with:

- React 18 + TypeScript + Material-UI frontend
- AWS Lambda + API Gateway + Step Functions backend
- Gemini 2.5 Flash translation engine
- DynamoDB + S3 storage
- AWS Cognito authentication
- Comprehensive test coverage across tiers (see [../../PROGRESS.md](../../PROGRESS.md) → Project Metrics for current counts)

## Technology Stack (as recorded at migration)

### Frontend

- **Framework**: React 18 + TypeScript (strict) + Material-UI + Vite
- **Hosting**: AWS CloudFront + S3 (CDK-managed)
- **Testing**: Vitest (unit) + Playwright (E2E); see [../../PROGRESS.md](../../PROGRESS.md) → Project Metrics for current counts

### Backend

- **Runtime**: Node.js 18 (AWS Lambda)
- **Infrastructure**: AWS CDK v2 (TypeScript)
- **Services**: API Gateway, DynamoDB, S3, Step Functions, Cognito
- **Translation**: Gemini 2.5 Flash (Google AI — free tier)

### DevOps

- **CI/CD**: GitHub Actions (automated test + deploy)
- **IaC**: AWS CDK (no configuration drift)

## Key Implementation Details (as of migration)

### Translation Processing

- **Chunk Size**: 3,500 tokens primary content + 250 tokens overlap
- **Rate Limits**: 5 RPM, 250K TPM, 25 RPD (Gemini free tier)
- **Languages**: Spanish, French, Italian, German, Chinese
- **Parallel Processing**: maxConcurrency: 10 (Step Functions Map state)

### Deployed Environment (snapshot)

- **Frontend URL**: https://d39xcun7144jgl.cloudfront.net
- **API Endpoint**: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
- **GitHub Repo**: https://github.com/leixiaoyu/lfmt-poc
- **AWS Region**: us-east-1

### Cost Targets

- **Monthly Budget**: <$50 for 1000 translations
- **Spend (at migration)**: ~$10-15/month (development)

## Development Guidelines (archived)

The original workspace document had sections covering Git Workflow, Code Standards, and post-code-change checklists. These have been removed from this archived snapshot because they duplicated or risked contradicting the canonical guidance in the root [../../CLAUDE.md](../../CLAUDE.md). See the root `CLAUDE.md` for current development guidelines, git workflow, and code standards.

## Quick Reference (historical pointers)

### Key Files

- **Current Progress**: [../../PROGRESS.md](../../PROGRESS.md)
- **Development Guide**: [../../CLAUDE.md](../../CLAUDE.md)
- **Architecture Docs (project)**: [../](../)
- **OpenSpec Changes**: [../../openspec/changes/](../../openspec/changes/)

### Where work happened (at migration)

- **Development**: `lfmt-poc/` (this repository)
- **Architecture Docs**: Root `/LFMT/` (Obsidian vault) — now migrated under `docs/architecture/`
- **Implementation Docs**: `lfmt-poc/docs/` — see [../](../)

---

_Archived snapshot. Last touched: 2026-04-18. For live guidance, use [../../CLAUDE.md](../../CLAUDE.md)._
