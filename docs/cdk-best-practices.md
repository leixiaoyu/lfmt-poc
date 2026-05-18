# CDK Best Practices

This document outlines best practices for working with AWS CDK in the LFMT project, with lessons learned from production incidents.

## Table of Contents

- [CDK Tokens vs CloudFormation Intrinsic Functions](#cdk-tokens-vs-cloudformation-intrinsic-functions)
- [IAM Policy Management](#iam-policy-management)
- [Resource Naming](#resource-naming)
- [Testing and Validation](#testing-and-validation)
- [Privacy-Preserving 404 for Ownership-Checked Resources](#privacy-preserving-404-for-ownership-checked-resources)

> **CI/CD pipeline architecture** (deploy workflow split, branch-protection
> coordination, shared-types contract): see
> [docs/CI-CD-ARCHITECTURE.md](CI-CD-ARCHITECTURE.md). The deploy pipeline
> is split into `deploy-backend.yml` and `deploy-frontend.yml` so
> frontend-only commits don't pay the cost of a full backend pipeline.

---

## CDK Tokens vs CloudFormation Intrinsic Functions

### The Problem: When CloudFormation Intrinsics Fail

**Incident**: PR #46 - Step Functions ARN used CloudFormation intrinsic functions in a managed policy, causing deployment failure.

**What Happened**:

```typescript
// ❌ WRONG - CloudFormation intrinsics in CDK code
const arnPattern = `arn:aws:states:\${AWS::Region}:\${AWS::AccountId}:stateMachine:my-machine`;

new iam.ManagedPolicy(this, 'MyPolicy', {
  statements: [
    new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [arnPattern], // ❌ Literal string "${AWS::Region}" in IAM policy!
    }),
  ],
});
```

**Error**:

```
The policy failed legacy parsing (Service: Iam, Status Code: 400)
```

**Why It Failed**:

- CloudFormation intrinsic functions (`${AWS::Region}`, `${AWS::AccountId}`) are **CloudFormation template syntax**
- When embedded in CDK code strings, they're treated as **literal strings**
- IAM policy validator sees `arn:aws:states:${AWS::Region}:...` and rejects it as invalid ARN format
- The intrinsics are only evaluated **after** IAM validation, which is too late

### The Solution: Use CDK Tokens

**CDK tokens** are placeholders that CDK resolves **during synthesis** (before CloudFormation sees them):

```typescript
// ✅ CORRECT - CDK Stack tokens
import { Stack } from 'aws-cdk-lib';

const arnPattern = `arn:aws:states:${Stack.of(this).region}:${Stack.of(this).account}:stateMachine:my-machine`;

new iam.ManagedPolicy(this, 'MyPolicy', {
  statements: [
    new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: [arnPattern], // ✅ Resolves to valid ARN during synthesis
    }),
  ],
});
```

**Result in CloudFormation Template**:

```json
{
  "Resource": "arn:aws:states:us-east-1:123456789012:stateMachine:my-machine"
}
```

### Decision Matrix: Which to Use?

| Scenario                              | Use This      | Example                    |
| ------------------------------------- | ------------- | -------------------------- |
| **IAM policies, managed policies**    | ✅ CDK tokens | `Stack.of(this).region`    |
| **Resource ARNs in CDK constructs**   | ✅ CDK tokens | `Stack.of(this).account`   |
| **CloudFormation template outputs**   | ✅ Either     | Both work                  |
| **Cross-stack references**            | ✅ CDK tokens | `otherStack.exportValue()` |
| **Custom resources, Lambda env vars** | ⚠️ Depends    | Usually CDK tokens         |
| **Fn::Sub in template strings**       | ✅ Intrinsics | `Fn.sub('arn:...')`        |

### Common CDK Token Patterns

```typescript
import { Stack, Fn } from 'aws-cdk-lib';

// ✅ Account and Region
const account = Stack.of(this).account;
const region = Stack.of(this).region;
const partition = Stack.of(this).partition; // 'aws' or 'aws-cn'

// ✅ Stack name and ID
const stackName = Stack.of(this).stackName;
const stackId = Stack.of(this).stackId;

// ✅ Resource ARNs
const lambdaArn = myFunction.functionArn; // Already a token
const tableArn = myTable.tableArn;

// ✅ Build ARN patterns
const arnPattern = `arn:${partition}:lambda:${region}:${account}:function:prefix-*`;

// ✅ Reference other resources
const bucket = s3.Bucket.fromBucketName(this, 'Bucket', bucketName);

// ✅ Use Fn for complex logic
const conditional = Fn.conditionIf('IsProd', prodValue, devValue);
```

### When CloudFormation Intrinsics ARE Appropriate

CloudFormation intrinsics **are** appropriate in these cases:

```typescript
// ✅ In CloudFormation template outputs
new cdk.CfnOutput(this, 'Output', {
  value: '${AWS::Region}', // This works fine in outputs
});

// ✅ With Fn.sub() for template string substitution
import { Fn } from 'aws-cdk-lib';

const value = Fn.sub('arn:aws:s3:::bucket-${AWS::Region}');

// ✅ In conditions
import { CfnCondition, Fn } from 'aws-cdk-lib';

const isProd = new CfnCondition(this, 'IsProd', {
  expression: Fn.conditionEquals(Stack.of(this).region, 'us-east-1'),
});
```

### Key Takeaway

**Rule of Thumb**: If you're writing TypeScript/JavaScript code in CDK constructs:

- ✅ Use **CDK tokens**: `Stack.of(this).region`
- ❌ Avoid **literal CloudFormation syntax**: `${AWS::Region}`

CloudFormation intrinsics should only appear in:

- `Fn.*` function calls
- `CfnOutput` values
- Low-level `Cfn*` constructs

---

## IAM Policy Management

### Policy Size Limits

**Incident**: PR #45 - Too many inline policies exceeded AWS IAM size limit.

AWS IAM has strict size limits:

- **Inline policy**: 2,048 characters per policy, 10 policies per role
- **Managed policy**: 6,144 characters per policy document
- **Role**: All policies combined must stay reasonable (no hard limit, but fails deployment)

### Best Practice: Use Managed Policies

```typescript
// ❌ AVOID - Multiple inline policies
new iam.Role(this, 'Role', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
  inlinePolicies: {
    Policy1: new iam.PolicyDocument({
      /* ... */
    }),
    Policy2: new iam.PolicyDocument({
      /* ... */
    }),
    Policy3: new iam.PolicyDocument({
      /* ... */
    }),
    // Can quickly exceed size limits!
  },
});

// ✅ BETTER - Separate managed policies
const role = new iam.Role(this, 'Role', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});

new iam.ManagedPolicy(this, 'DynamoDBPolicy', {
  roles: [role],
  statements: [
    /* DynamoDB permissions */
  ],
});

new iam.ManagedPolicy(this, 'S3Policy', {
  roles: [role],
  statements: [
    /* S3 permissions */
  ],
});
```

### Enable Policy Minimization

**Always enabled in our project** (see `cdk.json` line 29):

```json
{
  "context": {
    "@aws-cdk/aws-iam:minimizePolicies": true
  }
}
```

This flag automatically:

- Merges duplicate policy statements
- Combines similar actions
- Reduces overall policy size

### Policy Organization Guidelines

1. **Group by Service**: One managed policy per AWS service

   ```typescript
   new iam.ManagedPolicy(this, 'LambdaDynamoDBPolicy', {
     /* ... */
   });
   new iam.ManagedPolicy(this, 'LambdaS3Policy', {
     /* ... */
   });
   ```

2. **Limit Wildcards**: Be specific where possible

   ```typescript
   // ❌ Too broad
   actions: ['s3:*'];

   // ✅ Specific
   actions: ['s3:GetObject', 's3:PutObject'];
   ```

3. **Scope Resources**: Use ARN patterns

   ```typescript
   // ❌ Too broad
   resources: ['*'];

   // ✅ Scoped
   resources: [`arn:aws:s3:::${bucketName}/*`];
   ```

---

## Resource Naming

### Use Consistent Naming Patterns

```typescript
// ✅ Good: Consistent prefixes
const functionName = `${stackName}-process-document`;
const tableName = `${stackName}-jobs`;
const bucketName = `${stackName}-documents-${account}`;

// ❌ Avoid: Hard-coded names (prevents multi-environment deployments)
const functionName = 'process-document';
```

### Physical vs Logical Names

```typescript
// Logical name (for CloudFormation)
const table = new dynamodb.Table(this, 'JobsTable', {
  // Physical name (actual AWS resource name)
  tableName: `lfmt-jobs-${environment}`,
});
```

**Best Practice**: Let CDK generate physical names for most resources, only specify when required (cross-stack references, external integrations).

---

## Testing and Validation

### Pre-Deployment Checklist

Before every CDK deployment:

1. **Synthesize locally**:

   ```bash
   npx cdk synth --context environment=dev
   ```

2. **Review CloudFormation template**:

   ```bash
   npx cdk synth --context environment=dev > template.yaml
   # Review IAM policies, resource changes
   ```

3. **Run infrastructure tests**:

   ```bash
   npm test
   ```

4. **Check for warnings**:
   ```bash
   npx cdk synth 2>&1 | grep -i warning
   ```

### Common Issues to Check

- ❌ Policy size approaching limits
- ❌ CloudFormation intrinsics in CDK code
- ❌ Hard-coded resource names
- ❌ Overly broad wildcards in IAM policies
- ❌ Missing removal policies on stateful resources

---

## Multi-Input-Path Contract Tests (OMC-followup R1)

### The Rule

> **Every Step Functions task or Lambda that can be reached from MORE than one
> upstream state MUST have a contract test for EACH upstream entry path.**

A "contract test" verifies the _payload shape_ the downstream task reads from
the state machine context — not just that the task is wired into the graph.

### Why It Matters: PR #176 Bug B

PR #176 went through TWO rounds of OMC review and was approved. In production,
it still failed: when chunks returned `success: false` (instead of throwing),
the state machine routed through the Choice gate to `UpdateJobFailed`, which
crashed with a `States.Runtime` JsonPath-not-found error trying to read
`$.error`. The DDB write never happened, leaving `translationStatus` stuck on
`IN_PROGRESS` forever.

Root cause:

- `UpdateJobFailed` has **two upstream entry paths**:
  1. The Map state's Catch handler (sets `$.error` via `resultPath: '$.error'`)
  2. The Choice gate's failure branch (does NOT set `$.error`)
- Existing tests asserted **topology** only:
  - "Pass + Choice + UpdateJobFailed all exist" ✅
  - "Choice routes to UpdateJobFailed" ✅
- They did NOT assert that `$.error` was populated **on both paths**.

The two reviewers (and the author) both reasoned about the graph and missed
that the Choice path lacked the field the downstream task required.

### The Reviewer Checklist

When reviewing a PR that adds or modifies a Step Functions task / Lambda:

1. **List every upstream state that can reach this task.** Walk the state
   machine definition; don't just look at the most-recently-added entry.
2. **Document the input payload contract.** What fields does this task read?
   What types? Required vs. optional?
3. **For each upstream entry path, verify the contract holds.** Either:
   - The upstream state explicitly produces the required fields (assert in a
     test), or
   - There's a normalizer state in between that synthesizes them (assert the
     normalizer's output shape AND that the upstream routes through it).
4. **Add a contract test per path.** Tests must inspect the SYNTHESIZED ASL
   JSON, not the CDK construct surface, so they survive ASL serialization
   changes that don't affect the contract.

### Example Anti-Pattern

```typescript
// ❌ Topology-only assertion (PR #176's gap)
expect(failureBranch.Next).toMatch(/UpdateJobFailed/);
```

### Example Fix

```typescript
// ✅ Contract assertion: the failure branch MUST go through a normalizer
//    that synthesizes $.error before reaching UpdateJobFailed.
expect(failureBranch.Next).toMatch(/NormalizeFailureContext/);

const normState = states['NormalizeFailureContext'];
expect(normState.ResultPath).toBe('$.error');
expect(normState.Parameters['reason']).toBe('CHUNK_FAILURE');
expect(normState.Next).toMatch(/UpdateJobFailed/);

// AND the OTHER entry path (Map Catch) sets $.error directly:
expect(catchAll.Next).toMatch(/UpdateJobFailed/);
expect(catchAll.ResultPath).toBe('$.error');
```

See `backend/infrastructure/lib/__tests__/infrastructure.test.ts` —
"Choice failure branch routes through NormalizeFailureContext before
UpdateJobFailed — Bug B regression" for the canonical example in this
codebase.

### Extension: HTTP-Boundary Contract Tests (Issue #183 follow-up)

The same principle extends beyond Step Functions to **every typed cross-process
boundary**. The HTTP seam between a Lambda handler and its shared-types
interface is equally invisible to topology-only review.

**Case study: PR #184 (`uploadRequest.ts` dropped `jobId`)**

The upload Lambda constructed a `jobId` UUID, used it in DynamoDB, then
silently omitted it from the response object. `PresignedUrlResponse` in
`shared-types/src/documents.ts` had no `jobId` field; TypeScript accepted
both sides because `createSuccessResponse` accepted `any`. The frontend
compensated by aliasing `fileId` as `jobId` — masking the gap until the
smoke suite caught it at runtime.

**The boundary contract rule:**

> **For every Lambda whose response body has a typed counterpart in
> `@lfmt/shared-types`, the handler's `createSuccessResponse` call MUST be
> statically constrained to that type (via generic), AND a unit test MUST
> round-trip the body through `JSON.parse` and assert each contract field is
> present and correctly typed.**

**Enforcement mechanism (already in place):**

`createSuccessResponse<T extends ApiFlatResponseBody>` in
`backend/functions/shared/api-response.ts` is already generic and bounded.
Omitting the type parameter (`createSuccessResponse(200, ...)`) does NOT bypass
enforcement — TypeScript infers `T` from the literal object, but silently accepts
any shape because the object type is too wide. To trigger a compile-time error on
missing fields you MUST supply the explicit type parameter:
`createSuccessResponse<PresignedUrlResponse>(200, ...)`. The unit-test
round-trip catches runtime mismatches that TypeScript's structural typing cannot
see (e.g. serialization drops `undefined` fields).

No new ESLint infrastructure is needed: the pattern is enforceable today via
the type parameter + round-trip test. Future Lambda authors can copy the template
in the **Example** block below.

**Reviewer checklist for HTTP boundaries:**

- [ ] Does the handler's `createSuccessResponse` call carry a type parameter
      matching the `shared-types` interface? (e.g. `createSuccessResponse<PresignedUrlResponse>(200, ...)`)
- [ ] Is there a unit test that serialises the handler's return value, parses
      it, and asserts every required field is present with the right type?
- [ ] Does the consuming service (frontend or downstream Lambda) read the field
      by its interface-declared name — not an alias or workaround?

**Example:**

```typescript
// ❌ Handler accepts any shape — gap is invisible to TypeScript
return createSuccessResponse(200, { data: { uploadUrl, fileId } }, requestId);

// ✅ Handler is constrained to the shared-types interface
return createSuccessResponse<PresignedUrlResponse>(
  200,
  { data: { uploadUrl, fileId, jobId } }, // TypeScript errors if jobId missing
  requestId
);
```

```typescript
// ✅ Unit test round-trips the wire shape
const raw = JSON.stringify(result.body);
const parsed: PresignedUrlResponse = JSON.parse(raw).data;
expect(parsed.uploadUrl).toBeDefined();
expect(parsed.fileId).toBeDefined();
expect(parsed.jobId).toBeDefined(); // would have caught the PR #184 gap
```

### When This Rule Applies

- Step Functions tasks that have multiple `.next()` predecessors
- Step Functions tasks reached via both a Choice rule AND a Catch handler
- Lambdas invoked from multiple Step Functions tasks
- Lambdas invoked from both Step Functions AND API Gateway
- Lambda response bodies that have a typed counterpart in `@lfmt/shared-types`
- Any cross-process boundary where both sides are "trust by convention"

---

## Additional Resources

- [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [IAM Policy Size Limits](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)
- [CDK Token Documentation](https://docs.aws.amazon.com/cdk/v2/guide/tokens.html)
- [Team Incident Reports](../openspec/changes/)

---

## AWS String Constraint Validation (OMC-followup R2)

### The Rule

> **Every string field that flows from CDK code into an AWS resource property
> must be validated against AWS's character-set constraints at synth time —
> not at deploy time.**

CDK happily accepts arbitrary Unicode in CDK property values. The CloudFormation
template synthesizes cleanly. `npm test` passes. Then `cdk deploy` fails at
resource creation because AWS validates the actual string against a per-resource
regex that's narrower than what CDK accepts.

### Why It Matters: PRs #208 + #212 Deploy Rollback

PRs #208 (DeleteJobLambdaRole) and #212 (DownloadTranslationLambdaRole)
introduced new IAM roles with em-dash characters (`—`, U+2014) in their
`description` strings. AWS IAM rejects:

```
Resource handler returned message: "1 validation error detected: Value at
'description' failed to satisfy constraint: Member must satisfy regular
expression pattern: [\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*"
```

That regex permits ASCII printable (0x20-0x7E) + tab/LF/CR + Latin-1 Supplement
(0xA1-0xFF). U+2014 is well outside Latin-1, so the role create failed and CDK
rolled back the entire stack — taking the new download endpoint, GET/DELETE
`/jobs/{id}`, and 11 unrelated Lambda updates with it.

Both PRs went through 5-agent OMC reviews. Multiple reviewers inspected the
new IAM roles for IAM scope correctness, BOLA, and IAM `Condition` hardening.
None spotted that the description string contained Unicode that AWS would
reject — because the test suite never asserted the AWS character constraint.
PR #213 was filed as the hotfix.

### The Reviewer / Test-Author Checklist

When adding or modifying any AWS resource property that accepts a string:

1. **Identify the AWS character constraint** for that property. The IAM
   `Description` regex above is one of many. Examples:
   - IAM Role/Policy `Description`: `[\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*`
     (ASCII + Latin-1 only, no Unicode beyond)
   - Resource tags: 256 chars max, no `aws:` prefix
   - S3 bucket names: lowercase, hyphens, 3-63 chars
   - CloudWatch alarm names: ASCII printable
   - IAM resource names: `[\w+=,.@-]+`
2. **Add a synth-time test** that walks the synthesized template and validates
   the property against the AWS regex. The PR #213 implementation is the
   canonical example — see `backend/infrastructure/lib/__tests__/infrastructure.test.ts`
   "AWS String Constraint Drift Guard (PR #213)".
3. **Prefer ASCII-only string literals in CDK source.** Reserve em-dashes,
   smart quotes, and other Unicode typography for code comments (stripped by
   tsc) or doc-comment strings (not sent to AWS).

### Example: PR #213's Drift Guard

```typescript
test('all `Description` fields contain only AWS-allowed characters', () => {
  const awsAllowedDescription = /^[\x09\x0A\x0D\x20-\x7E\xA1-\xFF]*$/;
  const violations: string[] = [];
  const visit = (path: string, node: unknown): void => {
    // walk the entire synthesized JSON template, collecting every
    // `Description` field and validating against the AWS regex
    // ...
  };
  visit('$', template.toJSON());
  expect(violations).toEqual([]); // friendly multi-violation surface
});
```

The test fails fast in `npm test` — long before `cdk deploy` ever runs.

### OMC Test-Automator Reviewer Checklist Update

When reviewing a PR that introduces or modifies any AWS resource:

- [ ] Are all string fields (Description, Name, Path, etc.) validated against
      the relevant AWS character constraint? If a `Description` is user-typed
      English prose, it's a candidate for non-ASCII drift.
- [ ] Is there a synth-time test that walks the template and asserts the
      constraint? Or is the only validation `cdk deploy` itself?
- [ ] If a CDK Aspect could provide broader coverage (e.g., `cdk-nag`), is
      adoption tracked as a follow-up?

### When This Rule Applies

- Any new `iam.Role`, `iam.Policy`, `iam.User`, etc. with a `description`
- Any new resource type whose schema includes `Description` / `Name` /
  `Comment` with documented character constraints
- Any cdk construct that interpolates user-supplied input into resource
  property strings

---

## Privacy-Preserving 404 for Ownership-Checked Resources

### The Problem: 403-vs-404 leaks resource existence (OWASP API1:2023 — BOLA)

Issue #286 — a backend handler that returns **403 Forbidden** when a resource
exists but isn't owned by the caller, and **404 Not Found** when the resource
doesn't exist, is leaking metadata. The 403-vs-404 asymmetry lets an attacker
who can enumerate or guess resource ids learn whether each id exists in the
system, even though the ownership check correctly blocks data access. That's
the same bug class as OWASP API1:2023 — Broken Object Level Authorization
(BOLA). It is medium-high severity: not directly exploitable for data theft,
but useful for targeted reconnaissance.

### The Antipattern

```ts
// ❌ WRONG — distinguishable 403 vs 404 responses leak resource existence.
const job = await loadJob(jobId);
if (!job) {
  return createErrorResponse(404, `Job not found: ${jobId}`, requestId, undefined, requestOrigin, {
    errorCode: 'JOB_NOT_FOUND',
  });
}
if (job.userId !== userId) {
  return createErrorResponse(
    403,
    'You do not have permission',
    requestId,
    undefined,
    requestOrigin,
    {
      errorCode: 'FORBIDDEN',
    }
  );
}
```

Two response codes, two different bodies. An attacker probing random jobIds
sees 403 vs 404 and learns which ids exist.

### The Pattern: collapse not-found and not-owned into a single 404

```ts
// ✅ CORRECT — single 404 response, byte-identical for both branches.
const job = await loadJob(jobId);
if (!job || job.userId !== userId) {
  // Privacy-preserving 404: do not distinguish "doesn't exist" from
  // "exists but not yours". The response is identical in both cases —
  // status code, message, errorCode all match.
  return createErrorResponse(404, `Job not found: ${jobId}`, requestId, undefined, requestOrigin, {
    errorCode: 'JOB_NOT_FOUND',
  });
}
```

Even better — push the ownership check into the data layer so the not-found
and not-owned cases produce the SAME `null` return from the repository helper:

```ts
// ✅ BEST — composite-key lookup means a job owned by someone else returns
// null at the DDB layer. The handler has only one error branch to reason about.
const job = await loadJobForUser(dynamoClient, JOBS_TABLE, jobId, userId);
if (!job) {
  return createErrorResponse(404, `Job not found: ${jobId}`, requestId, undefined, requestOrigin, {
    errorCode: 'JOB_NOT_FOUND',
  });
}
```

The LFMT Jobs table uses a composite primary key (jobId HASH + userId RANGE),
so `GetItem` with both keys naturally rejects cross-ownership lookups by
returning a null Item. `loadJobForUser` in
`backend/functions/shared/jobRepository.ts` is the canonical helper; new
handlers should use it rather than re-implementing the pattern.

### When NOT to apply this pattern

This pattern applies to handlers that:

1. Read a resource by a path-parameter id.
2. Enforce per-user ownership of that resource.

It does **NOT** apply to:

- **Auth handlers** (`backend/functions/auth/*.ts`). Their 403 responses
  (e.g., on unverified email) do not carry resource-existence information;
  the 403 status carries an orthogonal signal that the frontend deliberately
  surfaces in the UI (see PR #283).
- **Status-guard 4xx codes** that don't reveal existence. For example,
  `downloadTranslation.ts` returns **409 Conflict** when a job exists, is
  owned by the caller, but is not yet `COMPLETED`. That 409 is reached only
  after the ownership check has passed, so the response code reveals state
  about the caller's OWN job — which is fine.
- **Internal S3-event handlers** (`uploadComplete.ts`). They run inside the
  AWS account on validated events; the userId mismatch path is a defensive
  log-only event, not a client-facing HTTP response.

### Frontend impact

The frontend's `COPY_BY_CODE.JOB_NOT_FOUND` (added in PR #281) reads:

> "We couldn't find that translation — it may have been deleted. Please try
> again from your history."

This copy is appropriately ambiguous for both the not-found and not-owned
cases. No frontend code change is required when collapsing a backend 403 into
a 404 with `JOB_NOT_FOUND` — the user sees the same friendly message either
way.

### Reviewer / Test-Author Checklist

When reviewing a PR that adds or modifies a handler that takes a path-parameter
resource id and performs an ownership check:

- [ ] Does the handler return the SAME status code (404) for both
      "resource doesn't exist" and "resource exists but not owned by caller"?
- [ ] Is the response body byte-identical between those two branches
      (modulo the `requestId` UUID)?
- [ ] Are there at least two tests proving the byte-identical-body
      property? See `backend/functions/jobs/startTranslation.test.ts` →
      "returns BYTE-IDENTICAL 404 body for not-found vs not-owned (#286)"
      for the canonical pattern.
- [ ] If the handler refers to `userId` from `event.requestContext.authorizer.claims.sub`
      to compare against a loaded record, can the ownership scoping be
      pushed into the DDB key shape instead (composite key)? If yes,
      prefer `loadJobForUser` from `backend/functions/shared/jobRepository.ts`.

### Residual side-channel: response timing

Collapsing the two response codes defeats the per-response leak but does **not**
defeat a patient attacker measuring response time across many requests. A
not-found path returns null from DynamoDB after the lookup; a not-owned path
(with the composite-key shape) ALSO returns null from DynamoDB — so the two
paths take almost identical time. The residual gap on the LFMT-POC stack is
in the low single-digit millisecond range and is dominated by Lambda
cold-start jitter; it is not exploitable without thousands of requests and
statistical analysis. Mitigating it would require either an artificial delay
on the success path or a different data-access pattern. We document it here
for future hardening but do not consider it actionable in v1.

### When This Rule Applies

- Any new API Gateway Lambda that reads a per-user resource by a path
  parameter (`/jobs/{jobId}`, `/jobs/{jobId}/translate`, etc.).
- Any refactor of an existing ownership-checked handler — the response code
  is now part of the security-relevant API contract.

---

### Per-user rate limiting on ownership-checked endpoints — decision record (#289)

**Status:** Deferred (2026-05-18). Per-user rate limiting / anti-enumeration
on the five ownership-checked endpoints was filed as a defense-in-depth
follow-up to PR #287 and is **deliberately not being implemented today**.
The privacy-preserving 404 collapse from PR #287 already neutralizes the
per-request information leak; per-user throttling would only constrain
the cost and statistical power of large-scale enumeration in the event of
a future regression. Given a single-owner dev environment with no
external users, that work is overkill relative to the current threat
surface. This section records the threat model, the options considered,
the deferral decision, and the explicit conditions that would re-open it.

#### Context

- Issue #286 — the parent resource-existence leak (403 vs 404 asymmetry).
- PR #287 — the privacy-preserving 404 fix that closed #286 and added the
  "Privacy-Preserving 404 for Ownership-Checked Resources" section above.
- Issue #289 — this defense-in-depth follow-up, explicitly disclosed in
  PR #287's "Items deliberately NOT in scope" list and filed under the
  project's "no follow-up items lost" policy.
- OWASP API Security Top 10 references:
  - API1:2023 — Broken Object Level Authorization (BOLA). Rate limiting
    is recommended as a complementary mitigation to authorization checks,
    not a substitute.
  - API4:2023 — Unrestricted Resource Consumption. Even useless
    enumeration consumes Lambda invocations + DDB reads + API Gateway
    requests, so an unbounded request rate is itself a cost-abuse vector.

#### Threat model

After PR #287, an attacker holding a valid Cognito session can:

1. Issue `GET /jobs/<random-uuid>` (or any of the other four
   ownership-checked endpoints) repeatedly with valid auth.
2. Every response is a byte-identical 404 + `JOB_NOT_FOUND` envelope
   (modulo the `requestId` UUID). No per-request information leaks.
3. **However:** there is no upper bound on the request volume a single
   authenticated user may sustain against ownership-checked endpoints,
   beyond the global API Gateway throttle. The attacker can therefore
   probe the keyspace at scale.

Why this still matters as defense-in-depth:

- **Future regression amplification.** If a new ownership-checked handler
  is added that doesn't follow the privacy-preserving-404 pattern, or an
  existing one regresses despite the contract spec at
  `frontend/e2e/tests/contract/api-envelope-live.spec.ts`, an attacker
  who is already running an enumeration campaign gets the leak for free
  the moment the regression ships.
- **Timing side-channel amplification.** The residual response-timing
  gap documented in the "Privacy-Preserving 404" section above is not
  exploitable per-request, but is multiplied by attack volume. If issue
  #288 (timing side-channel residual) ever becomes exploitable, the
  absence of per-user throttling makes the statistical attack
  meaningfully cheaper.
- **Resource cost.** Useless enumeration still bills Lambda invocations,
  DDB reads, and API Gateway requests. A per-user throttle caps the
  cost of abuse independent of any data-leak property.
- **Generalized BOLA mitigation.** OWASP API1:2023 explicitly
  recommends rate limiting as a defense-in-depth control alongside
  authorization checks.

#### Current state

A **global** API Gateway throttle exists at the stage level — see
`backend/infrastructure/lib/lfmt-infrastructure-stack.ts:690-691`
(the `deployOptions` block on the `RestApi` construct):

| Environment   | `throttlingRateLimit` | `throttlingBurstLimit` |
| ------------- | --------------------- | ---------------------- |
| dev / staging | 100 req/sec           | 200                    |
| prod          | 1000 req/sec          | 2000                   |

**Gap:** the throttle is shared across all users and all endpoints. A
single authenticated user can spend the entire 100-RPS dev budget on
`GET /jobs/<random-uuid>` enumeration without affecting anyone else's
experience until they max out the global throttle. There is no
per-user, per-endpoint enforcement on the five ownership-checked
endpoints — `GET /jobs/{jobId}`, `GET /jobs/{jobId}/translation-status`,
`GET /jobs/{jobId}/download`, `POST /jobs/{jobId}/translate`,
`DELETE /jobs/{jobId}` (the audit set from PR #287's table).

#### Options considered

##### Option 1 — API Gateway usage plan + API key per Cognito user

Map each Cognito user to an API Gateway usage plan with a per-user rate
and quota; AWS-native; no Lambda code change.

Trade-offs:

- Operationally heavy. Usage plans + API keys must be provisioned on
  registration and rotated/revoked alongside Cognito lifecycle events.
- Coarse-grained. Doesn't differentiate enumeration ("1,000
  `GET /jobs/<random>`") from a legitimate burst ("1,000
  `POST /jobs/upload`"). Both burn the same bucket.
- Forces an API-key concept onto a system that today uses Cognito-only
  auth — a new auth primitive to maintain.

##### Option 2 — Lambda authorizer with per-user token bucket in DDB

Wrap or replace the existing Cognito authorizer with a Lambda authorizer
that maintains a per-user token bucket in DynamoDB. Decrement on each
call to an ownership-checked endpoint; reject with 429 when the bucket
is exhausted.

Trade-offs:

- Cleanest threat-model fit. The bucket can be tuned per endpoint
  (e.g., 1000 GETs/min, 100 POSTs/min) and per stage.
- DDB write on every request adds latency (~5–10 ms) and cost (~$0.25
  per million writes) on the hot path.
- Reuses an already-explored pattern. The `RateLimitBucketsTable` plus
  the bucket logic in
  [`backend/functions/translation/rateLimiter.ts`](../backend/functions/translation/rateLimiter.ts)
  already implement a distributed token bucket today (for the Gemini
  per-API-key throttle). Adapting it to key on Cognito `sub` + endpoint
  is straightforward; the bucket maths is identical.

##### Option 3 — Anomaly-based, log-driven (out-of-band)

Don't enforce in the request path. Log every ownership-checked endpoint
hit with `(userId, requestedResourceId)`; a CloudWatch metric filter
alarms on per-user enumeration patterns (e.g., > 50 distinct jobIds
queried per minute by one user); on alarm, ops manually locks or
disables the offending Cognito user.

Trade-offs:

- Zero per-request latency / cost.
- Reactive, not preventive. An attacker has the full alarm window to
  enumerate before any action is taken.
- Requires an ops on-call rotation — not appropriate for a project
  without one. Reasonable as a complementary measure alongside Option
  2, but unsafe as the sole control.

| Option                            | Per-request enforcement | Operational cost                        | Hot-path latency    | Reuses existing pattern                          |
| --------------------------------- | ----------------------- | --------------------------------------- | ------------------- | ------------------------------------------------ |
| 1: Usage plan + API key           | Yes                     | High (key lifecycle, rotation)          | Negligible          | No (new auth primitive)                          |
| 2: Lambda authorizer + DDB bucket | Yes                     | Medium (one new authorizer + table key) | ~5–10 ms + DDB cost | Yes (`rateLimiter.ts` / `RateLimitBucketsTable`) |
| 3: Log-driven anomaly alarm       | No (reactive)           | Low infra / High ops                    | Zero                | Partial (CloudWatch tooling)                     |

#### Decision

**Option 2 is deferred** until the re-entry criteria below are met.
**Option 1 is rejected** for operational complexity and poor
threat-model fit (it can't distinguish enumeration from legitimate
bursty workloads). **Option 3 is considered viable as a future
complementary measure** alongside Option 2 — e.g., a CloudWatch alarm
that catches enumeration patterns inside the per-user budget — but is
**not viable as the sole control** in this project given the absence
of a dedicated ops rotation.

When the re-entry criteria fire, **Option 2 is the option to land
first**, scoped narrowly to the five ownership-checked endpoints in the
PR #287 audit table.

#### Rationale (why deferral is correct today)

- **No real users.** The system today has a single owner (the project
  author). There is no realistic attacker population, and no external
  auth surface beyond the developer's own Cognito session.
- **Privacy-preserving 404 already neutralizes the per-request leak.**
  PR #287 collapsed the 403/404 distinction across all five
  ownership-checked handlers and added a live-contract spec
  (`api-envelope-live.spec.ts`) that pins the property. An attacker
  who enumerates today learns nothing from any single response — the
  marginal value of rate-limiting is therefore bounded to "make a
  hypothetical future regression less catastrophic", which is real
  but not urgent.
- **Global throttle covers the cost-abuse case at current scale.** The
  100-RPS dev throttle (1000-RPS prod) caps total stack cost. The gap
  Option 2 closes is per-user fairness inside that budget, which only
  matters once there is more than one user.
- **Engineering opportunity cost.** Implementing Option 2 means a new
  Lambda authorizer, a new DDB access pattern, integration tests
  against the bucket-exhausted path, a frontend mapping for 429 +
  `STATUS_MESSAGES[429]`, and a live-contract test gated behind a
  flag. That is multi-day work that competes with Phase 10 demo polish
  (see `PROGRESS.md`).
- **Reversible.** This is a docs-only decision. Re-opening the issue
  is cheap; no architecture is being calcified.

#### Re-entry criteria

Re-open issue #289 and implement Option 2 when **any** of the following
becomes true:

- **First external user or non-owner traffic lands on production.** The
  moment there is more than one Cognito principal in production, the
  global throttle stops providing per-user fairness and Option 2
  becomes load-bearing.
- **Compliance requirement.** A target compliance regime — SOC 2,
  HIPAA, ISO 27001, or an enterprise customer's security review —
  requires demonstrable per-user rate-limit controls on
  authorization-checked endpoints.
- **Observed enumeration pattern in CloudWatch logs.** Any operational
  signal that a Cognito user is issuing high-cardinality
  `GET /jobs/<random-uuid>` requests (or any of the other four
  ownership-checked endpoints) at a rate inconsistent with legitimate
  UX. Option 3's log-driven detection is the cheapest way to surface
  this signal short-term; treat such a finding as immediate
  justification for Option 2 as the structural fix.
- **Sibling timing-side-channel (#288) gets upgraded to exploitable.**
  The residual response-timing gap is currently sub-millisecond and
  dominated by Lambda cold-start jitter; if a future analysis shows
  it's exploitable with feasible request budgets, per-user rate
  limiting becomes a hard prerequisite for any timing-mitigation work
  (because rate-limiting is the only way to make the statistical
  attack uneconomic without changing the data-access pattern).
- **CloudWatch cost telemetry shows enumeration-shaped abuse.** Even
  absent a security signal, sustained anomalous Lambda invocation
  volume on the five ownership-checked endpoints is a financial
  signal that warrants Option 2.

When re-entered, follow the acceptance criteria listed in issue #289
verbatim (bucket size / window per stage via CDK context; 429 envelope
with `retry-after`; frontend `STATUS_MESSAGES[429]` mapping; bucket-
allow + bucket-exhausted unit tests; integration test for sustained
burst; gated live-contract test).

#### References

- Issue #289 — this decision record's source issue (per-user rate
  limiting / anti-enumeration).
- Issue #286 — parent resource-existence leak issue, closed by PR #287.
- PR #287 — privacy-preserving 404 fix; added the
  "Privacy-Preserving 404 for Ownership-Checked Resources" section
  above and called this work out as a deliberately-out-of-scope
  sibling issue.
- [`backend/functions/translation/rateLimiter.ts`](../backend/functions/translation/rateLimiter.ts)
  — existing distributed token-bucket implementation (per-API-key, for
  Gemini); the pattern Option 2 would adapt for per-Cognito-user
  buckets keyed by `sub` + endpoint.
- `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:690-691`
  — existing global API Gateway throttle (`throttlingRateLimit` /
  `throttlingBurstLimit`) that Option 2 would complement, not replace.
- OWASP API Security Top 10 — API1:2023 (Broken Object Level
  Authorization) and API4:2023 (Unrestricted Resource Consumption).

---

**Last Updated**: 2026-05-18
**Maintained By**: LFMT Engineering Team
