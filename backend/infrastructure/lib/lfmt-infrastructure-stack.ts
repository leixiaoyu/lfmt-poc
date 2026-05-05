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
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

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
  public readonly translationApiKeySecret: secretsmanager.Secret;

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

  // API Gateway resources
  private authResource?: apigateway.Resource;

  /**
   * Get allowed API origins for CORS configuration
   * Returns array of allowed origins including localhost and CloudFront URL
   */
  private getAllowedApiOrigins(): string[] {
    const origins: string[] = [];

    switch (this.node.tryGetContext('environment')) {
      case 'prod':
        origins.push('https://lfmt.yourcompany.com'); // Replace with actual production domain
        break;
      case 'staging':
        origins.push('https://staging.lfmt.yourcompany.com'); // Replace with actual staging domain
        break;
      default:
        // Dev environment: local development + CDK-managed CloudFront
        origins.push('http://localhost:3000');
        origins.push('https://localhost:3000');
        origins.push('https://d39xcun7144jgl.cloudfront.net'); // CDK-managed CloudFront distribution
    }

    // Add CloudFront distribution URL if it exists (after createFrontendHosting() is called)
    if (this.frontendDistribution) {
      origins.push(`https://${this.frontendDistribution.distributionDomainName}`);
    }

    return origins;
  }

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

    // 4. Secrets Manager - Create translation API key secret
    this.createSecretsManagerResources(removalPolicy);

    // 5. CloudWatch Log Groups
    if (enableLogging) {
      this.createLogGroups(removalPolicy);
    }

    // 6. Frontend Hosting (CloudFront + S3) - Create early to get CloudFront URL for CORS
    this.createFrontendHosting(removalPolicy);

    // 7. IAM Roles and Policies
    this.createIamRoles();

    // 8. Lambda Functions - Created after CloudFront to include CloudFront URL in ALLOWED_ORIGINS
    this.createLambdaFunctions();

    // 9. Step Functions State Machine
    this.createStepFunctions();

    // 10. API Gateway - Create after CloudFront to include CloudFront URL in CORS origins
    this.createApiGateway();

    // 10.5. Update CloudFront CSP with API Gateway URL (must be after API Gateway creation)
    this.updateCloudFrontCSP();

    // 11. API Gateway Endpoints
    this.createApiEndpoints();

    // 12. Outputs
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
      versioned: true, // Enable versioning for data protection (Phase C3.3.2)
      encryption: s3.BucketEncryption.S3_MANAGED,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      // Cost-optimized storage lifecycle using manual transitions:
      // - First 30 days: STANDARD (frequent access for recent translations)
      // - Days 30-60: INFREQUENT_ACCESS (occasional retrieval)
      // - Days 60-90: GLACIER (archival, rare retrieval)
      // - After 90 days: Automatic deletion
      lifecycleRules: [
        {
          id: 'ResultsCleanup',
          enabled: true,
          expiration: Duration.days(90), // 90 days retention for results
          noncurrentVersionExpiration: Duration.days(30), // Clean up old versions after 30 days
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: Duration.days(30), // AWS minimum for STANDARD_IA
            },
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(60), // Transition to Glacier after 60 days
            },
          ],
        },
      ],
    });
  }

  private createCognitoUserPool(removalPolicy: RemovalPolicy) {
    // Environment-specific email verification config
    // Dev: Disable to avoid Cognito SES email limits (50 emails/day)
    // Staging/Prod: Enable for security (requires custom SES setup)
    const isDev = this.stackName.toLowerCase().includes('dev');

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

    // Add Pre-Signup Lambda trigger for dev environment
    // Auto-confirms users and verifies email to avoid SES limits
    if (isDev) {
      const preSignUpFunction = new lambda.Function(this, 'PreSignUpTrigger', {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline(`
          exports.handler = async (event) => {
            const isDev = process.env.ENVIRONMENT === 'dev';

            if (isDev) {
              // Auto-confirm user (skip email verification)
              event.response.autoConfirmUser = true;

              // Auto-verify email (set email_verified = true)
              event.response.autoVerifyEmail = true;
            }

            return event;
          };
        `),
        description: 'Auto-confirm users and verify email in dev environment',
        environment: {
          ENVIRONMENT: isDev ? 'dev' : 'prod',
        },
        logRetention: logs.RetentionDays.ONE_WEEK,
      });

      this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFunction);
    }

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

  private createSecretsManagerResources(removalPolicy: RemovalPolicy) {
    /**
     * Create Secrets Manager resources for sensitive configuration
     *
     * Creates a placeholder secret for the Gemini API key.
     * The secret value must be populated manually after deployment:
     *
     * aws secretsmanager put-secret-value \
     *   --secret-id lfmt/gemini-api-key-${STACK_NAME} \
     *   --secret-string "YOUR_GEMINI_API_KEY"
     *
     * This approach:
     * - Ensures the secret resource exists (IaC-managed)
     * - Avoids storing sensitive keys in code
     * - Follows security best practices
     */
    (this as any).translationApiKeySecret = new secretsmanager.Secret(
      this,
      'TranslationApiKeySecret',
      {
        secretName: `lfmt/gemini-api-key-${this.stackName}`,
        description: 'API Key for the translation service (Gemini)',
        removalPolicy,
      }
    );
  }

  private createApiGateway() {
    // Create API Gateway - From Document 3 (API Gateway & Lambda Functions)
    // NOTE: CloudFront URL will be included in CORS origins after createFrontendHosting() is called
    (this as any).api = new apigateway.RestApi(this, 'LfmtApi', {
      restApiName: `lfmt-api-${this.stackName}`,
      description: 'LFMT Translation Service API',
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
      defaultCorsPreflightOptions: {
        allowOrigins: this.getAllowedApiOrigins(),
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
    //
    // NOTE: All Lambda functions currently share this role for simplicity.
    // This follows least-privilege where possible:
    // - DynamoDB: Scoped to specific tables (no wildcards)
    // - S3: Scoped to specific buckets (no wildcards)
    // - Cognito: Scoped to specific User Pool (no wildcards)
    // - Secrets Manager: Scoped to lfmt/gemini-api-key-${this.stackName} (environment-specific, no wildcards)
    // - Lambda Invoke: Removed from Translation role (Step Functions invokes Lambda, not vice versa)
    //
    // Least Privilege Principle: Separate roles per Lambda function group
    // Function-specific permission requirements:
    // - Auth functions: Cognito + DynamoDB (users table)
    // - Upload functions: S3 + DynamoDB (jobs + attestations tables)
    // - Translation functions: S3 + DynamoDB (all tables) + Secrets Manager (no Lambda Invoke)
    // - Chunking functions: S3 + DynamoDB (jobs table)

    // ===================================================================
    // Role 1: Auth Lambda Functions Role
    // Permissions: Cognito + DynamoDB (users table only)
    // ===================================================================
    (this as any).authRole = new iam.Role(this, 'AuthLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for authentication Lambda functions (register, login, getCurrentUser, etc.)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Auth: Cognito Access
    new iam.ManagedPolicy(this, 'AuthCognitoPolicy', {
      roles: [(this as any).authRole],
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
            'cognito-idp:AdminConfirmSignUp',
          ],
          resources: [this.userPool.userPoolArn],
        }),
      ],
    });

    // Auth: DynamoDB Access (users + rate limit buckets tables only)
    // SECURITY: Scan removed - auth functions use GetItem/Query for specific records, not full table scans
    // SECURITY: DeleteItem removed - auth role doesn't delete users directly (handled via Cognito)
    new iam.ManagedPolicy(this, 'AuthDynamoDBPolicy', {
      roles: [(this as any).authRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:Query',
          ],
          resources: [
            this.usersTable.tableArn,
            (this as any).rateLimitBucketsTable.tableArn,
            `${this.usersTable.tableArn}/index/*`,
          ],
        }),
      ],
    });

    // ===================================================================
    // Role 2: Upload Lambda Functions Role
    // Permissions: S3 + DynamoDB (jobs + attestations tables)
    // ===================================================================
    (this as any).uploadRole = new iam.Role(this, 'UploadLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for upload Lambda functions (upload-request, upload-complete)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Upload: S3 Access
    new iam.ManagedPolicy(this, 'UploadS3Policy', {
      roles: [(this as any).uploadRole],
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
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [
            this.documentBucket.bucketArn,
            this.resultsBucket.bucketArn,
          ],
        }),
      ],
    });

    // Upload: DynamoDB Access (jobs + attestations + rate limit buckets tables)
    // SECURITY: Scan removed - upload uses Query on GSIs, not full table scans
    // SECURITY: DeleteItem removed - not used by upload functions
    new iam.ManagedPolicy(this, 'UploadDynamoDBPolicy', {
      roles: [(this as any).uploadRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:Query',
          ],
          resources: [
            this.jobsTable.tableArn,
            this.attestationsTable.tableArn,
            (this as any).rateLimitBucketsTable.tableArn,
            `${this.jobsTable.tableArn}/index/*`,
            `${this.attestationsTable.tableArn}/index/*`,
          ],
        }),
      ],
    });

    // ===================================================================
    // Role 3: Chunking Lambda Functions Role
    // Permissions: S3 + DynamoDB (jobs table)
    // ===================================================================
    (this as any).chunkingRole = new iam.Role(this, 'ChunkingLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for chunking Lambda function (chunk-document)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Chunking: S3 Access
    new iam.ManagedPolicy(this, 'ChunkingS3Policy', {
      roles: [(this as any).chunkingRole],
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
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [
            this.documentBucket.bucketArn,
            this.resultsBucket.bucketArn,
          ],
        }),
      ],
    });

    // Chunking: DynamoDB Access (jobs + rate limit buckets tables)
    // SECURITY: Scan removed - not used by chunking (uses GetItem with composite key)
    // SECURITY: DeleteItem removed - not used by chunking
    // SECURITY: Query removed - not used by chunking functions
    new iam.ManagedPolicy(this, 'ChunkingDynamoDBPolicy', {
      roles: [(this as any).chunkingRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
          ],
          resources: [
            this.jobsTable.tableArn,
            (this as any).rateLimitBucketsTable.tableArn,
            `${this.jobsTable.tableArn}/index/*`,
          ],
        }),
      ],
    });

    // ===================================================================
    // Role 4: Translation Lambda Functions Role
    // Permissions: S3 + DynamoDB (all tables) + Secrets Manager (no Lambda Invoke)
    // ===================================================================
    (this as any).translationRole = new iam.Role(this, 'TranslationLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for translation Lambda functions (translate-chunk, start-translation, get-translation-status)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Translation: S3 Access
    new iam.ManagedPolicy(this, 'TranslationS3Policy', {
      roles: [(this as any).translationRole],
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
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [
            this.documentBucket.bucketArn,
            this.resultsBucket.bucketArn,
          ],
        }),
      ],
    });

    // Translation: DynamoDB Access (all tables)
    // SECURITY: Scan removed - translation uses GetItem/Query, not full table scans
    // SECURITY: DeleteItem removed - translation doesn't delete records
    new iam.ManagedPolicy(this, 'TranslationDynamoDBPolicy', {
      roles: [(this as any).translationRole],
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:Query',
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

    // Translation: Secrets Manager Access
    // SECURITY: The Gemini API key secret is now CDK-managed (see createSecretsManagerResources).
    // grantRead() scopes the policy to this specific secret ARN, replacing the previous
    // manually-scoped ManagedPolicy. The secret value must still be populated out-of-band via:
    //   aws secretsmanager put-secret-value \
    //     --secret-id lfmt/gemini-api-key-${this.stackName} \
    //     --secret-string "YOUR_GEMINI_API_KEY"
    this.translationApiKeySecret.grantRead((this as any).translationRole);

    // SECURITY: Removed TranslationLambdaInvokePolicy
    // Translation functions do NOT invoke other Lambda functions directly
    // startTranslation invokes Step Functions (states:StartExecution), not Lambda

    // Maintain backward compatibility with legacy code that references this.lambdaRole
    // New deployments should use specific roles (authRole, uploadRole, chunkingRole, translationRole)
    this.lambdaRole = (this as any).translationRole; // Default to most permissive role for backward compatibility

    // Step Functions Execution Role
    // SECURITY: Changed wildcard to specific function (only translate-chunk is invoked by Step Functions)
    const stepFunctionsRole = new iam.Role(this, 'StepFunctionsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {
        LambdaInvoke: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['lambda:InvokeFunction'],
              resources: [`arn:aws:lambda:${this.region}:${this.account}:function:lfmt-translate-chunk-${this.stackName}`],
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

    // Get role references from IAM role creation (stored in this.lambdaRole context)
    // Each Lambda function uses the appropriate role based on its permission requirements
    const authRole = (this as any).authRole || this.lambdaRole;
    const uploadRole = (this as any).uploadRole || this.lambdaRole;
    const chunkingRole = (this as any).chunkingRole || this.lambdaRole;
    const translationRole = (this as any).translationRole || this.lambdaRole;

    // Common environment variables for all Lambda functions
    const commonEnv = {
      COGNITO_CLIENT_ID: this.userPoolClient.userPoolClientId,
      COGNITO_USER_POOL_ID: this.userPool.userPoolId,
      ENVIRONMENT: this.stackName,
      JOBS_TABLE: this.jobsTable.tableName,
      USERS_TABLE_NAME: this.usersTable.tableName,
      ATTESTATIONS_TABLE_NAME: this.attestationsTable.tableName,
      RATE_LIMIT_BUCKETS_TABLE: (this as any).rateLimitBucketsTable.tableName,
      DOCUMENT_BUCKET: this.documentBucket.bucketName,
      CHUNKS_BUCKET: this.documentBucket.bucketName, // Chunks stored in same bucket as documents
      GEMINI_API_KEY_SECRET_NAME: this.translationApiKeySecret.secretName,
      // Pass all allowed origins as comma-separated list (includes localhost + CloudFront URL)
      ALLOWED_ORIGINS: this.getAllowedApiOrigins().join(','),
    };

    // Register Lambda Function - using NodejsFunction with local esbuild
    this.registerFunction = new NodejsFunction(this, 'RegisterFunction', {
      functionName: `lfmt-register-${this.stackName}`,
      entry: '../functions/auth/register.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: authRole,
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
      role: authRole,
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
      role: authRole,
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
      role: authRole,
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
      role: authRole,
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
      role: uploadRole,
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
      role: uploadRole,
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
      role: chunkingRole,
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
      role: translationRole,
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
    // Note: STATE_MACHINE_NAME provided as env var; Lambda constructs full ARN dynamically to avoid circular dependency
    this.startTranslationFunction = new NodejsFunction(this, 'StartTranslationFunction', {
      functionName: `lfmt-start-translation-${this.stackName}`,
      entry: '../functions/jobs/startTranslation.ts',
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      role: translationRole,
      environment: {
        ...commonEnv,
        TRANSLATE_CHUNK_FUNCTION_NAME: `lfmt-translate-chunk-${this.stackName}`,
        // Pass state machine name only; Lambda constructs full ARN to avoid circular dependency
        STATE_MACHINE_NAME: `lfmt-translation-workflow-${this.stackName}`,
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
      role: translationRole,
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
      // Input: { jobId, userId, chunkIndex, targetLanguage, tone, contextChunks }
      payload: stepfunctions.TaskInput.fromObject({
        jobId: stepfunctions.JsonPath.stringAt('$.jobId'),
        userId: stepfunctions.JsonPath.stringAt('$.userId'),
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

    // NOTE (Issue #151): Failure handling lives on the Map state, NOT on the
    // iterator task. The previous design attached `addCatch(failState)` to the
    // inner `translateChunkTask` with `failState` defined OUTSIDE the iterator.
    // CDK synthesized this with the Catch handler scoped INSIDE the iteration,
    // which made each Lambda failure behave as a "successfully caught"
    // iteration result. The Map state then aggregated those caught failures as
    // if every chunk had succeeded, ran updateJobCompleted, and wrote
    // translationStatus=COMPLETED + progress=100% to DDB even when zero chunks
    // were translated (latent for ~30 days; surfaced by Track B demo capture).
    // The fix below catches at the Map level and routes to a real DDB writer
    // that records TRANSLATION_FAILED, so the UI sees the truth.

    // Map state to process all chunks in parallel
    // maxConcurrency can be configured per environment via CDK context:
    // - Dev: Lower concurrency (5) to conserve resources
    // - Staging: Match production (10) for testing
    // - Production: Higher concurrency (15-20) as we scale
    // Default: 10 (balanced for Gemini rate limits: 5 RPM per account)
    const maxConcurrency = this.node.tryGetContext('maxConcurrency') || 10;
    const processChunksMap = new stepfunctions.Map(this, 'ProcessChunksMap', {
      maxConcurrency,
      itemsPath: stepfunctions.JsonPath.stringAt('$.chunks'),
      parameters: {
        'jobId.$': '$.jobId',
        'userId.$': '$.userId',
        'chunkIndex.$': '$$.Map.Item.Value.chunkIndex',
        'targetLanguage.$': '$.targetLanguage',
        'tone.$': '$.tone',
        'contextChunks.$': '$.contextChunks',
      },
      resultPath: '$.translationResults',
    });

    processChunksMap.iterator(translateChunkTask);

    // Update job status to COMPLETED (fixed translatedChunks type bug).
    //
    // ISSUE #170: This task also writes the OUTER `status` field
    // (#status = :outerStatus = 'COMPLETED'). Two attributes need the
    // success update because they have separate lifecycles:
    //   - `translationStatus` — driven by Step Functions; the polling
    //     endpoint reads it for progress UI.
    //   - `status` (outer) — initialized at upload (UPLOADED → CHUNKED)
    //     and may be flipped to TRANSLATION_FAILED by the per-chunk
    //     Lambda's catch-all (translateChunk.ts updateJobStatus).
    // If a chunk Lambda fails non-retryably on attempt 1 then succeeds
    // on a Step Functions retry, the outer status stays on
    // TRANSLATION_FAILED forever — the frontend (TranslationDetail.tsx
    // branches on `job.status === 'TRANSLATION_FAILED'`) then misclassifies
    // the successful job as failed. Writing both fields here makes Step
    // Functions the single source of truth on terminal success, mirroring
    // PR #165's pattern for terminal failure (UpdateJobFailed below).
    //
    // `#status` is used because `status` is a DDB reserved word — the
    // ExpressionAttributeNames map below aliases it.
    const updateJobCompleted = new tasks.DynamoUpdateItem(this, 'UpdateJobCompleted', {
      table: this.jobsTable,
      key: {
        jobId: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.jobId')),
        userId: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.userId')),
      },
      updateExpression: 'SET translationStatus = :status, #status = :outerStatus, translationCompletedAt = :completedAt, translatedChunks = :totalChunks, updatedAt = :updatedAt',
      expressionAttributeNames: {
        '#status': 'status',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('COMPLETED'),
        // 'COMPLETED' is a member of shared-types/src/jobs.ts JobStatus union
        // and matches what frontend logic (TranslationDetail.tsx) expects on
        // terminal success.
        ':outerStatus': tasks.DynamoAttributeValue.fromString('COMPLETED'),
        ':completedAt': tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')),
        // CRITICAL FIX: DynamoDB NUMBER attributes in Step Functions MUST be provided as strings
        // Using States.Format() to convert the number result from States.ArrayLength() to a string
        ':totalChunks': tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt("States.Format('{}', States.ArrayLength($.chunks))")),
        ':updatedAt': tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    // Failure path (Issue #151): when the Map iterator throws after retries
    // are exhausted, OR when at least one chunk reports success=false (see
    // OMC-followup C1 + the AggregateChunkResults / CheckAllChunksSucceeded
    // states below), persist TRANSLATION_FAILED to DDB so the UI / polling
    // endpoints stop reporting a phantom-success.
    //
    // Bug B fix (post-PR-#176): UpdateJobFailed previously read $.error via
    // States.JsonToString($.error). That field only exists when the Map Catch
    // fires (resultPath='$.error'). When chunks return success:false and the
    // Choice gate routes here, $.error is absent — causing a States.Runtime
    // JsonPath-not-found error that prevents the DDB write entirely and leaves
    // translationStatus stuck on IN_PROGRESS in DDB. Fix: insert a
    // NormalizeFailureContext Pass state on the Choice path that synthesises
    // $.error from $.translationResults so UpdateJobFailed always has it.
    // The Map Catch path bypasses NormalizeFailureContext and already has $.error.
    //
    // OMC-followup C2 — dual-write `#status` (outer) in addition to
    // `translationStatus`. PR #176 added the dual-write to UpdateJobCompleted
    // (issue #170) but left UpdateJobFailed asymmetric; the same bug class
    // applies in reverse — without this, a transient success that later
    // fails terminally leaves the outer `status` field stuck on a stale
    // value (e.g., 'COMPLETED' from a hypothetical earlier write, or
    // 'IN_PROGRESS' from startTranslation). Mirror the dual-write so Step
    // Functions is the single source of truth on terminal lifecycle for
    // BOTH success and failure outcomes.
    const updateJobFailed = new tasks.DynamoUpdateItem(this, 'UpdateJobFailed', {
      table: this.jobsTable,
      key: {
        jobId: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.jobId')),
        userId: tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$.userId')),
      },
      updateExpression: 'SET translationStatus = :status, #status = :outerStatus, translationFailedAt = :failedAt, translationError = :error, updatedAt = :updatedAt',
      expressionAttributeNames: {
        // `status` is a DDB reserved word — alias matches UpdateJobCompleted.
        '#status': 'status',
      },
      expressionAttributeValues: {
        // 'TRANSLATION_FAILED' matches shared-types/src/jobs.ts (TranslationStatus union)
        // and the polling endpoint in backend/functions/jobs/getTranslationStatus.ts.
        ':status': tasks.DynamoAttributeValue.fromString('TRANSLATION_FAILED'),
        // OMC-followup C2: outer status mirrors translationStatus on terminal
        // failure (frontend TranslationDetail.tsx branches on `job.status`).
        ':outerStatus': tasks.DynamoAttributeValue.fromString('TRANSLATION_FAILED'),
        ':failedAt': tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')),
        // $.error is guaranteed to exist here — both entry paths set it:
        // 1. Map Catch path: resultPath='$.error' on processChunksMap.addCatch().
        // 2. Choice path (success:false): NormalizeFailureContext Pass state below
        //    synthesises $.error from $.translationResults before entering this task.
        ':error': tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt("States.JsonToString($.error)")),
        ':updatedAt': tasks.DynamoAttributeValue.fromString(stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: stepfunctions.JsonPath.DISCARD,
    });

    // NormalizeFailureContext: inserted between the Choice gate and UpdateJobFailed
    // on the success:false path. Synthesises $.error from $.translationResults
    // so UpdateJobFailed's States.JsonToString($.error) always resolves.
    // The Map Catch path goes DIRECTLY to updateJobFailed (bypassing this state)
    // because the Catch already sets $.error via resultPath.
    //
    // OMC-followup R2 — structured payload (was: raw translationResults dump).
    //
    // Previously this state set `error.$` = States.JsonToString($.translationResults),
    // which produced a stringified array of every chunk's full result as the
    // DDB `translationError` column value. That is semantically wrong: the
    // column is supposed to hold a *description of the failure*, not the
    // success/failure data of every chunk. It also bloats DDB rows
    // unnecessarily (each result includes tokensUsed, estimatedCost,
    // processingTimeMs, etc. — KB per chunk × N chunks).
    //
    // Step Functions ASL has NO native filter intrinsic
    // (States.ArrayFilter does not exist; only ArrayContains/ArrayLength/
    // ArrayPartition/ArrayUnique/ArrayGetItem/ArrayRange/Array are available).
    // To filter to "only failed chunks" we would need a Map substate, which
    // is too heavy for a normalizer that only runs once on the failure path.
    //
    // Pragmatic fix: produce a structured envelope with a `reason` discriminator,
    // a count, and the full `translationResults` (preserving forensic detail).
    // The DDB column type is now `{reason: string, failedCountUpperBound: number,
    // totalChunks: number, translationResults: Array<...>}` — readable,
    // queryable by reason, and explicit about the failure mode.
    //
    // Why keep `translationResults` rather than slim it down: ASL filtering
    // would require a substate (rejected as too heavy per the OMC review).
    // The forensic value of the per-chunk results outweighs the DDB row size
    // for the failure path (failures are rare; this is dead-letter queue
    // territory). Future work: if/when ASL adds States.ArrayFilter, replace
    // `translationResults.$` with a filtered subset (only failed chunks).
    const normalizeFailureContext = new stepfunctions.Pass(this, 'NormalizeFailureContext', {
      comment:
        'Bug B fix (R2 structured payload): when Choice gate routes here (success:false path), ' +
        '$.error is absent. Synthesise a structured failure envelope so UpdateJobFailed can always ' +
        'read $.error AND so the DDB translationError column holds a typed payload (reason + counts + ' +
        'forensic detail) rather than a raw dump of translationResults. Map Catch path bypasses ' +
        'this state because resultPath="$.error" already sets $.error.',
      parameters: {
        // R2: structured envelope.
        // - `reason`: stable discriminator (CHUNK_FAILURE) for downstream
        //   alerting / dashboards.
        // - `failedCountUpperBound` / `totalChunks`: counts derived via
        //   States.ArrayLength (the only quantitative ASL intrinsic we have
        //   without filter support). The exact failed count cannot be
        //   computed without filter support; we surface the upper bound and
        //   annotate intent in the field name so future readers don't
        //   misinterpret it as the exact failure count.
        // - `translationResults.$`: raw forensic detail, preserved verbatim
        //   so we don't lose information for triage.
        'reason': 'CHUNK_FAILURE',
        'failedCountUpperBound.$': 'States.ArrayLength($.translationResults)',
        'totalChunks.$': 'States.ArrayLength($.translationResults)',
        'translationResults.$': '$.translationResults',
      },
      resultPath: '$.error',
    });

    // Terminal failure state — must come after the DDB write so the execution
    // is marked FAILED in the Step Functions console / CloudWatch dashboards.
    const failedTerminal = new stepfunctions.Fail(this, 'TranslationFailed', {
      comment: 'Translation failed - one or more chunks failed after retries',
      cause: 'See translationError in the jobs table for the underlying error payload',
    });

    updateJobFailed.next(failedTerminal);

    // Catch on the Map state itself (NOT on the inner task — see Issue #151
    // note above). States.ALL covers Lambda errors, retries-exhausted, and
    // Map-internal failures; resultPath='$.error' makes the error JSON
    // available to the updateJobFailed task.
    processChunksMap.addCatch(updateJobFailed, {
      errors: ['States.ALL'],
      resultPath: '$.error',
    });

    // OMC-followup C1 (Issue #170 + round-2 OMC review
    // https://github.com/leixiaoyu/lfmt-poc/pull/176#issuecomment-4364585175):
    // gate UpdateJobCompleted so it only runs when EVERY chunk's translateChunk
    // Lambda returned `success: true`.
    //
    // Bug class: translateChunk.ts catches every error in its outer
    // try/catch and RETURNS `{ success: false, retryable }` instead of
    // throwing (translateChunk.ts:256-293). From Step Functions'
    // perspective the Lambda invocation is successful, so Map's
    // `addCatch(updateJobFailed, ...)` above NEVER fires on chunk-level
    // application failures — `addCatch` (and `addRetry`) only react to
    // THROWN errors, not to `{ success: false }` return payloads.
    // Without this Choice, any single failed chunk would still be
    // aggregated into a "successful" Map result, UpdateJobCompleted would
    // run, and the per-chunk Lambda's TRANSLATION_FAILED outer status
    // would be overwritten with COMPLETED — the exact phantom-success
    // bug PR #176's #170 fix was meant to prevent.
    //
    // Note on `retryable`: the field is currently a dead-letter signal
    // (no Step Functions construct reads it; addRetry only catches thrown
    // errors). Round-2 reviewer flagged the previous "rate-limit
    // soft-signal preserved" framing as misleading — keeping the
    // try/catch + `{ success: false }` contract avoids changing the
    // chunk handler's surface area, and the gate stays contained to
    // infra. If we ever want true rate-limit retries we'll need to
    // throw a typed error from translateChunk and add a matching
    // `addRetry` rule on the Map iterator.
    //
    // Why States.ArrayContains: it's the canonical ASL idiom — JSONPath
    // filter expressions aren't supported in Choice states. The wildcard
    // `$.translationResults[*].translateResult.Payload.success` projects
    // to a flat array of booleans (one per chunk) and ArrayContains
    // checks whether the literal `false` value appears anywhere; if it
    // does, route to UpdateJobFailed instead. Strict equality, no
    // object matching needed (object matching is NOT supported by the
    // operator).
    const aggregateChunkResults = new stepfunctions.Pass(this, 'AggregateChunkResults', {
      comment:
        'Compute anyChunkFailed = ArrayContains(translationResults[*].translateResult.Payload.success, false). ' +
        'Step Functions Map only catches THROWN errors; translateChunk returns success:false instead — without this aggregate, ' +
        'a Lambda that reported success:false would still flow into UpdateJobCompleted and overwrite TRANSLATION_FAILED with COMPLETED.',
      parameters: {
        'anyChunkFailed.$':
          'States.ArrayContains($.translationResults[*].translateResult.Payload.success, false)',
      },
      resultPath: '$.aggregate',
    });

    const checkAllChunksSucceeded = new stepfunctions.Choice(this, 'CheckAllChunksSucceeded', {
      comment:
        'If any chunk reported success:false, route to UpdateJobFailed. Otherwise proceed to UpdateJobCompleted. ' +
        'See AggregateChunkResults above for the rationale.',
    });

    // Success state
    const successState = new stepfunctions.Succeed(this, 'TranslationSuccess', {
      comment: 'All chunks translated successfully - hotfix v1',
    });

    // Wire the Choice rules. BooleanEquals against a Variable that holds
    // the result of the intrinsic above. true → failure path; otherwise
    // (default) → success path. This guarantees UpdateJobCompleted ONLY
    // runs when every chunk actually succeeded.
    //
    // Bug B fix: route anyChunkFailed=true through NormalizeFailureContext
    // BEFORE UpdateJobFailed so $.error is always populated (see comment above).
    normalizeFailureContext.next(updateJobFailed);
    checkAllChunksSucceeded
      .when(
        stepfunctions.Condition.booleanEquals('$.aggregate.anyChunkFailed', true),
        normalizeFailureContext
      )
      .otherwise(updateJobCompleted.next(successState));

    // Define the state machine workflow.
    // Map → AggregateChunkResults → CheckAllChunksSucceeded
    //   ├── (anyChunkFailed=true)  → NormalizeFailureContext → UpdateJobFailed → TranslationFailed
    //   └── (default)              → UpdateJobCompleted → TranslationSuccess
    // Map Catch (States.ALL) → UpdateJobFailed (directly; $.error set by Catch resultPath)
    const definition = processChunksMap
      .next(aggregateChunkResults)
      .next(checkAllChunksSucceeded);

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
        level: stepfunctions.LogLevel.ALL, // Restore to ALL for better debugging
        includeExecutionData: true, // Restore to true for complete execution logs
      },
      tracingEnabled: true,
    });

    // Grant the state machine permission to invoke the Lambda function
    this.translateChunkFunction.grantInvoke(this.translationStateMachine);

    // SECURITY: Grant minimal DynamoDB permissions to state machine
    // State machine only needs UpdateItem for the DynamoUpdateItem task
    // Avoid grantReadWriteData() which includes dangerous Scan and DeleteItem permissions
    //
    // SECURITY ANALYSIS: No additional condition keys needed because:
    // 1. State machine only updates jobs passed via execution input (jobId, userId)
    // 2. Execution is started by Lambda after validating user ownership
    // 3. No broad resource patterns - only updates specific job records
    // 4. Update expression is fixed (status fields only, no user data modification)
    this.jobsTable.grant(this.translationStateMachine, 'dynamodb:UpdateItem');

    // Grant startTranslation Lambda permission to start state machine executions
    // SECURITY: Use CDK reference instead of hardcoded ARN string
    if (this.lambdaRole) {
      new iam.ManagedPolicy(this, 'LambdaStepFunctionsPolicy', {
        roles: [this.lambdaRole],
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              'states:StartExecution',
            ],
            resources: [
              this.translationStateMachine.stateMachineArn
            ],
          }),
        ],
      });
    }
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

    // Create Cognito authorizer for protected endpoints
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [this.userPool],
      identitySource: 'method.request.header.Authorization',
      authorizerName: 'cognito-authorizer',
    });

    // GET /auth/me - Get Current User (requires Cognito authorization)
    const me = auth.addResource('me');
    me.addMethod('GET', new apigateway.LambdaIntegration(this.getCurrentUserFunction), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
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
        allowOrigins: this.getAllowedApiOrigins(),
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
        allowOrigins: this.getAllowedApiOrigins(),
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
        allowOrigins: this.getAllowedApiOrigins(),
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
    // Note: Gateway Response headers must be static strings, cannot use dynamic origins
    // For dynamic CORS support, Lambda functions extract requestOrigin and return appropriate headers
    // These Gateway Responses are only for error cases where Lambda doesn't execute
    //
    // CORS Strategy:
    // - Error responses (401, 403, 400, 500): Use wildcard '*' origin WITHOUT credentials
    //   (CORS spec forbids Access-Control-Allow-Credentials: true with wildcard origin)
    // - Success responses (Lambda): Use specific allowed origin WITH credentials='true'
    //   (Lambda dynamically selects origin from ALLOWED_ORIGINS based on request)
    //
    // This dual strategy ensures:
    // 1. Error responses work from any origin (developer-friendly)
    // 2. Success responses use secure, credential-aware CORS (production-ready)
    // 3. Full CORS spec compliance (no wildcard+credentials violations)

    // Add CORS headers to 401 Unauthorized responses
    this.api.addGatewayResponse('Unauthorized', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
      },
    });

    // Add CORS headers to 403 Forbidden responses
    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
      },
    });

    // Add CORS headers to 400 Bad Request responses
    this.api.addGatewayResponse('BadRequestBody', {
      type: apigateway.ResponseType.BAD_REQUEST_BODY,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
      },
    });

    // Add CORS headers to 500 Internal Server Error responses
    this.api.addGatewayResponse('DefaultServerError', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers': "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
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
          // CSP body sourced from `buildCsp()` (Round 2 item 10).
          // The `connect-src` argument is a region-wide wildcard at
          // initial deploy time — `updateCloudFrontCSP()` swaps it for
          // the concrete API Gateway domain once that resource exists.
          // See `buildCsp()` JSDoc for the full hardening status.
          contentSecurityPolicy: this.buildCsp('https://*.execute-api.us-east-1.amazonaws.com'),
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

  /**
   * Build the Content-Security-Policy header string (Round 2 item 10).
   *
   * Single source of truth for the CSP — previously the policy string
   * was duplicated between the initial response-headers policy (line
   * ~1815) and the post-API-Gateway "Updated" policy (line ~1941).
   * Drift between the two would have been a real risk; future hardening
   * (e.g., Issue #197's `style-src` nonce work) now only edits ONE
   * place.
   *
   * The only per-call variable is `connectSrc` — the wildcard
   * `https://*.execute-api.us-east-1.amazonaws.com` is used at initial
   * deploy time (before API Gateway exists), then replaced with the
   * concrete `https://<apiId>.execute-api.<region>.amazonaws.com` once
   * the API is provisioned.
   *
   * Hardening status (Issues #133, #194):
   *   - 'unsafe-eval' REMOVED from script-src.
   *   - 'unsafe-inline' REMOVED from script-src — Vite's built
   *     `dist/index.html` has no inline `<script>` blocks.
   *   - 'unsafe-inline' RETAINED on style-src — MUI/Emotion injects
   *     runtime styles via `document.head.appendChild('<style>')`,
   *     removal blocked on the Lambda@Edge nonce pipeline tracked in
   *     issue #197.
   *
   * Telemetry (Round 2 item 9 — DEFERRED to issue #201):
   *
   *   The `report-uri` directive is INTENTIONALLY OMITTED from this
   *   build. Implementing it correctly requires (1) a new Lambda
   *   function to receive POST /csp-report; (2) a new API Gateway
   *   route with no auth and request-size limits; (3) CORS
   *   configuration since browsers send violation reports
   *   cross-origin. That is a meaningful infrastructure change which
   *   the OMC reviewer's "out of scope" guard for this PR specifically
   *   excluded.
   *
   *   Issue #201 has the full implementation plan and acceptance
   *   criteria; when it lands, the activation here is a one-line
   *   edit: append `report-uri ${reportUri}` to the directive list
   *   below and pass the new endpoint URL through `updateCloudFrontCSP`.
   *   Until then, every reviewer who looks at this code will see this
   *   block and know exactly what to do (and why we didn't do it now).
   */
  private buildCsp(connectSrc: string): string {
    return [
      `default-src 'self'`,
      `script-src 'self'`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: https:`,
      `font-src 'self' data:`,
      `connect-src 'self' ${connectSrc}`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `form-action 'self'`,
      `frame-ancestors 'none'`,
      `upgrade-insecure-requests`,
    ].join('; ') + ';';
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
          // CSP body sourced from `buildCsp()` (Round 2 item 10) so the
          // initial and updated policies cannot drift. `connect-src` is
          // now the concrete API Gateway domain — see `buildCsp()`
          // JSDoc for the full hardening status (#133, #194, #197).
          contentSecurityPolicy: this.buildCsp(`https://${apiDomain}`),
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