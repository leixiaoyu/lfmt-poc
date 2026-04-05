# Cost Monitoring & Emergency Cost Control Runbook

**Last Updated**: 2025-04-05
**Owner**: DevOps Team / FinOps
**Monthly Budget**: $50 USD

---

## Overview

This runbook covers AWS cost monitoring, budget alerts, and emergency cost control procedures for the LFMT project.

**Cost Breakdown (Estimated)**:
- Lambda: ~$10/month (1M invocations)
- API Gateway: ~$5/month (1M requests)
- DynamoDB: ~$10/month (on-demand)
- S3: ~$5/month (10GB storage + requests)
- CloudFront: ~$5/month (1GB egress)
- Step Functions: ~$10/month (10K state transitions)
- Other (Cognito, Secrets Manager, CloudWatch): ~$5/month

**Total**: ~$50/month

---

## Cost Monitoring Setup

### 1. AWS Budgets (Automated via CDK)

**Budget Configuration**:
- Monthly budget: $50 USD
- Alert at 80%: $40 USD (warning)
- Alert at 100%: $50 USD (critical)

**Notifications**:
- Email: operations@yourcompany.com
- SNS Topic: `lfmt-cost-alarms-${environment}`

**Verification**:
```bash
# Check budget status
aws budgets describe-budgets --account-id $(aws sts get-caller-identity --query Account --output text)

# Check current month-to-date spend
aws ce get-cost-and-usage \
    --time-period Start=$(date -u +%Y-%m-01),End=$(date -u +%Y-%m-%d) \
    --granularity DAILY \
    --metrics BlendedCost
```

---

### 2. AWS Cost Anomaly Detection (Manual Setup Required)

**⚠️ IMPORTANT**: AWS Cost Anomaly Detection must be configured manually via AWS Console.

#### Setup Instructions

1. Go to AWS Console → Cost Management → Cost Anomaly Detection
2. Click "Create monitor"
3. Configure monitor:
   - **Name**: `LFMT Cost Anomaly Monitor`
   - **Monitor type**: AWS Services
   - **Alerting preferences**:
     - Individual alerts: Enabled
     - Alert threshold: $5 (detect spikes > $5/day)
     - Notification frequency: Immediately
   - **Recipients**: operations@yourcompany.com
4. Click "Create monitor"

**Verification**:
```bash
# List all cost anomaly monitors
aws ce get-anomaly-monitors

# List recent anomalies
aws ce get-anomalies \
    --date-interval Start=$(date -u -d '7 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d)
```

---

### 3. Daily Spend Alarm (Automated via CDK)

**Alarm Configuration**:
- Metric: AWS/Billing EstimatedCharges
- Threshold: $5 (3x daily average for $50/month budget)
- Evaluation Period: 6 hours
- Action: SNS notification to operations team

**Verification**:
```bash
# Check alarm status
aws cloudwatch describe-alarms --alarm-names "LfmtPocDev-daily-spend-spike"

# View current estimated charges
aws cloudwatch get-metric-statistics \
    --namespace AWS/Billing \
    --metric-name EstimatedCharges \
    --dimensions Name=Currency,Value=USD \
    --start-time $(date -u -d '24 hours ago' --iso-8601=seconds) \
    --end-time $(date -u --iso-8601=seconds) \
    --period 86400 \
    --statistics Maximum
```

---

## Cost Monitoring Dashboard

**CloudWatch Dashboard**: `${stackName}-cost-monitoring`

**Widgets**:
- Estimated charges (daily trend)
- Lambda invocations (cost driver)
- API Gateway requests (cost driver)
- S3 storage size (cost driver)
- DynamoDB consumed capacity (cost driver)

**Access**:
```bash
# Get dashboard URL
DASHBOARD_NAME="LfmtPocDev-cost-monitoring"
echo "https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=${DASHBOARD_NAME}"
```

---

## Emergency Cost Control Procedures

### Scenario 1: Budget Alert (80% of $50 = $40)

**Severity**: P2 (Warning)

**Actions**:

1. **Investigate cost spike**
   ```bash
   # Check cost breakdown by service (last 7 days)
   aws ce get-cost-and-usage \
       --time-period Start=$(date -u -d '7 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
       --granularity DAILY \
       --metrics BlendedCost \
       --group-by Type=SERVICE

   # Identify top cost drivers
   ```

2. **Check for runaway processes**
   ```bash
   # Check Lambda invocation count (last 24h)
   aws cloudwatch get-metric-statistics \
       --namespace AWS/Lambda \
       --metric-name Invocations \
       --dimensions Name=FunctionName,Value=lfmt-translate-chunk-LfmtPocDev \
       --start-time $(date -u -d '24 hours ago' --iso-8601=seconds) \
       --end-time $(date -u --iso-8601=seconds) \
       --period 3600 \
       --statistics Sum

   # Check Step Functions execution count (last 24h)
   aws stepfunctions list-executions \
       --state-machine-arn $STATE_MACHINE_ARN \
       --max-results 1000 \
       | jq '.executions | length'
   ```

3. **Optimize if needed**
   - Reduce Lambda memory (if over-provisioned)
   - Enable S3 Intelligent-Tiering
   - Review DynamoDB capacity mode (on-demand vs provisioned)

---

### Scenario 2: Budget Exceeded (100% of $50)

**Severity**: P1 (Critical)

**Actions**:

1. **Immediate investigation**
   - Follow steps from Scenario 1
   - Check for unauthorized API usage (review CloudWatch Logs)

2. **Contact AWS Support** (if unexpected charges)
   - Open support case for billing review
   - Request cost breakdown

3. **Plan to reduce costs** (if legitimate usage)
   - Defer non-critical workloads
   - Optimize infrastructure (see Cost Optimization section)

---

### Scenario 3: Runaway Costs (Infinite Loop Detected)

**Severity**: P0 (Emergency)

**Goal**: Stop all billable resources immediately

#### Emergency Kill Switch Script

```bash
#!/bin/bash
# File: scripts/emergency-cost-control.sh

set -euo pipefail

STACK_NAME="${1:-LfmtPocDev}"

echo "⚠️  EMERGENCY COST CONTROL ACTIVATED ⚠️"
echo ""
echo "This will STOP all billable resources for stack: $STACK_NAME"
echo ""
read -p "Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "Cancelled"
    exit 0
fi

# 1. Stop all Step Functions executions
echo "Step 1: Stopping all Step Functions executions..."
STATE_MACHINE_ARN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`TranslationStateMachineArn`].OutputValue' \
    --output text)

aws stepfunctions list-executions \
    --state-machine-arn $STATE_MACHINE_ARN \
    --status-filter RUNNING \
    --query 'executions[].executionArn' \
    --output text | xargs -n1 aws stepfunctions stop-execution --execution-arn

echo "✓ All Step Functions executions stopped"

# 2. Disable API Gateway (block all incoming traffic)
echo "Step 2: Disabling API Gateway..."
API_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiId`].OutputValue' \
    --output text)

# Update API Gateway to reject all requests (set throttle to 0)
aws apigateway update-stage \
    --rest-api-id $API_ID \
    --stage-name v1 \
    --patch-operations \
        op=replace,path=/throttle/rateLimit,value=0 \
        op=replace,path=/throttle/burstLimit,value=0

echo "✓ API Gateway throttled to 0 requests/sec"

# 3. Set all Lambda concurrency to 0 (prevent new invocations)
echo "Step 3: Setting Lambda concurrency to 0..."
aws lambda list-functions \
    --query "Functions[?starts_with(FunctionName, 'lfmt-')].FunctionName" \
    --output text | xargs -n1 -I {} aws lambda put-function-concurrency \
        --function-name {} \
        --reserved-concurrent-executions 0

echo "✓ All Lambda functions set to 0 concurrency"

echo ""
echo "========================================"
echo "✓ EMERGENCY COST CONTROL COMPLETE"
echo "========================================"
echo ""
echo "All billable resources have been stopped."
echo ""
echo "To restore service:"
echo "1. Identify root cause of cost spike"
echo "2. Fix the issue"
echo "3. Re-enable resources via AWS Console or CDK redeploy"
```

**Estimated Time**: 2 minutes

---

## Cost Optimization Tips

### 1. Lambda Optimization

```bash
# Reduce memory for functions that don't need it
# Lower memory = lower cost per invocation

# Example: Reduce register function from 256MB to 128MB
aws lambda update-function-configuration \
    --function-name lfmt-register-LfmtPocDev \
    --memory-size 128
```

**Savings**: ~50% reduction for low-CPU functions

---

### 2. S3 Intelligent-Tiering

```bash
# Enable Intelligent-Tiering on document bucket
aws s3api put-bucket-intelligent-tiering-configuration \
    --bucket lfmt-documents-lfmtpocdev \
    --id "AutoTiering" \
    --intelligent-tiering-configuration '{
        "Id": "AutoTiering",
        "Status": "Enabled",
        "Tierings": [
            {
                "Days": 30,
                "AccessTier": "ARCHIVE_ACCESS"
            }
        ]
    }'
```

**Savings**: ~70% reduction for infrequently accessed files

---

### 3. DynamoDB On-Demand vs Provisioned

**Current**: On-demand (pay per request)

**Alternative**: Provisioned capacity (if predictable workload)

```bash
# Switch to provisioned capacity (example: 5 RCU, 5 WCU)
aws dynamodb update-table \
    --table-name lfmt-jobs-LfmtPocDev \
    --billing-mode PROVISIONED \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5
```

**Savings**: ~50% reduction if workload is consistent

---

### 4. CloudWatch Logs Retention

**Current**: 30 days (dev), 6 months (prod)

**Optimization**: Reduce to 7 days for non-critical logs

```bash
# Reduce retention for non-critical log groups
aws logs put-retention-policy \
    --log-group-name /aws/lambda/lfmt-register-LfmtPocDev \
    --retention-in-days 7
```

**Savings**: ~70% reduction in CloudWatch Logs costs

---

## Monthly Cost Review Process

**Schedule**: First Monday of each month

### 1. Generate Cost Report

```bash
# Generate cost report for previous month
LAST_MONTH_START=$(date -u -d 'last month' +%Y-%m-01)
LAST_MONTH_END=$(date -u -d 'last day of last month' +%Y-%m-%d)

aws ce get-cost-and-usage \
    --time-period Start=$LAST_MONTH_START,End=$LAST_MONTH_END \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --group-by Type=SERVICE \
    > last-month-cost-report.json

# View report
cat last-month-cost-report.json | jq '.ResultsByTime[0].Groups[] | {Service: .Keys[0], Cost: .Metrics.BlendedCost.Amount}'
```

### 2. Identify Anomalies

- Compare costs to previous month
- Identify services with >20% increase
- Investigate spikes

### 3. Optimization Recommendations

- Review unused resources (e.g., old S3 files, DynamoDB tables)
- Check for over-provisioned Lambda memory
- Evaluate CloudWatch Logs retention policies

---

## Appendix: Useful Cost Commands

### Get cost by service (last 30 days)

```bash
aws ce get-cost-and-usage \
    --time-period Start=$(date -u -d '30 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --group-by Type=SERVICE
```

### Get cost by tag (requires tagging)

```bash
aws ce get-cost-and-usage \
    --time-period Start=$(date -u -d '30 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --group-by Type=TAG,Key=Project
```

### Forecast next month's cost

```bash
aws ce get-cost-forecast \
    --time-period Start=$(date -u +%Y-%m-%d),End=$(date -u -d '30 days' +%Y-%m-%d) \
    --metric BLENDED_COST \
    --granularity MONTHLY
```
