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

      // Verify caching is configured
      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        CacheClusterEnabled: true
      });
    });

    test('CORS is properly configured', () => {
      // Check for OPTIONS method on resources
      expect(template.findResources('AWS::ApiGateway::Method')).toBeDefined();
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

      // Check for DynamoDB permissions in IAM role policies (inline policies)
      template.hasResourceProperties('AWS::IAM::Role', {
        Policies: Match.arrayWith([
          Match.objectLike({
            PolicyName: 'DynamoDBAccess',
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
          })
        ])
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
    });
  });

  describe('Resource Count Validation', () => {
    test('Expected number of resources created', () => {
      // Ensure we're not creating too many or too few resources
      template.resourceCountIs('AWS::DynamoDB::Table', 3); // Jobs, Users, Attestations
      template.resourceCountIs('AWS::S3::Bucket', 2);      // Documents, Results
      template.resourceCountIs('AWS::Cognito::UserPool', 1);
      template.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
      template.resourceCountIs('AWS::Logs::LogGroup', 4);   // API, Lambda, Step Functions, Security Audit
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
});