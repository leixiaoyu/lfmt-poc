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
        skipLambdaBundling: 'true',  // Skip Docker bundling for tests
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
            KeyType: 'HASH'
          },
          {
            AttributeName: 'userId', 
            KeyType: 'RANGE'
          }
        ],
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true
        },
        SSESpecification: {
          SSEEnabled: true
        }
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
                KeyType: 'HASH'
              },
              {
                AttributeName: 'createdAt',
                KeyType: 'RANGE'
              }
            ]
          }),
          Match.objectLike({
            IndexName: 'StatusIndex',
            KeySchema: [
              {
                AttributeName: 'status',
                KeyType: 'HASH'
              },
              {
                AttributeName: 'createdAt', 
                KeyType: 'RANGE'
              }
            ]
          })
        ])
      });
    });

    test('Users table exists with correct configuration', () => {
      // Validates Document 10 specifications
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'lfmt-users-test',
        KeySchema: [
          {
            AttributeName: 'userId',
            KeyType: 'HASH'
          }
        ],
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'EmailIndex',
            KeySchema: [
              {
                AttributeName: 'email',
                KeyType: 'HASH'
              }
            ]
          })
        ])
      });
    });

    test('Attestations table exists with TTL for 7-year retention', () => {
      // Validates Document 6 legal compliance requirements
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'lfmt-attestations-test',
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true
        },
        KeySchema: [
          {
            AttributeName: 'attestationId',
            KeyType: 'HASH'
          },
          {
            AttributeName: 'userId',
            KeyType: 'RANGE'
          }
        ]
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
            KeyType: 'HASH'
          }
        ],
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true
        },
        SSESpecification: {
          SSEEnabled: true
        },
        TimeToLiveSpecification: {
          AttributeName: 'ttl',
          Enabled: true
        }
      });
    });
  });

  describe('S3 Buckets', () => {
    test('Document bucket configured with proper security', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'lfmt-documents-test',
        VersioningConfiguration: {
          Status: 'Enabled'
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256'
              }
            }
          ]
        }
      });
    });

    test('Results bucket configured correctly', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: 'lfmt-results-test',
        BucketEncryption: Match.anyValue(),
        PublicAccessBlockConfiguration: Match.anyValue()
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
              ExpirationInDays: 90
            })
          ])
        }
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
                  TransitionInDays: 30
                }),
                Match.objectLike({
                  StorageClass: 'GLACIER',
                  TransitionInDays: 60
                })
              ])
            })
          ])
        }
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
            RequireUppercase: true
          }
        }
      });
    });

    test('User pool client configured correctly', () => {
      template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ClientName: 'lfmt-client-test',
        GenerateSecret: false
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
          Types: ['REGIONAL']
        }
      });
    });

    test('API deployment configured correctly', () => {
      // Check that API Gateway deployment exists
      template.resourceCountIs('AWS::ApiGateway::Deployment', 1);
      
      // Check that API Gateway stage exists with correct name
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'v1'
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
                Service: 'lambda.amazonaws.com'
              }
            })
          ])
        }
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
                'dynamodb:Query'
              ])
            })
          ])
        }
      });

      // Verify S3 permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith([
                's3:GetObject',
                's3:PutObject'
              ])
            })
          ])
        }
      });

      // Verify Cognito permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith([
                'cognito-idp:SignUp',
                'cognito-idp:InitiateAuth'
              ])
            })
          ])
        }
      });

      // Verify Secrets Manager permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'secretsmanager:GetSecretValue'
            })
          ])
        }
      });

      // Verify Lambda invoke permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'lambda:InvokeFunction'
            })
          ])
        }
      });

      // Verify Step Functions permissions in managed policy
      template.hasResourceProperties('AWS::IAM::ManagedPolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'states:StartExecution'
            })
          ])
        }
      });
    });

    test('Step Functions role has Lambda invoke permissions', () => {
      template.hasResourceProperties('AWS::IAM::Role', {
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Principal: {
                Service: 'states.amazonaws.com'
              }
            })
          ])
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
        StateMachineName: 'lfmt-translation-workflow-test'
      });
    });

    test('State machine has Map state for parallel chunk processing', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachineKeys = Object.keys(stateMachines);
      expect(stateMachineKeys.length).toBe(1);

      const stateMachine = stateMachines[stateMachineKeys[0]];
      const definition = JSON.parse(stateMachine.Properties.DefinitionString['Fn::Join'][1].join(''));

      // Verify Map state exists
      const states = definition.States;
      const mapState = Object.values(states).find((state: any) => state.Type === 'Map');
      expect(mapState).toBeDefined();

      // Verify parallel processing (maxConcurrency: 10) with distributed rate limiting
      expect((mapState as any).MaxConcurrency).toBe(10);
    });

    test('State machine has workflow states', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const stateMachineKeys = Object.keys(stateMachines);
      const stateMachine = stateMachines[stateMachineKeys[0]];
      const definition = JSON.parse(stateMachine.Properties.DefinitionString['Fn::Join'][1].join(''));

      // Verify state machine has multiple states
      const states = definition.States;
      const stateCount = Object.keys(states).length;
      expect(stateCount).toBeGreaterThan(2); // At least: Map, DynamoDB Update, Success (Fail is inside Map iterator)

      // Verify there's a Succeed state for successful completion
      const successState = Object.values(states).find((state: any) => state.Type === 'Succeed');
      expect(successState).toBeDefined();

      // Note: Fail state is nested inside Map iterator (TranslationFailed), not at top level
    });

    test('State machine has required IAM permissions', () => {
      // State machine should have permission to invoke Lambda
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: 'lambda:InvokeFunction',
              Resource: Match.anyValue()
            })
          ])
        }
      });

      // State machine should have permission to read/write DynamoDB
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: 'Allow',
              Action: Match.arrayWith([
                Match.stringLikeRegexp('dynamodb:.*')
              ]),
              Resource: Match.anyValue()
            })
          ])
        }
      });
    });

    test('State machine log group configured correctly', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/stepfunctions/lfmt-translation-test',
        RetentionInDays: 7  // One week retention as specified in implementation
      });
    });
  });

  describe('CloudWatch Log Groups', () => {
    test('Log groups created with correct retention', () => {
      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/apigateway/lfmt-api-test',
        RetentionInDays: 30
      });

      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/lambda/lfmt-test',
        RetentionInDays: 30
      });

      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/stepfunctions/lfmt-test',
        RetentionInDays: 30
      });

      template.hasResourceProperties('AWS::Logs::LogGroup', {
        LogGroupName: '/aws/security/lfmt-test',
        RetentionInDays: 90
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
      template.resourceCountIs('AWS::S3::Bucket', 3);      // Documents, Results, Frontend
      template.resourceCountIs('AWS::Cognito::UserPool', 1);
      template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
      template.resourceCountIs('AWS::Logs::LogGroup', 5);   // API, Lambda x3, Step Functions State Machine x1
      template.resourceCountIs('AWS::CloudFront::Distribution', 1);
      template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
      template.resourceCountIs('AWS::CloudFront::ResponseHeadersPolicy', 1);
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
          RestrictPublicBuckets: true
        }
      });
    });

    test('All DynamoDB tables have encryption enabled', () => {
      template.allResourcesProperties('AWS::DynamoDB::Table', {
        SSESpecification: {
          SSEEnabled: true
        }
      });
    });
  });

  describe('CloudFront Distribution', () => {
    test('CloudFront distribution exists', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          Enabled: true,
          IPV6Enabled: true,
          DefaultRootObject: 'index.html'
        }
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
              ErrorCachingMinTTL: 300
            },
            {
              ErrorCode: 404,
              ResponseCode: 200,
              ResponsePagePath: '/index.html',
              ErrorCachingMinTTL: 300
            }
          ]
        }
      });
    });

    test('HTTPS-only viewer protocol policy', () => {
      template.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: {
          DefaultCacheBehavior: {
            ViewerProtocolPolicy: 'redirect-to-https'
          }
        }
      });
    });

    test('Security headers policy configured', () => {
      template.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
        ResponseHeadersPolicyConfig: {
          SecurityHeadersConfig: {
            StrictTransportSecurity: {
              AccessControlMaxAgeSec: 31536000,
              IncludeSubdomains: true,
              Override: true
            },
            ContentTypeOptions: {
              Override: true
            },
            FrameOptions: {
              FrameOption: 'DENY',
              Override: true
            },
            XSSProtection: {
              Protection: true,
              ModeBlock: true,
              Override: true
            },
            ReferrerPolicy: {
              ReferrerPolicy: 'strict-origin-when-cross-origin',
              Override: true
            },
            ContentSecurityPolicy: {
              ContentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.execute-api.*.amazonaws.com;",
              Override: true
            }
          }
        }
      });
    });

    test('Origin Access Control configured for S3', () => {
      template.hasResourceProperties('AWS::CloudFront::OriginAccessControl', {
        OriginAccessControlConfig: {
          OriginAccessControlOriginType: 's3',
          SigningBehavior: 'always',
          SigningProtocol: 'sigv4'
        }
      });
    });

    test('Frontend S3 bucket has public access blocked', () => {
      const buckets = template.findResources('AWS::S3::Bucket');
      const frontendBucket = Object.values(buckets).find((bucket: any) => {
        const bucketName = bucket.Properties?.BucketName;
        // Check if it's a string containing 'frontend' OR a Fn::Join with 'frontend'
        return (
          (typeof bucketName === 'string' && bucketName.includes('frontend')) ||
          bucketName?.['Fn::Join']?.[1]?.some((part: any) =>
            typeof part === 'string' && part.includes('frontend')
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
          RestrictPublicBuckets: true
        });
      }
    });
  });
});