# CDK Best Practices

This document outlines best practices for working with AWS CDK in the LFMT project, with lessons learned from production incidents.

## Table of Contents
- [CDK Tokens vs CloudFormation Intrinsic Functions](#cdk-tokens-vs-cloudformation-intrinsic-functions)
- [IAM Policy Management](#iam-policy-management)
- [Resource Naming](#resource-naming)
- [Testing and Validation](#testing-and-validation)

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

| Scenario | Use This | Example |
|----------|----------|---------|
| **IAM policies, managed policies** | ✅ CDK tokens | `Stack.of(this).region` |
| **Resource ARNs in CDK constructs** | ✅ CDK tokens | `Stack.of(this).account` |
| **CloudFormation template outputs** | ✅ Either | Both work |
| **Cross-stack references** | ✅ CDK tokens | `otherStack.exportValue()` |
| **Custom resources, Lambda env vars** | ⚠️ Depends | Usually CDK tokens |
| **Fn::Sub in template strings** | ✅ Intrinsics | `Fn.sub('arn:...')` |

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
    Policy1: new iam.PolicyDocument({ /* ... */ }),
    Policy2: new iam.PolicyDocument({ /* ... */ }),
    Policy3: new iam.PolicyDocument({ /* ... */ }),
    // Can quickly exceed size limits!
  },
});

// ✅ BETTER - Separate managed policies
const role = new iam.Role(this, 'Role', {
  assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
});

new iam.ManagedPolicy(this, 'DynamoDBPolicy', {
  roles: [role],
  statements: [/* DynamoDB permissions */],
});

new iam.ManagedPolicy(this, 'S3Policy', {
  roles: [role],
  statements: [/* S3 permissions */],
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
   new iam.ManagedPolicy(this, 'LambdaDynamoDBPolicy', { /* ... */ });
   new iam.ManagedPolicy(this, 'LambdaS3Policy', { /* ... */ });
   ```

2. **Limit Wildcards**: Be specific where possible
   ```typescript
   // ❌ Too broad
   actions: ['s3:*']

   // ✅ Specific
   actions: ['s3:GetObject', 's3:PutObject']
   ```

3. **Scope Resources**: Use ARN patterns
   ```typescript
   // ❌ Too broad
   resources: ['*']

   // ✅ Scoped
   resources: [`arn:aws:s3:::${bucketName}/*`]
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

## Additional Resources

- [AWS CDK Best Practices](https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html)
- [IAM Policy Size Limits](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_iam-quotas.html)
- [CDK Token Documentation](https://docs.aws.amazon.com/cdk/v2/guide/tokens.html)
- [Team Incident Reports](../openspec/changes/)

---

**Last Updated**: 2025-11-09
**Maintained By**: LFMT Engineering Team
