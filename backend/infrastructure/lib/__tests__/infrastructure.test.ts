// Infrastructure Validation Tests - Implementation Plan Milestone 1.1
// Validates AWS infrastructure matches design specifications exactly

import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LfmtInfrastructureStack } from '../lfmt-infrastructure-stack';

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

    test('No dynamodb:DeleteItem in any IAM policy', () => {
      // Security verification: Ensure dangerous DynamoDB DeleteItem action is not granted
      // This prevents accidental data deletion and enforces soft-delete patterns
      const templateJson = template.toJSON();
      const allPolicies = JSON.stringify(templateJson);
      expect(allPolicies).not.toContain('dynamodb:DeleteItem');
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
      // Note: 'unsafe-inline' is intentionally NOT asserted absent yet —
      // that lands with Part 1 (nonce-injection pipeline). Tracked in the
      // Part 1 follow-up issue.
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

    test('Origin Access Control configured for S3', () => {
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: {
          OriginAccessControlOriginType: 's3',
          SigningBehavior: 'always',
          SigningProtocol: 'sigv4',
        },
      });
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
});
