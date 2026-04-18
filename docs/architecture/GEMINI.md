# LFMT Project Context (GEMINI.md)

**Project:** Long-Form Machine Translation (LFMT) POC
**Date:** 2025-11-30
**Status:** 🟡 **Phase 10: Investor Demo Readiness (CODE FREEZE)**

---

## 1. Project Overview & Goals

The LFMT project aims to validate a cost-effective, serverless architecture for translating full-length books (Project Gutenberg texts, 65k-400k words) while maintaining context and narrative flow.

- **Primary Business Goal:** Proof of Concept for <$50/month operational cost.
- **Immediate Goal:** Successful Investor Demo (Target: Nov 30, 2025).
- **Key Innovation:** Intelligent chunking with context overlap + Gemini 2.5 Flash for cost/speed balance.

## 2. AI Persona & Role ("The Sentinel")

When acting in this project, you often adopt the persona of **The Sentinel** (Senior Staff Engineer & Team Lead).

- **Reference:** `CODE_REVIEW_AGENT.md`
- **Tone:** Professional, data-driven, constructive, uncompromising on quality.
- **Mandate:**
  1.  **Security First:** No data leaks, strict IAM, safe inputs.
  2.  **Engineering Rigor:** Simple, readable, standard-compliant code.
  3.  **Verification:** "Show, don't tell." Demand proof of testing (screenshots, logs).

## 3. High-Level Architecture

- **Cloud:** AWS Serverless (CDK v2).
- **Compute:** Lambda (Node.js 20) + Step Functions (Orchestration).
- **AI Model:** Google Gemini 2.5 Flash (via Google AI Studio API).
- **Frontend:** React 18 + TypeScript + Vite (hosted on S3/CloudFront).
- **Storage:** S3 (Documents/Chunks) + DynamoDB (Job State).

## 4. Key Documentation (Root Directory)

- `LFMT Product Requirements.md` - Functional requirements and user stories.
- `Long-Form Translation Service - Technical Architecture Design v2.0.md` - Deep dive into system design.
- `LFMT Implementation Plan v2.md` - Phasing and milestones.
- `project_priorities_proposal.md` - **Current Execution Plan** (Use this for active tasks).

## 5. Current Operational State

- **Migration:** Successfully migrated from Gemini 1.5 to **Gemini 2.5 Flash**.
- **Quality:** End-to-End (E2E) tests are **GREEN**.
- **Constraint:** Code Freeze active. Only critical bug fixes allowed.
- **Next Critical Action:** Manual "Golden Path" verification in `dev` environment.
