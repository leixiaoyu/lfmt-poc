import { 
  Stack, 
  StackProps, 
  RemovalPolicy,
  Duration,
  CfnOutput 
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

// AWS Service Imports - grouped by service
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as route53 from 'aws-cdk-lib/aws-route53';

export interface LfmtInfrastructureStackProps extends StackProps {
  stackName: string;
  environment: string;
  enableLogging: boolean;
  retainData: boolean;
}

export class LfmtInfrastructureStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly jobsTable: dynamodb.Table;
  public readonly usersTable: dynamodb.Table;
  public readonly attestationsTable: dynamodb.Table;
  public readonly documentBucket: s3.Bucket;
  public readonly resultsBucket: s3.Bucket;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: LfmtInfrastructureStackProps) {
    super(scope, id, props);

    const { environment, enableLogging, retainData } = props;

    // Removal policy based on environment
    const removalPolicy = retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // 1. DynamoDB Tables
    this.createDynamoDBTables(removalPolicy);

    // 2. S3 Buckets
    this.createS3Buckets(removalPolicy);

    // 3. Cognito User Pool
    this.createCognitoUserPool(removalPolicy);

    // 4. API Gateway
    this.createApiGateway();

    // 5. CloudWatch Log Groups
    if (enableLogging) {
      this.createLogGroups(removalPolicy);
    }

    // 6. IAM Roles and Policies
    this.createIamRoles();

    // 7. Outputs
    this.createOutputs();
  }

  private createDynamoDBTables(removalPolicy: RemovalPolicy) {
    // Jobs Table - From Document 7 (Job State Management)
    (this as any).jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName: `lfmt-jobs-${this.stackName}`,
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // GSI for user job queries
    this.jobsTable.addGlobalSecondaryIndex({
      indexName: 'UserJobsIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for status queries
    this.jobsTable.addGlobalSecondaryIndex({
      indexName: 'StatusIndex',
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // Users Table - From Document 10 (User Management)
    (this as any).usersTable = new dynamodb.Table(this, 'UsersTable', {
      tableName: `lfmt-users-${this.stackName}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI for email lookups
    this.usersTable.addGlobalSecondaryIndex({
      indexName: 'EmailIndex',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
    });

    // Legal Attestations Table - From Document 6 (Legal Attestation System)
    (this as any).attestationsTable = new dynamodb.Table(this, 'AttestationsTable', {
      tableName: `lfmt-attestations-${this.stackName}`,
      partitionKey: { name: 'attestationId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      // 7-year retention for legal compliance
      timeToLiveAttribute: 'ttl',
    });

    // GSI for user attestations
    this.attestationsTable.addGlobalSecondaryIndex({
      indexName: 'UserAttestationsIndex',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });

    // GSI for document attestations
    this.attestationsTable.addGlobalSecondaryIndex({
      indexName: 'DocumentAttestationsIndex',
      partitionKey: { name: 'documentId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
  }

  private createS3Buckets(removalPolicy: RemovalPolicy) {
    // Document Upload Bucket
    (this as any).documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `lfmt-documents-${this.stackName.toLowerCase()}`,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedOrigins: ['*'], // Restrict in production
        allowedHeaders: ['*'],
        maxAge: 3000,
      }],
      lifecycleRules: [{
        id: 'DocumentCleanup',
        enabled: true,
        expiration: Duration.days(90), // 90 days retention for source documents
        abortIncompleteMultipartUploadAfter: Duration.days(1),
        noncurrentVersionExpiration: Duration.days(30),
      }],
    });

    // Translation Results Bucket
    (this as any).resultsBucket = new s3.Bucket(this, 'ResultsBucket', {
      bucketName: `lfmt-results-${this.stackName.toLowerCase()}`,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      versioned: false,
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // Intelligent tiering will be configured via lifecycle rules instead
      lifecycleRules: [{
        id: 'ResultsCleanup',
        enabled: true,
        expiration: Duration.days(30), // 30 days retention for results
        transitions: [{
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: Duration.days(7),
        }, {
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: Duration.days(14),
        }],
      }],
    });
  }

  private createCognitoUserPool(removalPolicy: RemovalPolicy) {
    (this as any).userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `lfmt-users-${this.stackName}`,
      removalPolicy,
      signInCaseSensitive: false,
      signInAliases: {
        email: true,
      },
      selfSignUpEnabled: true,
      autoVerify: {
        email: true,
      },
      userVerification: {
        emailSubject: 'LFMT Account Verification',
        emailBody: 'Please verify your account by clicking the link: {##Verify Email##}',
        emailStyle: cognito.VerificationEmailStyle.LINK,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
        givenName: {
          required: true,
          mutable: true,
        },
        familyName: {
          required: true,
          mutable: true,
        },
      },
    });

    (this as any).userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool: this.userPool,
      userPoolClientName: `lfmt-client-${this.stackName}`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: true,
        adminUserPassword: true,
      },
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      preventUserExistenceErrors: true,
    });
  }

  private createApiGateway() {
    // Create API Gateway - From Document 3 (API Gateway & Lambda Functions)
    (this as any).api = new apigateway.RestApi(this, 'LfmtApi', {
      restApiName: `lfmt-api-${this.stackName}`,
      description: 'LFMT Translation Service API',
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS, // Restrict in production
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
      // Enable caching for polling endpoints
      deployOptions: {
        stageName: 'v1',
        cachingEnabled: true,
        cacheClusterEnabled: true,
        cacheClusterSize: '0.5',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
        methodOptions: {
          '/*/*': {
            cachingEnabled: true,
            cacheTtl: Duration.seconds(30), // 30-second cache for polling endpoints
          },
        },
      },
    });

    // Create API resources structure
    const authResource = this.api.root.addResource('auth');
    const jobsResource = this.api.root.addResource('jobs'); 
    const uploadResource = this.api.root.addResource('upload');
    const legalResource = this.api.root.addResource('legal');
    const claudeResource = this.api.root.addResource('claude');

    // Job-specific resources
    const jobResource = jobsResource.addResource('{jobId}');
    const progressResource = jobResource.addResource('progress');
    const statusResource = jobResource.addResource('status');

    // Add request validation
    const requestValidator = this.api.addRequestValidator('RequestValidator', {
      validateRequestBody: true,
      validateRequestParameters: true,
    });
  }

  private createLogGroups(removalPolicy: RemovalPolicy) {
    // API Gateway Logs
    new logs.LogGroup(this, 'ApiGatewayLogs', {
      logGroupName: `/aws/apigateway/lfmt-api-${this.stackName}`,
      removalPolicy,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Lambda Function Logs
    new logs.LogGroup(this, 'LambdaLogs', {
      logGroupName: `/aws/lambda/lfmt-${this.stackName}`,
      removalPolicy,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Step Functions Logs
    new logs.LogGroup(this, 'StepFunctionsLogs', {
      logGroupName: `/aws/stepfunctions/lfmt-${this.stackName}`,
      removalPolicy,
      retention: logs.RetentionDays.ONE_MONTH,
    });
  }

  private createIamRoles() {
    // Lambda Execution Role with required permissions
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      inlinePolicies: {
        DynamoDBAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:GetItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              resources: [
                this.jobsTable.tableArn,
                this.usersTable.tableArn,
                this.attestationsTable.tableArn,
                `${this.jobsTable.tableArn}/index/*`,
                `${this.usersTable.tableArn}/index/*`,
                `${this.attestationsTable.tableArn}/index/*`,
              ],
            }),
          ],
        }),
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              resources: [
                `${this.documentBucket.bucketArn}/*`,
                `${this.resultsBucket.bucketArn}/*`,
              ],
            }),
          ],
        }),
        CognitoAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-idp:AdminCreateUser',
                'cognito-idp:AdminSetUserPassword',
                'cognito-idp:AdminGetUser',
                'cognito-idp:AdminUpdateUserAttributes',
              ],
              resources: [this.userPool.userPoolArn],
            }),
          ],
        }),
      },
    });

    // Step Functions Execution Role
    const stepFunctionsRole = new iam.Role(this, 'StepFunctionsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        LambdaInvoke: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [`arn:aws:lambda:${this.region}:${this.account}:function:lfmt-*`],
            }),
          ],
        }),
      },
    });
  }

  private createOutputs() {
    // DynamoDB Table Names
    new CfnOutput(this, 'JobsTableName', {
      value: this.jobsTable.tableName,
      description: 'DynamoDB Jobs Table Name',
    });

    new CfnOutput(this, 'UsersTableName', {
      value: this.usersTable.tableName,
      description: 'DynamoDB Users Table Name',
    });

    new CfnOutput(this, 'AttestationsTableName', {
      value: this.attestationsTable.tableName,
      description: 'DynamoDB Attestations Table Name',
    });

    // S3 Bucket Names
    new CfnOutput(this, 'DocumentBucketName', {
      value: this.documentBucket.bucketName,
      description: 'S3 Document Upload Bucket Name',
    });

    new CfnOutput(this, 'ResultsBucketName', {
      value: this.resultsBucket.bucketName,
      description: 'S3 Results Bucket Name',
    });

    // Cognito Configuration
    new CfnOutput(this, 'UserPoolId', {
      value: this.userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new CfnOutput(this, 'UserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    // API Gateway
    new CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
    });

    new CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
    });
  }
}