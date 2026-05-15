# Tasks: Refactor Monolithic CDK Stack into Nested Stacks

This change is **proposal-only** in Phase 0 (this PR). Phases 1–7 are
the implementation roadmap and ONLY proceed after explicit owner
approval of `proposal.md` + `design.md`.

Each numbered phase below is intended to land as **one PR**. Each
checkbox is a 1–2 hour sub-task — the goal is that an estimator can
read this file and bound the total work.

---

## 0. Proposal (this PR — DO NOT implement further without owner approval)

- [x] 0.1 Scaffold `openspec/changes/refactor-cdk-nested-stacks/` with `proposal.md`, `design.md`, `tasks.md`, and `specs/infrastructure-stack/spec.md`.
- [x] 0.2 Run `openspec validate refactor-cdk-nested-stacks --strict` and resolve any issues.
- [x] 0.3 Commit on branch `proposal/issue-64-nested-stacks`; open PR titled `docs(openspec): scaffold proposal for nested-stacks CDK refactor (#64)`.
- [x] 0.4 Post OMC R1 self-review (~600–800 words) as a PR comment.
- [ ] 0.5 Owner approval gate — DO NOT proceed to Phase 1 without an explicit "approved" comment from Raymond on the PR.

---

## 1. Phase 1 — Extract DataStack (stateful, lowest churn)

**Stack scope**: 4 DynamoDB tables (Jobs, Users, Attestations, RateLimitBuckets) + 5 GSIs; 2 S3 buckets (Documents, Results); 1 Secrets Manager secret (Gemini API key); document bucket CORS rule that depends on the per-environment CloudFront origin literal.

**Critical constraint**: every stateful resource MUST keep its existing CFN logical ID. `cdk diff` against staging MUST show ZERO changes to any DDB table or S3 bucket. If diff shows recreation, the PR is BLOCKED.

- [ ] 1.1 Create `backend/infrastructure/lib/stacks/data-stack.ts` with `DataStack extends NestedStack`. Declare public-readonly properties: `jobsTable`, `usersTable`, `attestationsTable`, `rateLimitBucketsTable`, `documentBucket`, `resultsBucket`, `translationApiKeySecret`.
- [ ] 1.2 Move the body of `createDynamoDBTables(removalPolicy)` (currently lines ~270–352 of the monolith) into `DataStack`. Wire each table via `new dynamodb.Table(this, '<LogicalID>', { ... })` AND call `(table.node.defaultChild as dynamodb.CfnTable).overrideLogicalId('<existing-synthesized-ID>')` for each table.
- [ ] 1.3 Pre-flight: run `cdk synth` on the **current** monolith and capture each table's CFN logical ID from `cdk.out/LfmtPocDev.template.json`. Record these in a constant `EXISTING_LOGICAL_IDS` inside `data-stack.ts` so the rehome cannot drift silently.
- [ ] 1.4 Move the body of `createS3Buckets(removalPolicy)` (lines ~354–434) into `DataStack`. Apply `overrideLogicalId` for `DocumentBucket` and `ResultsBucket`. Keep `FrontendBucket` in the monolith (it moves in Phase 4).
- [ ] 1.5 Move `addCloudFrontOriginToDocumentBucketCors(environment)` (lines ~475–505) into `DataStack`. Accept `environment` as a constructor prop.
- [ ] 1.6 Move `createSecretsManagerResources(removalPolicy)` (lines ~627–652) into `DataStack`. Apply `overrideLogicalId` for `TranslationApiKeySecret`.
- [ ] 1.7 Update parent `LfmtInfrastructureStack` to instantiate `new DataStack(this, 'DataStack', {...})` and expose its public properties via getters so existing references keep working transitionally.
- [ ] 1.8 Remove the now-extracted methods from the parent. Replace each `this.jobsTable` reference site with `this.dataStack.jobsTable` (or pass the property through to the consumer's prop bag in later phases).
- [ ] 1.9 Run `cdk synth --context environment=dev` and `diff -r cdk.out cdk.out.before/` — assert **NO** changes to any DDB table or S3 bucket logical ID. If non-empty diff, fix logical ID overrides and re-run.
- [ ] 1.10 Run `cdk synth --context environment=staging` and `cdk diff LfmtPocStaging` against the live CFN template via `aws cloudformation get-template --stack-name LfmtPocStaging`. Assert zero stateful-resource recreation.
- [ ] 1.11 Create `backend/infrastructure/lib/stacks/__tests__/data-stack.test.ts`. Synthesize `DataStack` in isolation; assert the 4 tables, 5 GSIs, 3 buckets (Documents, Results, plus document-bucket CORS rule), and the secret all exist with expected properties.
- [ ] 1.12 Trim `infrastructure.test.ts` to remove the assertions now covered by `data-stack.test.ts`. Add a new top-level `composition.test.ts` that asserts the parent stack contains a `AWS::CloudFormation::Stack` resource for DataStack.
- [ ] 1.13 Run full test suite (`npm test`, `cdk synth`, `cdk diff` against dev). Open PR titled `refactor(infra): Phase 1 — extract DataStack from monolith (#64)`.
- [ ] 1.14 After CI green AND owner approval, deploy to dev. Verify the deploy completed successfully and DDB table contents are intact (`aws dynamodb scan --table-name lfmt-jobs-LfmtPocDev --limit 1`).

## 2. Phase 2 — Extract AuthStack (stateful, second-lowest churn)

**Stack scope**: Cognito User Pool, User Pool Client, User Pool Domain, PreSignUp inline Lambda trigger.

**Critical constraint**: Cognito User Pool MUST keep its existing CFN logical ID. Recreation deletes all users.

- [ ] 2.1 Create `backend/infrastructure/lib/stacks/auth-stack.ts` with `AuthStack extends NestedStack`. Public-readonly: `userPool`, `userPoolClient`, `userPoolDomain`.
- [ ] 2.2 Move `createCognitoUserPool(removalPolicy)` (lines ~507–625) into `AuthStack`. Apply `overrideLogicalId` to UserPool, UserPoolClient, UserPoolDomain, PreSignUpTrigger.
- [ ] 2.3 The PreSignUp inline Lambda's role must be created inside AuthStack (currently it's an inline Lambda with default role).
- [ ] 2.4 Update parent to instantiate `AuthStack` after `DataStack`. Add `addDependency(authStack)` if the dependency graph requires explicit ordering (it shouldn't — Cognito has no deps on DDB).
- [ ] 2.5 Update all reference sites: `this.userPool` → `this.authStack.userPool`, etc.
- [ ] 2.6 Pre-flight: `cdk synth` + diff against the prior synth — assert ZERO changes to Cognito resources.
- [ ] 2.7 Create `backend/infrastructure/lib/stacks/__tests__/auth-stack.test.ts`. Assert: exactly one UserPool, password policy preserved, PreSignUp trigger wired for dev only.
- [ ] 2.8 Run full test suite + cdk synth. Open PR `refactor(infra): Phase 2 — extract AuthStack from monolith (#64)`.
- [ ] 2.9 Deploy to dev. Verify existing users still log in (`aws cognito-idp list-users --user-pool-id $POOL_ID --limit 1`).

## 3. Phase 3 — Extract TranslationWorkflowStack

**Stack scope**: Step Functions state machine (`ProcessChunksMap` + all 8+ tasks), Step Functions execution IAM role, Step Functions log group.

**Cross-stack reference**: needs the `translateChunkFunction` from (future) ApiStack. For Phase 3 the function still lives in the monolith parent — TranslationWorkflowStack receives it as a constructor prop.

- [ ] 3.1 Create `backend/infrastructure/lib/stacks/translation-workflow-stack.ts` with `TranslationWorkflowStack extends NestedStack`. Constructor takes `props.translateChunkFunction: lambda.IFunction` and `props.jobsTable: dynamodb.ITable`.
- [ ] 3.2 Move `createStepFunctions()` (lines ~1590–~2027) into `TranslationWorkflowStack`. Reference `props.translateChunkFunction` instead of `this.translateChunkFunction`.
- [ ] 3.3 Move the `StepFunctionsExecutionRole` (lines ~1153–1170) into `TranslationWorkflowStack`. Replace the manual `arn:aws:lambda:...` reference with `props.translateChunkFunction.grantInvoke(stepFunctionsRole)`.
- [ ] 3.4 Move the Step Functions log group (currently inside `createLogGroups`) into `TranslationWorkflowStack`.
- [ ] 3.5 Apply `overrideLogicalId` to the state machine to preserve its CFN logical ID (preserves the state machine ARN; the env-var consumer is `startTranslation.ts` and the ARN is read at runtime).
- [ ] 3.6 Update parent to instantiate `TranslationWorkflowStack` AFTER Lambda creation. Pass `translateChunkFunction` + `jobsTable`.
- [ ] 3.7 Create `translation-workflow-stack.test.ts`. Assert state machine exists, Map state has correct `maxConcurrency`, the on-failure handler is at the Map level (Issue #151 regression guard moves here).
- [ ] 3.8 cdk synth + diff. Run tests. Open PR `refactor(infra): Phase 3 — extract TranslationWorkflowStack (#64)`.
- [ ] 3.9 Deploy to dev. Run an end-to-end translation to verify the state machine still executes correctly.

## 4. Phase 4 — Extract FrontendStack (and reconcile CSP-update flip)

**Stack scope**: Frontend S3 bucket, CloudFront distribution, OAC, ResponseHeadersPolicy (single, with concrete API domain — no second policy), bucket→OAC resource policy, optional prod CloudFront log bucket.

**Cross-stack reference**: needs `documentBucket.bucketRegionalDomainName` (DataStack) for CSP `connect-src`; needs `apiDomain` (string, currently constructed inside the monolith from `this.api.restApiId`) for CSP `connect-src` + `report-uri`.

**Critical design change**: Decision 4 in `design.md` flips the API-before-Frontend order. This phase ALSO removes the `updateCloudFrontCSP()` post-hoc L1 override and the orphan `FrontendSecurityHeadersUpdated` policy.

- [ ] 4.1 Create `backend/infrastructure/lib/stacks/frontend-stack.ts`. Constructor takes `props.documentBucket: s3.IBucket`, `props.apiDomain: string`, `props.environment: string`, `props.removalPolicy`.
- [ ] 4.2 Move `createFrontendHosting(removalPolicy)` (lines ~2315–2477) into `FrontendStack`. Apply `overrideLogicalId` to FrontendBucket, FrontendOAC, FrontendDistribution, FrontendSecurityHeaders.
- [ ] 4.3 Build the CSP body once, with the concrete `props.apiDomain` (NOT the `*.execute-api.us-east-1.amazonaws.com` wildcard). Delete the `updateCloudFrontCSP()` method and its `FrontendSecurityHeadersUpdated` policy from the codebase. Update `composition.test.ts` to assert there is exactly ONE ResponseHeadersPolicy in the synthesized parent template.
- [ ] 4.4 Update `getAllowedApiOrigins()` to no longer depend on `this.frontendDistribution` existing — the per-environment literal in `CLOUDFRONT_ORIGINS_BY_ENVIRONMENT` is the primary source and is sufficient.
- [ ] 4.5 Verify the drift between `CLOUDFRONT_ORIGINS_BY_ENVIRONMENT.dev` literal and the live CloudFront domain is zero via the existing post-deploy check; if the rehome accidentally changes the domain, the PR is BLOCKED.
- [ ] 4.6 Update parent stack to instantiate `FrontendStack` AFTER `ApiStack` (still in the monolith in Phase 4 — `apiDomain` derived from the current `this.api.restApiId`). Pass props through.
- [ ] 4.7 Update `composition.test.ts`: post-Phase-4 the CFN template MUST contain exactly one ResponseHeadersPolicy + one Distribution + zero orphan policies.
- [ ] 4.8 Create `frontend-stack.test.ts`. Assert: bucket public access blocked, OAC bound, custom error responses for 403+404 → /index.html, security headers (HSTS, frame-options, content-type-options), CSP includes the concrete API domain.
- [ ] 4.9 cdk synth + diff. ZERO changes to FrontendDistribution's logical ID. ZERO changes to the CloudFront domain literal.
- [ ] 4.10 Open PR `refactor(infra): Phase 4 — extract FrontendStack + collapse CSP policies (#64)`.
- [ ] 4.11 Deploy to dev. Verify SPA still serves; CSP header still allows API + document-bucket connect-src.

## 5. Phase 5 — Extract SecurityStack (CSP report Lambda + future Lambda@Edge slot)

**Stack scope**: CSP report collector Lambda (#201) + its isolated IAM role, CloudWatch security audit log group, and a reserved slot for Lambda@Edge work (#254 follow-up — empty in Phase 5).

**Cross-stack reference**: the CSP report Lambda is bound to a POST endpoint on API Gateway (`/csp-report`). For Phase 5 the API Gateway lives in the monolith parent — SecurityStack receives a reference to it via constructor props.

- [ ] 5.1 Create `backend/infrastructure/lib/stacks/security-stack.ts` (a NEW file — does NOT touch the existing `backend/infrastructure/lib/security-stack.ts` which is CloudTrail/GuardDuty/WAF and is out of scope here. Consider naming this `app-security-stack.ts` to avoid collision, OR move the existing one to `account-security-stack.ts`).
- [ ] 5.2 Move the CSP report Lambda creation site + `cspReportRole` (lines ~1136–1151 of the monolith for the role; the function is in `createLambdaFunctions`) into `SecurityStack`.
- [ ] 5.3 Move the security audit log group (currently inside `createLogGroups`) into `SecurityStack`.
- [ ] 5.4 Move the `/csp-report` API Gateway resource binding into `SecurityStack` — accept `props.apiRootResource: apigateway.IResource` so the binding stays close to the Lambda. (Alternative: keep the binding in ApiStack and pass `props.cspReportFunction` to it. The decision should be revisited if the Lambda@Edge slot adds more API surface.)
- [ ] 5.5 Apply `overrideLogicalId` to the CSP report Lambda + role.
- [ ] 5.6 Create `app-security-stack.test.ts`. Assert: CSP report role has ONLY `AWSLambdaBasicExecutionRole` attached (no DDB/S3/Secrets grants — this is the load-bearing assertion because the endpoint is anonymous).
- [ ] 5.7 cdk synth + diff. Open PR `refactor(infra): Phase 5 — extract SecurityStack for CSP-report + future L@E (#64)`.
- [ ] 5.8 Deploy to dev. Verify a synthetic CSP violation report still reaches CloudWatch Logs.

## 6. Phase 6 — Extract ApiStack (the biggest piece)

**Stack scope**: API Gateway REST API, request validators, Cognito authorizer, 15 NodejsFunction Lambdas, 7 application IAM roles, all IAM grants from Lambdas to DDB tables + buckets + secrets, all API method bindings.

**Critical constraint**: API Gateway URL (api.url) MUST be preserved. `overrideLogicalId` on the RestApi construct. Frontend `.env` REACT_APP_API_URL is hardcoded per environment and read at build time — if API ID changes, frontend rebuilds + redeploys are required and CORS may break mid-flight.

This is the largest PR. Consider splitting into sub-PRs (6a, 6b, 6c) if review fatigue surfaces. Suggested split: (6a) Lambdas + IAM roles only; (6b) API Gateway + Cognito authorizer; (6c) all method bindings.

- [ ] 6.1 Create `backend/infrastructure/lib/stacks/api-stack.ts`. Constructor takes `props.dataStack`, `props.authStack`, `props.translationApiKeySecret`, `props.environment`, `props.removalPolicy`.
- [ ] 6.2 Move `createIamRoles()` (lines ~743–1171) into `ApiStack`. Convert every IAM grant from manual ARN string to construct-reference (e.g., `props.dataStack.jobsTable.grantReadWriteData(uploadRole)` instead of `tableArn` interpolation). Apply `overrideLogicalId` to each of the 7 roles.
- [ ] 6.3 Move the `createJobLambda` helper + `createLambdaFunctions()` (lines ~1182–~1589) into `ApiStack`. Apply `overrideLogicalId` to each of the 15 NodejsFunction constructs (preserves Lambda ARN; preserves the `lfmt-<name>-<stack>` function names which are bound to the resource ID via `functionName`).
- [ ] 6.4 Move `createApiGateway()` (lines ~654–702) into `ApiStack`. Apply `overrideLogicalId` to the RestApi + deployment stage.
- [ ] 6.5 Move `createApiEndpoints()` (lines ~2028–~2314) into `ApiStack`. Every method binding stays inside `ApiStack`.
- [ ] 6.6 Re-wire the Step Functions cross-stack reference: ApiStack exposes `translateChunkFunction`; TranslationWorkflowStack reads it via the parent stack's prop propagation.
- [ ] 6.7 Re-wire the CSP report cross-stack reference: SecurityStack reads either `props.apiRootResource` (per Phase 5 Decision) OR the Lambda is passed in the other direction. Confirm the chosen pattern.
- [ ] 6.8 The post-hoc `updateCloudFrontCSP()` is already gone (Phase 4); just verify ApiStack exposes `apiDomain` as a public-readonly property and the parent stack threads it into FrontendStack.
- [ ] 6.9 Create `api-stack.test.ts`. This is the largest test file — move ALL Lambda assertions, IAM scoping assertions, and API method assertions here. The ARM64 + Node22 drift guards move here.
- [ ] 6.10 cdk synth + cdk diff. Assert ZERO changes to: every Lambda function name, the API ID, the API URL, every IAM role ARN.
- [ ] 6.11 Open PR(s) for Phase 6. If split: `refactor(infra): Phase 6a — extract Lambdas + IAM into ApiStack (#64)`, `Phase 6b — extract API Gateway into ApiStack (#64)`, `Phase 6c — extract method bindings into ApiStack (#64)`.
- [ ] 6.12 Deploy to dev. Verify all API endpoints respond. Run the full backend integration test suite against dev.

## 7. Phase 7 — Cleanup + final composition test

- [ ] 7.1 Delete the now-empty `createX()` methods from the parent stack. The parent should be ~150 LOC composing 6 NestedStacks + passing props.
- [ ] 7.2 Delete `(this as any).x = ...` escape hatch sites. Each is now owned by its child stack as a typed public-readonly property.
- [ ] 7.3 Move the `CLOUDFRONT_ORIGINS_BY_ENVIRONMENT` constant to a shared module (`backend/infrastructure/lib/stacks/shared/cloudfront-origins.ts`) since it is referenced by both DataStack (document-bucket CORS) and ApiStack (API Gateway CORS).
- [ ] 7.4 Move the `LAMBDA_RUNTIME` and `LAMBDA_ARCHITECTURE` constants to the same shared module.
- [ ] 7.5 Finalize `composition.test.ts`: assert parent template contains exactly 6 NestedStack resources; assert the cross-stack parameter references are wired (ApiStack reads DataStack table ARN parameter; FrontendStack reads ApiStack apiDomain parameter; etc.).
- [ ] 7.6 Add ESLint rule (or grep-based pre-push hook) that fails the build if `(this as any)` appears in any `backend/infrastructure/lib/stacks/*.ts` file.
- [ ] 7.7 Update `CLAUDE.md` infrastructure section to describe the new stack layout. Update `docs/CDK-BEST-PRACTICES.md` with the cross-stack reference pattern.
- [ ] 7.8 Update `openspec/project.md` infrastructure section to reflect the nested-stack layout.
- [ ] 7.9 Open PR `refactor(infra): Phase 7 — finalize nested-stack composition + docs (#64)`.
- [ ] 7.10 Deploy to dev, staging, then prod (sequenced — staging green for one full deploy cycle before prod).
- [ ] 7.11 Archive this OpenSpec change: `openspec archive refactor-cdk-nested-stacks --yes`.
- [ ] 7.12 Close issue #64 with a comment summarizing the final architecture + linking each Phase PR.

---

## Out-of-scope (NOT in this proposal)

- Onboarding the existing `backend/infrastructure/lib/security-stack.ts` (CloudTrail/GuardDuty/WAF). That file is not currently composed into the deploy; this proposal does not change that.
- Splitting into separate `cdk.json` apps (sibling-stack architecture). Revisit only if NestedStack composition outgrows its sweet spot.
- Reducing wall-clock deploy time. Not a goal; see `design.md` "Deploy time analysis."
- Custom L2.5/L3 CDK constructs. The split uses vanilla `NestedStack` only.
- Moving `LegalAttestations` table to its own stack. The `DataStack` boundary is wide enough; revisit when the production write path lands.
