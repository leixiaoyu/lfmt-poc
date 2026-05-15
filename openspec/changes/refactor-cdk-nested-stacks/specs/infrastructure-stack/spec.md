# Spec Delta: Infrastructure Stack Composition

This is a new capability being added to LFMT.

The `infrastructure-stack` capability captures the multi-stack
composition contract: which AWS resources live in which CDK stack,
how cross-stack references are wired, and what deploy-time invariants
the composition MUST preserve.

This capability does NOT describe the application behavior of any
individual resource (e.g., the DynamoDB table schema is captured under
the `jobs` capability, not here). It describes ONLY the boundary
between stacks and the safety invariants the boundary must respect.

## ADDED Requirements

### Requirement: Multi-Stack Composition Boundary

The system SHALL compose its AWS infrastructure as a parent
`LfmtInfrastructureStack` containing six child stacks deployed as CDK
`NestedStack` constructs: `DataStack`, `AuthStack`, `ApiStack`,
`TranslationWorkflowStack`, `FrontendStack`, and `SecurityStack`.

Each child stack SHALL own a non-overlapping set of AWS resources as
documented in `design.md`. No two child stacks may declare ownership of
the same physical resource.

The parent stack SHALL be deployable via a single `cdk deploy
<StackName>` invocation; the operator MUST NOT need to deploy child
stacks individually.

#### Scenario: Parent stack composes exactly six child stacks

- **GIVEN** the CDK app synthesizes the parent `LfmtInfrastructureStack`
- **WHEN** the synthesized CloudFormation template is inspected
- **THEN** the template MUST contain exactly six `AWS::CloudFormation::Stack` resources
- **AND** their logical IDs MUST correspond to `DataStack`, `AuthStack`, `ApiStack`, `TranslationWorkflowStack`, `FrontendStack`, and `SecurityStack`

#### Scenario: No resource owned by two stacks

- **GIVEN** the CDK app synthesizes all six child stacks
- **WHEN** the union of all child-stack templates is inspected
- **THEN** every CloudFormation resource (DDB Table, S3 Bucket, Cognito UserPool, Lambda Function, IAM Role, API Gateway RestApi, CloudFront Distribution, etc.) MUST appear in exactly one child stack
- **AND** the parent stack itself MUST NOT contain any non-`AWS::CloudFormation::Stack` resource (the parent is purely a composer)

#### Scenario: Single-command deploy

- **GIVEN** an operator with valid AWS credentials and CDK bootstrap completed
- **WHEN** the operator runs `cdk deploy LfmtPocDev`
- **THEN** all six child stacks SHALL deploy without further intervention
- **AND** CloudFormation SHALL roll all six child stacks back atomically if any single child stack fails

### Requirement: Stateful Resource Logical-ID Preservation

The system SHALL preserve the CloudFormation logical ID of every
**stateful** resource across the monolithic-to-nested refactor.
A "stateful resource" is any of:

- DynamoDB tables (`JobsTable`, `UsersTable`, `AttestationsTable`, `RateLimitBucketsTable`)
- Cognito User Pool (`UserPool`), User Pool Domain (`UserPoolDomain`), User Pool Client (`UserPoolClient`)
- S3 buckets with `RemovalPolicy.RETAIN` or that hold user data (`DocumentBucket`, `ResultsBucket`, `FrontendBucket`)
- Secrets Manager secrets (`TranslationApiKeySecret`)

For each stateful resource, the implementation MUST call
`(cfnResource).overrideLogicalId('<existing-logical-id>')` to pin the
CFN logical ID to the value synthesized by the pre-refactor monolithic
stack.

The implementation MUST NOT proceed to deploy in any environment until
`cdk diff` reports ZERO changes (no replacement, no removal) for every
stateful resource listed above.

#### Scenario: cdk diff against pre-refactor template shows no stateful changes

- **GIVEN** the pre-refactor CFN template is captured from the live `LfmtPocDev` stack
- **WHEN** the operator runs `cdk diff` with the new nested-stack code against that captured template
- **THEN** the diff output MUST show zero changes — no `Resources to be replaced` and no `Resources to be removed` — for any DynamoDB table, Cognito User Pool, Cognito User Pool Client, Cognito User Pool Domain, S3 bucket (Documents/Results/Frontend), or Secrets Manager secret
- **AND** if any stateful resource shows as `to be replaced` or `to be removed`, the deploy MUST be blocked by CI

#### Scenario: Cognito User Pool data preserved across deploy

- **GIVEN** the pre-refactor Cognito User Pool contains at least one registered user
- **WHEN** the nested-stack refactor is deployed via `cdk deploy`
- **THEN** the User Pool ID MUST remain unchanged
- **AND** existing users MUST still be able to authenticate using their pre-refactor credentials

#### Scenario: DynamoDB table data preserved across deploy

- **GIVEN** the pre-refactor `JobsTable` contains at least one record
- **WHEN** the nested-stack refactor is deployed
- **THEN** the table's CFN logical ID MUST remain unchanged
- **AND** the table's physical name MUST remain `lfmt-jobs-<StackName>`
- **AND** all pre-existing records MUST still be queryable after the deploy

### Requirement: Cross-Stack Reference via CDK Construct References

The system SHALL use CDK construct references (which compile to
CloudFormation parameter/output threading or `Fn::GetAtt`) for all
inter-stack resource sharing.

The system MUST NOT use AWS SSM Parameter Store for inter-stack
sharing of values that are known at deploy time (resource ARNs, table
names, bucket names, function ARNs, etc.).

The system MUST NOT use CloudFormation `Export` / `Fn::ImportValue`
for inter-stack sharing within the parent stack hierarchy.

#### Scenario: API Stack receives DataStack table references via construct props

- **GIVEN** an `ApiStack` Lambda function needs `s3:PutObject` permission on the document bucket
- **WHEN** the implementation calls `props.dataStack.documentBucket.grantPut(lambdaRole)`
- **THEN** the resulting CloudFormation template MUST resolve the bucket ARN via a parameter reference threaded through the parent template
- **AND** the resulting template MUST NOT contain a `Fn::ImportValue` referencing an external CFN export

#### Scenario: No SSM-parameter dependency for cross-stack values

- **GIVEN** the synthesized CFN template for any child stack
- **WHEN** the template's resources are inspected
- **THEN** no resource SHALL reference an SSM parameter for the purpose of looking up another stack's resource ARN/ID/name

### Requirement: Stack Dependency Ordering

The system SHALL enforce the following deploy-order dependencies among
child stacks via CDK construct references (which automatically infer
`addDependency` relationships):

- `DataStack` has no dependencies
- `AuthStack` has no dependencies (independent of DataStack)
- `ApiStack` depends on `DataStack` (for table/bucket/secret grants) AND `AuthStack` (for the Cognito authorizer)
- `TranslationWorkflowStack` depends on `ApiStack` (for the `translateChunkFunction` reference) AND `DataStack` (for the jobs table grant on Step Functions)
- `FrontendStack` depends on `ApiStack` (for the `apiDomain` string used in the CSP) AND `DataStack` (for the document bucket regional domain used in the CSP `connect-src`)
- `SecurityStack` depends on `ApiStack` (for the API Gateway root resource binding for the `/csp-report` endpoint)

#### Scenario: CFN deploy order matches the dependency graph

- **GIVEN** the parent stack's synthesized template
- **WHEN** CloudFormation executes the change set
- **THEN** `DataStack` and `AuthStack` MUST be created before `ApiStack`
- **AND** `ApiStack` MUST be created before `TranslationWorkflowStack`, `FrontendStack`, and `SecurityStack`

#### Scenario: Removing a dependency does not silently re-order deploy

- **GIVEN** a maintainer removes a cross-stack property reference (e.g., FrontendStack no longer reads `apiDomain` from ApiStack)
- **WHEN** the template is re-synthesized
- **THEN** the implicit CFN `DependsOn` relationship between the two stacks SHALL also be removed
- **AND** any test asserting the dependency MUST fail, requiring the maintainer to make the change explicit

### Requirement: Frontend CSP Built Once with Concrete API Domain

The system SHALL construct the CloudFront `ResponseHeadersPolicy` once
with the concrete API Gateway domain embedded in the CSP
`connect-src` and `report-uri` directives. The pre-refactor pattern of
constructing the CSP with a wildcard `*.execute-api.us-east-1.amazonaws.com`
and then patching it via a second `ResponseHeadersPolicy` and an L1
property override on the Distribution SHALL be removed.

The synthesized CloudFormation template MUST contain exactly one
`AWS::CloudFront::ResponseHeadersPolicy` resource. The post-hoc
`FrontendSecurityHeadersUpdated` policy SHALL no longer exist.

#### Scenario: Synthesized template has exactly one ResponseHeadersPolicy

- **GIVEN** the parent stack is synthesized with the new nested-stack code
- **WHEN** the CFN template is inspected
- **THEN** there MUST be exactly one `AWS::CloudFront::ResponseHeadersPolicy` resource in the union of all child stack templates
- **AND** the orphan `FrontendSecurityHeadersUpdated` resource MUST NOT appear

#### Scenario: CSP connect-src contains the concrete API domain

- **GIVEN** the FrontendStack is synthesized with `apiDomain = '<api-id>.execute-api.us-east-1.amazonaws.com'` from ApiStack
- **WHEN** the resulting `ResponseHeadersPolicy` is inspected
- **THEN** the CSP `connect-src` directive MUST contain `https://<api-id>.execute-api.us-east-1.amazonaws.com`
- **AND** the CSP `connect-src` MUST NOT contain the wildcard `https://*.execute-api.us-east-1.amazonaws.com`

### Requirement: Drift Guards Per Child Stack

The system SHALL preserve every drift guard from the pre-refactor
infrastructure test suite by moving each guard to the test file of the
child stack that owns the guarded resource.

The following drift guards MUST remain in effect:

- Every Node.js Lambda MUST use the `LAMBDA_RUNTIME` constant (currently `lambda.Runtime.NODEJS_22_X`)
- Every Node.js Lambda MUST use the `LAMBDA_ARCHITECTURE` constant (currently `lambda.Architecture.ARM_64`)
- The `CLOUDFRONT_ORIGINS_BY_ENVIRONMENT` constant MUST contain entries for `dev`, `staging`, and `prod`
- No IAM role MUST contain a wildcard `Resource: "*"` for `dynamodb:*`, `s3:*`, or `cognito-idp:*` actions
- The CSP report Lambda's IAM role MUST attach ONLY `AWSLambdaBasicExecutionRole` and no other policy

#### Scenario: Per-stack tests inherit the runtime + architecture drift guards

- **GIVEN** the api-stack.test.ts file exists post-refactor
- **WHEN** the test suite runs
- **THEN** the test MUST assert every `AWS::Lambda::Function` in the synthesized ApiStack template has `Runtime: 'nodejs22.x'` (or the value of the `LAMBDA_RUNTIME` constant)
- **AND** the test MUST assert every Lambda has `Architectures: ['arm64']`

#### Scenario: CSP report role isolation drift guard moves to security-stack tests

- **GIVEN** the app-security-stack.test.ts file exists post-refactor
- **WHEN** the test suite runs
- **THEN** the test MUST assert the CspReportLambdaRole has exactly one ManagedPolicyArn attached
- **AND** that ManagedPolicyArn MUST be `service-role/AWSLambdaBasicExecutionRole`

### Requirement: Pre-Deploy CFN Diff Gate for Stateful Resources

The CI pipeline SHALL run `cdk diff` against the live CFN template in
each non-dev environment (staging, prod) before any deploy step. The
deploy step MUST be blocked if the diff output indicates that any
stateful resource (per the list in "Stateful Resource Logical-ID
Preservation") will be replaced or removed.

The dev environment MAY skip this gate because `retainData: false`
permits big-bang re-creation, but the implementer SHOULD still
manually inspect dev `cdk diff` output during local development.

#### Scenario: Staging deploy blocked when a stateful resource would be replaced

- **GIVEN** an implementation phase PR is opened with a typo in an `overrideLogicalId` call
- **WHEN** the CI pipeline runs `cdk diff LfmtPocStaging` against the live template
- **THEN** the diff MUST detect the affected stateful resource as `to be replaced`
- **AND** the CI deploy step MUST fail with a non-zero exit code
- **AND** the PR MUST NOT be merged until the diff is clean

#### Scenario: Prod deploy reuses the staging gate

- **GIVEN** the staging deploy succeeded with a clean diff
- **WHEN** the operator initiates the prod deploy
- **THEN** the same `cdk diff` gate MUST run against the live `LfmtPocProd` template
- **AND** any stateful-resource diff MUST block the prod deploy independently
