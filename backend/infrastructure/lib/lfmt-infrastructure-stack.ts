import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
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
import { CustomResource } from 'aws-cdk-lib';
import { Provider } from 'aws-cdk-lib/custom-resources';

// CSP builder — extracted into its own module (#216) so the directive
// shape is testable in isolation and re-usable from non-stack constructs.
import { buildCsp } from './csp';

// Centralized Lambda runtime version — single source of truth (DRY).
// Bump here whenever AWS deprecates the current runtime; CI workflow
// runners and the root package.json `engines.node` constraint should be
// kept in sync with this value (see .github/workflows/*.yml NODE_VERSION
// and root package.json `engines`). Node 22 is the active LTS as of
// 2026-05; AWS Lambda has supported it since November 2024.
const LAMBDA_RUNTIME = lambda.Runtime.NODEJS_22_X;

// Centralized Lambda CPU architecture — single source of truth (DRY).
//
// AWS Graviton (ARM64) gives Lambda ~20% lower per-ms cost and ~10–15%
// better price/performance vs the x86_64 default for typical Node.js
// workloads. The LFMT translation Lambdas are network-bound on the
// Gemini API call, so the perf gain is modest — but the cost reduction
// is independent of workload mix.
//
// Safe to bump on this stack because none of the Lambda code paths use
// native node-gyp dependencies; everything is pure TypeScript bundled
// by esbuild via NodejsFunction. esbuild emits architecture-neutral
// JavaScript, so Lambda picks up the ARM64 binary at deploy time
// without any per-function build changes.
//
// Drift-prevention: the infrastructure test suite asserts every Node
// Lambda in the synthesized template uses arm64 (mirror of the
// LAMBDA_RUNTIME drift guard). Any future Lambda added without this
// constant will fail that test.
const LAMBDA_ARCHITECTURE = lambda.Architecture.ARM_64;

/**
 * Per-environment CloudFront-distribution origin literals
 * (PR #214 OMC R2, convergent: 2 agents).
 *
 * Single source of truth consumed by BOTH `getAllowedApiOrigins()`
 * (API Gateway CORS) AND `addCloudFrontOriginToDocumentBucketCors()`
 * (S3 document-bucket CORS). Before the unification both methods kept
 * their own literal lists per environment and the two had to agree by
 * manual care — drift surfaces at the worst possible time (browser
 * upload silently rejected because the bucket-CORS list lagged the
 * API-CORS list after a CloudFront re-create).
 *
 * IMPORTANT: these are LITERAL strings on purpose, NOT references to
 * `frontendDistribution.distributionDomainName`. Using the live
 * reference would create a CFN cyclic dependency (DocumentBucket →
 * FrontendDistribution → response-headers policy → DocumentBucket).
 * The literal approach is acceptable because CloudFront distribution
 * domains are stable across deploys (CDK only re-creates the
 * distribution on logical-id changes). See
 * `addCloudFrontOriginToDocumentBucketCors` JSDoc and
 * `docs/CLOUDFRONT-SETUP.md` runbook note.
 *
 * Drift guard: `infrastructure.test.ts` asserts every known
 * environment has an entry, so adding a new tier without filling this
 * table fails the build immediately.
 */
export const CLOUDFRONT_ORIGINS_BY_ENVIRONMENT: Record<'dev' | 'staging' | 'prod', string> = {
  dev: 'https://d39xcun7144jgl.cloudfront.net',
  staging: 'https://staging.lfmt.yourcompany.com',
  prod: 'https://lfmt.yourcompany.com',
};

export interface LfmtInfrastructureStackProps extends StackProps {
  stackName: string;
  environment: string;
  enableLogging: boolean;
  retainData: boolean;
  skipLambdaBundling?: boolean; // For testing purposes
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
  private getJobFunction?: lambda.Function;
  private deleteJobFunction?: lambda.Function;
  private listJobsFunction?: lambda.Function;
  private downloadTranslationFunction?: lambda.Function;
  // CSP violation-report collector (#201). Anonymous, unauthenticated
  // endpoint receiving browser reports — kept on its own role so the
  // (minimal) IAM grant is auditable in isolation.
  private cspReportFunction?: lambda.Function;
  // CSP style-src nonce custom resource (#254). The CFN attribute
  // `Data.Nonce` carries the freshly-generated per-deploy nonce that
  // both the response-headers policy CSP and the S3-uploaded
  // `index.html` `<meta name="csp-nonce">` tag interpolate. Stored as a
  // class field so `updateCloudFrontCSP()` (called after API Gateway is
  // provisioned) can re-thread the same token into the updated CSP
  // string without a second custom-resource invocation.
  private cspNonceCustomResource?: CustomResource;

  // IAM role for Lambda functions
  private lambdaRole?: iam.Role;
  // Dedicated role for the delete-job Lambda — isolated from translationRole so
  // that only this one function gets DeleteItem + s3:DeleteObject permissions.
  private deleteJobRole?: iam.Role;
  // Dedicated role for the list-jobs Lambda — scoped to dynamodb:Query on the
  // UserJobsIndex GSI ARN only. Using translationRole would grant Query on all
  // indexes which violates least-privilege for a read-only list endpoint.
  private listJobsRole?: iam.Role;
  // Dedicated role for the download-translation Lambda — scoped to GetItem on
  // JobsTable and GetObject on the translated/* prefix only.
  private downloadTranslationRole?: iam.Role;
  // Dedicated role for the CSP report collector (#201). Only the
  // CloudWatch Logs basic-execution permissions — NO DDB/S3/API access.
  // Keeping this on its own role is doubly important here because the
  // endpoint is unauthenticated; ANY additional grant on this role
  // would be reachable by an anonymous internet caller.
  private cspReportRole?: iam.Role;

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

    // PR #214 OMC R2 (convergent): consume the unified per-environment
    // CloudFront constant rather than carrying our own literal here.
    // Drift between this list and the document-bucket CORS list (the
    // other consumer of the same constant) is no longer possible.
    switch (this.node.tryGetContext('environment')) {
      case 'prod':
        origins.push(CLOUDFRONT_ORIGINS_BY_ENVIRONMENT.prod);
        break;
      case 'staging':
        origins.push(CLOUDFRONT_ORIGINS_BY_ENVIRONMENT.staging);
        break;
      default:
        // Dev environment: local development + CDK-managed CloudFront
        origins.push('http://localhost:3000');
        origins.push('https://localhost:3000');
        origins.push(CLOUDFRONT_ORIGINS_BY_ENVIRONMENT.dev);
    }

    // Add CloudFront distribution URL if it exists (after createFrontendHosting() is called)
    if (this.frontendDistribution) {
      origins.push(`https://${this.frontendDistribution.distributionDomainName}`);
    }

    return origins;
  }

  /**
   * Return a consistent CORS preflight options object for a new API Gateway resource.
   *
   * The allowed-headers list and allowCredentials flag are identical across all
   * protected endpoints; only the HTTP methods differ (POST for mutating resources,
   * GET for read endpoints). Centralising them here prevents the three lines of
   * headers drifting independently (OMC review #9).
   */
  private corsPreflightOptions(
    primaryMethod: 'GET' | 'POST' | 'DELETE' | 'PUT'
  ): apigateway.ResourceOptions {
    return {
      defaultCorsPreflightOptions: {
        allowOrigins: this.getAllowedApiOrigins(),
        allowMethods: [primaryMethod, 'OPTIONS'],
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
    };
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

    // 6.5. Document-bucket CORS — append per-environment CloudFront
    // origin so browser-side presigned-PUT uploads pass the bucket's
    // OPTIONS preflight. Uses literal CloudFront domain strings (NOT
    // `frontendDistribution.distributionDomainName`) to avoid a CFN
    // cyclic dependency — see method JSDoc for details.
    this.addCloudFrontOriginToDocumentBucketCors(props.environment);

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
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
          allowedOrigins: getAllowedOrigins(),
          allowedHeaders: [
            'Content-Type',
            'x-amz-date',
            'Authorization',
            'x-api-key',
            'x-amz-security-token',
          ],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: 'DocumentCleanup',
          enabled: true,
          expiration: Duration.days(90), // 90 days retention for source documents
          abortIncompleteMultipartUploadAfter: Duration.days(1),
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
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

  /**
   * Append the CloudFront distribution origin to the document bucket's
   * CORS `AllowedOrigins` (PR #214 OMC C-sec).
   *
   * Browser-side presigned-PUT uploads originate from the CloudFront-
   * hosted SPA. The bucket's CORS preflight (OPTIONS /key) must echo
   * `Access-Control-Allow-Origin: https://<cloudfront-domain>` or the
   * browser blocks the subsequent PUT. The CSP fix in `buildCsp()`
   * solved one half of the demo-blocking incident (CSP `connect-src`);
   * this bucket-CORS entry solves the other half. Without both, a fresh
   * deploy in a new region would still fail in a real browser even
   * though curl-driven validation succeeds.
   *
   * IMPORTANT (cyclic-dependency avoidance): the response-headers
   * policy used by `frontendDistribution` already references
   * `documentBucket.bucketRegionalDomainName` (CSP `connect-src`). If
   * we then made the bucket's CORS rule reference
   * `frontendDistribution.distributionDomainName` we would create a
   * CFN cycle (DocumentBucket → FrontendDistribution → policy →
   * DocumentBucket). To break the cycle we use literal CloudFront
   * domain strings per environment — the same approach that
   * `getAllowedApiOrigins()` (dev tier) already takes for the API
   * Gateway CORS list. This is acceptable because:
   *   1. CloudFront distribution domains are stable across deploys
   *      (CDK only re-creates the distribution on logical-id changes,
   *      not on every `cdk deploy`).
   *   2. The same value is already maintained as the source of truth
   *      in `getAllowedApiOrigins()` — drift between the two would
   *      surface immediately in the API CORS reference.
   *
   * Production gating: localhost origins are dev-only. We mirror the
   * environment switch used by `getAllowedApiOrigins()` so prod-tier
   * deploys don't accidentally allow `http://localhost:3000` to upload
   * to the prod document bucket.
   *
   * @param environment - Stack environment ('dev' | 'staging' | 'prod')
   *   from `LfmtInfrastructureStackProps`. Used to select the right
   *   set of additional origins per tier.
   */
  private addCloudFrontOriginToDocumentBucketCors(environment: string) {
    // PR #214 OMC R2 (convergent): consume the unified per-environment
    // CloudFront constant `CLOUDFRONT_ORIGINS_BY_ENVIRONMENT` defined
    // at module scope. The same constant feeds `getAllowedApiOrigins()`
    // so the two CORS surfaces (API Gateway + S3 bucket) cannot drift
    // independently — a single edit covers both. Drift via
    // unrecognised environment label is also handled: known tiers
    // (dev / staging / prod) get their concrete entry; anything else
    // falls back to dev (matches the `default:` branch in
    // `getAllowedApiOrigins()`).
    const isKnown = (env: string): env is keyof typeof CLOUDFRONT_ORIGINS_BY_ENVIRONMENT =>
      env === 'dev' || env === 'staging' || env === 'prod';
    const additionalOrigins: string[] = [
      isKnown(environment)
        ? CLOUDFRONT_ORIGINS_BY_ENVIRONMENT[environment]
        : CLOUDFRONT_ORIGINS_BY_ENVIRONMENT.dev,
    ];

    this.documentBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
      allowedOrigins: additionalOrigins,
      allowedHeaders: [
        'Content-Type',
        'x-amz-date',
        'Authorization',
        'x-api-key',
        'x-amz-security-token',
      ],
      maxAge: 3000,
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
      autoVerify: isDev
        ? {}
        : {
            email: true,
          },
      userVerification: isDev
        ? undefined
        : {
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
        runtime: LAMBDA_RUNTIME,
        architecture: LAMBDA_ARCHITECTURE,
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
    const accountHash = Buffer.from(this.account)
      .toString('base64')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .substring(0, 8);
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
    const logRetention =
      this.node.tryGetContext('environment') === 'prod'
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
      retention:
        this.node.tryGetContext('environment') === 'prod'
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
      description:
        'Execution role for authentication Lambda functions (register, login, getCurrentUser, etc.)',
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
            // cognito-idp:AdminConfirmSignUp removed (#178): the PreSignUp Lambda
            // trigger + autoVerifiedAttributes in the dev User Pool auto-confirm
            // users as part of SignUp. The AdminConfirmSignUp call in register.ts
            // was a no-op that required a privileged IAM grant. Both removed.
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
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${this.documentBucket.bucketArn}/*`, `${this.resultsBucket.bucketArn}/*`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [this.documentBucket.bucketArn, this.resultsBucket.bucketArn],
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
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${this.documentBucket.bucketArn}/*`, `${this.resultsBucket.bucketArn}/*`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [this.documentBucket.bucketArn, this.resultsBucket.bucketArn],
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
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
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
      description:
        'Execution role for translation Lambda functions (translate-chunk, start-translation, get-translation-status)',
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
          actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
          resources: [`${this.documentBucket.bucketArn}/*`, `${this.resultsBucket.bucketArn}/*`],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [this.documentBucket.bucketArn, this.resultsBucket.bucketArn],
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

    // ===================================================================
    // Role 5: Delete Job Lambda Function Role (isolated, minimal permissions)
    //
    // This role is EXCLUSIVELY for the delete-job Lambda.  It is separate from
    // translationRole because translationRole is shared by ~5 Lambdas — adding
    // DeleteItem to it would grant all of them that permission, defeating the
    // least-privilege goal stated in the IAM section header above.
    //
    // Permissions:
    //   - dynamodb:GetItem on JobsTable  (already part of the single-round-trip
    //     conditional delete; DynamoDB's ReturnValues: ALL_OLD also reads the item)
    //   - dynamodb:DeleteItem on JobsTable
    //   - s3:DeleteObject on documentBucket/* (S3 cascade cleanup)
    //   - CloudWatch Logs write  (via AWSLambdaBasicExecutionRole)
    // ===================================================================
    this.deleteJobRole = new iam.Role(this, 'DeleteJobLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description:
        'Isolated execution role for delete-job Lambda - minimal DynamoDB + S3 delete permissions only',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    new iam.ManagedPolicy(this, 'DeleteJobPolicy', {
      roles: [this.deleteJobRole],
      statements: [
        // DynamoDB: GetItem (conditional delete reads the item internally via ALL_OLD)
        // and DeleteItem — scoped to the jobs table only.
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:GetItem', 'dynamodb:DeleteItem'],
          resources: [this.jobsTable.tableArn],
        }),
        // S3: DeleteObject on the document bucket for cascade cleanup of uploaded
        // files after the job record is removed.  Scoped to prefix-level.
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:DeleteObject'],
          resources: [`${this.documentBucket.bucketArn}/*`],
        }),
      ],
    });

    // ===================================================================
    // Role 6: Download Translation Lambda Function Role (isolated, minimal permissions)
    //
    // This role is EXCLUSIVELY for the download-translation Lambda.  It is
    // separate from translationRole because translationRole is shared across
    // ~5 Lambdas and grants broad S3 access (GetObject, PutObject, DeleteObject)
    // on the entire bucket.  The download Lambda only needs:
    //   - dynamodb:GetItem on JobsTable (ownership check via loadJobForUser)
    //   - s3:GetObject on documentBucket/translated/* (read translated chunks)
    //   - s3:ListBucket on documentBucket (enumerate chunks for assembly)
    //   - CloudWatch Logs write (via AWSLambdaBasicExecutionRole)
    //
    // Scoping to the translated/* prefix prevents this function from reading
    // source documents (uploads/, documents/) or chunk metadata (chunks/).
    // ===================================================================
    this.downloadTranslationRole = new iam.Role(this, 'DownloadTranslationLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description:
        'Isolated execution role for download-translation Lambda - read-only access to translated chunks and job ownership check',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    new iam.ManagedPolicy(this, 'DownloadTranslationPolicy', {
      roles: [this.downloadTranslationRole],
      statements: [
        // DynamoDB: GetItem on JobsTable only (ownership check via loadJobForUser)
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:GetItem'],
          resources: [this.jobsTable.tableArn],
        }),
        // S3: GetObject scoped to the translated/* prefix (translated chunks only)
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject'],
          resources: [`${this.documentBucket.bucketArn}/translated/*`],
        }),
        // S3: ListBucket needed for ListObjectsV2 to enumerate chunks under the prefix.
        // Scoped to the bucket ARN (resource-level condition for prefix is on the key,
        // not the bucket ARN, so the bucket-level permission must be bucket-scoped).
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [this.documentBucket.bucketArn],
        }),
        // Issue #28 — ePub/PDF lazy generation:
        //
        // The download Lambda persists generated artefacts under a SEPARATE
        // prefix (`translated-output/*`) so the read grant on `translated/*`
        // above is NOT widened to writes on the chunk store. GetObject on
        // this new prefix is needed by getSignedUrl (the SDK prepares the
        // signature against a GetObjectCommand). PutObject writes the
        // generated bytes after a cache miss. HeadObject (implicit under
        // s3:GetObject in IAM) is the cache-hit probe.
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:GetObject', 's3:PutObject'],
          resources: [`${this.documentBucket.bucketArn}/translated-output/*`],
        }),
      ],
    });

    // ===================================================================
    // Role 7: List Jobs Lambda Function Role (isolated, minimal permissions)
    //
    // This role is EXCLUSIVELY for the list-jobs Lambda.  It grants
    // ONLY `dynamodb:Query` on the `UserJobsIndex` GSI ARN — NOT on
    // the base table ARN — so the Lambda cannot perform GetItem, PutItem,
    // UpdateItem, DeleteItem, or Scan.
    //
    // Why not reuse translationRole: translationRole is shared across
    // ~5 Lambdas and grants Query on all indexes (`tableArn/index/*`).
    // Scoping to a single GSI ARN is the minimum necessary for this
    // read-only list endpoint and matches least-privilege per OWASP
    // API1:2023 (BOLA / IDOR).
    //
    // Authorization: the Lambda reads userId from the Cognito authorizer
    // claim; the GSI partition key in the DDB Query is ALWAYS set from
    // that claim.  There is no secondary authorization check needed at
    // the IAM level because every item returned by the GSI query already
    // belongs to the queried userId.
    // ===================================================================
    this.listJobsRole = new iam.Role(this, 'ListJobsLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Isolated execution role for list-jobs Lambda: Query on UserJobsIndex GSI only',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    new iam.ManagedPolicy(this, 'ListJobsPolicy', {
      roles: [this.listJobsRole],
      statements: [
        // DynamoDB: Query on the UserJobsIndex GSI ARN only.
        // This is strictly narrower than `tableArn/index/*` — the Lambda
        // can only query this one index and cannot touch the base table
        // or any other index.
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['dynamodb:Query'],
          resources: [`${this.jobsTable.tableArn}/index/UserJobsIndex`],
        }),
      ],
    });

    // CSP Report Collector Role (#201) — strictest possible IAM grant.
    //
    // The /csp-report endpoint is INTENTIONALLY unauthenticated (browsers
    // do not send credentials with violation reports). That makes every
    // grant on this role reachable by an anonymous internet caller, so
    // we attach ONLY the CloudWatch Logs basic-execution policy — no
    // DDB, no S3, no Secrets Manager. The Lambda body is restricted to
    // structured-log emission; there is no code path that could exfil
    // data even if the role grew accidentally.
    this.cspReportRole = new iam.Role(this, 'CspReportLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Isolated execution role for csp-report Lambda: CloudWatch Logs only (#201)',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

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
              resources: [
                `arn:aws:lambda:${this.region}:${this.account}:function:lfmt-translate-chunk-${this.stackName}`,
              ],
            }),
          ],
        }),
      },
    });
  }

  /**
   * createJobLambda — thin helper to remove repetition in the 13 NodejsFunction
   * blocks for jobs-related Lambdas.  Each block shares the same bundling config,
   * runtime, architecture, and environment; only the function-specific opts differ.
   *
   * Applied to getJob and deleteJob (the two new Lambdas in PR #208) and
   * intentionally scoped there to keep churn minimal.  The larger refactor
   * (applying to all 13 sites) is tracked as Issue #64 (nested stacks).
   */
  private createJobLambda(opts: {
    id: string;
    functionName: string;
    entry: string;
    description: string;
    role: iam.Role;
    environment: Record<string, string>;
    timeoutSeconds?: number;
    memoryMB?: number;
    /**
     * Optional extra bundling fields merged on top of the default bundling
     * config. Used for functions that need `nodeModules` (because some
     * packages can't be reliably tree-shaken by esbuild — pdfkit ships
     * fonts as binary `.afm` files; @lesjoursfr/html-to-epub uses
     * runtime `require()` for its EJS templates), or for functions that
     * need extra `externalModules` entries.
     *
     * Added for issue #28 — the download Lambda must bundle pdfkit,
     * @lesjoursfr/html-to-epub, and markdown-it via `nodeModules` so
     * their runtime asset reads succeed inside the Lambda zip.
     */
    extraBundling?: {
      nodeModules?: string[];
      externalModules?: string[];
    };
  }): NodejsFunction {
    // `skipLambdaBundling` context flag is set by the test harness
    // (`infrastructure.test.ts`) to avoid the expensive bundling step at
    // synth time. Under normal bundling, `nodeModules` triggers CDK to
    // create a temp directory and run `npm ci` to install the listed
    // packages — which fails in the Jest+Node environment under certain
    // workspace/lockfile configurations (observed on PR #28 — CI Build
    // Infrastructure regression). Externalising the same modules in test
    // mode lets esbuild emit `require()` calls without trying to bundle
    // them, which is functionally equivalent for the template-shape
    // assertions the tests actually make. The bundle is not produced in
    // a useful form when this flag is on — only the CFN template matters.
    const skipBundling = this.node.tryGetContext('skipLambdaBundling') === 'true';
    const extraNodeModules = opts.extraBundling?.nodeModules ?? [];
    const extraExternalModules = opts.extraBundling?.externalModules ?? [];

    return new NodejsFunction(this, opts.id, {
      functionName: opts.functionName,
      entry: opts.entry,
      handler: 'handler',
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
      role: opts.role,
      environment: opts.environment,
      timeout: Duration.seconds(opts.timeoutSeconds ?? 30),
      memorySize: opts.memoryMB ?? 256,
      description: opts.description,
      bundling: {
        externalModules: [
          'aws-sdk',
          '@aws-sdk/*',
          ...extraExternalModules,
          // Test-mode: route nodeModules through externalModules so the
          // bundler doesn't `npm ci` them. Real-deploy bundling (skip=
          // false) still threads them through `nodeModules` below.
          ...(skipBundling ? extraNodeModules : []),
        ],
        nodeModules: skipBundling
          ? undefined
          : extraNodeModules.length > 0
            ? extraNodeModules
            : undefined,
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
      role: authRole,
      environment: commonEnv,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'User registration with Cognito',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false, // Use local esbuild instead of Docker
      },
    });

    // Login Lambda Function
    this.loginFunction = new NodejsFunction(this, 'LoginFunction', {
      functionName: `lfmt-login-${this.stackName}`,
      entry: '../functions/auth/login.ts',
      handler: 'handler',
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
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

    // Get Job Lambda Function — GET /jobs/{jobId}
    // Reads a single job record owned by the authenticated user.
    // Reuses translationRole (already has dynamodb:GetItem on all tables).
    this.getJobFunction = this.createJobLambda({
      id: 'GetJobFunction',
      functionName: `lfmt-get-job-${this.stackName}`,
      entry: '../functions/jobs/getJob.ts',
      description: 'Get a job record by ID for the authenticated owner',
      role: translationRole,
      environment: commonEnv,
    });

    // Delete Job Lambda Function — DELETE /jobs/{jobId}
    // Uses a DEDICATED role (deleteJobRole, Role 5) with ONLY the permissions
    // this function actually needs: dynamodb:GetItem + dynamodb:DeleteItem on the
    // jobs table, and s3:DeleteObject on the document bucket.
    //
    // IMPORTANT: Do NOT use translationRole here.  translationRole is shared
    // across ~5 Lambda functions; adding DeleteItem to it would grant ALL of them
    // that permission, defeating least-privilege (OMC security-auditor item #2).
    if (!this.deleteJobRole) {
      throw new Error('deleteJobRole must be created before createLambdaFunctions');
    }
    this.deleteJobFunction = this.createJobLambda({
      id: 'DeleteJobFunction',
      functionName: `lfmt-delete-job-${this.stackName}`,
      entry: '../functions/jobs/deleteJob.ts',
      description: 'Delete a job record and cascade S3 cleanup (authenticated owner only)',
      role: this.deleteJobRole,
      environment: commonEnv,
    });

    // List Jobs Lambda Function — GET /jobs
    // Returns all jobs owned by the authenticated caller.
    // Uses DEDICATED role (listJobsRole, Role 7) with Query on UserJobsIndex GSI
    // only — the narrowest possible scope for this read-only endpoint.
    // SECURITY: userId is read from event.requestContext.authorizer.claims.sub;
    // any client-supplied ?userId query param is silently ignored.
    if (!this.listJobsRole) {
      throw new Error('listJobsRole must be created before createLambdaFunctions');
    }
    this.listJobsFunction = this.createJobLambda({
      id: 'ListJobsFunction',
      functionName: `lfmt-list-jobs-${this.stackName}`,
      entry: '../functions/jobs/listJobs.ts',
      description: 'List all jobs for the authenticated caller (Cognito-claim scoped, IDOR-safe)',
      role: this.listJobsRole,
      environment: commonEnv,
    });

    // Download Translation Lambda Function — GET /translation/{jobId}/download
    // Assembles translated chunks from S3 and returns the full document as
    // a raw text/plain response so the frontend can stream it to a Blob download.
    //
    // Uses DEDICATED role (downloadTranslationRole, Role 6) with read-only access
    // to translated/* on the document bucket and GetItem on the jobs table.
    // Using translationRole here would grant PutObject / DeleteObject on the
    // full bucket — unnecessary for a read-only operation.
    if (!this.downloadTranslationRole) {
      throw new Error('downloadTranslationRole must be created before createLambdaFunctions');
    }
    this.downloadTranslationFunction = this.createJobLambda({
      id: 'DownloadTranslationFunction',
      functionName: `lfmt-download-translation-${this.stackName}`,
      entry: '../functions/translation/downloadTranslation.ts',
      description:
        'Assemble translated chunks and return full document for download - markdown inline, ePub/PDF via presigned URL (#28)',
      role: this.downloadTranslationRole,
      environment: commonEnv,
      // Issue #28: ePub/PDF generation can take 1–5 s for a multi-megabyte
      // source. 120 s gives headroom for cold-start + chunk fan-out
      // (115 chunks for a 400K-word doc) + conversion + S3 PutObject.
      // Markdown-only path still completes well under 60 s.
      timeoutSeconds: 120,
      // PDFKit and the ePub generator hold the full document in heap
      // while assembling. 1024 MB keeps OOM well clear for the 8 MB
      // source ceiling (MAX_CONVERSION_SOURCE_BYTES). The price is
      // negligible — the Lambda is invoked rarely (per user download).
      memoryMB: 1024,
      extraBundling: {
        // Bundle the conversion libraries into node_modules/ inside the
        // Lambda zip rather than letting esbuild tree-shake them. Both
        // pdfkit (binary .afm font files) and @lesjoursfr/html-to-epub
        // (EJS templates + helper requires) load runtime assets via
        // `require()` paths that esbuild cannot trace statically.
        // markdown-it is small enough to bundle but listed here for
        // symmetry — the alternative (letting esbuild inline it) works
        // but obscures the dependency footprint.
        nodeModules: ['@lesjoursfr/html-to-epub', 'pdfkit', 'markdown-it'],
      },
    });

    // CSP Report Collector Lambda (#201) — POST /csp-report (unauthenticated)
    //
    // Receives browser CSP violation reports and logs them to CloudWatch
    // for the regression-alarm pattern. Memory is tiny (the handler
    // parses ~1 KB of JSON and emits a single log line), and the timeout
    // is short — anything longer means the handler is wedged and we'd
    // rather fail fast than let API Gateway hold the connection.
    //
    // NO commonEnv is passed: the CSP report handler does not need ANY
    // of the standard env vars (no DDB table, no S3 bucket, no
    // Cognito IDs). Keeping the env minimal also means an attacker who
    // somehow achieved RCE here gets ZERO discovery surface for
    // pivoting to other resources.
    if (!this.cspReportRole) {
      throw new Error('cspReportRole must be created before createLambdaFunctions');
    }
    this.cspReportFunction = this.createJobLambda({
      id: 'CspReportFunction',
      functionName: `lfmt-csp-report-${this.stackName}`,
      entry: '../functions/security/cspReport.ts',
      description: 'Anonymous CSP violation report collector - logs to CloudWatch (#201)',
      role: this.cspReportRole,
      environment: {}, // intentionally empty — see comment above
      timeoutSeconds: 5,
      memoryMB: 128,
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
      updateExpression:
        'SET translationStatus = :status, #status = :outerStatus, translationCompletedAt = :completedAt, translatedChunks = :totalChunks, updatedAt = :updatedAt',
      expressionAttributeNames: {
        '#status': 'status',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('COMPLETED'),
        // 'COMPLETED' is a member of shared-types/src/jobs.ts JobStatus union
        // and matches what frontend logic (TranslationDetail.tsx) expects on
        // terminal success.
        ':outerStatus': tasks.DynamoAttributeValue.fromString('COMPLETED'),
        ':completedAt': tasks.DynamoAttributeValue.fromString(
          stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')
        ),
        // CRITICAL FIX: DynamoDB NUMBER attributes in Step Functions MUST be provided as strings
        // Using States.Format() to convert the number result from States.ArrayLength() to a string
        ':totalChunks': tasks.DynamoAttributeValue.fromString(
          stepfunctions.JsonPath.stringAt("States.Format('{}', States.ArrayLength($.chunks))")
        ),
        ':updatedAt': tasks.DynamoAttributeValue.fromString(
          stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')
        ),
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
      updateExpression:
        'SET translationStatus = :status, #status = :outerStatus, translationFailedAt = :failedAt, translationError = :error, updatedAt = :updatedAt',
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
        ':failedAt': tasks.DynamoAttributeValue.fromString(
          stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')
        ),
        // $.error is guaranteed to exist here — both entry paths set it:
        // 1. Map Catch path: resultPath='$.error' on processChunksMap.addCatch().
        // 2. Choice path (success:false): NormalizeFailureContext Pass state below
        //    synthesises $.error from $.translationResults before entering this task.
        ':error': tasks.DynamoAttributeValue.fromString(
          stepfunctions.JsonPath.stringAt('States.JsonToString($.error)')
        ),
        ':updatedAt': tasks.DynamoAttributeValue.fromString(
          stepfunctions.JsonPath.stringAt('$$.State.EnteredTime')
        ),
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
        reason: 'CHUNK_FAILURE',
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
    const definition = processChunksMap.next(aggregateChunkResults).next(checkAllChunksSucceeded);

    // Create the state machine
    (this as any).translationStateMachine = new stepfunctions.StateMachine(
      this,
      'TranslationStateMachine',
      {
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
      }
    );

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
            actions: ['states:StartExecution'],
            resources: [this.translationStateMachine.stateMachineArn],
          }),
        ],
      });
    }

    // Issue #210: Grant deleteJobRole permission to stop in-flight executions.
    // Scoped to the translation state machine ARN only (least-privilege).
    // states:DescribeExecution — check current status before calling StopExecution.
    // states:StopExecution     — terminate a RUNNING execution when the owner deletes the job.
    // Executions ARNs are derived from the state machine ARN at runtime; SFN
    // IAM model requires the state machine ARN as resource for StopExecution.
    if (this.deleteJobRole) {
      new iam.ManagedPolicy(this, 'DeleteJobStepFunctionsPolicy', {
        roles: [this.deleteJobRole],
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['states:DescribeExecution', 'states:StopExecution'],
            resources: [
              this.translationStateMachine.stateMachineArn,
              // Execution ARNs share the same partition/account/region/name pattern:
              // arn:aws:states:<region>:<account>:execution:<stateMachineName>:*
              // CDK token resolution ensures we reference the correct machine.
              `${this.translationStateMachine.stateMachineArn.replace(':stateMachine:', ':execution:')}:*`,
            ],
          }),
        ],
      });
    }
  }

  private createApiEndpoints() {
    if (
      !this.registerFunction ||
      !this.loginFunction ||
      !this.refreshTokenFunction ||
      !this.resetPasswordFunction ||
      !this.getCurrentUserFunction ||
      !this.uploadRequestFunction ||
      !this.startTranslationFunction ||
      !this.getTranslationStatusFunction ||
      !this.getJobFunction ||
      !this.deleteJobFunction ||
      !this.deleteJobRole ||
      !this.listJobsFunction ||
      !this.listJobsRole ||
      !this.downloadTranslationFunction ||
      !this.downloadTranslationRole ||
      !this.cspReportFunction ||
      !this.cspReportRole
    ) {
      throw new Error('Lambda functions and roles must be created before API endpoints');
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
    const uploadResource = jobsResource.addResource('upload', this.corsPreflightOptions('POST'));

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

    // GET /jobs - List all jobs for the authenticated caller (requires authentication)
    //
    // SECURITY (OWASP API1:2023 — BOLA / IDOR):
    // The Lambda reads userId EXCLUSIVELY from the Cognito authorizer claim.
    // Any ?userId query-string override is silently ignored at the Lambda level.
    // API Gateway does NOT need a query-string validator here — ignoring is safer
    // than rejecting (a 400 on an unsupported param would be a breaking change if
    // clients accidentally include it, and the Lambda already ignores it securely).
    //
    // IAM: listJobsRole (Role 7) grants dynamodb:Query on UserJobsIndex GSI ARN
    // only — NOT on the base table or any other index.
    jobsResource.addMethod('GET', new apigateway.LambdaIntegration(this.listJobsFunction), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
    });

    // POST /jobs/{jobId}/translate - Start Translation (requires authentication)
    // Use existing /jobs/{jobId} resource created in createApiGateway()
    const jobResource = jobsResource.resourceForPath('{jobId}');

    const translateResource = jobResource.addResource(
      'translate',
      this.corsPreflightOptions('POST')
    );
    translateResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(this.startTranslationFunction),
      {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: authorizer,
        requestValidator: new apigateway.RequestValidator(this, 'StartTranslationValidator', {
          restApi: this.api,
          requestValidatorName: 'start-translation-validator',
          validateRequestBody: true,
          validateRequestParameters: false,
        }),
      }
    );

    // GET /jobs/{jobId}/translation-status - Get Translation Status (requires authentication)
    const translationStatusResource = jobResource.addResource(
      'translation-status',
      this.corsPreflightOptions('GET')
    );
    translationStatusResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.getTranslationStatusFunction),
      {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: authorizer,
      }
    );

    // GET /jobs/{jobId} - Get Job (requires authentication)
    // Returns the current state of a job record owned by the caller.
    // Reuses the existing /jobs/{jobId} resource created in createApiGateway().
    jobResource.addMethod('GET', new apigateway.LambdaIntegration(this.getJobFunction), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
    });

    // DELETE /jobs/{jobId} - Delete Job (requires authentication)
    // Permanently removes the caller's job record from DynamoDB.
    jobResource.addMethod('DELETE', new apigateway.LambdaIntegration(this.deleteJobFunction), {
      authorizationType: apigateway.AuthorizationType.COGNITO,
      authorizer: authorizer,
    });

    // GET /jobs/{jobId}/download — Download translated document (requires authentication)
    //
    // Nested under the existing /jobs/{jobId} resource to be consistent with the
    // other job-scoped endpoints: /jobs/{jobId}/translate, /jobs/{jobId}/translation-status,
    // GET /jobs/{jobId}. A separate /translation root was used initially but was moved
    // here (OMC review #4) to avoid a degenerate parallel resource hierarchy.
    const downloadResource = jobResource.addResource('download', this.corsPreflightOptions('GET'));

    downloadResource.addMethod(
      'GET',
      new apigateway.LambdaIntegration(this.downloadTranslationFunction),
      {
        authorizationType: apigateway.AuthorizationType.COGNITO,
        authorizer: authorizer,
      }
    );

    // -------------------------------------------------------------------------
    // POST /csp-report — anonymous CSP violation report collector (#201).
    //
    // Browsers send violation reports WITHOUT credentials, so this route
    // MUST NOT require Cognito auth. The Lambda's IAM grant is restricted
    // to CloudWatch Logs only (see CspReportLambdaRole) so the anonymous
    // access surface is bounded to one structured-log write.
    //
    // The route lives at the API root (`/csp-report`) rather than nested
    // under `/jobs` or `/auth` so the URL is short — CSP report-uri
    // values are emitted in every response header and shorter URLs keep
    // the CSP string compact (important for caches and metrics).
    //
    // OPTIONS preflight is wired via `corsPreflightOptions('POST')` so
    // the same-origin SPA test page (and any in-browser fetch from a
    // future debug tool) can POST without a CORS error.
    // -------------------------------------------------------------------------
    const cspReportResource = this.api.root.addResource(
      'csp-report',
      this.corsPreflightOptions('POST')
    );
    cspReportResource.addMethod('POST', new apigateway.LambdaIntegration(this.cspReportFunction), {
      // CRITICAL: this endpoint MUST stay unauthenticated. Browsers do
      // not send credentials with CSP violation reports — requiring
      // Cognito auth here would silently drop EVERY report.
      authorizationType: apigateway.AuthorizationType.NONE,
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
        'Access-Control-Allow-Headers':
          "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
      },
    });

    // Add CORS headers to 403 Forbidden responses
    this.api.addGatewayResponse('AccessDenied', {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers':
          "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
      },
    });

    // Add CORS headers to 400 Bad Request responses
    this.api.addGatewayResponse('BadRequestBody', {
      type: apigateway.ResponseType.BAD_REQUEST_BODY,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers':
          "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
        'Access-Control-Allow-Methods': "'OPTIONS,GET,POST,PUT,DELETE'",
      },
    });

    // Add CORS headers to 500 Internal Server Error responses
    this.api.addGatewayResponse('DefaultServerError', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
        'Access-Control-Allow-Headers':
          "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Request-ID'",
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
      lifecycleRules: [
        {
          id: 'FrontendCleanup',
          enabled: true,
          expiration: Duration.days(90), // Delete old deployments after 90 days
          noncurrentVersionExpiration: Duration.days(30),
        },
      ],
    });

    // 2. Create Origin Access Control (OAC) for CloudFront
    const oac = new cloudfront.S3OriginAccessControl(this, 'FrontendOAC', {
      signing: cloudfront.Signing.SIGV4_ALWAYS,
    });

    // 2.5 Create the CSP style-src nonce custom resource (#254).
    // MUST run before the ResponseHeadersPolicy below so the nonce token
    // is available to the `style-src 'self' 'nonce-<token>'` directive.
    this.createCspNonceCustomResource();

    // 3. Create CloudFront Distribution
    const environment = this.node.tryGetContext('environment');
    const isProd = environment === 'prod';

    // Environment-specific configuration
    const priceClass = isProd
      ? cloudfront.PriceClass.PRICE_CLASS_ALL // Global edge locations for production
      : cloudfront.PriceClass.PRICE_CLASS_100; // North America & Europe only for dev (cost-optimized)

    // Create Response Headers Policy with security headers
    const responseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      'FrontendSecurityHeaders',
      {
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
            // The `connect-src` arguments are region-wide wildcards at
            // initial deploy time — `updateCloudFrontCSP()` swaps the API
            // Gateway entry for the concrete domain once that resource
            // exists. The document-bucket entry is included here too so
            // browser-side presigned-PUT uploads succeed even before the
            // updated policy is applied (preventing the same CSP-block
            // class that caused the demo-blocking failure on 2026-05-08).
            // See `buildCsp()` JSDoc for the full hardening status.
            contentSecurityPolicy: buildCsp({
              directives: {
                // Source-list REPLACEMENT (not merge) — caller must include
                // 'self' explicitly. The wildcard execute-api host is the
                // initial-deploy placeholder; updateCloudFrontCSP() replaces
                // it with the concrete API Gateway domain once provisioned.
                'connect-src': [
                  "'self'",
                  'https://*.execute-api.us-east-1.amazonaws.com',
                  `https://${this.documentBucket.bucketRegionalDomainName}`,
                ],
                // #254 — style-src per-deploy nonce. The CDK custom resource
                // generates a fresh base64url nonce on every `cdk deploy`
                // and exposes it via `Data.Nonce`. `getAttString` returns
                // a CDK Token that resolves to a `Fn::GetAtt` reference at
                // synth time; CloudFormation substitutes the concrete value
                // when the stack is deployed, so the CSP header at the edge
                // carries `style-src 'self' 'nonce-<value>'`. The same nonce
                // is stamped into `index.html`'s `<meta name="csp-nonce">`
                // tag by the same custom resource (and by the CI rebuild
                // composite action — see `.github/actions/rebuild-frontend/`).
                'style-src': [
                  "'self'",
                  `'nonce-${this.cspNonceCustomResource!.getAttString('Nonce')}'`,
                ],
              },
            }),
            override: true,
          },
        },
      }
    );

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
      logBucket: isProd
        ? new s3.Bucket(this, 'CloudFrontLogBucket', {
            bucketName: `lfmt-cloudfront-logs-${this.stackName.toLowerCase()}`,
            removalPolicy,
            autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
            lifecycleRules: [
              {
                expiration: Duration.days(90),
              },
            ],
          })
        : undefined,
    });

    // 4. Grant CloudFront OAC access to frontend bucket
    this.frontendBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`${this.frontendBucket.bucketArn}/*`],
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${this.frontendDistribution.distributionId}`,
          },
        },
      })
    );
  }

  // -------------------------------------------------------------------------
  // CSP construction: extracted to `./csp.ts` (#216). Call `buildCsp({...})`
  // directly — no class wrapper is needed. The `assertValidCspReportUri`
  // helper is re-exported alongside it for the H-3 sanitization tests.
  // -------------------------------------------------------------------------

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
    const updatedResponseHeadersPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      'FrontendSecurityHeadersUpdated',
      {
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
            // initial and updated policies cannot drift. `connect-src`
            // now lists BOTH the concrete API Gateway domain AND the
            // document-bucket regional domain — the latter is required
            // for browser-side presigned-PUT uploads (root cause of the
            // 2026-05-08 demo-blocking regression). See `buildCsp()`
            // JSDoc for the full hardening status (#133, #194, #197).
            contentSecurityPolicy: buildCsp({
              directives: {
                // Source-list REPLACEMENT (not merge) — caller must include
                // 'self' explicitly. After API Gateway exists we swap the
                // wildcard `*.execute-api` host for the concrete API domain.
                'connect-src': [
                  "'self'",
                  `https://${apiDomain}`,
                  `https://${this.documentBucket.bucketRegionalDomainName}`,
                ],
                // #254 — same per-deploy nonce as the initial policy above.
                // We reuse the SAME `cspNonceCustomResource` instance (not a
                // second custom resource) so the two CSP headers cannot
                // drift to different nonces — both reference the same
                // `Fn::GetAtt` CFN token, which resolves once per deploy.
                'style-src': [
                  "'self'",
                  `'nonce-${this.cspNonceCustomResource!.getAttString('Nonce')}'`,
                ],
                // #201: report violations to the dedicated unauthenticated
                // /csp-report Lambda. Per CSP3, `report-uri` is exempt
                // from `connect-src` — the browser fires the POST out-of-band
                // without an explicit allowlist entry, so no `connect-src`
                // widening is needed here.
                //
                // The URL is sanitized at synth time by
                // `assertValidCspReportUri` (H-3, PR #214 OMC R2). The
                // stage prefix `/v1` is baked into the value rather than
                // computed because the API Gateway stage is configured
                // statically in `createApiGateway()`.
                'report-uri': [`https://${apiDomain}/v1/csp-report`],
              },
            }),
            override: true,
          },
        },
      }
    );

    // Update the CloudFront distribution's default behavior to use the new response headers policy
    // Note: We need to access the L1 CloudFormation construct to update this property
    const cfnDistribution = this.frontendDistribution.node
      .defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.DefaultCacheBehavior.ResponseHeadersPolicyId',
      updatedResponseHeadersPolicy.responseHeadersPolicyId
    );
  }

  /**
   * createCspNonceCustomResource — CDK construct for the per-deploy
   * style-src nonce (Issue #254).
   *
   * Provisions a tiny Lambda (`backend/functions/security/cspNonceCustomResource.ts`)
   * fronted by the CDK Provider framework. The Provider calls the handler
   * on every stack `Create`/`Update` event. The handler:
   *
   *   1. Generates a fresh base64url nonce (192 bits of entropy).
   *   2. Best-effort reads `index.html` from the frontend bucket, replaces
   *      every `__CSP_NONCE__` placeholder, and re-uploads.
   *   3. Returns the nonce via `Data.Nonce`, which CloudFormation surfaces
   *      to callers of `customResource.getAttString('Nonce')`.
   *
   * The `deployTimestamp` property is the always-changes input that
   * defeats CloudFormation's "no property delta -> skip update" optimisation,
   * so the resource re-runs on every `cdk deploy` and the nonce rotates.
   *
   * IAM scoping (least-privilege, per OMC review pattern):
   *   - `s3:GetObject` and `s3:PutObject` on EXACTLY the `index.html` key
   *     of the frontend bucket. NOT bucket-wide.
   *   - CloudWatch Logs basic execution policy.
   *
   * Deploy-workflow ordering note: when a backend deploy is followed by a
   * frontend re-upload via `rebuild-frontend` (deploy-backend.yml's frontend
   * rebuild step, OR a deploy-frontend.yml run), the re-upload would
   * naively overwrite the stamped `index.html` with the placeholder still
   * present. The composite action therefore re-performs the same
   * placeholder substitution (using the nonce read from this stack's
   * `CspStyleSrcNonce` CFN output) before uploading. See
   * `.github/actions/rebuild-frontend/action.yml`.
   */
  private createCspNonceCustomResource() {
    if (!this.frontendBucket) {
      throw new Error('Frontend bucket must be created before CSP nonce custom resource');
    }

    const skipBundling = this.node.tryGetContext('skipLambdaBundling') === 'true';

    // Lambda handler that does the read/replace/write.
    const nonceLambda = new NodejsFunction(this, 'CspNonceCustomResourceLambda', {
      functionName: `lfmt-csp-nonce-${this.stackName}`,
      entry: '../functions/security/cspNonceCustomResource.ts',
      handler: 'handler',
      runtime: LAMBDA_RUNTIME,
      architecture: LAMBDA_ARCHITECTURE,
      timeout: Duration.seconds(30),
      memorySize: 128,
      description:
        'CSP style-src nonce generator + index.html placeholder rewriter (#254). Runs on every cdk deploy.',
      bundling: {
        externalModules: ['aws-sdk', '@aws-sdk/*'],
        minify: true,
        sourceMap: true,
        forceDockerBundling: false,
      },
      // Test harness disables Lambda bundling for a fast `cdk synth` —
      // mirror the same flag the createJobLambda helper consults.
      ...(skipBundling
        ? {
            code: lambda.Code.fromInline(
              'exports.handler = async () => ({ Status: "SUCCESS", Data: { Nonce: "test" } });'
            ),
          }
        : {}),
    });

    // Least-privilege IAM: scoped to the single `index.html` key under the
    // frontend bucket. NOT the whole bucket. A scope-wide grant would let
    // a compromised Lambda overwrite the JS bundle and ship malicious code.
    nonceLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`${this.frontendBucket.bucketArn}/index.html`],
      })
    );

    // Provider construct ID intentionally prefixed with `Custom` so the
    // generated CloudFormation logical ID is filtered out by the Lambda
    // drift-guard tests (`isApplicationLambda` excludes `Custom*` because
    // those are CDK-helper Lambdas whose runtime/architecture defaults
    // we do not control via the application's `LAMBDA_*` constants). The
    // application-side handler (`nonceLambda` above) keeps its
    // `CspNonceCustomResourceLambda` name and IS counted, which is
    // correct — we control its architecture and runtime explicitly.
    const provider = new Provider(this, 'CustomCspNonceProvider', {
      onEventHandler: nonceLambda,
    });

    // The custom resource. Note `deployTimestamp` — a synth-time value
    // that changes on every `cdk deploy` so CloudFormation re-invokes
    // the handler (otherwise CFN sees identical properties and skips
    // the update, freezing the nonce).
    this.cspNonceCustomResource = new CustomResource(this, 'CspStyleSrcNonceResource', {
      serviceToken: provider.serviceToken,
      properties: {
        bucketName: this.frontendBucket.bucketName,
        // ISO-8601 UTC at synth time. Any string that differs between two
        // `cdk deploy` invocations works; using the timestamp keeps the
        // CFN diff human-readable (`OldValue` / `NewValue` show actual
        // wall-clock differences).
        deployTimestamp: new Date().toISOString(),
      },
    });

    // Surface the nonce on the stack outputs so the CI rebuild-frontend
    // composite action can read it via `aws cloudformation describe-stacks`
    // and stamp the same value into `dist/index.html` before uploading.
    // This is what closes the deploy-ordering loop when the CI rebuild
    // step runs AFTER the custom resource has updated S3 (and would
    // otherwise restore the `__CSP_NONCE__` placeholder).
    new CfnOutput(this, 'CspStyleSrcNonce', {
      value: this.cspNonceCustomResource.getAttString('Nonce'),
      description:
        'Per-deploy CSP style-src nonce (#254). Consumed by .github/actions/rebuild-frontend to stamp index.html before S3 upload. Public: surfaced in every viewer response, do NOT treat as secret.',
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
