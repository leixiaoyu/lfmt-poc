/**
 * Security Stack for LFMT POC
 *
 * This stack implements production-ready security features:
 * - AWS CloudTrail for audit logging
 * - AWS Config for compliance monitoring
 * - AWS GuardDuty for threat detection
 * - AWS WAF for API Gateway protection
 *
 * These services are account/region-level and should be deployed once per environment.
 */

import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as guardduty from 'aws-cdk-lib/aws-guardduty';
import * as config from 'aws-cdk-lib/aws-config';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';

export interface SecurityStackProps extends StackProps {
  environment: string;
  apiGatewayArn?: string; // Optional - can be set after API is created
  alertEmail?: string; // Email for security alerts
}

export class SecurityStack extends Stack {
  public readonly webAcl: wafv2.CfnWebACL;
  public readonly cloudTrail: cloudtrail.Trail;

  constructor(scope: Construct, id: string, props: SecurityStackProps) {
    super(scope, id, props);

    const { environment, alertEmail } = props;

    // SNS Topic for security alerts
    const securityAlertsTopic = this.createSecurityAlertsTopic(alertEmail);

    // 1. CloudTrail for audit logging
    this.cloudTrail = this.createCloudTrail(environment);

    // 2. GuardDuty for threat detection
    this.createGuardDuty(securityAlertsTopic);

    // 3. AWS Config for compliance monitoring
    this.createAwsConfig(environment);

    // 4. WAF Web ACL for API Gateway
    this.webAcl = this.createWafWebAcl(environment);
  }

  /**
   * Create SNS topic for security alerts
   */
  private createSecurityAlertsTopic(email?: string): sns.Topic {
    const topic = new sns.Topic(this, 'SecurityAlertsTopic', {
      topicName: `lfmt-security-alerts-${this.stackName}`,
      displayName: 'LFMT Security Alerts',
    });

    if (email) {
      topic.addSubscription(new subscriptions.EmailSubscription(email));
    }

    return topic;
  }

  /**
   * Create CloudTrail for comprehensive audit logging
   */
  private createCloudTrail(environment: string): cloudtrail.Trail {
    // S3 bucket for CloudTrail logs
    const cloudTrailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      bucketName: `lfmt-cloudtrail-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'DeleteOldLogs',
          expiration: Duration.days(90), // Retain logs for 90 days
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(30),
            },
          ],
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN, // Always retain audit logs
    });

    // CloudTrail
    const trail = new cloudtrail.Trail(this, 'CloudTrail', {
      trailName: `lfmt-trail-${environment}`,
      bucket: cloudTrailBucket,
      isMultiRegionTrail: true, // Capture events from all regions
      includeGlobalServiceEvents: true, // Include IAM, CloudFront, etc.
      enableFileValidation: true, // Enable log file integrity validation
      managementEvents: cloudtrail.ReadWriteType.ALL, // Log all management events
      sendToCloudWatchLogs: true, // Send to CloudWatch for real-time monitoring
    });

    // Log S3 data events for our buckets
    trail.logAllS3DataEvents();

    return trail;
  }

  /**
   * Create GuardDuty detector for threat detection
   */
  private createGuardDuty(alertTopic: sns.Topic): guardduty.CfnDetector {
    const detector = new guardduty.CfnDetector(this, 'GuardDutyDetector', {
      enable: true,
      dataSources: {
        s3Logs: {
          enable: true, // Monitor S3 access patterns
        },
        kubernetes: {
          auditLogs: {
            enable: false, // Not using EKS in this POC
          },
        },
      },
      findingPublishingFrequency: 'FIFTEEN_MINUTES', // Publish findings every 15 minutes
    });

    // Note: GuardDuty findings can be sent to EventBridge for automated responses
    // For simplicity, we'll rely on the GuardDuty console for now
    // In production, consider adding EventBridge rules to trigger SNS notifications

    return detector;
  }

  /**
   * Create AWS Config for compliance monitoring
   */
  private createAwsConfig(environment: string): config.CfnConfigurationRecorder {
    // S3 bucket for Config snapshots
    const configBucket = new s3.Bucket(this, 'ConfigBucket', {
      bucketName: `lfmt-config-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      lifecycleRules: [
        {
          id: 'DeleteOldSnapshots',
          expiration: Duration.days(365), // Retain for 1 year
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // IAM role for Config
    const configRole = new iam.Role(this, 'ConfigRole', {
      assumedBy: new iam.ServicePrincipal('config.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/ConfigRole'),
      ],
    });

    configBucket.grantReadWrite(configRole);

    // Configuration Recorder
    const recorder = new config.CfnConfigurationRecorder(this, 'ConfigRecorder', {
      name: `lfmt-config-recorder-${environment}`,
      roleArn: configRole.roleArn,
      recordingGroup: {
        allSupported: true, // Record all supported resources
        includeGlobalResourceTypes: true, // Include IAM, etc.
      },
    });

    // Delivery Channel
    new config.CfnDeliveryChannel(this, 'ConfigDeliveryChannel', {
      name: `lfmt-config-delivery-${environment}`,
      s3BucketName: configBucket.bucketName,
      configSnapshotDeliveryProperties: {
        deliveryFrequency: 'TwentyFour_Hours', // Daily snapshots
      },
    });

    // Add managed Config rules for security compliance
    this.addConfigRules();

    return recorder;
  }

  /**
   * Add AWS Config managed rules for security compliance
   */
  private addConfigRules() {
    // Rule: S3 buckets must have encryption enabled
    new config.ManagedRule(this, 'S3BucketEncryptionRule', {
      identifier: config.ManagedRuleIdentifiers.S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED,
      description: 'Checks that S3 buckets have encryption enabled',
    });

    // Rule: S3 buckets must block public access
    new config.ManagedRule(this, 'S3BucketPublicAccessRule', {
      identifier: config.ManagedRuleIdentifiers.S3_BUCKET_PUBLIC_READ_PROHIBITED,
      description: 'Checks that S3 buckets do not allow public read access',
    });

    // Rule: IAM password policy
    new config.ManagedRule(this, 'IAMPasswordPolicyRule', {
      identifier: config.ManagedRuleIdentifiers.IAM_PASSWORD_POLICY,
      description: 'Checks that the account password policy meets requirements',
      inputParameters: {
        RequireUppercaseCharacters: true,
        RequireLowercaseCharacters: true,
        RequireNumbers: true,
        MinimumPasswordLength: 14,
        MaxPasswordAge: 90,
      },
    });

    // Rule: DynamoDB tables must have encryption
    new config.ManagedRule(this, 'DynamoDBEncryptionRule', {
      identifier: config.ManagedRuleIdentifiers.DYNAMODB_TABLE_ENCRYPTED_KMS,
      description: 'Checks that DynamoDB tables are encrypted',
    });

    // Rule: CloudTrail must be enabled
    new config.ManagedRule(this, 'CloudTrailEnabledRule', {
      identifier: config.ManagedRuleIdentifiers.CLOUD_TRAIL_ENABLED,
      description: 'Checks that CloudTrail is enabled in the account',
    });
  }

  /**
   * Create WAF Web ACL for API Gateway protection
   */
  private createWafWebAcl(environment: string): wafv2.CfnWebACL {
    const webAcl = new wafv2.CfnWebACL(this, 'ApiGatewayWebACL', {
      name: `lfmt-api-waf-${environment}`,
      scope: 'REGIONAL', // For API Gateway
      defaultAction: {
        allow: {}, // Allow by default, block based on rules
      },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `lfmt-waf-${environment}`,
      },
      rules: [
        // Rule 1: Rate limiting - max 2000 requests per 5 minutes per IP
        {
          name: 'RateLimitRule',
          priority: 1,
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          action: {
            block: {}, // Block if rate limit exceeded
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimitRule',
          },
        },
        // Rule 2: AWS Managed Rules - Core Rule Set (CRS)
        {
          name: 'AWSManagedRulesCommonRuleSet',
          priority: 2,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
            },
          },
          overrideAction: {
            none: {}, // Use rule group's default actions
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesCommonRuleSet',
          },
        },
        // Rule 3: Known Bad Inputs
        {
          name: 'AWSManagedRulesKnownBadInputsRuleSet',
          priority: 3,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesKnownBadInputsRuleSet',
          },
        },
        // Rule 4: SQL Injection Protection
        {
          name: 'AWSManagedRulesSQLiRuleSet',
          priority: 4,
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesSQLiRuleSet',
            },
          },
          overrideAction: {
            none: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedRulesSQLiRuleSet',
          },
        },
        // Rule 5: Block requests from specific countries (optional - customize as needed)
        // Uncomment and modify if you want to restrict access by geography
        /*
        {
          name: 'GeoBlockRule',
          priority: 5,
          statement: {
            geoMatchStatement: {
              countryCodes: ['CN', 'RU'], // Block China and Russia (example)
            },
          },
          action: {
            block: {},
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'GeoBlockRule',
          },
        },
        */
      ],
    });

    return webAcl;
  }
}
