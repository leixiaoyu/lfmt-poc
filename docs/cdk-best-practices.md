# CDK Best Practices

This document outlines best practices for working with AWS CDK in the LFMT project, with lessons learned from production incidents.

## Table of Contents

- [CDK Tokens vs CloudFormation Intrinsic Functions](#cdk-tokens-vs-cloudformation-intrinsic-functions)
- [IAM Policy Management](#iam-policy-management)
- [Resource Naming](#resource-naming)
- [Testing and Validation](#testing-and-validation)

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

### When This Rule Applies

- Step Functions tasks that have multiple `.next()` predecessors
- Step Functions tasks reached via both a Choice rule AND a Catch handler
- Lambdas invoked from multiple Step Functions tasks
- Lambdas invoked from both Step Functions AND API Gateway

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
  expect(violations).toEqual([]);  // friendly multi-violation surface
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

**Last Updated**: 2026-05-07
**Maintained By**: LFMT Engineering Team
