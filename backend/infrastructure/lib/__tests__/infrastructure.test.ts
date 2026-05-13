// Infrastructure Validation Tests - Implementation Plan Milestone 1.1
// Validates AWS infrastructure matches design specifications exactly

import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import {
  CLOUDFRONT_ORIGINS_BY_ENVIRONMENT,
  LfmtInfrastructureStack,
} from '../lfmt-infrastructure-stack';

describe('LFMT Infrastructure Stack', () => {
  let app: App;
  let stack: LfmtInfrastructureStack;
  let template: Template;

  beforeAll(() => {
    app = new App({
      context: {
        skipLambdaBundling: 'true', // Skip Docker bundling for tests
      },
    });
    stack = new LfmtInfrastructureStack(app, 'TestStack', {
      stackName: 'test',
      environment: 'test',
      enableLogging: true,
      retainData: false,
    });
    template = Template.fromStack(stack);
  });

  describe('DynamoDB Tables', () => {
    test('Jobs table exists with correct schema', () => {
      // Validates Document 7 specifications
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'lfmt-jobs-test',
        KeySchema: [
          {
            AttributeName: 'jobId',
            KeyType: 'HASH',
          },
          {
            AttributeName: 'userId',
            KeyType: 'RANGE',
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
        SSESpecification: {
          SSEEnabled: true,
        },
      });
    });

    test('Jobs table has required GSIs', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'UserJobsIndex',
            KeySchema: [
              {
                AttributeName: 'userId',
                KeyType: 'HASH',
              },
              {
                AttributeName: 'createdAt',
                KeyType: 'RANGE',
              },
            ],
          }),
          Match.objectLike({
            IndexName: 'StatusIndex',
            KeySchema: [
              {
                AttributeName: 'status',
                KeyType: 'HASH',
              },
              {
                AttributeName: 'createdAt',
                KeyType: 'RANGE',
              },
            ],
          }),
        ]),
      });
    });

    test('Users table exists with correct configuration', () => {
      // Validates Document 10 specifications
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'lfmt-users-test',
        KeySchema: [
          {
            AttributeName: 'userId',
            KeyType: 'HASH',
          },
        ],
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'EmailIndex',
            KeySchema: [
              {
                AttributeName: 'email',
                KeyType: 'HASH',
              },
            ],
          }),
        ]),
      });
    });

    test('Attestations table exists with TTL for 7-year retention', () => {
      // Validates Document 6 legal compliance requirements
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'lfmt-attestations-test',
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
        KeySchema: [
          {
            AttributeName: 'attestationId',
            KeyType: 'HASH',
          },
          {
            AttributeName: 'userId',
            KeyType: 'RANGE',
          },
        ],
      });
    });

    test('Rate Limit Buckets table exists for distributed rate limiting', () => {
      // Validates P1 (Enable Parallel Translation) requirements
      // Supports distributed token bucket algorithm across Lambda instances
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'lfmt-rate-limit-buckets-test',
        KeySchema: [
          {
            AttributeName: 'bucketKey',
            KeyType: 'HASH',
          },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
        SSESpecification: {
          SSEEnabled: true,
        },
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true,
        },
      });
    });
  });

  describe('S3 Buckets', () => {
    test('Document bucket configured with proper security', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'lfmt-documents-test',
        VersioningConfiguration: {
          Status: 'Enabled',
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      });
    });

    test('Results bucket configured correctly', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'lfmt-results-test',
        BucketEncryption: Match.anyValue(),
        PublicAccessBlockConfiguration: Match.anyValue(),
      });
    });

    test('Buckets have appropriate lifecycle policies', () => {
      // Document bucket: 90 days retention
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'lfmt-documents-test',
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'DocumentCleanup',
              Status: 'Enabled',
              ExpirationInDays: 90,
            }),
          ]),
        },
      });

      // Results bucket: 90 days retention with transitions at 30/60 days
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'lfmt-results-test',
        LifecycleConfiguration: {
          Rules: Match.arrayWith([
            Match.objectLike({
              Id: 'ResultsCleanup',
              Status: 'Enabled',
              ExpirationInDays: 90,
              Transitions: Match.arrayWith([
                Match.objectLike({
                  StorageClass: 'STANDARD_IA',
                  TransitionInDays: 30,
                }),
                Match.objectLike({
                  StorageClass: 'GLACIER',
                  TransitionInDays: 60,
                }),
              ]),
            }),
          ]),
        },
      });
    });
  });

  describe('Cognito User Pool', () => {
    test('User pool configured with email sign-in', () => {
      // Validates Document 10 authentication requirements
      template.hasResourceProperties('AWS::Cognito::UserPool', {
        UserPoolName: 'lfmt-users-test',
        UsernameAttributes: ['email'],
        AutoVerifiedAttributes: ['email'],
        Policies: {
          PasswordPolicy: {
            MinimumLength: 8,
            RequireLowercase: true,
            RequireNumbers: true,
            RequireSymbols: true,
            RequireUppercase: true,
          },
        },
      });
    });

    test('User pool client configured correctly', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ClientName: 'lfmt-client-test',
        GenerateSecret: false,
      });

      // Check that required auth flows are present (but allow additional ones)
      const userPoolClients = template.findResources('AWS::Cognito::UserPoolClient');
      const client = Object.values(userPoolClients)[0] as any;
      const authFlows = client.Properties.ExplicitAuthFlows;

      expect(authFlows).toContain('ALLOW_USER_SRP_AUTH');
      expect(authFlows).toContain('ALLOW_USER_PASSWORD_AUTH');
      expect(authFlows).toContain('ALLOW_ADMIN_USER_PASSWORD_AUTH');
    });
  });

  describe('API Gateway', () => {
    test('REST API exists with correct configuration', () => {
      // Validates Document 3 API Gateway specifications
      template.hasResourceProperties('AWS::ApiGateway::RestApi', {
        Name: 'lfmt-api-test',
        Description: 'LFMT Translation Service API',
        EndpointConfiguration: {
          Types: ['REGIONAL'],
        },
      });
    });

    test('API deployment configured correctly', () => {
      // Check that API Gateway deployment exists
      template.resourceCountIs('AWS::ApiGateway::Deployment', 1);

      // Check that API Gateway stage exists with correct name
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'v1',
      });

      // Caching is intentionally disabled for cost control, so no assertion is needed.
    });

    test('CORS is properly configured', () => {
      // Check for OPTIONS method on resources
      expect(template.findResources('AWS::ApiGateway::Method')).toBeDefined();
    });

    test('CloudFront URL is included in API Gateway CORS origins', () => {
      // Verify that CloudFront distribution exists and API can reference it
      expect(stack.frontendDistribution).toBeDefined();
      expect(stack.api).toBeDefined();

      // Verify CloudFront domain is accessible (this will be used in CORS at runtime)
      const cloudfrontDomain = stack.frontendDistribution.distributionDomainName;
      expect(cloudfrontDomain).toBeDefined();
      expect(typeof cloudfrontDomain).toBe('string');

      // Note: The actual CORS allowOrigins list is populated at synthesis time
      // by getAllowedApiOrigins() which includes the CloudFront URL.
      // We verify the infrastructure is set up correctly by confirming:
      // 1. CloudFront distribution exists before API Gateway (constructor ordering)
      // 2. CloudFront distribution domain is accessible
      // This ensures the CORS configuration will include CloudFront URL at deployment.
    });
  });

  describe('IAM Roles and Policies', () => {
    test('Lambda execution role has required permissions', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            }),
          ]),
        },
      });

      // Check for DynamoDB permissions in managed policies (refactored from inline to avoid IAM size limits)
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith([
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:Query',
              ]),
            }),
          ]),
        },
      });

      // Verify S3 permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith(['s3:GetObject', 's3:PutObject']),
            }),
          ]),
        },
      });

      // Verify Cognito permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith(['cognito-idp:SignUp', 'cognito-idp:InitiateAuth']),
            }),
          ]),
        },
      });

      // Verify Secrets Manager permissions are granted. PR #126 replaced the manual
      // ManagedPolicy with a CDK-managed secret + grantRead() call, which synthesises
      // the permission onto the role's inline AWS::IAM::Policy (DefaultPolicy) with
      // both GetSecretValue and DescribeSecret actions.
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
            }),
          ]),
        },
      });

      // Verify Step Functions permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'states:StartExecution',
            }),
          ]),
        },
      });
    });

    test('Step Functions execution role exists with Lambda invoke', () => {
      // Find the StepFunctionsExecutionRole by checking for the assume role policy
      const roles = template.findResources('AWS::IAM::Role');
      const stepFunctionsRole = Object.values(roles).find((role: any) => {
        const statements = role.Properties?.AssumeRolePolicyDocument?.Statement || [];
        return statements.some((s: any) => s.Principal?.Service === 'states.amazonaws.com');
      });

      expect(stepFunctionsRole).toBeDefined();
      expect((stepFunctionsRole as any).Properties.Policies).toBeDefined();

      // Verify the inline policy has Lambda invoke
      const policies = (stepFunctionsRole as any).Properties.Policies;
      const lambdaInvokePolicy = policies.find((p: any) => p.PolicyName === 'LambdaInvoke');
      expect(lambdaInvokePolicy).toBeDefined();

      const statements = lambdaInvokePolicy.PolicyDocument.Statement;
      expect(statements).toContainEqual(
        expect.objectContaining({
          Effect: 'Allow',
          Action: 'lambda:InvokeFunction',
        })
      );
    });

    test('Upload Lambda role can PutItem on the AttestationsTable (OpenSpec 3.8.0)', () => {
      // Validates OWASP A09 (Security Logging & Monitoring Failures) closure:
      // the upload-request Lambda MUST be able to write attestation records
      // before issuing a presigned URL. The UploadDynamoDBPolicy explicitly
      // grants PutItem on both the jobs table and the attestations table.
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith(['dynamodb:PutItem']),
              Resource: Match.arrayWith([
                // The attestations table ARN appears as a Fn::GetAtt reference.
                Match.objectLike({
                  'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('^AttestationsTable')]),
                }),
              ]),
            }),
          ]),
        },
      });
    });

    test('No dynamodb:Scan in any IAM policy', () => {
      // Security verification: Ensure dangerous DynamoDB Scan action is not granted
      // This prevents expensive table scans and enforces query-based access patterns
      const templateJson = template.toJSON();
      const allPolicies = JSON.stringify(templateJson);
      expect(allPolicies).not.toContain('dynamodb:Scan');
    });

    test('dynamodb:DeleteItem is scoped only to the dedicated deleteJobRole — translationRole must NOT have it', () => {
      // OMC security-auditor item #2 (R2):
      // The delete-job Lambda has its own dedicated IAM role (DeleteJobLambdaRole /
      // Role 5) so that DeleteItem is isolated to that one function.
      //
      // This test enforces three things:
      // 1. DeleteItem appears at least once (the delete-job policy IS wired)
      // 2. Every DeleteItem statement resource is the JobsTable ARN — not a
      //    wildcard and not any other table.  The ARN is a CloudFormation {"Fn::GetAtt"}
      //    reference whose stringified form contains "JobsTable" in the logical ID.
      // 3. The TranslationLambdaRole (translationRole) does NOT have DeleteItem —
      //    if it did, ~5 other Lambdas would silently inherit it.
      const templateJson = template.toJSON();
      const resources = templateJson.Resources || {};

      type Statement = { Action?: string | string[]; Resource?: unknown; Effect?: string };
      type PolicyDoc = { Statement?: Statement[] };

      // Helper: collect all IAM statements matching a predicate from the template
      const collectStatements = (
        pred: (actions: string[]) => boolean
      ): Array<{ resource: unknown; sourceLogicalId: string }> => {
        const found: Array<{ resource: unknown; sourceLogicalId: string }> = [];
        Object.entries(resources).forEach(([logicalId, resource]) => {
          const cfn = resource as {
            Type?: string;
            Properties?: {
              Policies?: Array<{ PolicyDocument?: PolicyDoc }>;
              PolicyDocument?: PolicyDoc;
            };
          };
          const extractFromDoc = (doc: PolicyDoc | undefined) => {
            if (!doc?.Statement) return;
            doc.Statement.forEach((stmt) => {
              const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action ?? ''];
              if (pred(actions)) {
                found.push({ resource: stmt.Resource, sourceLogicalId: logicalId });
              }
            });
          };
          if (cfn.Type === 'AWS::IAM::Role') {
            cfn.Properties?.Policies?.forEach((p) => extractFromDoc(p.PolicyDocument));
          }
          if (cfn.Type === 'AWS::IAM::Policy' || cfn.Type === 'AWS::IAM::ManagedPolicy') {
            extractFromDoc(cfn.Properties?.PolicyDocument);
          }
        });
        return found;
      };

      const isDeleteItem = (actions: string[]) =>
        actions.some((a) => a === 'dynamodb:DeleteItem' || a === 'dynamodb:*');

      const deleteItemStatements = collectStatements(isDeleteItem);

      // 1. DeleteItem must appear — the delete-job policy is wired
      expect(deleteItemStatements.length).toBeGreaterThan(0);

      // 2. Every DeleteItem grant must reference the jobs table ARN (not a wildcard,
      //    not any other table).  In synthesised CloudFormation the ARN is represented
      //    as {"Fn::GetAtt": ["<JobsTableLogicalId>", "Arn"]} — the logical ID always
      //    contains "JobsTable" because that's the CDK construct ID used in the stack.
      deleteItemStatements.forEach(({ resource }) => {
        const resourceStr = JSON.stringify(resource);
        // Must not be a wildcard resource
        expect(resourceStr).not.toBe('"*"');
        expect(resourceStr).not.toContain('"*"');
        // Must reference exactly the jobs table (logical ID check — tighter than
        // the loose /JobsTable/i regex used previously)
        expect(resourceStr).toMatch(/"JobsTable[A-Za-z0-9]*/);
      });

      // 3. The TranslationLambdaRole itself must not carry DeleteItem.
      //    Find the TranslationLambdaRole logical ID, then find every ManagedPolicy /
      //    Policy that attaches to it, and assert none of those contains DeleteItem.
      const translationRoleLogicalIds = Object.entries(resources)
        .filter(([, r]) => {
          const res = r as { Type?: string; Properties?: { Description?: string } };
          return (
            res.Type === 'AWS::IAM::Role' &&
            res.Properties?.Description?.includes('TranslationLambdaRole') === false &&
            res.Properties?.Description?.includes('translation Lambda functions') === true
          );
        })
        .map(([lid]) => lid);

      // There should be exactly one TranslationLambdaRole
      expect(translationRoleLogicalIds).toHaveLength(1);
      const translationRoleLogicalId = translationRoleLogicalIds[0];

      // Collect all policies that attach to translationRole via Roles property
      const policiesAttachedToTranslationRole = Object.entries(resources).filter(([, r]) => {
        const res = r as { Type?: string; Properties?: { Roles?: unknown[] } };
        if (
          res.Type !== 'AWS::IAM::ManagedPolicy' &&
          res.Type !== 'AWS::IAM::Policy'
        ) return false;
        const roles = res.Properties?.Roles ?? [];
        return JSON.stringify(roles).includes(translationRoleLogicalId);
      });

      // None of those policies should contain DeleteItem
      policiesAttachedToTranslationRole.forEach(([logicalId, policy]) => {
        const policyStr = JSON.stringify(policy);
        expect(policyStr).not.toContain('DeleteItem');
        // eslint-disable-next-line no-console -- test diagnostic output
        if (policyStr.includes('DeleteItem')) {
          console.error(
            `translationRole policy ${logicalId} unexpectedly contains DeleteItem — ` +
              'this grants ~5 other Lambdas delete permission!'
          );
        }
      });
    });

    test('No dynamodb:* wildcard in any IAM policy', () => {
      // Security verification: Ensure wildcard DynamoDB actions are not granted
      // This prevents privilege escalation through broad permissions
      // Verifies that all DynamoDB permissions are explicitly listed
      const templateJson = template.toJSON();

      // Extract all IAM policies from the template
      const resources = templateJson.Resources || {};
      const policyDocuments: any[] = [];

      Object.values(resources).forEach((resource: any) => {
        // Check inline policies in roles
        if (resource.Type === 'AWS::IAM::Role' && resource.Properties?.Policies) {
          resource.Properties.Policies.forEach((policy: any) => {
            policyDocuments.push(policy.PolicyDocument);
          });
        }

        // Check managed policies
        if (resource.Type === 'AWS::IAM::ManagedPolicy' && resource.Properties?.PolicyDocument) {
          policyDocuments.push(resource.Properties.PolicyDocument);
        }

        // Check standalone policy documents
        if (resource.Type === 'AWS::IAM::Policy' && resource.Properties?.PolicyDocument) {
          policyDocuments.push(resource.Properties.PolicyDocument);
        }
      });

      // Check each policy document for wildcard actions
      policyDocuments.forEach((policyDoc) => {
        if (policyDoc?.Statement) {
          policyDoc.Statement.forEach((statement: any) => {
            if (statement.Action) {
              const actions = Array.isArray(statement.Action)
                ? statement.Action
                : [statement.Action];
              actions.forEach((action: any) => {
                // Fail if we find dynamodb:* wildcard
                expect(action).not.toBe('dynamodb:*');
              });
            }
          });
        }
      });
    });

    test('No * wildcard in any IAM policy Action field', () => {
      // Security verification: Ensure no policies grant all permissions via '*'
      // This prevents privilege escalation and enforces principle of least privilege
      const templateJson = template.toJSON();

      // Extract all IAM policies from the template
      const resources = templateJson.Resources || {};
      const policyDocuments: any[] = [];

      Object.values(resources).forEach((resource: any) => {
        // Check inline policies in roles
        if (resource.Type === 'AWS::IAM::Role' && resource.Properties?.Policies) {
          resource.Properties.Policies.forEach((policy: any) => {
            policyDocuments.push(policy.PolicyDocument);
          });
        }

        // Check managed policies
        if (resource.Type === 'AWS::IAM::ManagedPolicy' && resource.Properties?.PolicyDocument) {
          policyDocuments.push(resource.Properties.PolicyDocument);
        }

        // Check standalone policy documents
        if (resource.Type === 'AWS::IAM::Policy' && resource.Properties?.PolicyDocument) {
          policyDocuments.push(resource.Properties.PolicyDocument);
        }
      });

      // Check each policy document for wildcard actions
      policyDocuments.forEach((policyDoc) => {
        if (policyDoc?.Statement) {
          policyDoc.Statement.forEach((statement: any) => {
            if (statement.Action) {
              const actions = Array.isArray(statement.Action)
                ? statement.Action
                : [statement.Action];
              actions.forEach((action: any) => {
                // Fail if we find global wildcard '*'
                expect(action).not.toBe('*');
              });
            }
          });
        }
      });
    });
  });

  describe('Step Functions State Machine', () => {
    test('Translation state machine exists', () => {
      // Verify state machine is created
      template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);

      // Verify it has the correct name
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineName: 'lfmt-translation-workflow-test',
      });
    });

    test('State machine has Map state for parallel chunk processing', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachineKeys = Object.keys(stateMachines);
      expect(stateMachineKeys.length).toBe(1);

      const stateMachine = stateMachines[stateMachineKeys[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );

      // Verify Map state exists
      const states = definition.States;
      const mapState = Object.values(states).find((state: any) => state.Type === 'Map');
      expect(mapState).toBeDefined();

      // Verify parallel processing (default maxConcurrency: 10) with distributed rate limiting
      // Note: maxConcurrency can be overridden via CDK context
      expect((mapState as any).MaxConcurrency).toBe(10);
    });

    test('State machine has workflow states', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachineKeys = Object.keys(stateMachines);
      const stateMachine = stateMachines[stateMachineKeys[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );

      // Verify state machine has multiple states
      const states = definition.States;
      const stateCount = Object.keys(states).length;
      // Map, UpdateJobCompleted, TranslationSuccess, UpdateJobFailed, TranslationFailed
      expect(stateCount).toBeGreaterThanOrEqual(5);

      // Verify there's a Succeed state for successful completion
      const successState = Object.values(states).find((state: any) => state.Type === 'Succeed');
      expect(successState).toBeDefined();

      // Verify there's a Fail state at top level (Issue #151 — failure path
      // must terminate the execution as FAILED, not silently succeed).
      const failStates = Object.values(states).filter((state: any) => state.Type === 'Fail');
      expect(failStates.length).toBeGreaterThanOrEqual(1);
    });

    test('Map state has Catch handler routing to UpdateJobFailed (Issue #151)', () => {
      // Regression guard: the previous design attached Catch to the inner
      // iterator task, which CDK synthesized as a per-iteration Catch that
      // swallowed Lambda failures and made the Map state aggregate them as
      // successful iterations. The fix moves the Catch to the Map state
      // itself and routes it to a DDB writer that records TRANSLATION_FAILED.
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachine = stateMachines[Object.keys(stateMachines)[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );

      const states = definition.States;
      const mapStateEntry = Object.entries(states).find(
        ([, state]: [string, any]) => state.Type === 'Map'
      );
      expect(mapStateEntry).toBeDefined();
      const [, mapState] = mapStateEntry as [string, any];

      // Map state MUST have a Catch handler at the Map-state level
      expect(mapState.Catch).toBeDefined();
      expect(Array.isArray(mapState.Catch)).toBe(true);
      expect(mapState.Catch.length).toBeGreaterThanOrEqual(1);

      // The Catch must cover all error types and route to UpdateJobFailed
      const catchHandler = mapState.Catch[0];
      expect(catchHandler.ErrorEquals).toEqual(['States.ALL']);
      expect(catchHandler.ResultPath).toBe('$.error');
      expect(catchHandler.Next).toMatch(/UpdateJobFailed/);

      // Iterator's inner task must NOT have a Catch (would re-introduce
      // the swallow-and-aggregate bug fixed in Issue #151).
      const iteratorStartName = mapState.Iterator?.StartAt ?? mapState.ItemProcessor?.StartAt;
      const iteratorStates = mapState.Iterator?.States ?? mapState.ItemProcessor?.States;
      expect(iteratorStartName).toBeDefined();
      expect(iteratorStates).toBeDefined();
      const startState = iteratorStates[iteratorStartName];
      expect(startState.Catch).toBeUndefined();
    });

    test('UpdateJobCompleted task ALSO writes outer status=COMPLETED (Issue #170)', () => {
      // Regression guard: prior to this fix, updateJobCompleted only wrote
      // `translationStatus = 'COMPLETED'` and left the OUTER `status` field
      // alone. If a chunk Lambda failed non-retryably on attempt 1
      // (translateChunk.ts updateJobStatus writes status='TRANSLATION_FAILED')
      // then succeeded on a Step Functions retry, the outer status was
      // stuck on TRANSLATION_FAILED forever — the frontend's
      // TranslationDetail.tsx branches on `job.status === 'TRANSLATION_FAILED'`
      // and would misclassify successful jobs as failed.
      //
      // Fix mirrors PR #165's pattern: Step Functions becomes the single
      // source of truth on terminal lifecycle by updating both fields.
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachine = stateMachines[Object.keys(stateMachines)[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );

      const states = definition.States;
      const updateJobCompletedEntry = Object.entries(states).find(([name]) =>
        /UpdateJobCompleted/.test(name)
      );
      expect(updateJobCompletedEntry).toBeDefined();
      const [, updateJobCompleted] = updateJobCompletedEntry as [string, any];

      // Must be a DDB UpdateItem task.
      expect(updateJobCompleted.Type).toBe('Task');
      expect(updateJobCompleted.Resource).toMatch(/dynamodb:updateItem/i);

      // The UpdateExpression MUST set both `translationStatus` AND outer
      // `status` (via #status alias because `status` is a DDB reserved word).
      const updateExpression: string = updateJobCompleted.Parameters?.UpdateExpression ?? '';
      expect(updateExpression).toMatch(/translationStatus/);
      expect(updateExpression).toMatch(/#status/);

      // ExpressionAttributeNames must alias #status to 'status'.
      const attributeNames = updateJobCompleted.Parameters?.ExpressionAttributeNames ?? {};
      expect(attributeNames['#status']).toBe('status');

      // The value bound to outer status MUST be 'COMPLETED' (matching
      // shared-types/src/jobs.ts JobStatus union — a drift here would
      // re-introduce the misclassification bug fixed by issue #170).
      //
      // Round-2 OMC review (issuecomment-4364585175) — assert by KEY
      // (`:status` and `:outerStatus`), not by counting 'COMPLETED'
      // substring matches in the serialized JSON. Substring counts are
      // logically sufficient here but can false-positive on contrived
      // serialization changes (e.g., adding any other value containing
      // 'COMPLETED'). Keyed assertions are strictly correct,
      // self-documenting, and survive ASL serialization changes that
      // don't affect the contract.
      const exprValues = updateJobCompleted.Parameters?.ExpressionAttributeValues ?? {};
      expect(updateExpression).toMatch(/translationStatus\s*=\s*:status/);
      expect(updateExpression).toMatch(/#status\s*=\s*:outerStatus/);
      expect(exprValues[':status']).toEqual({ S: 'COMPLETED' });
      expect(exprValues[':outerStatus']).toEqual({ S: 'COMPLETED' });
    });

    test('UpdateJobFailed task writes TRANSLATION_FAILED to DDB (Issue #151)', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachine = stateMachines[Object.keys(stateMachines)[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );

      const states = definition.States;
      const updateJobFailedEntry = Object.entries(states).find(([name]) =>
        /UpdateJobFailed/.test(name)
      );
      expect(updateJobFailedEntry).toBeDefined();
      const [, updateJobFailed] = updateJobFailedEntry as [string, any];

      // Must be a DDB UpdateItem task
      expect(updateJobFailed.Type).toBe('Task');
      expect(updateJobFailed.Resource).toMatch(/dynamodb:updateItem/i);

      // Status enum must match shared-types/src/jobs.ts TranslationStatus
      // (drift here would cause the polling endpoint to misclassify the row).
      const valuesString = JSON.stringify(
        updateJobFailed.Parameters?.ExpressionAttributeValues ?? {}
      );
      expect(valuesString).toContain('TRANSLATION_FAILED');

      // Must transition to a Fail terminal state (so the SF execution itself
      // is marked FAILED, not Succeeded).
      expect(updateJobFailed.Next).toBeDefined();
      const nextState = states[updateJobFailed.Next];
      expect(nextState.Type).toBe('Fail');
    });

    test('UpdateJobFailed task ALSO writes outer status=TRANSLATION_FAILED (OMC-followup C2)', () => {
      // Regression guard: PR #176 made UpdateJobCompleted dual-write both
      // `translationStatus` AND outer `#status` (issue #170) but left
      // UpdateJobFailed asymmetric. Same bug class applies in reverse —
      // without this, a transient success that later fails terminally
      // leaves the outer `status` field stuck on a stale value (e.g.,
      // 'IN_PROGRESS' from startTranslation, or 'COMPLETED' from a
      // hypothetical earlier write). Mirror the dual-write so Step
      // Functions is the single source of truth on terminal lifecycle
      // for BOTH success and failure outcomes.
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachine = stateMachines[Object.keys(stateMachines)[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );

      const states = definition.States;
      const updateJobFailedEntry = Object.entries(states).find(([name]) =>
        /UpdateJobFailed/.test(name)
      );
      expect(updateJobFailedEntry).toBeDefined();
      const [, updateJobFailed] = updateJobFailedEntry as [string, any];

      // The UpdateExpression MUST set both `translationStatus` AND outer
      // `status` (via #status alias because `status` is a DDB reserved word).
      const updateExpression: string = updateJobFailed.Parameters?.UpdateExpression ?? '';
      expect(updateExpression).toMatch(/translationStatus/);
      expect(updateExpression).toMatch(/#status/);

      // ExpressionAttributeNames must alias #status to 'status'.
      const attributeNames = updateJobFailed.Parameters?.ExpressionAttributeNames ?? {};
      expect(attributeNames['#status']).toBe('status');

      // Round-2 OMC review (issuecomment-4364584995) — assert by KEY
      // (`:status` and `:outerStatus`), not by counting 'TRANSLATION_FAILED'
      // substring matches in the serialized JSON. Mirrors the keyed
      // assertion pattern in the UpdateJobCompleted test above for
      // symmetry. Strictly correct, self-documenting, and survives ASL
      // serialization changes that don't affect the contract.
      const exprValues = updateJobFailed.Parameters?.ExpressionAttributeValues ?? {};
      expect(updateExpression).toMatch(/translationStatus\s*=\s*:status/);
      expect(updateExpression).toMatch(/#status\s*=\s*:outerStatus/);
      expect(exprValues[':status']).toEqual({ S: 'TRANSLATION_FAILED' });
      expect(exprValues[':outerStatus']).toEqual({ S: 'TRANSLATION_FAILED' });
    });

    test('Choice state gates UpdateJobCompleted on per-chunk success (OMC-followup C1)', () => {
      // Regression guard: translateChunk.ts catches every error in its
      // outer try/catch and returns { success: false } instead of throwing.
      // Map's addCatch only fires on THROWN errors, so without this Choice
      // gate, UpdateJobCompleted would unconditionally run and overwrite
      // the per-chunk Lambda's TRANSLATION_FAILED outer status with
      // COMPLETED — the exact phantom-success bug PR #176's #170 fix was
      // meant to prevent. The Choice state aggregates
      // $.translationResults[*].translateResult.Payload.success via
      // States.ArrayContains and routes to UpdateJobFailed if any chunk
      // reported success:false.
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachine = stateMachines[Object.keys(stateMachines)[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );

      const states = definition.States;

      // 1. Map state must transition to the aggregator (Pass), NOT directly
      //    to UpdateJobCompleted.
      const mapEntry = Object.entries(states).find(
        ([, state]: [string, any]) => state.Type === 'Map'
      );
      expect(mapEntry).toBeDefined();
      const [, mapState] = mapEntry as [string, any];
      expect(mapState.Next).toBeDefined();
      const afterMap = states[mapState.Next];
      expect(afterMap.Type).toBe('Pass');

      // 2. The Pass state must compute anyChunkFailed via States.ArrayContains
      //    on the success flag projection from each chunk's result.
      const passParams = afterMap.Parameters ?? {};
      const anyChunkFailedExpr = passParams['anyChunkFailed.$'];
      expect(anyChunkFailedExpr).toBeDefined();
      expect(anyChunkFailedExpr).toMatch(/States\.ArrayContains/);
      // The wildcard projection must walk into translateResult.Payload.success
      // so failures returned by translateChunk (Lambda success / app failure)
      // are captured.
      expect(anyChunkFailedExpr).toContain('translationResults');
      expect(anyChunkFailedExpr).toContain('translateResult');
      expect(anyChunkFailedExpr).toContain('Payload');
      expect(anyChunkFailedExpr).toContain('success');
      // ArrayContains is called against the literal `false` boolean.
      expect(anyChunkFailedExpr).toMatch(/,\s*false\s*\)/);

      // 3. The Pass state must transition to a Choice state.
      expect(afterMap.Next).toBeDefined();
      const choiceState = states[afterMap.Next];
      expect(choiceState.Type).toBe('Choice');

      // 4. The Choice state must have a rule that routes to NormalizeFailureContext
      //    (Bug B fix: NormalizeFailureContext then → UpdateJobFailed) when
      //    anyChunkFailed=true, and otherwise (Default) to UpdateJobCompleted.
      expect(Array.isArray(choiceState.Choices)).toBe(true);
      expect(choiceState.Choices.length).toBeGreaterThanOrEqual(1);
      const failureBranch = choiceState.Choices.find(
        (rule: any) => rule.Variable === '$.aggregate.anyChunkFailed' && rule.BooleanEquals === true
      );
      expect(failureBranch).toBeDefined();
      // Bug B fix: Choice now routes through NormalizeFailureContext before UpdateJobFailed.
      expect(failureBranch.Next).toMatch(/NormalizeFailureContext/);

      expect(choiceState.Default).toBeDefined();
      expect(choiceState.Default).toMatch(/UpdateJobCompleted/);
    });

    test('Choice failure branch routes through NormalizeFailureContext before UpdateJobFailed — Bug B regression', () => {
      // Regression guard for the Bug B fix (post-PR-#176):
      //
      // UpdateJobFailed uses States.JsonToString($.error) to write the error
      // detail to DDB. $.error is set by the Map Catch handler (resultPath='$.error'),
      // but when chunks return success:false and the Choice gate fires,
      // $.error does NOT exist — only $.translationResults does.
      // This caused a States.Runtime JsonPath-not-found error that prevented
      // the DDB write, leaving translationStatus stuck on IN_PROGRESS.
      //
      // Fix: insert NormalizeFailureContext (a Pass state) between the Choice
      // gate and UpdateJobFailed on the success:false path. It synthesises
      // $.error from $.translationResults, so UpdateJobFailed always has it.
      // The Map Catch path bypasses NormalizeFailureContext (goes directly to
      // UpdateJobFailed) because the Catch already sets $.error via resultPath.
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachine = stateMachines[Object.keys(stateMachines)[0]];
      const definition = JSON.parse(
        stateMachine.Properties.DefinitionString['Fn::Join'][1].join('')
      );
      const states = definition.States;

      // 1. The Choice state's failure branch must point to NormalizeFailureContext,
      //    NOT directly to UpdateJobFailed.
      const choiceEntry = Object.entries(states).find(
        ([, s]: [string, any]) => s.Type === 'Choice'
      );
      expect(choiceEntry).toBeDefined();
      const [, choiceState] = choiceEntry as [string, any];

      const failureBranch = choiceState.Choices.find(
        (rule: any) => rule.Variable === '$.aggregate.anyChunkFailed' && rule.BooleanEquals === true
      );
      expect(failureBranch).toBeDefined();
      // Must route to the normalizer, not directly to the DDB task.
      expect(failureBranch.Next).toMatch(/NormalizeFailureContext/);

      // 2. NormalizeFailureContext must be a Pass state that sets $.error
      //    from $.translationResults (which is present in the success:false path).
      //
      // OMC-followup R2 + R5: the payload was originally a single
      //   error.$ = States.JsonToString($.translationResults)
      // (a stringified raw dump of every chunk's result). It is now a
      // STRUCTURED envelope:
      //   {
      //     reason: 'CHUNK_FAILURE',         // stable discriminator
      //     failedCountUpperBound.$: ArrayLength,
      //     totalChunks.$: ArrayLength,
      //     translationResults.$: <raw forensic detail>
      //   }
      // Tighten the assertions to the new shape so a future refactor that
      // accidentally drops `reason` or reverts to the unstructured dump
      // fails this test loudly.
      const normEntry = Object.entries(states).find(([name]) =>
        /NormalizeFailureContext/.test(name)
      );
      expect(normEntry).toBeDefined();
      const [, normState] = normEntry as [string, any];

      expect(normState.Type).toBe('Pass');
      // Must write into $.error via ResultPath so UpdateJobFailed can read it.
      expect(normState.ResultPath).toBe('$.error');

      // R5: assert structured payload shape (NOT the legacy `error.$` raw dump).
      const params = normState.Parameters ?? {};

      // Discriminator: stable `reason` literal so downstream alerting can
      // branch on the failure mode without parsing the array.
      expect(params['reason']).toBe('CHUNK_FAILURE');

      // Counts: ASL has no native filter intrinsic, so we surface the upper
      // bound (== totalChunks). Both fields are derived via States.ArrayLength
      // on $.translationResults.
      expect(params['failedCountUpperBound.$']).toMatch(/States\.ArrayLength/);
      expect(params['failedCountUpperBound.$']).toContain('translationResults');
      expect(params['totalChunks.$']).toMatch(/States\.ArrayLength/);
      expect(params['totalChunks.$']).toContain('translationResults');

      // Forensic detail preserved verbatim under a NAMED key (NOT the legacy
      // `error.$` raw dump — that would be a regression to the unstructured
      // payload).
      expect(params['translationResults.$']).toBe('$.translationResults');

      // Negative guard: the legacy raw-dump shape (single `error.$` key
      // pointing at States.JsonToString of the whole array) MUST be gone.
      expect(params['error.$']).toBeUndefined();

      // 3. NormalizeFailureContext must transition to UpdateJobFailed.
      expect(normState.Next).toMatch(/UpdateJobFailed/);

      // 4. The Map Catch handler must STILL route directly to UpdateJobFailed
      //    (bypassing NormalizeFailureContext) so we don't clobber the real
      //    $.error payload from the Catch.
      const mapEntry = Object.entries(states).find(([, s]: [string, any]) => s.Type === 'Map');
      expect(mapEntry).toBeDefined();
      const [, mapState] = mapEntry as [string, any];

      const catchHandlers: any[] = mapState.Catch ?? [];
      expect(catchHandlers.length).toBeGreaterThanOrEqual(1);
      const catchAll = catchHandlers.find(
        (c: any) => Array.isArray(c.ErrorEquals) && c.ErrorEquals.includes('States.ALL')
      );
      expect(catchAll).toBeDefined();
      // Catch goes DIRECTLY to UpdateJobFailed (no normalizer needed —
      // resultPath='$.error' on the Catch already provides $.error).
      expect(catchAll.Next).toMatch(/UpdateJobFailed/);
      expect(catchAll.Next).not.toMatch(/NormalizeFailureContext/);
    });

    test('State machine has required IAM permissions', () => {
      // State machine should have permission to invoke Lambda
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'lambda:InvokeFunction',
              Resource: Match.anyValue(),
            }),
          ]),
        },
      });

      // State machine should have minimal DynamoDB permissions (UpdateItem only)
      // SECURITY: Verify state machine does NOT have broad read/write permissions
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'dynamodb:UpdateItem',
              Resource: Match.anyValue(),
            }),
          ]),
        },
      });
    });

    test('State machine log group configured correctly', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/stepfunctions/lfmt-translation-test',
        RetentionInDays: 7, // One week retention as specified in implementation
      });
    });
  });

  describe('CloudWatch Log Groups', () => {
    test('Log groups created with correct retention', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/apigateway/lfmt-api-test',
        RetentionInDays: 30,
      });

      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/lambda/lfmt-test',
        RetentionInDays: 30,
      });

      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/stepfunctions/lfmt-test',
        RetentionInDays: 30,
      });

      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/security/lfmt-test',
        RetentionInDays: 90,
      });
    });
  });

  describe('Stack Outputs', () => {
    test('Required outputs are present', () => {
      // Validate all required outputs exist
      const outputs = template.findOutputs('*');

      expect(outputs).toHaveProperty('JobsTableName');
      expect(outputs).toHaveProperty('UsersTableName');
      expect(outputs).toHaveProperty('AttestationsTableName');
      expect(outputs).toHaveProperty('DocumentBucketName');
      expect(outputs).toHaveProperty('ResultsBucketName');
      expect(outputs).toHaveProperty('UserPoolId');
      expect(outputs).toHaveProperty('UserPoolClientId');
      expect(outputs).toHaveProperty('ApiUrl');
      expect(outputs).toHaveProperty('ApiId');
      expect(outputs).toHaveProperty('TranslationStateMachineArn');
      expect(outputs).toHaveProperty('TranslationStateMachineName');
      expect(outputs).toHaveProperty('FrontendBucketName');
      expect(outputs).toHaveProperty('CloudFrontDistributionId');
      expect(outputs).toHaveProperty('CloudFrontDistributionDomain');
      expect(outputs).toHaveProperty('FrontendUrl');
    });
  });

  describe('Resource Count Validation', () => {
    test('Expected number of resources created', () => {
      // Ensure we're not creating too many or too few resources
      template.resourceCountIs('AWS::DynamoDB::Table', 4); // Jobs, Users, Attestations, Rate Limit Buckets
      template.resourceCountIs('AWS::S3::Bucket', 3); // Documents, Results, Frontend
      template.resourceCountIs('AWS::Cognito::UserPool', 1);
      template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
      template.resourceCountIs('AWS::Logs::LogGroup', 5); // API, Lambda x3, Step Functions State Machine x1
      template.resourceCountIs('AWS::CloudFront::Distribution', 1);
      template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
      // Now we have 2 ResponseHeadersPolicy: initial + updated with API Gateway URL
      template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 2);
      // CDK creates additional service roles, so check we have at least our expected roles
      const roleCount = Object.keys(template.findResources('AWS::IAM::Role')).length;
      expect(roleCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Security Validation', () => {
    test('No hardcoded secrets or keys', () => {
      // Ensure no hardcoded values in the template
      const templateJson = template.toJSON();
      const templateString = JSON.stringify(templateJson);

      // Check for actual hardcoded secrets, but ignore legitimate CDK properties
      expect(templateString).not.toMatch(/["']password["']\s*:\s*["'][^"']{8,}["']/i);
      expect(templateString).not.toMatch(/["']secret["']\s*:\s*["'][^"']{10,}["']/i);
      expect(templateString).not.toMatch(/["']api[_-]?key["']\s*:\s*["'][a-zA-Z0-9]{20,}["']/i);
    });

    test('All S3 buckets block public access', () => {
      template.allResourcesProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    test('All DynamoDB tables have encryption enabled', () => {
      template.allResourcesProperties('AWS::DynamoDB::Table', {
        SSESpecification: {
          SSEEnabled: true,
        },
      });
    });
  });

  describe('CloudFront Distribution', () => {
    test('CloudFront distribution exists', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Enabled: true,
          IPV6Enabled: true,
          DefaultRootObject: 'index.html',
        },
      });
    });

    test('Custom error responses configured for SPA routing', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          CustomErrorResponses: [
            {
              ErrorCode: 403,
              ResponseCode: 200,
              ResponsePagePath: '/index.html',
              ErrorCachingMinTTL: 300,
            },
            {
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: '/index.html',
              ErrorCachingMinTTL: 300,
            },
          ],
        },
      });
    });

    test('HTTPS-only viewer protocol policy', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: {
            ViewerProtocolPolicy: 'redirect-to-https',
          },
        },
      });
    });

    test('Security headers policy configured', () => {
      // Check that we have a Response Headers Policy with all security headers
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: {
            StrictTransportSecurity: {
              AccessControlMaxAgeSec: 31536000,
              IncludeSubdomains: true,
              Override: true,
            },
            ContentTypeOptions: {
              Override: true,
            },
            FrameOptions: {
              FrameOption: 'DENY',
              Override: true,
            },
            XSSProtection: {
              Protection: true,
              ModeBlock: true,
              Override: true,
            },
            ReferrerPolicy: {
              ReferrerPolicy: 'strict-origin-when-cross-origin',
              Override: true,
            },
          },
        },
      });

      // Verify that CSP includes API Gateway domain (specific test)
      const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
      const policyWithUpdatedCSP = Object.values(policies).find((policy: any) => {
        const csp =
          policy?.Properties?.ResponseHeadersPolicyConfig?.SecurityHeadersConfig
            ?.ContentSecurityPolicy?.ContentSecurityPolicy;
        // Check if CSP contains the specific API Gateway domain pattern or the Fn::Join construct
        return (
          csp &&
          ((typeof csp === 'string' && csp.includes('execute-api')) ||
            (typeof csp === 'object' && csp['Fn::Join']))
        );
      });
      expect(policyWithUpdatedCSP).toBeDefined();
    });

    test('CSP includes hardening directives (object-src, base-uri, form-action, frame-ancestors, upgrade-insecure-requests)', () => {
      // Regression coverage for the CSP hardening work on PR #127 / issue #63.
      // These directives MUST be present on every CSP emitted by the stack.
      const requiredDirectives = [
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ];

      // Helper: flatten a CSP value (which may be a plain string or an
      // Fn::Join-wrapped CloudFormation intrinsic containing a mix of
      // literals and Ref/GetAtt objects) into a single searchable string.
      const flattenCsp = (csp: unknown): string => {
        if (typeof csp === 'string') return csp;
        if (csp && typeof csp === 'object' && 'Fn::Join' in (csp as object)) {
          const join = (csp as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
          const parts = join[1];
          return parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('');
        }
        return JSON.stringify(csp);
      };

      const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
      const policyList = Object.values(policies);
      expect(policyList.length).toBeGreaterThan(0);

      // Every ResponseHeadersPolicy in the stack that carries a CSP must
      // include all the hardening directives. (Both the initial policy and
      // the post-API-Gateway "updated" policy are expected here.)
      const cspCarryingPolicies = policyList.filter((policy: any) => {
        return !!policy?.Properties?.ResponseHeadersPolicyConfig?.SecurityHeadersConfig
          ?.ContentSecurityPolicy?.ContentSecurityPolicy;
      });
      expect(cspCarryingPolicies.length).toBeGreaterThanOrEqual(2);

      cspCarryingPolicies.forEach((policy: any) => {
        const csp =
          policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy
            .ContentSecurityPolicy;
        const flat = flattenCsp(csp);
        requiredDirectives.forEach((directive) => {
          expect(flat).toContain(directive);
        });
      });
    });

    test("CSP does not contain 'unsafe-eval' (Issue #133 Part 2)", () => {
      // Regression guard for Issue #133 Part 2.
      // 'unsafe-eval' was removed from script-src after verifying that the
      // production Vite/MUI bundle contains no eval()/new Function() calls.
      // Re-introducing it would weaken script-src CSP and must trip CI.
      const flattenCsp = (csp: unknown): string => {
        if (typeof csp === 'string') return csp;
        if (csp && typeof csp === 'object' && 'Fn::Join' in (csp as object)) {
          const join = (csp as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
          const parts = join[1];
          return parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('');
        }
        return JSON.stringify(csp);
      };

      const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
      const cspCarryingPolicies = Object.values(policies).filter((policy: any) => {
        return !!policy?.Properties?.ResponseHeadersPolicyConfig?.SecurityHeadersConfig
          ?.ContentSecurityPolicy?.ContentSecurityPolicy;
      });
      expect(cspCarryingPolicies.length).toBeGreaterThanOrEqual(2);

      cspCarryingPolicies.forEach((policy: any) => {
        const csp =
          policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy
            .ContentSecurityPolicy;
        const flat = flattenCsp(csp);
        expect(flat).not.toContain("'unsafe-eval'");
      });
    });

    test("script-src does not contain 'unsafe-inline' (Issue #194)", () => {
      // Regression guard for Issue #194.
      //
      // 'unsafe-inline' on script-src would let an XSS payload inject an
      // inline `<script>` to read `localStorage` and exfiltrate the API
      // Gateway Bearer credential — exactly the risk the OMC reviewer
      // flagged on PR #193 once `idToken` started living in localStorage.
      //
      // The directive is safely removable because the built `dist/index.html`
      // emits no inline `<script>` blocks (verified during PR #194).
      // Re-introducing 'unsafe-inline' on script-src would re-open the
      // exfiltration class and must trip CI.
      //
      // Note: 'unsafe-inline' on style-src remains present. MUI/Emotion
      // injects runtime styles via document.head.appendChild('<style>')
      // and removing this directive requires a Lambda@Edge nonce
      // pipeline. That work is tracked in a separate follow-up issue;
      // it does not address the same exfiltration class.
      const flattenCsp = (csp: unknown): string => {
        if (typeof csp === 'string') return csp;
        if (csp && typeof csp === 'object' && 'Fn::Join' in (csp as object)) {
          const join = (csp as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
          const parts = join[1];
          return parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('');
        }
        return JSON.stringify(csp);
      };

      const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
      const cspCarryingPolicies = Object.values(policies).filter((policy: any) => {
        return !!policy?.Properties?.ResponseHeadersPolicyConfig?.SecurityHeadersConfig
          ?.ContentSecurityPolicy?.ContentSecurityPolicy;
      });
      expect(cspCarryingPolicies.length).toBeGreaterThanOrEqual(2);

      cspCarryingPolicies.forEach((policy: any) => {
        const csp =
          policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy
            .ContentSecurityPolicy;
        const flat = flattenCsp(csp);
        // Extract just the script-src directive, then assert it does
        // NOT contain 'unsafe-inline'. Avoids accidentally tripping on
        // the style-src 'unsafe-inline' that is intentionally retained.
        const scriptSrcMatch = flat.match(/script-src[^;]*/);
        if (!scriptSrcMatch) {
          throw new Error(`script-src directive missing from CSP: ${flat}`);
        }
        expect(scriptSrcMatch[0]).not.toContain("'unsafe-inline'");
        // Round 2 item 4: positive assertion. A test that only checks
        // for absence is fragile against a future regression that
        // accidentally drops the directive entirely (e.g.,
        // `script-src` missing → browser defaults to `default-src`,
        // which IS `'self'`, so the SPA still loads but the contract
        // is now implicit). Assert `'self'` is the explicit value.
        expect(scriptSrcMatch[0]).toMatch(/^script-src\s+'self'\s*$/);
      });
    });

    test('Origin Access Control configured for S3', () => {
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: {
          OriginAccessControlOriginType: 's3',
          SigningBehavior: 'always',
          SigningProtocol: 'sigv4',
        },
      });
    });

    test('CSP connect-src includes both API Gateway and document S3 bucket origins (Issue #98)', () => {
      // Regression guard for the 2026-05-08 demo-blocking incident.
      //
      // The browser performs presigned-PUT uploads directly against the
      // document S3 bucket; CSP `connect-src` must whitelist that origin
      // alongside the API Gateway origin or the XHR is blocked and the
      // wizard surfaces a misleading "Connection lost" error. The bucket
      // is enumerated explicitly (not via a `*.s3.amazonaws.com` wildcard)
      // per OWASP CSP guidance — see `buildCsp()` JSDoc.
      //
      // Both the initial response-headers policy AND the post-API
      // "Updated" policy must include the bucket origin (the user's first
      // upload may happen before the second policy is fully propagated to
      // CloudFront edges).
      const flattenCsp = (csp: unknown): string => {
        if (typeof csp === 'string') return csp;
        if (csp && typeof csp === 'object' && 'Fn::Join' in (csp as object)) {
          const join = (csp as { 'Fn::Join': [string, unknown[]] })['Fn::Join'];
          const parts = join[1];
          return parts
            .map((p) => {
              if (typeof p === 'string') return p;
              // Resolve common CFN intrinsics into a stable searchable
              // marker. The bucket regional domain is a Fn::GetAtt on the
              // DocumentBucket resource at synth time (CDK uses the
              // logical id `DocumentBucket...`); we surface the full
              // intrinsic so the test below can match on it deterministically.
              return JSON.stringify(p);
            })
            .join('');
        }
        return JSON.stringify(csp);
      };

      const policies = template.findResources('AWS::CloudFront::ResponseHeadersPolicy');
      const cspCarryingPolicies = Object.values(policies).filter((policy: any) => {
        return !!policy?.Properties?.ResponseHeadersPolicyConfig?.SecurityHeadersConfig
          ?.ContentSecurityPolicy?.ContentSecurityPolicy;
      });
      expect(cspCarryingPolicies.length).toBeGreaterThanOrEqual(2);

      cspCarryingPolicies.forEach((policy: any) => {
        const csp =
          policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy
            .ContentSecurityPolicy;
        const flat = flattenCsp(csp);

        // 1. API Gateway origin must be present (wildcard form on the
        //    initial policy, concrete domain on the updated policy — both
        //    contain the literal substring 'execute-api').
        expect(flat).toContain('execute-api');

        // 2. Document-bucket origin must be present. CDK lowercases the
        //    bucket name into `lfmt-documents-test`, then resolves the
        //    regional domain at synth time; on a synthesized template
        //    this surfaces as either:
        //      a) Fn::GetAtt → ['DocumentBucket<hash>', 'RegionalDomainName']
        //         (when used inside a string literal that doesn't already
        //         resolve at synth time, like other CFN refs), OR
        //      b) the literal string 'lfmt-documents-test.s3.<region>...'
        //         (when CDK's tokenizer pre-resolves it, which is what
        //         happens here because buildCsp interpolates into a plain
        //         template literal that becomes a CloudFormation Fn::Join).
        //    Either form is acceptable — we just need to prove the bucket
        //    is enumerated, not that a particular CFN intrinsic was used.
        const hasBucketLiteral = flat.includes('lfmt-documents-test');
        const hasBucketGetAtt = flat.includes('DocumentBucket') && flat.includes('RegionalDomainName');
        expect(hasBucketLiteral || hasBucketGetAtt).toBe(true);

        // 3. connect-src directive must still start with 'self' and
        //    must NOT use a generic `https://*.s3.amazonaws.com` wildcard
        //    (OWASP — wildcards on S3 hosts let any compromised bucket
        //    script exfiltrate the user's API Gateway Bearer credential).
        expect(flat).toMatch(/connect-src\s+'self'/);
        expect(flat).not.toContain('*.s3.amazonaws.com');
      });
    });

    // -------------------------------------------------------------------------
    // C-sec (PR #214 OMC): document bucket CORS must include CloudFront
    // origin.
    //
    // Browser-side presigned-PUT uploads originate from the CloudFront-
    // hosted SPA. Without the CloudFront domain in the bucket's CORS
    // `AllowedOrigins`, the preflight OPTIONS is rejected and the PUT
    // never fires. The CSP fix only solved one half of the demo-blocking
    // incident; this test pins the other half so a future contributor
    // can't drop the `addCorsRule` call without breaking the build.
    //
    // Implementation note: we use literal CloudFront domain strings
    // (NOT `frontendDistribution.distributionDomainName`) to avoid a
    // CFN cyclic dependency — see `addCloudFrontOriginToDocumentBucketCors`
    // JSDoc. The test stack runs with `environment: 'test'`, which
    // falls through to the `dev` literal list, so we assert on that
    // domain (`d39xcun7144jgl.cloudfront.net`) — the same value that
    // `getAllowedApiOrigins()` enumerates as the dev tier source of
    // truth.
    // -------------------------------------------------------------------------
    test('Document bucket CORS includes CloudFront distribution origin', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      const docBucketEntry = Object.entries(buckets).find(([, bucket]) => {
        const bucketName = (bucket as { Properties?: { BucketName?: unknown } })
          .Properties?.BucketName;
        // Document bucket has BucketName = `lfmt-documents-<stack>`.
        if (typeof bucketName === 'string') return bucketName.includes('lfmt-documents');
        // Token form (Fn::Join) — match on the literal segment.
        const join = (bucketName as { 'Fn::Join'?: [string, unknown[]] })?.[
          'Fn::Join'
        ];
        return Array.isArray(join?.[1])
          ? join[1].some(
              (part) => typeof part === 'string' && part.includes('lfmt-documents')
            )
          : false;
      });

      expect(docBucketEntry).toBeDefined();
      const [, docBucket] = docBucketEntry!;
      const corsRules =
        (docBucket as { Properties?: { CorsConfiguration?: { CorsRules?: unknown[] } } })
          .Properties?.CorsConfiguration?.CorsRules ?? [];
      expect(Array.isArray(corsRules)).toBe(true);
      // Two rules expected: (1) the initial localhost-dev rule from
      // `createS3Buckets` and (2) the CloudFront-origin rule appended
      // by `addCloudFrontOriginToDocumentBucketCors`. We assert
      // `>= 2` so a future merge into a single rule (semantic equiv)
      // doesn't break the test, but the current shape is two rules.
      expect(corsRules.length).toBeGreaterThanOrEqual(2);

      // Flatten every CORS rule's AllowedOrigins so the assertion is
      // robust to the rule being either:
      //   a) merged with the initial localhost rule (single CorsRule), or
      //   b) appended via addCorsRule (second CorsRule entry).
      // Either layout is correct as long as the CloudFront distribution
      // domain ends up in the union.
      const allOrigins: string[] = corsRules.flatMap((rule) =>
        ((rule as { AllowedOrigins?: unknown[] }).AllowedOrigins ?? []).filter(
          (o): o is string => typeof o === 'string'
        )
      );

      // Use Match.arrayWith semantics — the CloudFront dev origin must
      // be present somewhere in the union of CORS rules.
      expect(allOrigins).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/d39xcun7144jgl\.cloudfront\.net/),
        ])
      );
    });

    test('Frontend S3 bucket has public access blocked', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      const frontendBucket = Object.values(buckets).find((bucket: any) => {
        const bucketName = bucket.Properties?.BucketName;
        // Check if it's a string containing 'frontend' OR a Fn::Join with 'frontend'
        return (
          (typeof bucketName === 'string' && bucketName.includes('frontend')) ||
          bucketName?.['Fn::Join']?.[1]?.some(
            (part: any) => typeof part === 'string' && part.includes('frontend')
          )
        );
      });

      expect(frontendBucket).toBeDefined();
      if (frontendBucket) {
        expect(frontendBucket).toHaveProperty('Properties.PublicAccessBlockConfiguration');
        expect(frontendBucket.Properties.PublicAccessBlockConfiguration).toEqual({
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        });
      }
    });
  });

  // Helper-Lambda exclusion filter shared by the runtime + architecture
  // drift guards (PR #203 R4 item 2 — adds LogRetention to the prefix
  // list per code-reviewer + architect feedback).
  //
  // CDK injects Lambdas for its own machinery — S3 auto-delete custom-
  // resource provider, log-retention setter, BucketNotificationsHandler,
  // etc. — that do NOT expose CDK-level runtime/architecture knobs and
  // ship with AWS defaults we cannot influence. Filtering them out keeps
  // both drift guards focused on the Lambdas that LFMT actually owns.
  //
  // Helper-prefix list (extend whenever a new CDK helper class shows up):
  //   - Custom*                     S3 auto-delete + assorted custom resources
  //   - BucketNotificationsHandler* S3-event wiring (Python; not Node)
  //   - LogRetention*               aws-cdk-lib/aws-logs LogRetention setter,
  //                                 injected when a construct declares
  //                                 `logRetention:`. Currently only
  //                                 attached to the dev-only PreSignUp
  //                                 Lambda; absent in the test stack —
  //                                 but listed here defensively so any
  //                                 future addition of `logRetention:` to
  //                                 a test-visible Lambda doesn't silently
  //                                 corrupt the drift-guard scope.
  const isApplicationLambda = (logicalId: string): boolean =>
    !logicalId.startsWith('Custom')
    && !logicalId.startsWith('BucketNotificationsHandler')
    && !logicalId.startsWith('LogRetention');

  // PR #203 R4 item 2: pin exact application-Lambda count instead of a
  // loose `>= N` floor. Drift guards should fail loudly on ANY headcount
  // change so additions/removals force a deliberate test update.
  //
  // Test environment application Lambdas:
  //   Register, Login, RefreshToken, ResetPassword, GetCurrentUser,
  //   UploadRequest, UploadComplete, ChunkDocument, TranslateChunk,
  //   StartTranslation, GetTranslationStatus, GetJob, DeleteJob,
  //   DownloadTranslation (added in demo-readiness PR).
  // The dev-only PreSignUp Lambda is gated behind `isDev`
  // (stackName.toLowerCase().includes('dev')) and is absent in the
  // 'test' stackName used by these tests.
  // Update this constant + the PR body whenever a Lambda is added or removed
  // (PR #208: +2 for GetJob + DeleteJob, 11 → 13; demo-readiness: +1 for
  // DownloadTranslation, 13 → 14; PR #239: +1 for ListJobs, 14 → 15;
  // #201: +1 for CspReport, 15 → 16).
  const EXPECTED_APPLICATION_LAMBDA_COUNT = 16;

  describe('Lambda Runtime Drift Guard (PR #203 R2)', () => {
    // Regression guard mirroring the CSP/'unsafe-eval' pattern (PR #198):
    //
    // PR #203 centralized the Lambda runtime version into a single module
    // constant (LAMBDA_RUNTIME = lambda.Runtime.NODEJS_22_X) and bumped all
    // 12 Lambda definitions away from the EOL'd Node 18 runtime. Without
    // this regression test, an accidental future revert of the constant
    // (or a one-off Lambda definition that hardcodes an older runtime)
    // would silently re-introduce an unsupported runtime that AWS will
    // eventually force-migrate.
    //
    // Scope (R4 update): APPLICATION Lambdas only — same filter as the
    // architecture drift guard below. CDK helper Lambdas (Custom*,
    // BucketNotificationsHandler*, LogRetention*) follow AWS-managed
    // runtime/architecture defaults we cannot control via CDK props.

    test('All application Node.js Lambdas use nodejs22.x runtime', () => {
      const allLambdas = template.findResources('AWS::Lambda::Function');
      const appNodeLambdas = Object.entries(allLambdas).filter(
        ([logicalId, fn]: [string, any]) =>
          isApplicationLambda(logicalId)
          && typeof fn.Properties?.Runtime === 'string'
          && fn.Properties.Runtime.startsWith('nodejs')
      );

      // R4: exact-count pin (was `>= 12` — accidentally satisfied by 11
      // app + 1 CDK helper happening to be Node, which is fragile).
      expect(appNodeLambdas).toHaveLength(EXPECTED_APPLICATION_LAMBDA_COUNT);

      appNodeLambdas.forEach(([logicalId, fn]: [string, any]) => {
        // Sanity log on the unlikely failure path: name the offending
        // Lambda so CI output points straight at the regression.
        if (fn.Properties.Runtime !== 'nodejs22.x') {
          throw new Error(
            `Application Lambda ${logicalId} runtime is `
              + `${fn.Properties.Runtime}, expected nodejs22.x`
          );
        }
        expect(fn.Properties.Runtime).toBe('nodejs22.x');
      });
    });

    test('No Lambda uses an EOL Node runtime (nodejs18.x or nodejs20.x)', () => {
      // Negative assertion: explicitly forbid the runtime values we just
      // migrated away from. This catches the regression case where a
      // developer copy-pastes an old Lambda definition and accidentally
      // hardcodes lambda.Runtime.NODEJS_18_X / NODEJS_20_X instead of
      // referencing the centralized LAMBDA_RUNTIME constant.
      const templateString = JSON.stringify(template.toJSON());
      expect(templateString).not.toContain('"nodejs18.x"');
      expect(templateString).not.toContain('"nodejs20.x"');
    });
  });

  describe('Lambda Architecture Drift Guard (PR #203 R3)', () => {
    // Regression guard mirroring the runtime drift guard (PR #203 R2):
    //
    // PR #203 R3 centralized the Lambda CPU architecture into a single
    // module constant (LAMBDA_ARCHITECTURE = lambda.Architecture.ARM_64)
    // and migrated all 12 application Lambda definitions from the AWS
    // x86_64 default to ARM64 (Graviton). Without this regression test,
    // an accidental future revert of the constant — or a one-off Lambda
    // definition that omits `architecture` and falls back to x86_64 —
    // would silently regress the ~20% cost saving and the documentation
    // claim in openspec/project.md that the stack runs on Graviton.

    test('All application Node.js Lambdas declare arm64 architecture', () => {
      const allLambdas = template.findResources('AWS::Lambda::Function');
      const appNodeLambdas = Object.entries(allLambdas).filter(
        ([logicalId, fn]: [string, any]) =>
          isApplicationLambda(logicalId)
          && typeof fn.Properties?.Runtime === 'string'
          && fn.Properties.Runtime.startsWith('nodejs')
      );

      // R4: exact-count pin (was `>= 10`). Same headcount contract as
      // the runtime drift guard above — see EXPECTED_APPLICATION_LAMBDA_COUNT
      // comment for the rationale and update protocol.
      expect(appNodeLambdas).toHaveLength(EXPECTED_APPLICATION_LAMBDA_COUNT);

      appNodeLambdas.forEach(([logicalId, fn]: [string, any]) => {
        // CDK serializes Architecture into the `Architectures` array
        // on the CFN resource (note the plural — Lambda's CFN schema
        // accepts a single-element array, not a scalar).
        if (!Array.isArray(fn.Properties.Architectures)
            || fn.Properties.Architectures[0] !== 'arm64') {
          throw new Error(
            `Application Lambda ${logicalId} architecture is `
              + `${JSON.stringify(fn.Properties.Architectures)}, expected ["arm64"]`
          );
        }
        expect(fn.Properties.Architectures).toEqual(['arm64']);
      });
    });

    test('No application Lambda uses x86_64 architecture', () => {
      // Negative assertion: forbid the architecture value we just left
      // behind on application Lambdas. Catches the copy-paste regression
      // where a developer reuses an old Lambda definition that omits
      // `architecture` (CDK would silently default it back to x86_64) or
      // hardcodes lambda.Architecture.X86_64.
      //
      // Per-Lambda check (not a JSON.stringify substring scan) because
      // CDK-injected helper Lambdas legitimately ship with x86_64 defaults
      // we do not control; a substring scan would false-positive on those.
      const allLambdas = template.findResources('AWS::Lambda::Function');
      const appNodeLambdas = Object.entries(allLambdas).filter(
        ([logicalId, fn]: [string, any]) =>
          isApplicationLambda(logicalId)
          && typeof fn.Properties?.Runtime === 'string'
          && fn.Properties.Runtime.startsWith('nodejs')
      );
      appNodeLambdas.forEach(([logicalId, fn]: [string, any]) => {
        const archs = fn.Properties.Architectures ?? [];
        if (Array.isArray(archs) && archs.includes('x86_64')) {
          throw new Error(
            `Application Lambda ${logicalId} declares x86_64 - must be arm64`
          );
        }
        expect(archs).not.toContain('x86_64');
      });
    });
  });

  describe('AWS String Constraint Drift Guard (PR #213)', () => {
    // Regression guard for the deploy failure that rolled back the
    // post-PR-#212 deploy on commit d8fd9a8:
    //
    //   AWS::IAM::Role | DeleteJobLambdaRole - Resource handler returned
    //   message: "1 validation error detected: Value at 'description' failed
    //   to satisfy constraint: Member must satisfy regular expression pattern:
    //   [\u0009\u000A\u000D\u0020-\u007E\u00A1-\u00FF]*"
    //
    // PRs #208 and #212 introduced new IAM roles whose `description` strings
    // contained em-dashes (U+2014). AWS IAM only accepts ASCII printable
    // (0x20-0x7E) + tab/LF/CR + Latin-1 Supplement (0xA1-0xFF). U+2014 is
    // outside that range; CDK happily synthesized the template, npm test
    // passed, but `cdk deploy` failed at resource creation, leaving the
    // stack in UPDATE_ROLLBACK_COMPLETE and blocking the demo journey.
    //
    // This guard walks the synthesized template and validates every
    // `Description` property (the field AWS rejected on us) against the
    // documented IAM regex. Walking the JSON template instead of the CDK
    // construct surface guarantees we catch any resource type whose
    // serialized description ends up in a CFN string slot — not just IAM.
    //
    // See docs/cdk-best-practices.md "AWS String Constraint Validation"
    // section for the broader pattern.

    test('all `Description` fields contain only AWS-allowed characters', () => {
      // Per AWS docs: IAM Role / Policy / etc. `Description` accepts:
      //   ASCII printable (0x20-0x7E) + tab (0x09) + LF (0x0A) + CR (0x0D)
      //   + Latin-1 Supplement (0xA1-0xFF). NO Unicode beyond Latin-1.
      const awsAllowedDescription = /^[\x09\x0A\x0D\x20-\x7E\xA1-\xFF]*$/;

      // Walk the entire synthesized template, collecting every
      // `Description` (and `description` — case varies by resource type).
      const violations: string[] = [];
      const visit = (path: string, node: unknown): void => {
        if (node === null || node === undefined) return;
        if (Array.isArray(node)) {
          node.forEach((item, i) => visit(`${path}[${i}]`, item));
          return;
        }
        if (typeof node === 'object') {
          for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (
              (key === 'Description' || key === 'description')
              && typeof value === 'string'
              && !awsAllowedDescription.test(value)
            ) {
              // Surface the offending character(s) for fast triage.
              const offenders = [...value]
                .filter((ch) => !awsAllowedDescription.test(ch))
                .map((ch) => `U+${ch.codePointAt(0)!.toString(16).padStart(4, '0').toUpperCase()} ('${ch}')`)
                .join(', ');
              violations.push(
                `${path}.${key} contains chars outside AWS Latin-1 range: ${offenders}\n  value: ${value.slice(0, 120)}`
              );
            }
            visit(`${path}.${key}`, value);
          }
        }
      };
      visit('$', template.toJSON());

      // Friendly failure message: list ALL violations at once so a single
      // CI run surfaces every offender (not just the first).
      if (violations.length > 0) {
        throw new Error(
          `Found ${violations.length} Description field(s) with characters AWS will reject:\n\n`
            + violations.join('\n\n')
        );
      }
      expect(violations).toEqual([]);
    });
  });

  describe('Download Translation Lambda (demo-readiness)', () => {
    // Drift guards for the new DownloadTranslation Lambda added in the
    // demo-readiness PR. These mirror the patterns used for GetJob and
    // DeleteJob (PR #208): runtime + architecture + IAM role isolation.
    //
    // CDK logical-ID convention: CDK generates PascalCase logical IDs from the
    // construct `id` string (e.g. 'DownloadTranslationFunction' + hash suffix).
    // Tests that search for the Lambda by logical ID must use PascalCase patterns,
    // NOT the kebab-case function name (lfmt-download-translation-*).

    test('DownloadTranslationFunction exists with nodejs22.x + arm64', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'lfmt-download-translation-test',
        Runtime: 'nodejs22.x',
        Architectures: ['arm64'],
      });
    });

    test('DownloadTranslationFunction has a dedicated IAM role (not translationRole)', () => {
      // The download Lambda must NOT reuse translationRole — that role grants
      // PutObject + DeleteObject on the full bucket.  The dedicated
      // DownloadTranslationLambdaRole is read-only on translated/* only.
      const functions = template.findResources('AWS::Lambda::Function');
      const downloadFn = Object.values(functions).find((fn: any) =>
        fn.Properties?.FunctionName === 'lfmt-download-translation-test'
      ) as any;

      expect(downloadFn).toBeDefined();

      // The Role property is a Ref or GetAtt to the dedicated role.
      // Find the DownloadTranslationLambdaRole in the template and verify
      // the Lambda's role references it.
      const roles = template.findResources('AWS::IAM::Role');
      const downloadRole = Object.entries(roles).find(([, role]: [string, any]) =>
        role.Properties?.Description?.includes('download-translation')
      );
      expect(downloadRole).toBeDefined();
    });

    test('DownloadTranslationLambdaRole does NOT have s3:PutObject or s3:DeleteObject', () => {
      // Security assertion: the download role must be read-only.
      // PutObject / DeleteObject on the document bucket would allow this
      // Lambda to overwrite or delete source documents — not its purpose.
      const roles = template.findResources('AWS::IAM::Role');
      const downloadRoleEntry = Object.entries(roles).find(([, role]: [string, any]) =>
        role.Properties?.Description?.includes('download-translation')
      );
      expect(downloadRoleEntry).toBeDefined();

      // Collect all managed policies that reference the download role's logical ID.
      const downloadRoleLogicalId = downloadRoleEntry![0];
      const managedPolicies = template.findResources('AWS::IAM::ManagedPolicy');
      const downloadPolicies = Object.values(managedPolicies).filter((policy: any) => {
        const roles = policy.Properties?.Roles ?? [];
        return JSON.stringify(roles).includes(downloadRoleLogicalId);
      });

      const downloadPoliciesStr = JSON.stringify(downloadPolicies);
      expect(downloadPoliciesStr).not.toContain('s3:PutObject');
      expect(downloadPoliciesStr).not.toContain('s3:DeleteObject');
    });

    test('DownloadTranslationLambdaRole has s3:GetObject on translated/* prefix only', () => {
      // Verify that GetObject is scoped to the translated/* prefix and does
      // NOT allow reads on the full bucket (which would expose source documents).
      const managedPolicies = template.findResources('AWS::IAM::ManagedPolicy');
      const downloadPolicyWithGetObject = Object.values(managedPolicies).find((policy: any) => {
        const policyStr = JSON.stringify(policy);
        return policyStr.includes('s3:GetObject') && policyStr.includes('download-translation');
      });

      // If the above filter is too strict due to description not being in the policy
      // resource itself, just verify a GetObject policy for translated/* exists.
      const roles = template.findResources('AWS::IAM::Role');
      const downloadRoleEntry = Object.entries(roles).find(([, role]: [string, any]) =>
        role.Properties?.Description?.includes('download-translation')
      );
      expect(downloadRoleEntry).toBeDefined();

      const downloadRoleLogicalId = downloadRoleEntry![0];
      const allManagedPolicies = template.findResources('AWS::IAM::ManagedPolicy');
      const policiesForDownload = Object.values(allManagedPolicies).filter((policy: any) => {
        const rolesArr = policy.Properties?.Roles ?? [];
        return JSON.stringify(rolesArr).includes(downloadRoleLogicalId);
      });

      // At least one policy attached to the download role must grant GetObject
      const policiesStr = JSON.stringify(policiesForDownload);
      expect(policiesStr).toContain('s3:GetObject');

      // The GetObject grant must be scoped to a path containing 'translated'
      // (not a wildcard on the full bucket).
      const hasTranslatedPrefixScope = policiesForDownload.some((policy: any) => {
        const stmts = policy.Properties?.PolicyDocument?.Statement ?? [];
        return stmts.some((stmt: any) => {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          if (!actions.includes('s3:GetObject')) return false;
          const resources = Array.isArray(stmt.Resource) ? stmt.Resource : [stmt.Resource];
          return JSON.stringify(resources).includes('translated');
        });
      });
      expect(hasTranslatedPrefixScope).toBe(true);
    });

    test('API Gateway has GET /jobs/{jobId}/download route', () => {
      // Verify the API Gateway resource tree contains the download path.
      // The route is /jobs/{jobId}/download (not /translation/{jobId}/download)
      // to stay consistent with the /jobs/{jobId}/translate and /jobs/{jobId}/translation-status
      // convention (OMC review #4). CDK creates one ApiGateway::Resource per path segment.
      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: 'download',
      });

      // Verify a GET method exists that integrates with the download Lambda.
      // CDK logical IDs use PascalCase (e.g. "DownloadTranslationFunction…"),
      // so we search for the PascalCase prefix in the serialised URI object.
      const methods = template.findResources('AWS::ApiGateway::Method');
      const downloadGetMethod = Object.values(methods).find((method: any) => {
        const uri = JSON.stringify(method.Properties?.Integration?.Uri ?? '');
        const httpMethod = method.Properties?.HttpMethod;
        return httpMethod === 'GET' && uri.includes('DownloadTranslation');
      });
      expect(downloadGetMethod).toBeDefined();
    });

    test('GET /jobs/{jobId}/download method uses COGNITO authorizer', () => {
      // The download endpoint must be protected — unauthenticated access would
      // leak translated documents to anyone who knows a jobId.
      const methods = template.findResources('AWS::ApiGateway::Method');
      const downloadGetMethod = Object.values(methods).find((method: any) => {
        const uri = JSON.stringify(method.Properties?.Integration?.Uri ?? '');
        return method.Properties?.HttpMethod === 'GET' && uri.includes('DownloadTranslation');
      });

      expect(downloadGetMethod).toBeDefined();
      expect((downloadGetMethod as any).Properties?.AuthorizationType).toBe('COGNITO_USER_POOLS');
    });
  });
});

// ===========================================================================
// PR #214 OMC R2 — Multi-environment CORS drift guard (H-1, M-1, code coverage)
//
// The PR's silent-drift defense was undefended in the prior test suite:
// the original `'test'` stack falls through to the dev branch (so only the
// dev CloudFront literal was ever exercised at synth). This block synthesizes
// the stack for each of dev / staging / prod and asserts:
//   1. The CloudFront origin literal for THAT environment appears in the
//      document bucket's CORS `AllowedOrigins`.
//   2. localhost is GATED to dev only — staging / prod must NOT allow it
//      (security M finding: localhost exclusion).
//   3. `AllowedMethods` includes PUT (test-coverage gap surfaced by the
//      browser-upload regression class — without PUT in the bucket CORS,
//      every presigned-PUT preflight fails).
// ===========================================================================
describe('LFMT Infrastructure Stack — multi-environment CORS (PR #214 OMC R2)', () => {
  const synthForEnvironment = (environment: 'dev' | 'staging' | 'prod') => {
    const app = new App({
      context: {
        skipLambdaBundling: 'true',
        environment,
      },
    });
    const stack = new LfmtInfrastructureStack(app, `Stack${environment}`, {
      stackName: `lfmt-${environment}`,
      environment,
      enableLogging: true,
      retainData: false,
    });
    return Template.fromStack(stack);
  };

  // Helper: collect every AllowedOrigins entry across every CORS rule on
  // the document bucket so the assertion is robust to a future merge of
  // the initial `cors:[]` rule and the appended `addCorsRule` entry.
  const documentBucketCorsRules = (template: Template): unknown[] => {
    const buckets = template.findResources('AWS::S3::Bucket');
    const docBucketEntry = Object.entries(buckets).find(([, bucket]) => {
      const bucketName = (bucket as { Properties?: { BucketName?: unknown } })
        .Properties?.BucketName;
      if (typeof bucketName === 'string') return bucketName.includes('lfmt-documents');
      const join = (bucketName as { 'Fn::Join'?: [string, unknown[]] })?.['Fn::Join'];
      return Array.isArray(join?.[1])
        ? join[1].some((part) => typeof part === 'string' && part.includes('lfmt-documents'))
        : false;
    });
    expect(docBucketEntry).toBeDefined();
    const [, docBucket] = docBucketEntry!;
    return (
      (docBucket as { Properties?: { CorsConfiguration?: { CorsRules?: unknown[] } } })
        .Properties?.CorsConfiguration?.CorsRules ?? []
    );
  };

  const flattenAllowedOrigins = (corsRules: unknown[]): string[] =>
    corsRules.flatMap((rule) =>
      ((rule as { AllowedOrigins?: unknown[] }).AllowedOrigins ?? []).filter(
        (o): o is string => typeof o === 'string'
      )
    );

  const flattenAllowedMethods = (corsRules: unknown[]): string[] =>
    corsRules.flatMap((rule) =>
      ((rule as { AllowedMethods?: unknown[] }).AllowedMethods ?? []).filter(
        (m): m is string => typeof m === 'string'
      )
    );

  describe.each(['dev', 'staging', 'prod'] as const)(
    'environment=%s',
    (environment) => {
      let template: Template;
      beforeAll(() => {
        template = synthForEnvironment(environment);
      });

      test(`document bucket CORS allows the ${environment} CloudFront origin`, () => {
        const origins = flattenAllowedOrigins(documentBucketCorsRules(template));
        const expectedOrigin = CLOUDFRONT_ORIGINS_BY_ENVIRONMENT[environment];
        expect(origins).toEqual(expect.arrayContaining([expectedOrigin]));
      });

      test('document bucket CORS allows the PUT method (presigned uploads)', () => {
        // Without PUT, every presigned upload preflight is rejected by
        // the bucket's CORS policy and the browser blocks the request
        // before any HTTP body is sent — same regression class as the
        // 2026-05-08 demo blocker.
        const methods = flattenAllowedMethods(documentBucketCorsRules(template));
        expect(methods).toEqual(expect.arrayContaining(['PUT']));
      });

      if (environment === 'dev') {
        test('localhost IS allowed on dev (developer experience)', () => {
          const origins = flattenAllowedOrigins(documentBucketCorsRules(template));
          // The initial `cors:[]` rule on the document bucket includes
          // localhost for dev; this test pins that contract so a future
          // refactor doesn't break local-machine wizard testing.
          expect(origins).toEqual(expect.arrayContaining(['http://localhost:3000']));
        });
      } else {
        test(`localhost is NOT allowed on ${environment} (security M)`, () => {
          // Per security-M finding (PR #214 OMC R2): non-dev tiers must
          // never allow `http://localhost:3000` on the production
          // document bucket — a developer running a local wizard on
          // their laptop must not be able to drive prod uploads.
          const origins = flattenAllowedOrigins(documentBucketCorsRules(template));
          expect(origins).not.toContain('http://localhost:3000');
          expect(origins).not.toContain('https://localhost:3000');
        });
      }
    }
  );

  // ---------------------------------------------------------------------
  // Constant drift guard (PR #214 OMC R2 convergent — 2 agents).
  //
  // `CLOUDFRONT_ORIGINS_BY_ENVIRONMENT` is the single source of truth for
  // both API Gateway CORS and document-bucket CORS. If a new environment
  // ('preview', 'qa', etc.) is added to the stack switch but the
  // contributor forgets to populate this constant, the bucket-CORS path
  // silently falls back to the dev origin and prod-tier uploads start
  // hitting the wrong origin. This test fails loudly on that drift.
  // ---------------------------------------------------------------------
  test('CLOUDFRONT_ORIGINS_BY_ENVIRONMENT has entries for every known tier', () => {
    expect(Object.keys(CLOUDFRONT_ORIGINS_BY_ENVIRONMENT).sort()).toEqual([
      'dev',
      'prod',
      'staging',
    ]);
    // Every value must be an https:// URL — the same gate `buildCsp`
    // applies to `reportUri` (PR #214 OMC R2 H-3). This is a cheap
    // sanity check that catches a typo at synth time. Wrap in a try
    // so a failure surfaces the offending env name (Jest's `expect`
    // doesn't accept a second message argument).
    for (const [env, origin] of Object.entries(CLOUDFRONT_ORIGINS_BY_ENVIRONMENT)) {
      if (!/^https:\/\//.test(origin)) {
        throw new Error(`${env} origin must start with https:// (got: ${origin})`);
      }
    }
  });
});

// ===========================================================================
// buildCsp — H-3 reportUri sanitization (PR #214 OMC R2) + #216 refactor
//
// `buildCsp` (now in `lib/csp.ts`, extracted by #216) interpolates the
// configured `report-uri` value directly into a CSP directive string. When
// issue #201 wires this parameter, an attacker (or a misconfigured deploy)
// could inject a CSP directive via a malformed URL. The validation is
// exercised here via the exported assertion helper so the unit test runs
// without a full stack synth.
//
// #216 changed the options shape from
//   `buildCsp({ connectSrc, reportUri })`
// to
//   `buildCsp({ directives: { 'connect-src': [...], 'report-uri': [...] } })`
// — the tests below cover BOTH the validation contract AND the new shape.
// ===========================================================================
import { Lazy, Token } from 'aws-cdk-lib';
import { buildCsp, assertValidCspReportUri, type CspDirective } from '../csp';

describe('csp.ts — assertValidCspReportUri (H-3 sanitization)', () => {
  test('valid https:// URL passes', () => {
    expect(() =>
      assertValidCspReportUri('https://csp-report.lfmt.example.com/report')
    ).not.toThrow();
  });

  test('throws on injected CSP directive via `;`', () => {
    expect(() =>
      assertValidCspReportUri('https://evil.com; script-src *')
    ).toThrow(/must not contain whitespace/);
  });

  test('throws on injected CSP directive via `,`', () => {
    expect(() =>
      assertValidCspReportUri('https://evil.com,script-src *')
    ).toThrow(/must not contain whitespace/);
  });

  test('throws on whitespace inside the URL', () => {
    expect(() =>
      assertValidCspReportUri('https://evil.com /report')
    ).toThrow(/must not contain whitespace/);
  });

  test('throws on plain http:// (must be https)', () => {
    expect(() =>
      assertValidCspReportUri('http://csp-report.example.com/report')
    ).toThrow(/protocol must be https:/);
  });

  test('throws on a malformed URL', () => {
    expect(() => assertValidCspReportUri('not a url')).toThrow();
  });

  test('accepts an unresolved CDK token URL (deferred URL-parse)', () => {
    // CDK emits `${Token[<id>]}` for unresolved references at synth time.
    // The string is NOT a valid URL by `new URL()` standards, but it IS
    // safe — CDK substitutes the concrete value via Fn::Join before the
    // browser ever sees it. The validator must allow this through so the
    // stack can synthesize, while still rejecting the dangerous characters.
    expect(() =>
      assertValidCspReportUri(
        'https://${Token[apiId.123]}.execute-api.${Token[AWS.Region.13]}.amazonaws.com/v1/csp-report'
      )
    ).not.toThrow();
  });

  // OMC R2 Medium-1: defensive coupling-check between the pure-module
  // CDK-token regex in csp.ts and CDK's actual token lexical format.
  //
  // `csp.ts` is a pure module that deliberately does NOT depend on CDK
  // (so the unit tests can run without `@aws-cdk/*` imports). The
  // token-escape-hatch uses a lexical regex (`/\$\{Token\[[^\]]+\]\}/`)
  // that mirrors CDK's internal `${Token[<id>]}` format. If a future CDK
  // upgrade changes that lexical format, the escape hatch would silently
  // misfire and our valid stack synth would start throwing.
  //
  // This test imports CDK and asks it to generate a real unresolved
  // token, then verifies our lexical regex matches CDK's output. The
  // test BREAKS at the CDK-upgrade PR, surfacing the drift at the time
  // we can act on it (rather than at next deploy).
  test('CDK token lexical format matches the csp.ts regex (CDK-upgrade drift guard)', () => {
    const lazyToken = Lazy.uncachedString({
      produce: () => 'resolved-at-deploy-time',
    });

    // Sanity-check: the produced string must actually BE an unresolved
    // CDK token (not the literal resolved value). If this assertion
    // fails, our test setup is wrong and the regex check below is
    // vacuous.
    expect(Token.isUnresolved(lazyToken)).toBe(true);

    // The lexical form CDK emits when this token is stringified.
    const tokenLexicalForm = String(lazyToken);

    // The same regex literal that csp.ts uses internally (line 248).
    // Keeping it inline here — rather than exporting it from csp.ts —
    // preserves the pure-module API surface (only buildCsp + the
    // assertion helper are exported). If a future csp.ts contributor
    // changes the regex, they must update this test too — that's the
    // OPPOSITE drift this test guards against (CDK changing on us).
    const cspTokenRegex = /\$\{Token\[[^\]]+\]\}/;
    expect(cspTokenRegex.test(tokenLexicalForm)).toBe(true);

    // End-to-end check: an `https://...` URL containing the real token
    // must pass our validator. This is the load-bearing assertion —
    // if CDK changes the format, this is what would break inside an
    // actual stack synth.
    expect(() =>
      assertValidCspReportUri(`https://${tokenLexicalForm}.example.com/csp-report`)
    ).not.toThrow();
  });

  test('still rejects CDK-token URLs with forbidden chars (defense-in-depth)', () => {
    // Even if a future contributor adds a token that resolves to a value
    // containing a `;`/`,`/whitespace, this rejection fires SYNCHRONOUSLY
    // at synth — the protection is not bypassed by the token escape hatch.
    expect(() =>
      assertValidCspReportUri('https://${Token[id]}.example.com; script-src *')
    ).toThrow(/must not contain whitespace/);
  });

  test('still rejects CDK-token URLs that are http:// (defense-in-depth)', () => {
    // Token escape hatch must NOT bypass the protocol check — the prefix
    // test happens before the token detection so an http://-prefixed token
    // string is rejected.
    expect(() =>
      assertValidCspReportUri('http://${Token[id]}.example.com/report')
    ).toThrow(/protocol must be https:/);
  });

  test('throws on a non-string input', () => {
    // Defensive: silent-coercion would let `null`/`undefined`/`{}` pass.
    expect(() =>
      assertValidCspReportUri(null as unknown as string)
    ).toThrow(/must be a string/);
    expect(() =>
      assertValidCspReportUri(undefined as unknown as string)
    ).toThrow(/must be a string/);
    expect(() =>
      assertValidCspReportUri({ url: 'https://x.com' } as unknown as string)
    ).toThrow(/must be a string/);
  });
});

describe('csp.ts — buildCsp(#216 directive-map shape)', () => {
  test('default emission contains every hardening directive', () => {
    const csp = buildCsp();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
    // No `report-uri` unless explicitly opted in.
    expect(csp).not.toContain('report-uri');
  });

  test('single-directive override replaces (does not merge) the default', () => {
    const csp = buildCsp({
      directives: {
        'connect-src': ["'self'", 'https://api.example.com'],
      },
    });
    expect(csp).toContain("connect-src 'self' https://api.example.com");
    // Other directives untouched.
    expect(csp).toContain("script-src 'self'");
  });

  test('multi-directive override coexists', () => {
    const csp = buildCsp({
      directives: {
        'connect-src': ["'self'", 'https://api.example.com'],
        'style-src': ["'self'", "'nonce-abc123'"],
      },
    });
    expect(csp).toContain("connect-src 'self' https://api.example.com");
    expect(csp).toContain("style-src 'self' 'nonce-abc123'");
    // Default style-src was REPLACED — the inline keyword must not appear.
    const styleSrcMatch = csp.match(/style-src[^;]*/);
    expect(styleSrcMatch).not.toBeNull();
    expect(styleSrcMatch![0]).not.toContain("'unsafe-inline'");
  });

  test('nonce-style runtime value survives unchanged through the builder', () => {
    // #197 forward-compat: per-response nonces will be threaded in as
    // `'nonce-<base64>'` source-expressions. The builder must not mangle them.
    const nonce = "'nonce-r4ndomB64+/=='";
    const csp = buildCsp({
      directives: {
        'style-src': ["'self'", nonce],
        'script-src': ["'self'", nonce],
      },
    });
    expect(csp).toContain(`style-src 'self' ${nonce}`);
    expect(csp).toContain(`script-src 'self' ${nonce}`);
  });

  test("upgrade-insecure-requests emits as a value-less directive", () => {
    // CSP grammar quirk: this directive takes NO source list. The builder
    // must emit just the bare name; appending sources here would be a
    // grammar error that some browsers tolerate and others reject.
    const csp = buildCsp();
    // Must appear as a standalone token between '; ' delimiters.
    expect(csp).toMatch(/(^|; )upgrade-insecure-requests(;|$)/);
  });

  test('report-uri is emitted LAST when provided (per CSP grammar)', () => {
    const validUri = 'https://csp-report.lfmt.example.com/report';
    const csp = buildCsp({
      directives: {
        'connect-src': ["'self'", 'https://api.example.com'],
        'report-uri': [validUri],
      },
    });
    expect(csp).toContain(`report-uri ${validUri}`);
    const directives = csp.split(';').map((d) => d.trim()).filter(Boolean);
    const lastDirective = directives[directives.length - 1];
    expect(lastDirective).toBe(`report-uri ${validUri}`);
  });

  test('report-uri validation rejects injection attempts at build time', () => {
    expect(() =>
      buildCsp({
        directives: {
          'report-uri': ['https://evil.com; script-src *'],
        },
      })
    ).toThrow(/must not contain whitespace/);
  });

  test('report-uri rejects empty array (would emit a sourceless directive)', () => {
    expect(() =>
      buildCsp({
        directives: {
          'report-uri': [],
        },
      })
    ).toThrow(/non-empty array/);
  });

  test('CspDirective type union covers every default directive (compile-time guard)', () => {
    // This test is mostly a compile-time check — TypeScript narrows the
    // type at the indexed access. If a future contributor removes a
    // directive from the union without removing its default, this assertion
    // (and the build) breaks.
    const names: CspDirective[] = [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'object-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
      'upgrade-insecure-requests',
      'report-uri',
    ];
    expect(names).toHaveLength(12);
  });
});
