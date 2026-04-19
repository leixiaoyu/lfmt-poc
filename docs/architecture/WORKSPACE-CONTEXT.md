# Workspace Context (Obsidian)

> **NOTE**: This is workspace-level Obsidian guidance, distinct from the project-level [`CLAUDE.md`](../../CLAUDE.md) at the repo root. The canonical Claude Code guide for this repository is the root `CLAUDE.md`; this file documents the broader Obsidian vault that contains the repo and is preserved for historical context.

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Long-Form Translation Service (LFMT)** - A Proof of Concept (POC) that translates 65K-400K word documents using intelligent chunking and Gemini 2.5 Flash API, deployed on AWS serverless infrastructure.

**Key Technical Challenge**: Process documents up to 400K words through intelligent chunking while maintaining translation coherence.

**Current Status**: Phase 10 - Investor Demo & Production Readiness (~80% complete)

## Repository Structure

```
/LFMT/                              # Root workspace (Obsidian vault)
├── CLAUDE.md                       # This file - workspace guidance
├── LFMT Product Requirements.md    # Product specification
├── Long-Form Translation Service - Technical Architecture Design v2.0.md
├── Low-Level Design - 01 through 10.md
├── project_priorities_proposal.md  # Current execution plan
│
└── lfmt-poc/                       # ⭐ DEVELOPMENT REPOSITORY
    ├── CLAUDE.md                   # Project-specific guidance
    ├── PROGRESS.md                 # Current phase status
    ├── README.md                   # Project overview
    ├── backend/                    # AWS Lambda functions + CDK
    ├── frontend/                   # React 18 SPA
    ├── shared-types/               # TypeScript interfaces
    ├── demo/                       # Demo materials
    └── openspec/                   # Feature specifications
```

## Architecture Documentation

### Core Documents (Obsidian Vault)

- `LFMT Product Requirements.md` - Complete product specification
- `Long-Form Translation Service - Technical Architecture Design v2.0.md` - **V2 recommended architecture**
- `Low-Level Design - 01 through 10.md` - Detailed system specifications

### Implementation Status

The implementation in `lfmt-poc/` is **deployed and operational** with:

- ✅ React 18 + TypeScript + Material-UI frontend
- ✅ AWS Lambda + API Gateway + Step Functions backend
- ✅ Gemini 2.5 Flash translation engine
- ✅ DynamoDB + S3 storage
- ✅ AWS Cognito authentication
- ✅ 877 tests passing (91.66% frontend, 100% backend coverage)

## Technology Stack (Implemented)

### Frontend

- **Framework**: React 18 + TypeScript (strict) + Material-UI + Vite
- **Hosting**: AWS CloudFront + S3 (CDK-managed)
- **Testing**: Vitest (499 unit tests) + Playwright (58 E2E tests)

### Backend

- **Runtime**: Node.js 18 (AWS Lambda)
- **Infrastructure**: AWS CDK v2 (TypeScript)
- **Services**: API Gateway, DynamoDB, S3, Step Functions, Cognito
- **Translation**: Gemini 2.5 Flash (Google AI - free tier)

### DevOps

- **CI/CD**: GitHub Actions (automated test + deploy)
- **IaC**: AWS CDK (no configuration drift)

## Key Implementation Details

### Translation Processing

- **Chunk Size**: 3,500 tokens primary content + 250 tokens overlap
- **Rate Limits**: 5 RPM, 250K TPM, 25 RPD (Gemini free tier)
- **Languages**: Spanish, French, Italian, German, Chinese
- **Parallel Processing**: maxConcurrency: 10 (Step Functions Map state)

### Deployed Environment

- **Frontend URL**: https://d39xcun7144jgl.cloudfront.net
- **API Endpoint**: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
- **GitHub Repo**: https://github.com/leixiaoyu/lfmt-poc
- **AWS Region**: us-east-1

### Cost Targets

- **Monthly Budget**: <$50 for 1000 translations
- **Current Spend**: ~$10-15/month (development)

## Development Guidelines

### Git Workflow

- **Main Branch**: Protected, requires PR approval
- **Feature Branches**: `feature/*`, `fix/*`, `docs/*`
- **Never Commit Without Request**: Only commit when explicitly asked by user
- **Pre-push Hook**: Runs all tests automatically

### Code Standards

- **TypeScript Strict Mode**: No `any` types in production code
- **Comment Language**: Match existing codebase language (auto-detect)
- **SOLID Principles**: Single responsibility, open/closed, etc.
- **KISS/DRY/YAGNI**: Simplicity, no duplication, no premature features

### After Code Changes

- Update OpenSpec status if applicable
- Update `lfmt-poc/PROGRESS.md` with current status
- Always create a feature branch for GitHub pushes
- Main branch is protected - use PR workflow

## Quick Reference

### Key Files

- **Current Progress**: `lfmt-poc/PROGRESS.md`
- **Development Guide**: `lfmt-poc/CLAUDE.md`
- **Architecture Docs**: `lfmt-poc/docs/`
- **OpenSpec Changes**: `lfmt-poc/openspec/changes/`

### Where to Work

- **Development**: `lfmt-poc/`
- **Architecture Docs**: Root `/LFMT/` (Obsidian vault)
- **Implementation Docs**: `lfmt-poc/docs/`

---

_Last Updated: 2026-04-17_
