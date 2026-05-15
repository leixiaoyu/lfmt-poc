# Proposal: Refactor Monolithic CDK Stack into Nested Stacks

**Change ID**: `refactor-cdk-nested-stacks`
**Status**: PROPOSAL ONLY — implementation gated on owner approval
**Related Issue**: [#64 — P3-ARCH: Plan Refactoring of Monolithic CDK Stack to Nested Stacks](https://github.com/leixiaoyu/lfmt-poc/issues/64)
**Author**: Raymond Lei (via OpenSpec scaffolding)
**Created**: 2026-05-14

> This change is **PROPOSAL ONLY**. No CDK code, infrastructure tests, or
> deploy-pipeline files are modified by the PR introducing this folder.
> Implementation will land in subsequent PRs gated on explicit owner
> approval of this proposal and its companion `design.md`.

## Why

### Current state

The single `LfmtInfrastructureStack` defined in
`backend/infrastructure/lib/lfmt-infrastructure-stack.ts` is now
**2,662 lines of TypeScript** orchestrating every AWS resource in the
LFMT POC across a flat constructor that calls twelve private methods in
sequence (`createDynamoDBTables` → `createS3Buckets` →
`createCognitoUserPool` → `createSecretsManagerResources` →
`createLogGroups` → `createFrontendHosting` →
`addCloudFrontOriginToDocumentBucketCors` → `createIamRoles` →
`createLambdaFunctions` → `createStepFunctions` → `createApiGateway` →
`updateCloudFrontCSP` → `createApiEndpoints` → `createOutputs`).

The companion infrastructure test file
(`backend/infrastructure/lib/__tests__/infrastructure.test.ts`) is
**2,405 lines** and synthesizes the whole stack for every assertion.

Concrete resource inventory in the monolith:

- 4 DynamoDB tables (Jobs, Users, Attestations, RateLimitBuckets) with 5 GSIs
- 3 S3 buckets (Documents, Results, Frontend) — plus a conditional prod CloudFront log bucket
- 1 Cognito User Pool + 1 User Pool Client + 1 User Pool Domain + 1 PreSignUp trigger Lambda
- 1 Secrets Manager secret (Gemini API key)
- 15 NodejsFunction Lambdas (auth: 5, upload: 2, chunking: 1, translation: 3, jobs: 4, CSP-report: 1) + 1 inline PreSignUp Lambda
- 7 IAM roles (Auth, Upload, Chunking, Translation, DeleteJob, DownloadTranslation, ListJobs, CspReport) — and a Step Functions execution role
- 1 Step Functions state machine (`ProcessChunksMap` with 8+ tasks)
- 1 CloudFront distribution + 2 ResponseHeadersPolicy resources (initial + post-API CSP update) + 1 OAC
- 1 API Gateway REST API with ~12 resources/methods + 1 Cognito authorizer + per-method request validators
- 4 CloudWatch log groups (conditional on `enableLogging`)

### Problems observed today

1. **Cognitive load for changes.** Adding a new Lambda (e.g., the soft-delete purge Lambda from change `add-soft-delete-jobs`) requires touching the 2,662-line file in five places: role section, function section, environment variables, API endpoint binding, and outputs. PR reviewers must scroll a single 2k-line diff to see whether IAM grants and Lambda config are co-located.

2. **Test feedback loop is slow.** Every infrastructure test synthesizes the entire stack (`Template.fromStack(stack)`). The full 2,405-line test file takes noticeably longer to iterate than smaller stack tests would; targeted changes (e.g., "did I break the API stack?") still require a full re-synth.

3. **Deploy-time risk concentration ("blast radius").** A CDK deploy of the dev stack currently takes **~7–10 minutes wall-clock** (sample from `gh run list --workflow=deploy-backend.yml` on 2026-05-13/14). Every change — even a one-line Lambda environment variable tweak — re-evaluates the entire CloudFormation template and risks transient failures rolling back the whole stack. A small frontend-only or jobs-Lambda-only change should not be able to break Cognito or the document bucket.

4. **Implicit ordering constraints.** The constructor comments document non-trivial ordering: "CloudFront must be created before API Gateway so the CloudFront URL is in CORS origins"; "`updateCloudFrontCSP()` must run after API Gateway so the API domain can be baked into CSP." Today these constraints are enforced by call order inside `constructor()`. Splitting along the same boundaries makes the dependency explicit via CDK's `addDependency()` and removes a class of "rearranged a method call and broke prod" mistakes.

5. **No isolation of stateful vs stateless resources.** DynamoDB tables, the Cognito User Pool, and the document bucket are **stateful** — accidental destruction loses user data. Lambda functions, API Gateway, Step Functions, and CloudFront are **stateless** — they can be torn down and rebuilt cheaply. Today they live in the same CloudFormation template. A bug in the stateless section that triggers a stack rollback can put the stateful resources at risk.

6. **`(this as any).*` escape hatches.** The current file uses `(this as any).jobsTable = ...` and similar patterns ~10 times because the public-readonly properties are declared at class scope but assigned inside helper methods. Each nested stack would own its resources via clean construct properties, removing the type-system bypass.

### Why now

The OMC security-auditor PR comments on recent waves (#207, #208, #216) repeatedly noted "this is hard to review because the file is too long." The proposal-only `add-soft-delete-jobs` change is about to add a new Lambda + EventBridge rule + IAM role to the monolith, and the comment in `createJobLambda` already references this issue:

```typescript
// Applied to getJob and deleteJob (the two new Lambdas in PR #208) and
// intentionally scoped there to keep churn minimal.  The larger refactor
// (applying to all 13 sites) is tracked as Issue #64 (nested stacks).
```

This proposal does not block the soft-delete change — but it makes the long-running cleanup explicit so future waves can be scoped against it.

## What Changes

This proposal proposes splitting `LfmtInfrastructureStack` into **six purpose-bound nested stacks** plus the existing top-level CDK App. Each nested stack is `NestedStack` (CDK construct), composed into the parent stack so a single `cdk deploy` still deploys everything, but each child stack is a separately-versioned CloudFormation child template.

### Proposed stack split

| Stack                        | Resources                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DataStack**                | DynamoDB tables (Jobs, Users, Attestations, RateLimitBuckets) + their GSIs; S3 buckets (Documents, Results); Secrets Manager (Gemini API key)                                    | **ADDED** — extracted from monolith. Owns all stateful resources; never destroyed during routine deploys.                                                                                                                                                                                                                                                      |
| **AuthStack**                | Cognito User Pool, User Pool Client, User Pool Domain, PreSignUp Lambda trigger, Cognito-related IAM                                                                             | **ADDED** — extracted from monolith. Owns the second stateful resource class (user pool).                                                                                                                                                                                                                                                                      |
| **ApiStack**                 | API Gateway REST API, Cognito authorizer, all 15 NodejsFunction Lambdas, all 7 application IAM roles, Lambda→DynamoDB/S3/Secrets grants, request validators, API method bindings | **ADDED** — extracted from monolith. The biggest of the new stacks (~1,200 lines) but cohesive: every resource here is request-path.                                                                                                                                                                                                                           |
| **TranslationWorkflowStack** | Step Functions state machine (`ProcessChunksMap`), Step Functions execution IAM role, Step Functions log group                                                                   | **ADDED** — extracted from monolith. Isolates the asynchronous workflow from the request-path API.                                                                                                                                                                                                                                                             |
| **FrontendStack**            | Frontend S3 bucket, CloudFront distribution, OAC, both ResponseHeadersPolicy resources (initial + post-API CSP update), CloudFront log bucket (prod), bucket→OAC policy          | **ADDED** — extracted from monolith. The cross-stack CSP-update problem is the load-bearing part of the design (see `design.md`).                                                                                                                                                                                                                              |
| **SecurityStack**            | CSP report collector Lambda + its IAM role, Lambda@Edge slot (reserved for #254 follow-up), CloudWatch security audit log group                                                  | **ADDED** — extracted from monolith. Already half-extracted today: `backend/infrastructure/lib/security-stack.ts` exists for CloudTrail/GuardDuty/WAF and is **NOT** currently composed into the deploy. This proposal does not enable that file by default — it only adopts the SecurityStack pattern for the CSP report collector + future Lambda@Edge work. |

Notes on cuts that were rejected:

- **`NetworkingStack`** (VPC, Route 53, ACM): rejected — LFMT POC uses no VPC, no custom domain, no ACM cert. Adding an empty stack now would be premature. If a custom domain ever lands, it goes into `FrontendStack` (single owner of viewer-facing surfaces) until it grows large enough to extract.
- **Splitting `ApiStack` further into `JobsLambdaStack` / `AuthLambdaStack` / etc.**: rejected — over-decomposition. All Lambdas share the same NodejsFunction bundling config, the same API Gateway as binding surface, and the same `commonEnv` map. Splitting them buys nothing and triples the cross-stack-reference burden.

### What does NOT change in this proposal

- **No code is modified.** This PR adds only `openspec/changes/refactor-cdk-nested-stacks/`. The CDK stack file, infrastructure tests, deploy workflows, and Lambda code are all untouched.
- **No CDK migration is executed.** Migration of stateful resources (DDB, Cognito) is the load-bearing risk; see `design.md` for the rehoming strategy. Migration itself is a sequenced Phase 3+ effort.
- **No spec for app behavior changes.** The capability spec for jobs, auth, translation, etc. is identical before and after the refactor — this is a pure infrastructure restructuring.

## Impact

### Affected specs

- **`infrastructure-stack` (NEW capability)** — added in this proposal. Captures the multi-stack composition contract: which resources live where, how cross-stack references work, what the deploy invariants are. See `specs/infrastructure-stack/spec.md` in this folder.
- **No existing application capability specs are modified.** `jobs`, `frontend-hosting`, etc. continue to describe behavior, not infrastructure layout.

### Affected code (when implementation lands — NOT in this PR)

- `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` — split into:
  - `backend/infrastructure/lib/stacks/data-stack.ts` (~250 lines projected)
  - `backend/infrastructure/lib/stacks/auth-stack.ts` (~150 lines projected)
  - `backend/infrastructure/lib/stacks/api-stack.ts` (~1,200 lines projected)
  - `backend/infrastructure/lib/stacks/translation-workflow-stack.ts` (~400 lines projected)
  - `backend/infrastructure/lib/stacks/frontend-stack.ts` (~300 lines projected)
  - `backend/infrastructure/lib/stacks/security-stack.ts` (rename/extend the existing skeleton, ~250 lines projected)
  - `backend/infrastructure/lib/lfmt-infrastructure-stack.ts` (kept as the parent stack composing the six children, ~150 lines projected)
- `backend/infrastructure/lib/app.ts` — minor: the `App` instantiation does not change; the parent stack still wraps the children.
- `backend/infrastructure/lib/__tests__/infrastructure.test.ts` — split mirror: one test file per stack (`data-stack.test.ts`, `api-stack.test.ts`, …) plus a `composition.test.ts` that asserts the parent wires children correctly.
- `.github/workflows/deploy-backend.yml` — likely unchanged (still `cdk deploy`); a follow-up may add parallel child deploys.

### Deploy / migration impact

This is the riskiest part of the actual implementation (not of this proposal PR). See `design.md` "Migration plan" for the per-resource rehoming strategy. Summary:

- **Stateless resources** (Lambdas, API Gateway, Step Functions, CloudFront): re-creation is acceptable. Brief deploy window of broken-API is tolerable in dev; staging/prod use a logical-id-preserving rehome.
- **Stateful resources** (DDB tables, Cognito User Pool, S3 buckets with `retainData: true`): **MUST use the CDK `overrideLogicalId` + parent-stack stack-rename pattern OR a CFN stack-import**. Naive rehome would force-delete DDB tables and the user pool — unacceptable. Dev is `retainData: false` so a big-bang re-deploy is technically permitted, but losing the Cognito user pool means re-registering every test user.

### Test impact

- Per-stack synthesis tests run in **isolated CDK App contexts**, so each test file synthesizes only its target stack. Wall-clock test time should drop noticeably.
- Cross-stack reference assertions move to a new `composition.test.ts`.
- The drift-guard tests (ARM64 architecture, Node 22 runtime, per-environment CloudFront origin map) move to the stack that owns the resource — e.g., the Lambda runtime drift guard moves into `api-stack.test.ts`.

## BREAKING

This proposal **does not** ship breaking changes — it ships scaffolding only. The implementation phases authorized by this proposal **may** introduce the following breaking changes; they are called out here so reviewers of subsequent PRs are not surprised:

- **BREAKING (implementation phase, IF rehome is not logical-id-preserving): CloudFormation logical IDs change.** This forces resource recreation. For the Cognito User Pool and the four DynamoDB tables, recreation means **data loss**. The mitigation (see `design.md`) is to use `overrideLogicalId` to preserve every stateful resource's logical ID across the split, OR to do a CFN-level stack-import. This is testable in dev (where `retainData: false` permits a big-bang re-deploy as a fallback) before being applied to staging/prod.
- **BREAKING (implementation phase): CFN stack outputs split across parent + children.** Tooling that reads `aws cloudformation describe-stacks --stack-name LfmtPocDev` to fetch e.g. `FrontendUrl` may need to query `LfmtPocDev-FrontendStack-<hash>` instead. The deploy workflow already reads outputs by name; this will be audited in the implementation phase.
- **NOT BREAKING (clarification): The API Gateway URL, the CloudFront URL, the Cognito User Pool ID, and the DynamoDB table names are all stable across the refactor IF the migration plan is followed.** Frontend `.env`, integration tests, and the deploy workflow do not need to change.

## Validation

This proposal MUST pass `openspec validate refactor-cdk-nested-stacks --strict` before merge. The validation output is recorded in the PR body.
