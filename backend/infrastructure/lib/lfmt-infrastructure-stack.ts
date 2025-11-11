import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  CfnOutput,
  Lazy
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

// AWS Service Imports - grouped by service
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';

export interface LfmtInfrastructureStackProps extends StackProps {
  stackName: string;
  environment: string;
  enableLogging: boolean;
  retainData: boolean;
  skipLambdaBundling?: boolean;  // For testing purposes
}

export class LfmtInfrastructureStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly jobsTable: dynamodb.Table;
  public readonly usersTable: dynamodb.Table;
  public readonly attestationsTable: dynamodb.Table;
  public readonly documentBucket: s3.Bucket;
  public readonly resultsBucket: s3.Bucket;
  public readonly frontendBucket: s3.Bucket;
  public readonly api: apigateway.RestApi;
  public readonly frontendDistribution: cloudfront.Distribution;

  // Lambda functions
  private registerFunction?: lambda.Function;
  private loginFunction?: lambda.Function;
  private refreshTokenFunction?: lambda.Function;
  private resetPasswordFunction?: lambda.Function;
  private getCurrentUserFunction?: lambda.Function;
  private uploadRequestFunction?: lambda.Function;
  private uploadCompleteFunction?: lambda.Function;
  private chunkDocumentFunction?: lambda.Function;
  private translateChunkFunction?: lambda.Function;
  private startTranslationFunction?: lambda.Function;
  private getTranslationStatusFunction?: lambda.Function;

  // IAM role for Lambda functions
  private lambdaRole?: iam.Role;

  // Step Functions state machine
  public readonly translationStateMachine: stepfunctions.StateMachine;
  private readonly stateMachineArnPattern: string;

  // API Gateway resources
  private authResource?: apigateway.Resource;

  constructor(scope: Construct, id: string, props: LfmtInfrastructureStackProps) {
    super(scope, id, props);

    const { environment, enableLogging, retainData } = props;

    // Removal policy based on environment
    const removalPolicy = retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // Initialize state machine ARN pattern for IAM permissions
    // Use CDK Stack tokens instead of CloudFormation intrinsic functions for managed policies
    (this as any).stateMachineArnPattern = `arn:aws:states:${Stack.of(this).region}:${Stack.of(this).account}:stateMachine:lfmt-translation-workflow-${this.stackName}`;

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

    // 7. Step Functions State Machine
    this.createStepFunctions();

    // 8. Frontend Hosting (CloudFront + S3) - Create before API Gateway to get CloudFront URL for CORS
    this.createFrontendHosting(removalPolicy);

    // 9. API Gateway - Create after CloudFront to include CloudFront URL in CORS origins
    this.createApiGateway();

    // 9.5. Update CloudFront CSP with API Gateway URL (must be after API Gateway creation)
    this.updateCloudFrontCSP();

    // 10. API Gateway Endpoints
    this.createApiEndpoints();

    // 11. Outputs
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

    // Rate Limit Buckets Table - For distributed rate limiting across Lambda instances
    // Supports token bucket algorithm with atomic conditional writes
    (this as any).rateLimitBucketsTable = new dynamodb.Table(this, 'RateLimitBucketsTable', {
      tableName: `lfmt-rate-limit-buckets-${this.stackName}`,
      partitionKey: { name: 'bucketKey', type: dynamodb.AttributeType.STRING }, // e.g., "gemini-api-rpm", "gemini-api-tpm"
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // On-demand for variable rate limiter access
      removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      // Automatic cleanup of inactive buckets after 7 days
      timeToLiveAttribute: 'ttl',
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
        expiration: Duration.days(90), // 90 days retention for results
        transitions: [{
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: Duration.days(30), // AWS minimum for STANDARD_IA
        }, {
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: Duration.days(60), // Transition to Glacier after 60 days
        }],
      }],
    });
  }

  private createCognitoUserPool(removalPolicy: RemovalPolicy) {
    // Environment-specific email verification config
    // Dev: Disable to avoid Cognito SES email limits (50 emails/day)
    // Staging/Prod: Enable for security (requires custom SES setup)
    const isDev = this.stackName.includes('Dev');

    (this as any).userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `lfmt-users-${this.stackName}`,
      removalPolicy,
      signInCaseSensitive: false,
      signInAliases: {
        email: true,
      },
      selfSignUpEnabled: true,
      // Disable email verification in dev to avoid SES limits
      // Integration tests create many users, exhausting 50 email/day quota
      autoVerify: isDev ? {} : {
        email: true,
      },
      userVerification: isDev ? undefined : {
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

    // Add User Pool Domain (required for Cognito sign-up flow)
    // Create a simple hash from account ID to ensure uniqueness
    const accountHash = Buffer.from(this.account).toString('base64').toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 8);
    const userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool: this.userPool,
      cognitoDomain: {
        domainPrefix: `lfmt-${this.stackName.toLowerCase()}-${accountHash}`,
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

    // Export the domain for reference
    new CfnOutput(this, 'UserPoolDomainName', {
      value: userPoolDomain.domainName,
      description: 'Cognito User Pool Domain',
    });
  }

  private createApiGateway() {
    // Environment-specific CORS origins
    // NOTE: CloudFront URL will be added after createFrontendHosting() is called
    const getAllowedApiOrigins = () => {
      const origins = [];

      switch (this.node.tryGetContext('environment')) {
        case 'prod':
          origins.push('https://lfmt.yourcompany.com'); // Replace with actual production domain
          break;
        case 'staging':
          origins.push('https://staging.lfmt.yourcompany.com'); // Replace with actual staging domain
          break;
        default:
          origins.push('http://localhost:3000');
          origins.push('https://localhost:3000');
      }

      // Add CloudFront distribution URL if it exists (after createFrontendHosting() is called)
      if (this.frontendDistribution) {
        origins.push(`https://${this.frontendDistribution.distributionDomainName}`);
      }

      return origins;
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
          'X-Request-ID',
        ],
        allowCredentials: true,
      },
      // Caching is disabled to control costs. Throttling is retained for abuse protection.
      deployOptions: {
        stageName: 'v1',
        cachingEnabled: false,
        throttlingRateLimit: this.node.tryGetContext('environment') === 'prod' ? 1000 : 100,
        throttlingBurstLimit: this.node.tryGetContext('environment') === 'prod' ? 2000 : 200,
      },
    });

    // Create API resources structure
    this.authResource = this.api.root.addResource('auth');
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
    // IMPORTANT: Use separate managed policies instead of inline policies to avoid AWS IAM size limits
    this.lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // DynamoDB Access Policy (separate managed policy)
    const dynamoDbPolicy = new iam.ManagedPolicy(this, 'LambdaDynamoDBPolicy', {
      roles: [this.lambdaRole],
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
            (this as any).rateLimitBucketsTable.tableArn,
            `${this.jobsTable.tableArn}/index/*`,
            `${this.usersTable.tableArn}/index/*`,
            `${this.attestationsTable.tableArn}/index/*`,
          ],
        }),
      ],
    });

    // S3 Access Policy (separate managed policy)
    const s3Policy = new iam.ManagedPolicy(this, 'LambdaS3Policy', {
      roles: [this.lambdaRole],
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
    });

    // Cognito Access Policy (separate managed policy)
    const cognitoPolicy = new iam.ManagedPolicy(this, 'LambdaCognitoPolicy', {
      roles: [this.lambdaRole],
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
    });

    // Secrets Manager Access Policy (separate managed policy)
    const secretsPolicy = new iam.ManagedPolicy(this, 'LambdaSecretsPolicy', {
      roles: [this.lambdaRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'secretsmanager:GetSecretValue',
          ],
          resources: [
            `arn:aws:secretsmanager:${this.region}:${this.account}:secret:lfmt/gemini-api-key-*`,
          ],
        }),
      ],
    });

    // Lambda Invoke Access Policy (separate managed policy)
    const lambdaInvokePolicy = new iam.ManagedPolicy(this, 'LambdaInvokePolicy', {
      roles: [this.lambdaRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:InvokeFunction',
          ],
          resources: [
            `arn:aws:lambda:${this.region}:${this.account}:function:lfmt-*`,
          ],
        }),
      ],
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

    // Common environment variables for all Lambda functions
    const commonEnv = {
      COGNITO_CLIENT_ID: this.userPoolClient.userPoolClientId,
      COGNITO_USER_POOL_ID: this.userPool.userPoolId,
      ENVIRONMENT: this.stackName,
      JOBS_TABLE: this.jobsTable.tableName,
      JOBS_TABLE_NAME: this.jobsTable.tableName,
      USERS_TABLE_NAME: this.usersTable.tableName,
      ATTESTATIONS_TABLE_NAME: this.attestationsTable.tableName,
      RATE_LIMIT_BUCKETS_TABLE: (this as any).rateLimitBucketsTable.tableName,
      DOCUMENT_BUCKET: this.documentBucket.bucketName,
      CHUNKS_BUCKET: this.documentBucket.bucketName, // Chunks stored in same bucket as documents
      GEMINI_API_KEY_SECRET_NAME: `lfmt/gemini-api-key-${this.stackName}`,
      ALLOWED_ORIGIN: this.node.tryGetContext('environment') === 'prod'
        ? 'https://lfmt.yourcompany.com'
        : 'http://localhost:3000',
    };

    // Register Lambda Function - using NodejsFunction with local esbuild
    this.registerFunction = new NodejsFunction(this, 'RegisterFunction', {
      functionName: `lfmt-register-${this.stackName}`,
      entry: '../functions/auth/register.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'User registration with Cognito',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,  // Use local esbuild instead of Docker
      },
    });

    // Login Lambda Function
    this.loginFunction = new NodejsFunction(this, 'LoginFunction', {
      functionName: `lfmt-login-${this.stackName}`,
      entry: '../functions/auth/login.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'User login with Cognito',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Refresh Token Lambda Function
    this.refreshTokenFunction = new NodejsFunction(this, 'RefreshTokenFunction', {
      functionName: `lfmt-refresh-token-${this.stackName}`,
      entry: '../functions/auth/refreshToken.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Refresh JWT tokens',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Reset Password Lambda Function
    this.resetPasswordFunction = new NodejsFunction(this, 'ResetPasswordFunction', {
      functionName: `lfmt-reset-password-${this.stackName}`,
      entry: '../functions/auth/resetPassword.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Password reset via email',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Get Current User Lambda Function
    this.getCurrentUserFunction = new NodejsFunction(this, 'GetCurrentUserFunction', {
      functionName: `lfmt-get-current-user-${this.stackName}`,
      entry: '../functions/auth/getCurrentUser.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Get current user from access token',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Upload Request Lambda Function
    this.uploadRequestFunction = new NodejsFunction(this, 'UploadRequestFunction', {
      functionName: `lfmt-upload-request-${this.stackName}`,
      entry: '../functions/jobs/uploadRequest.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 512, // Increased memory for S3 operations
      description: 'Generate presigned URLs for document uploads',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Upload Complete Lambda Function (S3 event handler)
    this.uploadCompleteFunction = new NodejsFunction(this, 'UploadCompleteFunction', {
      functionName: `lfmt-upload-complete-${this.stackName}`,
      entry: '../functions/jobs/uploadComplete.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(60), // Longer timeout for validation and updates
      memorySize: 512,
      description: 'Process S3 upload completion events and update job status',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Document Chunking Lambda Function (S3 event handler)
    this.chunkDocumentFunction = new NodejsFunction(this, 'ChunkDocumentFunction', {
      functionName: `lfmt-chunk-document-${this.stackName}`,
      entry: '../functions/chunking/chunkDocument.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.minutes(5), // 5 minutes for large document processing
      memorySize: 1024, // 1GB for chunking large documents
      description: 'Process uploaded documents and create chunks for translation',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Translate Chunk Lambda Function (processes individual chunks)
    this.translateChunkFunction = new NodejsFunction(this, 'TranslateChunkFunction', {
      functionName: `lfmt-translate-chunk-${this.stackName}`,
      entry: '../functions/translation/translateChunk.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: {
        ...commonEnv,
        TRANSLATE_CHUNK_FUNCTION_NAME: `lfmt-translate-chunk-${this.stackName}`, // Self-reference for recursive calls
      },
      timeout: Duration.minutes(2), // 2 minutes for Gemini API call with retries
      memorySize: 512,
      description: 'Translate individual document chunks using Gemini API',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Start Translation Lambda Function (initiates translation process)
    this.startTranslationFunction = new NodejsFunction(this, 'StartTranslationFunction', {
      functionName: `lfmt-start-translation-${this.stackName}`,
      entry: '../functions/jobs/startTranslation.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: {
        ...commonEnv,
        TRANSLATE_CHUNK_FUNCTION_NAME: `lfmt-translate-chunk-${this.stackName}`,
        STATE_MACHINE_NAME: `lfmt-translation-workflow-${this.stackName}`, // Pass name instead of ARN
      },
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Start translation process for a chunked document',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Get Translation Status Lambda Function (returns translation progress)
    this.getTranslationStatusFunction = new NodejsFunction(this, 'GetTranslationStatusFunction', {
      functionName: `lfmt-get-translation-status-${this.stackName}`,
      entry: '../functions/jobs/getTranslationStatus.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: this.lambdaRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Get translation status and progress for a job',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
    });

    // Add S3 event notification for upload completion
    this.documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.uploadCompleteFunction),
      {
        prefix: 'uploads/',
        suffix: '.txt',
      }
    );

    // Add S3 event notification for document chunking
    // This triggers after uploadComplete moves files from uploads/ to documents/
    this.documentBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(this.chunkDocumentFunction),
      {
        prefix: 'documents/',
        suffix: '.txt',
      }
    );
  }

  private createStepFunctions() {
    if (!this.translateChunkFunction) {
      throw new Error('Translate chunk function must be created before Step Functions');
    }

    /**
     * Step Functions State Machine for Translation Workflow
     *
     * Architecture: Sequential chunk translation with context continuity
     *
     * Flow:
     * 1. Initialize translation (mark job as IN_PROGRESS)
     * 2. Load job metadata from DynamoDB
     * 3. Map state - iterate through all chunks sequentially
     * 4. For each chunk:
     *    - Invoke translateChunk Lambda
     *    - Lambda handles rate limiting internally
     *    - Update progress in DynamoDB
     * 5. Mark job as COMPLETED or FAILED
     *
     * Error Handling:
     * - Retry transient failures (rate limits, API errors)
     * - Fail job on non-retryable errors
     * - Catch-all for unexpected failures
     */

    // Define the Translate Chunk task with retry logic
    const translateChunkTask = new tasks.LambdaInvoke(this, 'TranslateChunkTask', {
      lambdaFunction: this.translateChunkFunction,
      // Input: { jobId, chunkIndex, targetLanguage, tone, contextChunks }
      payload: stepfunctions.TaskInput.fromObject({
        jobId: stepfunctions.JsonPath.stringAt('$.jobId'),
        chunkIndex: stepfunctions.JsonPath.numberAt('$.chunkIndex'),
        targetLanguage: stepfunctions.JsonPath.stringAt('$.targetLanguage'),
        tone: stepfunctions.JsonPath.stringAt('$.tone'),
        contextChunks: stepfunctions.JsonPath.numberAt('$.contextChunks'),
      }),
      resultPath: '$.translateResult',
      retryOnServiceExceptions: true,
    });

    // Add retry logic for transient failures
    translateChunkTask.addRetry({
      errors: [
        'Lambda.ServiceException',
        'Lambda.TooManyRequestsException',
        'States.TaskFailed', // Retryable errors from Lambda (rate limits, etc.)
      ],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0, // Exponential backoff: 2s, 4s, 8s
    });

    // Add catch for non-retryable errors
    const failState = new stepfunctions.Fail(this, 'TranslationFailed', {
      comment: 'Translation failed - non-retryable error',
    });

    translateChunkTask.addCatch(failState, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // Map state to process all chunks in parallel
    const processChunksMap = new stepfunctions.Map(this, 'ProcessChunksMap', {
      maxConcurrency: 10, // Parallel processing with distributed rate limiting
      itemsPath: stepfunctions.JsonPath.stringAt('$.chunks'),
      parameters: {
        'jobId.$': '$.jobId',
        'chunkIndex.$': '$$.Map.Item.Value.chunkIndex',
        'targetLanguage.$': '$.targetLanguage',
        'tone.$': '$.tone',
        'contextChunks.$': '$.contextChunks',
      },
      resultPath: '$.translationResults',
    });

    processChunksMap.iterator(translateChunkTask);

    // Update job status to COMPLETED
    const updateJobCompleted = new tasks.DynamoUpdateItem(this, 'UpdateJobCompleted', {
      table: this.jobsTable,
      key: {
        jobId: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.jobId')),
        userId: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.userId')),
      },
      updateExpression: 'SET translationStatus = :status, completedAt = :completedAt',
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('COMPLETED'),
        ':completedAt': tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    // Success state
    const successState = new stepfunctions.Succeed(this, 'TranslationSuccess', {
      comment: 'All chunks translated successfully',
    });

    // Define the state machine workflow
    const definition = processChunksMap
      .next(updateJobCompleted)
      .next(successState);

    // Create the state machine
    (this as any).translationStateMachine = new stepfunctions.StateMachine(this, 'TranslationStateMachine', {
      stateMachineName: `lfmt-translation-workflow-${this.stackName}`,
      definition,
      timeout: Duration.hours(6), // Max 6 hours for large documents (400K words)
      logs: {
        destination: new logs.LogGroup(this, 'TranslationStateMachineLogGroup', {
          logGroupName: `/aws/stepfunctions/lfmt-translation-${this.stackName}`,
          removalPolicy: RemovalPolicy.DESTROY,
          retention: logs.RetentionDays.ONE_WEEK,
        }),
        level: stepfunctions.LogLevel.ALL,
        includeExecutionData: true,
      },
      tracingEnabled: true,
    });

    // Grant the state machine permission to invoke the Lambda function
    this.translateChunkFunction.grantInvoke(this.translationStateMachine);

    // Grant the state machine permission to update DynamoDB
    this.jobsTable.grantReadWriteData(this.translationStateMachine);

    // Grant startTranslation Lambda permission to start state machine executions
    // Use separate managed policy to avoid IAM policy size limits
    new iam.ManagedPolicy(this, 'LambdaStepFunctionsPolicy', {
      roles: [this.lambdaRole!],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['states:StartExecution'],
          resources: [this.stateMachineArnPattern],
        }),
      ],
    });
  }

  private createApiEndpoints() {
    if (!this.registerFunction || !this.loginFunction || !this.refreshTokenFunction || !this.resetPasswordFunction || !this.getCurrentUserFunction || !this.uploadRequestFunction || !this.startTranslationFunction || !this.getTranslationStatusFunction) {
      throw new Error('Lambda functions must be created before API endpoints');
    }

    if (!this.authResource) {
      throw new Error('Auth resource must be created before API endpoints');
    }

    // Use existing /auth resource created in createApiGateway()
    const auth = this.authResource;

    // POST /auth/register - Register
    const register = auth.addResource('register');
    register.addMethod('POST', new apigateway.LambdaIntegration(this.registerFunction), {
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

    // GET /auth/me - Get Current User (requires valid access token)
    const me = auth.addResource('me');
    me.addMethod('GET', new apigateway.LambdaIntegration(this.getCurrentUserFunction), {
      authorizationType: apigateway.AuthorizationType.NONE,
      requestValidator: new apigateway.RequestValidator(this, 'GetCurrentUserRequestValidator', {
        restApi: this.api,
        requestValidatorName: 'get-current-user-validator',
        validateRequestBody: false,
        validateRequestParameters: false,
      }),
    });

    // POST /jobs/upload - Request Upload URL (requires authentication)
    const jobsResource = this.api.root.resourceForPath('jobs');
    const uploadResource = jobsResource.addResource('upload', {
      defaultCorsPreflightOptions: {
        allowOrigins: this.node.tryGetContext('environment') === 'prod'
          ? ['https://lfmt.yourcompany.com']
          : ['http://localhost:3000', 'https://localhost:3000'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Request-ID',
        ],
        allowCredentials: true,
      },
    });

    // Create Cognito authorizer for protected endpoints
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
      identitySource: 'method.request.header.Authorization',
      authorizerName: 'cognito-authorizer',
    });

    uploadResource.addMethod('POST', new apigateway.LambdaIntegration(this.uploadRequestFunction), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
      requestValidator: new apigateway.RequestValidator(this, 'UploadRequestValidator', {
        restApi: this.api,
        requestValidatorName: 'upload-request-validator',
        validateRequestBody: true,
        validateRequestParameters: false,
      }),
    });

    // POST /jobs/{jobId}/translate - Start Translation (requires authentication)
    // Use existing /jobs/{jobId} resource created in createApiGateway()
    const jobResource = jobsResource.resourceForPath('{jobId}');

    const translateResource = jobResource.addResource('translate', {
      defaultCorsPreflightOptions: {
        allowOrigins: this.node.tryGetContext('environment') === 'prod'
          ? ['https://lfmt.yourcompany.com']
          : ['http://localhost:3000', 'https://localhost:3000'],
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Request-ID',
        ],
        allowCredentials: true,
      },
    });
    translateResource.addMethod('POST', new apigateway.LambdaIntegration(this.startTranslationFunction), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
      requestValidator: new apigateway.RequestValidator(this, 'StartTranslationValidator', {
        restApi: this.api,
        requestValidatorName: 'start-translation-validator',
        validateRequestBody: true,
        validateRequestParameters: false,
      }),
    });

    // GET /jobs/{jobId}/translation-status - Get Translation Status (requires authentication)
    const translationStatusResource = jobResource.addResource('translation-status', {
      defaultCorsPreflightOptions: {
        allowOrigins: this.node.tryGetContext('environment') === 'prod'
          ? ['https://lfmt.yourcompany.com']
          : ['http://localhost:3000', 'https://localhost:3000'],
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Request-ID',
        ],
        allowCredentials: true,
      },
    });
    translationStatusResource.addMethod('GET', new apigateway.LambdaIntegration(this.getTranslationStatusFunction), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
    });

    // Add Gateway Responses to include CORS headers on errors
    const allowedOrigins = this.node.tryGetContext('environment') === 'prod'
      ? 'https://lfmt.yourcompany.com'
      : 'http://localhost:3000';

    // Add CORS headers to 401 Unauthorized responses
    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
        'Access-Control-Allow-Credentials': "'true'",
      },
    });

    // Add CORS headers to 403 Forbidden responses
    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
        'Access-Control-Allow-Credentials': "'true'",
      },
    });

    // Add CORS headers to 400 Bad Request responses
    this.api.addGatewayResponse('BadRequestBody', {
      type: apigateway.ResponseType.BAD_REQUEST_BODY,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
        'Access-Control-Allow-Credentials': "'true'",
      },
    });

    // Add CORS headers to 500 Internal Server Error responses
    this.api.addGatewayResponse('DefaultServerError', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': `'${allowedOrigins}'`,
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
        'Access-Control-Allow-Credentials': "'true'",
      },
    });
  }

  private createFrontendHosting(removalPolicy: RemovalPolicy) {
    /**
     * Frontend Hosting Infrastructure
     * 
     * Creates CloudFront distribution and S3 bucket for hosting React SPA.
     * 
     * Key Features:
     * - Origin Access Control (OAC) for secure S3 access
     * - Custom error responses for SPA routing (403 + 404 → /index.html)
     * - Security headers (HSTS, CSP, X-Frame-Options, etc.)
     * - Environment-specific configuration (dev vs prod)
     * - HTTPS-only viewer protocol
     */

    // 1. Create Frontend S3 Bucket
    (this as any).frontendBucket = new s3.Bucket(this, 'FrontendBucket', {
      bucketName: `lfmt-frontend-${this.stackName.toLowerCase()}`,
      removalPolicy,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [{
        id: 'FrontendCleanup',
        enabled: true,
        expiration: Duration.days(90), // Delete old deployments after 90 days
        noncurrentVersionExpiration: Duration.days(30),
      }],
    });

    // 2. Create Origin Access Control (OAC) for CloudFront
    const oac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // 3. Create CloudFront Distribution
    const environment = this.node.tryGetContext('environment');
    const isProd = environment === 'prod';

    // Environment-specific configuration
    const priceClass = isProd 
      ? cloudfront.PriceClass.PRICE_CLASS_ALL  // Global edge locations for production
      : cloudfront.PriceClass.PRICE_CLASS_100; // North America & Europe only for dev (cost-optimized)

    // Create Response Headers Policy with security headers
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'FrontendSecurityHeaders', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: {
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: {
          // NOTE: This CSP will be updated after API Gateway is created to include the actual API URL
          // Temporary CSP allows connections to execute-api.us-east-1.amazonaws.com domain
          contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.execute-api.us-east-1.amazonaws.com;",
          override: true,
        },
      },
    });

    (this as any).frontendDistribution = new cloudfront.Distribution(this, 'FrontendDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.frontendBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        compress: true,
        responseHeadersPolicy: responseHeadersPolicy,
      },
      defaultRootObject: 'index.html',
      priceClass,
      enableIpv6: true,
      errorResponses: [
        {
          // Handle S3 403 Forbidden for non-existent objects (restricted bucket)
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
        {
          // Handle S3 404 Not Found (rare case with certain bucket configurations)
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(5),
        },
      ],
      comment: `LFMT Frontend Distribution - ${this.stackName}`,
      enableLogging: isProd, // Enable access logging for production
      logBucket: isProd ? new s3.Bucket(this, 'CloudFrontLogBucket', {
        bucketName: `lfmt-cloudfront-logs-${this.stackName.toLowerCase()}`,
        removalPolicy,
        autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
        lifecycleRules: [{
          expiration: Duration.days(90),
        }],
      }) : undefined,
    });

    // 4. Grant CloudFront OAC access to frontend bucket
    this.frontendBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${this.frontendBucket.bucketArn}/*`],
      principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
      conditions: {
        StringEquals: {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.frontendDistribution.distributionId}`,
        },
      },
    }));
  }

  private updateCloudFrontCSP() {
    /**
     * Update CloudFront CSP with API Gateway URL
     *
     * This method is called after API Gateway is created to update the CSP
     * with the actual API Gateway URL instead of using wildcards.
     *
     * NOTE: CloudFront distributions cannot be modified after creation for certain properties,
     * so we update the response headers policy's CSP to include the specific API Gateway domain.
     */

    if (!this.api) {
      throw new Error('API Gateway must be created before updating CloudFront CSP');
    }

    // Get the API Gateway domain (e.g., "8brwlwf68h.execute-api.us-east-1.amazonaws.com")
    const apiDomain = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;

    // Create a new Response Headers Policy with the updated CSP
    const updatedResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(this, 'FrontendSecurityHeadersUpdated', {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: {
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
        xssProtection: {
          protection: true,
          modeBlock: true,
          override: true,
        },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        contentSecurityPolicy: {
          // Use specific API Gateway domain instead of wildcard
          contentSecurityPolicy: `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://${apiDomain};`,
          override: true,
        },
      },
    });

    // Update the CloudFront distribution's default behavior to use the new response headers policy
    // Note: We need to access the L1 CloudFormation construct to update this property
    const cfnDistribution = this.frontendDistribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride('DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId', updatedResponseHeadersPolicy.responseHeadersPolicyId);
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

    // Frontend Hosting (CloudFront + S3)
    new CfnOutput(this, 'FrontendBucketName', {
      value: this.frontendBucket.bucketName,
      description: 'S3 Frontend Hosting Bucket Name',
    });

    new CfnOutput(this, 'CloudFrontDistributionId', {
      value: this.frontendDistribution.distributionId,
      description: 'CloudFront Distribution ID',
    });

    new CfnOutput(this, 'CloudFrontDistributionDomain', {
      value: this.frontendDistribution.distributionDomainName,
      description: 'CloudFront Distribution Domain',
    });

    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${this.frontendDistribution.distributionDomainName}`,
      description: 'Frontend Application URL',
    });

    // Step Functions State Machine
    if (this.translationStateMachine) {
      new CfnOutput(this, 'TranslationStateMachineArn', {
        value: this.translationStateMachine.stateMachineArn,
        description: 'Translation Workflow State Machine ARN',
      });

      new CfnOutput(this, 'TranslationStateMachineName', {
        value: this.translationStateMachine.stateMachineName,
        description: 'Translation Workflow State Machine Name',
      });
    }
  }
}