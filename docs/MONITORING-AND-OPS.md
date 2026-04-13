# Monitoring & Operations Setup

**Last Updated**: 2025-04-05
**Phase**: Production Foundation — D1-D5 Monitoring & Ops
**Status**: ✅ Implemented

---

## Overview

This document covers the monitoring, alerting, and operational tools implemented for the LFMT project (Phase 4: D1-D5).

**What's Included**:
- ✅ CloudWatch Dashboards (API Gateway, Lambda, DynamoDB, S3, Step Functions, Overview)
- ✅ CloudWatch Alarms (Lambda errors, API Gateway 5xx, DynamoDB throttling, Step Functions failures)
- ✅ Structured Logging with Correlation IDs
- ✅ AWS Budgets ($50/month with 80% & 100% alerts)
- ✅ Cost Monitoring Dashboard and Daily Spend Alarms
- ✅ Automated Rollback Scripts (Lambda, CDK Stack, DynamoDB)
- ✅ Operational Runbooks (Deployment, Incident Response, Cost Monitoring)

---

## CloudWatch Dashboards

### Available Dashboards

| Dashboard | Name | Purpose |
|-----------|------|---------|
| **API Gateway** | `${stackName}-api-gateway` | Request count, 4xx/5xx errors, latency (p50, p90, p99) |
| **Lambda** | `${stackName}-lambda` | Invocations, errors, duration, throttles, concurrency per function |
| **DynamoDB** | `${stackName}-dynamodb` | Consumed capacity, throttled requests per table |
| **S3** | `${stackName}-s3` | Bucket size, requests, errors per bucket |
| **Step Functions** | `${stackName}-step-functions` | Execution count, success/failure rate, duration |
| **Overview** | `${stackName}-overview` | Combined key metrics for system health |

### Accessing Dashboards

```bash
# Get all dashboards for a stack
aws cloudwatch list-dashboards --dashboard-name-prefix "LfmtPocDev"

# Open dashboard in browser (replace ${DASHBOARD_NAME})
DASHBOARD_NAME="LfmtPocDev-overview"
echo "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=${DASHBOARD_NAME}"
```

---

## CloudWatch Alarms

### Alarm Configuration

| Alarm | Threshold | Evaluation | Action |
|-------|-----------|------------|--------|
| **Lambda Error Rate** | >5% | 2 consecutive 5-min periods | SNS notification |
| **API Gateway 5xx** | >1% | 2 consecutive 5-min periods | SNS notification |
| **DynamoDB Throttling** | >10 requests | 3 consecutive 1-min periods | SNS notification |
| **Step Functions Failures** | >3 failures in 1 hour | 1 evaluation period | SNS notification |

### SNS Notification Setup

**Topic**: `lfmt-alarms-${stackName}`

**Subscription**: Requires manual email confirmation

1. Check your email for "AWS Notification - Subscription Confirmation"
2. Click "Confirm subscription" link
3. Verify subscription in AWS Console:
   ```bash
   aws sns list-subscriptions-by-topic --topic-arn <topic-arn>
   ```

### Alarm Status Check

```bash
# List all alarms in ALARM state
aws cloudwatch describe-alarms --state-value ALARM

# Check specific alarm
aws cloudwatch describe-alarms --alarm-names "lfmt-translate-chunk-LfmtPocDev-error-rate"
```

---

## Structured Logging

### Correlation ID Flow

```
User Request → API Gateway (generates requestId)
              ↓
           Lambda Handler (extracts requestId from event.requestContext.requestId)
              ↓
           Logger.fromAPIGatewayEvent(event)
              ↓
           All logs include correlationId
              ↓
           Response includes X-Correlation-ID header
```

### Quick Start

```typescript
import { Logger } from './utils/logger';

export const handler = async (event: any): Promise<any> => {
  const logger = Logger.fromAPIGatewayEvent(event);

  logger.info('Processing request', { userId: 'user-123' });

  try {
    const result = await doSomething();
    logger.info('Success', { result });
    return {
      statusCode: 200,
      headers: { 'X-Correlation-ID': logger.getCorrelationId() },
      body: JSON.stringify(result),
    };
  } catch (error) {
    logger.error('Failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
};
```

**Full Documentation**: [STRUCTURED-LOGGING.md](./STRUCTURED-LOGGING.md)

---

## Cost Monitoring

### AWS Budgets

**Monthly Budget**: $50 USD

**Alerts**:
- 80% ($40): Warning notification
- 100% ($50): Critical notification

**Recipients**: operations@yourcompany.com + SNS topic

### Cost Anomaly Detection (Manual Setup Required)

⚠️ **IMPORTANT**: AWS Cost Anomaly Detection must be configured manually via AWS Console.

**Setup Instructions**: See [docs/runbooks/cost-monitoring.md](./runbooks/cost-monitoring.md)

### Daily Spend Alarm

**Threshold**: $5 USD (3x daily average for $50/month budget)

**Evaluation Period**: 6 hours

**Action**: SNS notification to operations team

### Cost Monitoring Commands

```bash
# Check current month-to-date spend
aws ce get-cost-and-usage \
    --time-period Start=$(date -u +%Y-%m-01),End=$(date -u +%Y-%m-%d) \
    --granularity DAILY \
    --metrics BlendedCost

# Get cost breakdown by service (last 7 days)
aws ce get-cost-and-usage \
    --time-period Start=$(date -u -d '7 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
    --granularity DAILY \
    --metrics BlendedCost \
    --group-by Type=SERVICE
```

---

## Automated Rollback Scripts

### 1. Lambda Rollback

**Script**: `scripts/rollback-lambda.sh`

**Usage**:
```bash
# List available versions
./scripts/rollback-lambda.sh lfmt-translate-chunk-LfmtPocDev

# Rollback to version 5
./scripts/rollback-lambda.sh lfmt-translate-chunk-LfmtPocDev 5
```

**Estimated Time**: 2-5 minutes

---

### 2. CDK Stack Rollback

**Script**: `scripts/rollback-cdk-stack.sh`

**Usage**:
```bash
# Interactive rollback
./scripts/rollback-cdk-stack.sh LfmtPocDev

# Auto-confirm (skip prompts)
./scripts/rollback-cdk-stack.sh LfmtPocProd --yes
```

**Estimated Time**: 10-15 minutes

---

### 3. DynamoDB Point-in-Time Recovery

**Script**: `scripts/rollback-database.sh`

**Usage**:
```bash
# Restore to specific timestamp (ISO 8601 UTC format)
./scripts/rollback-database.sh lfmt-jobs-LfmtPocDev "2025-04-05T10:30:00Z"
```

**Estimated Time**: 10-15 minutes (restore) + manual steps to swap tables

**Note**: Creates new table `${SOURCE_TABLE}-restored-${DATE}`. Manual steps required to swap tables.

---

### 4. Emergency Cost Control

**Script**: `scripts/emergency-cost-control.sh`

**Usage**:
```bash
# Interactive emergency stop
./scripts/emergency-cost-control.sh LfmtPocDev

# Auto-confirm (requires typing "EMERGENCY")
./scripts/emergency-cost-control.sh LfmtPocProd --yes
```

**Actions Taken**:
1. Stop all running Step Functions executions
2. Disable API Gateway (throttle to 0 requests/sec)
3. Set all Lambda functions to 0 concurrency

**Estimated Time**: 2 minutes

---

## Operational Runbooks

### 1. Deployment Runbook

**Location**: [docs/runbooks/deployment.md](./runbooks/deployment.md)

**Covers**:
- Pre-deployment checklist
- Dev/Staging/Prod deployment procedures
- Post-deployment verification
- Automated rollback procedures
- Troubleshooting

---

### 2. Incident Response Runbook

**Location**: [docs/runbooks/incident-response.md](./runbooks/incident-response.md)

**Covers**:
- Severity levels (P0-P3)
- Incident response process (Detection → Investigation → Mitigation → Verification)
- Common incident scenarios with resolution steps
- Emergency contacts

---

### 3. Cost Monitoring Runbook

**Location**: [docs/runbooks/cost-monitoring.md](./runbooks/cost-monitoring.md)

**Covers**:
- Cost monitoring setup (Budgets, Anomaly Detection, Daily Alarms)
- Emergency cost control procedures
- Cost optimization tips
- Monthly cost review process

---

## Deployment

### Enable Monitoring in CDK

**File**: `backend/infrastructure/bin/lfmt-infrastructure.ts`

```typescript
const stack = new LfmtInfrastructureStack(app, 'LfmtPocDev', {
  stackName: 'LfmtPocDev',
  environment: 'dev',
  enableLogging: true,
  retainData: false,
  // Monitoring configuration (new)
  enableMonitoring: true,  // Enable CloudWatch dashboards and alarms
  operationsEmail: 'devops@yourcompany.com',  // Email for alarm notifications
  monthlyBudgetLimit: 50,  // Monthly budget in USD
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});
```

### Deploy Monitoring Stack

```bash
cd backend/infrastructure
npx cdk deploy --context environment=dev
```

**Expected Deployment Time**: 5-10 minutes

**New Resources Created**:
- 6 CloudWatch Dashboards
- 10+ CloudWatch Alarms
- 1 SNS Topic for alarms
- 1 AWS Budget with 2 notification rules
- 1 Daily spend alarm

---

## Verification

### 1. Verify Dashboards Created

```bash
aws cloudwatch list-dashboards --dashboard-name-prefix "LfmtPocDev"
# Expected: 6 dashboards (api-gateway, lambda, dynamodb, s3, step-functions, overview)
```

### 2. Verify Alarms Created

```bash
aws cloudwatch describe-alarms --alarm-name-prefix "lfmt"
# Expected: 10+ alarms (Lambda errors, API Gateway 5xx, DynamoDB throttling, Step Functions failures)
```

### 3. Verify SNS Topic Created

```bash
aws sns list-topics | grep lfmt-alarms
# Expected: 1 SNS topic
```

### 4. Verify Budget Created

```bash
aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output text)
# Expected: 1 budget named "lfmt-monthly-budget-${stackName}"
```

---

## Testing

### Trigger Test Alarm

```bash
# Manually set Lambda concurrency to 0 (will trigger throttle alarm)
aws lambda put-function-concurrency \
    --function-name lfmt-translate-chunk-LfmtPocDev \
    --reserved-concurrent-executions 0

# Wait 5-10 minutes for alarm to trigger
aws cloudwatch describe-alarms --alarm-names "lfmt-translate-chunk-LfmtPocDev-error-rate"

# Reset concurrency
aws lambda delete-function-concurrency \
    --function-name lfmt-translate-chunk-LfmtPocDev
```

### Test Structured Logging

```bash
# Invoke Lambda function
aws lambda invoke \
    --function-name lfmt-login-LfmtPocDev \
    --payload '{"body":"{\"email\":\"test@example.com\",\"password\":\"TestPassword123!\"}"}' \
    response.json

# Check CloudWatch Logs
aws logs tail /aws/lambda/lfmt-login-LfmtPocDev --follow
```

**Expected Output** (JSON formatted):
```json
{
  "timestamp": "2025-04-05T10:30:45.123Z",
  "level": "INFO",
  "correlationId": "abc123-request-id",
  "message": "Processing login request",
  "metadata": {
    "path": "/auth/login",
    "method": "POST"
  }
}
```

---

## Troubleshooting

### Issue: Alarms not triggering

**Solution**:
1. Check SNS topic subscription status:
   ```bash
   aws sns list-subscriptions-by-topic --topic-arn <topic-arn>
   ```
2. Confirm email subscription (check spam folder)
3. Verify alarm threshold configuration

### Issue: Dashboards showing "No data"

**Solution**:
1. Wait 5-10 minutes for metrics to populate
2. Verify Lambda functions have been invoked at least once
3. Check CloudWatch metric retention settings

### Issue: Budget alerts not received

**Solution**:
1. Verify budget configuration:
   ```bash
   aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output text)
   ```
2. Confirm email address is correct
3. Check SNS topic subscription

---

## Next Steps

### Phase 5: Frontend RUM (Not Implemented)

**Future Enhancement**: CloudWatch RUM for frontend monitoring

**Setup Required**:
1. Create CloudWatch RUM app monitor in CDK
2. Inject RUM script into frontend HTML (Vite plugin)
3. Track: JS errors, page load time, React component crashes, API call failures

**Estimated Effort**: 4-6 hours

---

### CI/CD Staging/Prod Pipelines (Documented, Not Automated)

**Current State**: Deployment runbooks provide manual procedures

**Future Enhancement**: Automate staging/prod deployments via GitHub Actions

**Required**:
1. Create `.github/workflows/deploy-staging.yml`
2. Create `.github/workflows/deploy-prod.yml`
3. Add smoke tests to CI pipeline
4. Configure GitHub secrets for AWS credentials

**Estimated Effort**: 6-8 hours

---

## FAQ

**Q: Do I need to update Lambda code to use structured logging?**

A: No. Existing Lambda functions continue to work with `console.log`. Migrate incrementally for better observability.

**Q: What happens if I exceed the monthly budget?**

A: You'll receive email notification at 80% and 100%. No automatic service shutdown. Use emergency cost control script if needed.

**Q: Can I disable monitoring after deployment?**

A: Yes. Set `enableMonitoring: false` in CDK configuration and redeploy. This will delete all dashboards, alarms, and budgets.

**Q: How do I add a new Lambda function to monitoring?**

A: The monitoring constructs automatically discover all Lambda functions starting with `lfmt-`. No manual configuration needed.

---

## Related Documentation

- **Structured Logging**: [STRUCTURED-LOGGING.md](./STRUCTURED-LOGGING.md)
- **Deployment Runbook**: [runbooks/deployment.md](./runbooks/deployment.md)
- **Incident Response Runbook**: [runbooks/incident-response.md](./runbooks/incident-response.md)
- **Cost Monitoring Runbook**: [runbooks/cost-monitoring.md](./runbooks/cost-monitoring.md)
- **OpenSpec Proposal**: [../openspec/changes/production-foundation/README.md](../openspec/changes/production-foundation/README.md)
