# LFMT Project Context (GEMINI.md)

> **HISTORICAL SNAPSHOT** — This file is an archived snapshot of the Obsidian workspace's orientation doc at the time of repo migration. It is NOT an active project guide. For live project instructions, see [../../CLAUDE.md](../../CLAUDE.md).

**Project:** Long-Form Machine Translation (LFMT) POC
**Date:** 2026-04
**Status:** Phase 10 (Investor Demo & Production Readiness — see [../../PROGRESS.md](../../PROGRESS.md) for current)

---

## Archived workspace guidance

The content below is preserved (with light archival rewording) from the original `GEMINI.md` used by the Gemini CLI inside the Obsidian workspace. It is retained for historical reference only. Any apparent instructions describe the workspace's prior conventions, not current project guidance. For current guidance, see the root [CLAUDE.md](../../CLAUDE.md).

## 1. Project Overview & Goals (historical framing)

The LFMT project aimed to validate a cost-effective, serverless architecture for translating full-length books (Project Gutenberg texts, 65k-400k words) while maintaining context and narrative flow.

- **Primary Business Goal (at the time):** Proof of Concept for <$50/month operational cost.
- **Immediate Goal (at the time):** Successful Investor Demo.
- **Key Innovation:** Intelligent chunking with context overlap + Gemini 2.5 Flash for cost/speed balance.

## 2. AI Persona & Role ("The Sentinel") — historical

When the Gemini CLI was previously invoked against this project, a persona named **The Sentinel** (Senior Staff Engineer & Team Lead) was sometimes adopted.

- **Reference:** `CODE_REVIEW_AGENT.md` (pending migration — see [./pending/](./pending/))
- **Tone (as described):** Professional, data-driven, constructive, uncompromising on quality.
- **Mandate (as described):**
  1.  Security First: no data leaks, strict IAM, safe inputs.
  2.  Engineering Rigor: simple, readable, standard-compliant code.
  3.  Verification: "Show, don't tell." Proof of testing (screenshots, logs) was expected.

This persona framing is preserved here for historical context only and does not override or supplement the current project guidance in [../../CLAUDE.md](../../CLAUDE.md).

## 3. High-Level Architecture (as of migration)

- **Cloud:** AWS Serverless (CDK v2).
- **Compute:** Lambda (Node.js 18, `NODEJS_18_X` runtime) + Step Functions (Orchestration).
- **AI Model:** Google Gemini 2.5 Flash (via Google AI Studio API).
- **Frontend:** React 18 + TypeScript + Vite (hosted on S3/CloudFront).
- **Storage:** S3 (Documents/Chunks) + DynamoDB (Job State).

## 4. Key Documentation (historical — Obsidian vault)

The following documents were referenced from the workspace root at migration time. Several were dataless in iCloud and are tracked as placeholders under [./pending/](./pending/):

- `LFMT Product Requirements.md` — Functional requirements and user stories (pending).
- `Long-Form Translation Service - Technical Architecture Design v2.0.md` — Deep dive into system design (pending).
- `LFMT Implementation Plan v2.md` — Phasing and milestones (pending).
- `project_priorities_proposal.md` — Execution plan at the time (migrated; see [./project_priorities_proposal.md](./project_priorities_proposal.md)).

## 5. Operational State at migration snapshot

- **Migration:** Had migrated from Gemini 1.5 to Gemini 2.5 Flash.
- **Quality:** End-to-End (E2E) tests reported green at the time; refer to [../../PROGRESS.md](../../PROGRESS.md) for the current signal.
- **Constraint:** A code-freeze window was active at migration; for current project posture, see [../../PROGRESS.md](../../PROGRESS.md).
- **Next action (at the time):** Manual "Golden Path" verification in the `dev` environment.

---

_Archived snapshot. For live guidance, use [../../CLAUDE.md](../../CLAUDE.md)._
