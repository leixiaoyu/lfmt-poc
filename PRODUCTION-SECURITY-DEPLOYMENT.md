# Production Security Deployment Guide

This guide explains how to deploy the production-ready security features for LFMT POC.

## Overview

The security stack (`backend/infrastructure/lib/security-stack.ts`) implements:

1. **AWS CloudTrail** - Comprehensive audit logging
2. **AWS Config** - Compliance monitoring and rules
3. **AWS GuardDuty** - Threat detection
4. **AWS WAF** - API Gateway protection

## Prerequisites

- AWS CLI configured with appropriate credentials
- CDK v2 installed (`npm install -g aws-cdk`)
- Admin or PowerUser IAM permissions
- Email address for security alerts (optional but recommended)

## Deployment Options

###  Option 1: Standalone Security Stack (Recommended for Production)

Deploy security features as a separate stack that can be managed independently:

```bash
cd backend/infrastructure

# Deploy security stack with email alerts
npx cdk deploy LfmtSecurityStack \
  --context environment=prod \
  --context alertEmail=your-email@example.com
```

### Option 2: Integrated Deployment

To integrate the security stack with your main infrastructure, update `lib/app.ts`:

```typescript
import { SecurityStack } from './security-stack';

// After creating infrastructureStack...
const securityStack = new SecurityStack(app, `${config.stackName}-Security`, {
  env,
  environment: envName,
  alertEmail: 'your-email@example.com', // Optional
});

// Add dependency to ensure infrastructure deploys first
securityStack.addDependency(infrastructureStack);
```

Then deploy:

```bash
npx cdk deploy --all --context environment=prod
```

## Security Features Explained

### 1. AWS CloudTrail

**What it does:**
- Logs all API calls and management events
- Captures S3 data events for your buckets
- Provides immutable audit trail
- Enables forensic investigation

**Configuration:**
- **Log Retention**: 90 days in S3 (30 days hot, then Glacier)
- **Multi-Region**: Enabled (captures events from all regions)
- **Log Validation**: Enabled (detects tampering)
- **CloudWatch Integration**: Real-time monitoring

**Cost Estimate**: ~$2-5/month for typical POC usage

### 2. AWS Config

**What it does:**
- Continuously monitors resource configurations
- Ensures compliance with security policies
- Alerts on non-compliant resources
- Provides configuration history

**Managed Rules Included:**
- S3 bucket encryption enforcement
- S3 public access blocking
- IAM password policy compliance
- DynamoDB table encryption
- CloudTrail enablement check

**Configuration:**
- **Snapshot Frequency**: Daily
- **Retention**: 365 days
- **Scope**: All supported resources

**Cost Estimate**: ~$2-3/month for POC

### 3. AWS GuardDuty

**What it does:**
- Intelligent threat detection using ML
- Monitors CloudTrail logs, VPC Flow Logs, DNS logs
- Detects compromised instances, reconnaissance, unauthorized access
- Provides severity-rated findings

**Configuration:**
- **S3 Protection**: Enabled (monitors bucket access patterns)
- **Finding Frequency**: Every 15 minutes
- **Notifications**: Via AWS Console (can be integrated with SNS)

**Cost Estimate**: ~$5-10/month for POC

### 4. AWS WAF (Web Application Firewall)

**What it does:**
- Protects API Gateway from common web exploits
- Rate limiting to prevent DDoS
- SQL injection and XSS protection
- Geo-blocking capabilities

**Rules Configured:**
1. **Rate Limiting**: 2,000 requests per 5 minutes per IP
2. **AWS Managed Core Rule Set**: OWASP Top 10 protection
3. **Known Bad Inputs**: Blocks known attack signatures
4. **SQL Injection Protection**: Detects and blocks SQLi attempts

**Configuration:**
- **Scope**: Regional (for API Gateway)
- **Logging**: Enabled with CloudWatch metrics
- **Sampling**: 100% of blocked requests logged

**Cost Estimate**: ~$6-8/month + $0.60 per million requests

## Total Monthly Cost Estimate

| Service | Estimated Cost |
|---------|---------------|
| CloudTrail | $2-5 |
| Config | $2-3 |
| GuardDuty | $5-10 |
| WAF | $6-8 |
| **Total** | **$15-26/month** |

## Post-Deployment Verification

### 1. Verify CloudTrail

```bash
# Check CloudTrail status
aws cloudtrail describe-trails --region us-east-1

# View recent events
aws cloudtrail lookup-events --max-results 10
```

### 2. Verify GuardDuty

```bash
# List detectors
aws guardduty list-detectors --region us-east-1

# Get detector status
aws guardduty get-detector --detector-id <detector-id>
```

### 3. Verify AWS Config

```bash
# Check recorder status
aws configservice describe-configuration-recorders

# View compliance summary
aws configservice describe-compliance-by-config-rule
```

### 4. Verify WAF

```bash
# List Web ACLs
aws wafv2 list-web-acls --scope REGIONAL --region us-east-1

# Get Web ACL details
aws wafv2 get-web-acl --scope REGIONAL --region us-east-1 --id <acl-id> --name lfmt-api-waf-prod
```

## Monitoring and Alerts

### CloudWatch Dashboards

Create a custom dashboard to monitor security metrics:

1. Navigate to CloudWatch → Dashboards
2. Create new dashboard: `LFMT-Security-Prod`
3. Add widgets:
   - CloudTrail event count
   - GuardDuty findings (by severity)
   - WAF blocked requests
   - Config compliance status

### SNS Email Alerts

The security stack creates an SNS topic for alerts. Subscribe additional emails:

```bash
aws sns subscribe \
  --topic-arn <topic-arn-from-output> \
  --protocol email \
  --notification-endpoint your-email@example.com
```

Confirm the subscription via the email link.

### GuardDuty Findings

For automated responses to GuardDuty findings, create an EventBridge rule:

```bash
# Create rule to send GuardDuty findings to SNS
aws events put-rule \
  --name lfmt-guardduty-alerts \
  --event-pattern '{"source":["aws.guardduty"],"detail-type":["GuardDuty Finding"]}'

# Add SNS as target
aws events put-targets \
  --rule lfmt-guardduty-alerts \
  --targets "Id"="1","Arn"="<sns-topic-arn>"
```

## Integrating WAF with API Gateway

After deploying the security stack, attach the WAF to your API Gateway:

### Via AWS Console:
1. Navigate to API Gateway → Your API → Stages → prod
2. Under "Web ACL", select the WAF ACL created by the security stack
3. Click "Save Changes"

### Via AWS CLI:
```bash
# Get the WAF ARN from security stack outputs
WAF_ARN=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocDev-Security \
  --query 'Stacks[0].Outputs[?OutputKey==`WebAclArn`].OutputValue' \
  --output text)

# Get API Gateway ARN
API_ARN=$(aws apigateway get-rest-apis \
  --query "items[?name=='lfmt-api'].id" \
  --output text)

# Associate WAF with API Gateway stage
aws wafv2 associate-web-acl \
  --web-acl-arn $WAF_ARN \
  --resource-arn "arn:aws:apigateway:us-east-1::/restapis/${API_ARN}/stages/prod"
```

## Security Best Practices

### 1. Review Findings Daily

- **GuardDuty**: Check for high/medium severity findings
- **Config**: Review non-compliant resources
- **WAF**: Monitor blocked request patterns

### 2. Regular Audits

- **Weekly**: Review CloudTrail logs for suspicious activity
- **Monthly**: Audit IAM permissions and access patterns
- **Quarterly**: Full security assessment and penetration testing

### 3. Incident Response Plan

If GuardDuty detects a threat:

1. **Immediate**: Isolate affected resources (disable access keys, modify security groups)
2. **Investigation**: Review CloudTrail logs for the timeline
3. **Remediation**: Follow AWS incident response guidelines
4. **Documentation**: Log findings and actions taken

### 4. Cost Optimization

To reduce costs in non-production environments:

- Disable GuardDuty in dev/staging (enable only in prod)
- Reduce CloudTrail log retention to 30 days for dev
- Use simpler WAF rules in dev environments

## Cleanup (Development Only)

⚠️ **WARNING**: Only run these commands in development environments!

```bash
# Destroy security stack
npx cdk destroy LfmtSecurityStack --force

# Manual cleanup (if needed)
aws cloudtrail delete-trail --name lfmt-trail-dev
aws guard duty delete-detector --detector-id <detector-id>
aws configservice delete-configuration-recorder --configuration-recorder-name <recorder-name>
aws wafv2 delete-web-acl --scope REGIONAL --region us-east-1 --id <acl-id>
```

## Compliance and Reporting

### Generate Compliance Report

```bash
# Config compliance summary
aws configservice describe-compliance-by-config-rule \
  --query 'ComplianceByConfigRules[*].[ConfigRuleName,Compliance.ComplianceType]' \
  --output table

# GuardDuty findings summary
aws guardduty list-findings --detector-id <detector-id> \
  --finding-criteria '{"Criterion":{"severity":{"Gte":4}}}' \
  --max-results 50
```

### Export CloudTrail Logs

For compliance audits, export logs to a separate S3 bucket:

```bash
aws s3 sync s3://lfmt-cloudtrail-prod-<account-id>/ \
  s3://compliance-audit-logs/ \
  --exclude "*" \
  --include "*/2024/*"
```

## Support

For issues or questions:
- Security Contact: `leixiaoyu@users.noreply.github.com`
- AWS Support: Enterprise Support Plan (if applicable)
- Documentation: https://docs.aws.amazon.com/security/

## Additional Resources

- [AWS Security Best Practices](https://aws.amazon.com/architecture/security-identity-compliance/)
- [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CIS AWS Foundations Benchmark](https://www.cisecurity.org/benchmark/amazon_web_services)
