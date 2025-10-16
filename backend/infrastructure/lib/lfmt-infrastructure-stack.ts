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

  // Lambda functions
  private registerFunction?: lambda.Function;
  private loginFunction?: lambda.Function;
  private refreshTokenFunction?: lambda.Function;
  private resetPasswordFunction?: lambda.Function;

  // IAM role for Lambda functions
  private lambdaRole?: iam.Role;

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

    // 4. CloudWatch Log Groups
    if (enableLogging) {
      this.createLogGroups(removalPolicy);
    }

    // 5. IAM Roles and Policies
    this.createIamRoles();

    // 6. Lambda Functions
    this.createLambdaFunctions();

    // 7. API Gateway
    this.createApiGateway();

    // 8. API Gateway Endpoints
    this.createApiEndpoints();

    // 9. Outputs
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
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
    // Environment-specific CORS origins
    const getAllowedOrigins = () => {
      switch (this.node.tryGetContext('environment')) {
        case 'prod':
          return ['https://lfmt.yourcompany.com']; // Replace with actual production domain
        case 'staging':
          return ['https://staging.lfmt.yourcompany.com']; // Replace with actual staging domain
        default:
          return ['http://localhost:3000', 'https://localhost:3000']; // Development origins
      }
    };

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
        allowedOrigins: getAllowedOrigins(),
        allowedHeaders: ['Content-Type', 'x-amz-date', 'Authorization', 'x-api-key', 'x-amz-security-token'],
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
      // Intelligent tiering can be enabled via AWS console or CLI post-deployment
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
    // Environment-specific CORS origins
    const getAllowedApiOrigins = () => {
      switch (this.node.tryGetContext('environment')) {
        case 'prod':
          return ['https://lfmt.yourcompany.com']; // Replace with actual production domain
        case 'staging':
          return ['https://staging.lfmt.yourcompany.com']; // Replace with actual staging domain
        default:
          return ['http://localhost:3000', 'https://localhost:3000']; // Development origins
      }
    };

    // Create API Gateway - From Document 3 (API Gateway & Lambda Functions)
    (this as any).api = new apigateway.RestApi(this, 'LfmtApi', {
      restApiName: `lfmt-api-${this.stackName}`,
      description: 'LFMT Translation Service API',
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      defaultCorsPreflightOptions: {
        allowOrigins: getAllowedApiOrigins(),
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
      // Enable caching for polling endpoints
      deployOptions: {
        stageName: 'v1',
        cachingEnabled: true,
        cacheClusterEnabled: true,
        cacheClusterSize: '0.5',
        throttlingRateLimit: this.node.tryGetContext('environment') === 'prod' ? 1000 : 100,
        throttlingBurstLimit: this.node.tryGetContext('environment') === 'prod' ? 2000 : 200,
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
    // Determine log retention based on environment
    const logRetention = this.node.tryGetContext('environment') === 'prod' 
      ? logs.RetentionDays.SIX_MONTHS 
      : logs.RetentionDays.ONE_MONTH;

    // API Gateway Logs
    new logs.LogGroup(this, 'ApiGatewayLogs', {
      logGroupName: `/aws/apigateway/lfmt-api-${this.stackName}`,
      removalPolicy,
      retention: logRetention,
    });

    // Lambda Function Logs
    new logs.LogGroup(this, 'LambdaLogs', {
      logGroupName: `/aws/lambda/lfmt-${this.stackName}`,
      removalPolicy,
      retention: logRetention,
    });

    // Step Functions Logs
    new logs.LogGroup(this, 'StepFunctionsLogs', {
      logGroupName: `/aws/stepfunctions/lfmt-${this.stackName}`,
      removalPolicy,
      retention: logRetention,
    });

    // Security Audit Logs
    new logs.LogGroup(this, 'SecurityAuditLogs', {
      logGroupName: `/aws/security/lfmt-${this.stackName}`,
      removalPolicy,
      retention: this.node.tryGetContext('environment') === 'prod' 
        ? logs.RetentionDays.ONE_YEAR 
        : logs.RetentionDays.THREE_MONTHS,
    });
  }

  private createIamRoles() {
    // Lambda Execution Role with required permissions
    this.lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
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
                'cognito-idp:SignUp',
                'cognito-idp:InitiateAuth',
                'cognito-idp:ForgotPassword',
                'cognito-idp:ConfirmForgotPassword',
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

  private createLambdaFunctions() {
    if (!this.lambdaRole) {
      throw new Error('Lambda role must be created before Lambda functions');
    }

    // Common environment variables for all auth Lambda functions
    const commonEnv = {
      COGNITO_CLIENT_ID: this.userPoolClient.userPoolClientId,
      COGNITO_USER_POOL_ID: this.userPool.userPoolId,
      ENVIRONMENT: this.stackName,
      JOBS_TABLE_NAME: this.jobsTable.tableName,
      USERS_TABLE_NAME: this.usersTable.tableName,
      ATTESTATIONS_TABLE_NAME: this.attestationsTable.tableName,
      ALLOWED_ORIGIN: this.node.tryGetContext('environment') === 'prod'
        ? 'https://lfmt.yourcompany.com'
        : 'http://localhost:3000',
    };

    // Register Lambda Function
    this.registerFunction = new lambda.Function(this, 'RegisterFunction', {
      functionName: `lfmt-register-${this.stackName}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'auth/register.handler',
      code: lambda.Code.fromAsset('../functions', {
        bundling: {
          image: lambda.Runtime.NODEJS_18_X.bundlingImage,
          command: [
            'bash', '-c',
            'npm install && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
          ],
        },
      }),
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'User registration with Cognito',
    });

    // Login Lambda Function
    this.loginFunction = new lambda.Function(this, 'LoginFunction', {
      functionName: `lfmt-login-${this.stackName}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'auth/login.handler',
      code: lambda.Code.fromAsset('../functions', {
        bundling: {
          image: lambda.Runtime.NODEJS_18_X.bundlingImage,
          command: [
            'bash', '-c',
            'npm install && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
          ],
        },
      }),
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'User login with Cognito',
    });

    // Refresh Token Lambda Function
    this.refreshTokenFunction = new lambda.Function(this, 'RefreshTokenFunction', {
      functionName: `lfmt-refresh-token-${this.stackName}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'auth/refreshToken.handler',
      code: lambda.Code.fromAsset('../functions', {
        bundling: {
          image: lambda.Runtime.NODEJS_18_X.bundlingImage,
          command: [
            'bash', '-c',
            'npm install && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
          ],
        },
      }),
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Refresh JWT tokens',
    });

    // Reset Password Lambda Function
    this.resetPasswordFunction = new lambda.Function(this, 'ResetPasswordFunction', {
      functionName: `lfmt-reset-password-${this.stackName}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'auth/resetPassword.handler',
      code: lambda.Code.fromAsset('../functions', {
        bundling: {
          image: lambda.Runtime.NODEJS_18_X.bundlingImage,
          command: [
            'bash', '-c',
            'npm install && npm run build && cp -r dist/* /asset-output/ && cp -r node_modules /asset-output/',
          ],
        },
      }),
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Password reset via email',
    });
  }

  private createApiEndpoints() {
    if (!this.registerFunction || !this.loginFunction || !this.refreshTokenFunction || !this.resetPasswordFunction) {
      throw new Error('Lambda functions must be created before API endpoints');
    }

    // Create /auth resource
    const auth = this.api.root.addResource('auth');

    // POST /auth - Register
    auth.addMethod('POST', new apigateway.LambdaIntegration(this.registerFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestValidator: new apigateway.RequestValidator(this, 'RegisterRequestValidator', {
        restApi: this.api,
        requestValidatorName: 'register-validator',
        validateRequestBody: true,
        validateRequestParameters: false,
      }),
    });

    // POST /auth/login - Login
    const login = auth.addResource('login');
    login.addMethod('POST', new apigateway.LambdaIntegration(this.loginFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestValidator: new apigateway.RequestValidator(this, 'LoginRequestValidator', {
        restApi: this.api,
        requestValidatorName: 'login-validator',
        validateRequestBody: true,
        validateRequestParameters: false,
      }),
    });

    // POST /auth/refresh - Refresh Token
    const refresh = auth.addResource('refresh');
    refresh.addMethod('POST', new apigateway.LambdaIntegration(this.refreshTokenFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestValidator: new apigateway.RequestValidator(this, 'RefreshTokenRequestValidator', {
        restApi: this.api,
        requestValidatorName: 'refresh-token-validator',
        validateRequestBody: true,
        validateRequestParameters: false,
      }),
    });

    // POST /auth/reset-password - Reset Password
    const resetPassword = auth.addResource('reset-password');
    resetPassword.addMethod('POST', new apigateway.LambdaIntegration(this.resetPasswordFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestValidator: new apigateway.RequestValidator(this, 'ResetPasswordRequestValidator', {
        restApi: this.api,
        requestValidatorName: 'reset-password-validator',
        validateRequestBody: true,
        validateRequestParameters: false,
      }),
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