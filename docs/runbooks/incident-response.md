# Incident Response Runbook

**Last Updated**: 2025-04-05
**Owner**: DevOps Team
**Purpose**: Guide for responding to production incidents

---

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| **P0** | Critical - Total service outage | 15 minutes | API Gateway down, all users affected |
| **P1** | High - Major feature broken | 1 hour | Translation workflow failing, login broken |
| **P2** | Medium - Degraded performance | 4 hours | Slow API responses, intermittent errors |
| **P3** | Low - Minor issue | Next business day | Non-critical UI bug, cosmetic issue |

---

## Incident Response Process

### 1. Detection & Triage (5 minutes)

#### How Incidents Are Detected

- CloudWatch alarms send email notifications to operations team
- Users report issues via support email
- Automated monitoring dashboards show anomalies

#### Initial Triage Steps

1. **Acknowledge the incident**
   - Reply to alarm email with "INVESTIGATING"
   - Update incident tracking system (if applicable)

2. **Determine severity**
   - How many users affected? (1 user vs all users)
   - Which features are broken? (critical path vs minor feature)
   - Is data at risk? (data loss/corruption = P0/P1)

3. **Assemble response team**
   - P0/P1: Notify all team members immediately
   - P2/P3: Single engineer can handle during business hours

**Expected Outcome**: Severity level determined, incident owner assigned

---

### 2. Investigation (15-30 minutes)

#### Quick Diagnostic Commands

```bash
# 1. Check CloudWatch Alarms
aws cloudwatch describe-alarms --state-value ALARM

# 2. Check recent deployments
git log --oneline --since="24 hours ago"

# 3. Check API Gateway health
API_URL=$(aws cloudformation describe-stacks \
    --stack-name LfmtPocProd \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text)
curl -I $API_URL

# 4. Check Lambda errors (last 1 hour)
aws logs filter-log-events \
    --log-group-name /aws/lambda/lfmt-translate-chunk-LfmtPocProd \
    --start-time $(date -u -d '1 hour ago' +%s)000 \
    --filter-pattern "ERROR"

# 5. Check DynamoDB throttling
aws cloudwatch get-metric-statistics \
    --namespace AWS/DynamoDB \
    --metric-name UserErrors \
    --dimensions Name=TableName,Value=lfmt-jobs-LfmtPocProd \
    --start-time $(date -u -d '1 hour ago' --iso-8601=seconds) \
    --end-time $(date -u --iso-8601=seconds) \
    --period 300 \
    --statistics Sum
```

#### Common Root Causes

| Symptom | Likely Cause | Investigation |
|---------|--------------|---------------|
| API Gateway 5xx errors | Lambda function crashing | Check Lambda CloudWatch Logs |
| Lambda timeout errors | Long-running operations | Check Lambda duration metrics |
| DynamoDB throttling | Traffic spike | Check consumed capacity metrics |
| Translation failures | Gemini API rate limits | Check rate limiter logs |
| Frontend not loading | CloudFront/S3 issue | Check CloudFront access logs |

**Expected Outcome**: Root cause identified or hypothesized

---

### 3. Mitigation (10-20 minutes)

#### P0/P1 Incident - Immediate Actions

**Goal**: Stop the bleeding, restore service ASAP

##### Option 1: Automated Rollback (Preferred)

```bash
# Rollback entire stack
./scripts/rollback-cdk-stack.sh LfmtPocProd --yes

# Monitor rollback
# Estimated time: 10 minutes
```

##### Option 2: Rollback Specific Component

```bash
# Rollback single Lambda function
./scripts/rollback-lambda.sh lfmt-translate-chunk-LfmtPocProd <previous-version>

# Rollback DynamoDB table (if data corruption)
./scripts/rollback-database.sh lfmt-jobs-LfmtPocProd "2025-04-05T10:00:00Z"
```

##### Option 3: Emergency Kill Switch (Runaway Costs)

```bash
# Disable API Gateway (stop all traffic)
aws apigateway update-rest-api \
    --rest-api-id <api-id> \
    --patch-operations op=replace,path=/minimumCompressionSize,value=0

# Stop all Step Functions executions
STATE_MACHINE_ARN=$(aws cloudformation describe-stacks \
    --stack-name LfmtPocProd \
    --query 'Stacks[0].Outputs[?OutputKey==`TranslationStateMachineArn`].OutputValue' \
    --output text)

aws stepfunctions list-executions \
    --state-machine-arn $STATE_MACHINE_ARN \
    --status-filter RUNNING \
    --query 'executions[].executionArn' \
    --output text | xargs -n1 aws stepfunctions stop-execution --execution-arn
```

**Expected Outcome**: Service restored or incident contained

---

### 4. Verification (10 minutes)

#### Post-Mitigation Checks

```bash
# 1. Verify CloudWatch alarms are green
aws cloudwatch describe-alarms --state-value ALARM
# Expected: No alarms in ALARM state

# 2. Test critical user journeys
# Login
curl -X POST "${API_URL}auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"TestPassword123!"}'

# Upload
curl -X POST "${API_URL}jobs/upload" \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"filename":"test.txt","fileSize":1024}'

# 3. Check error rates (should be <1%)
aws cloudwatch get-metric-statistics \
    --namespace AWS/Lambda \
    --metric-name Errors \
    --dimensions Name=FunctionName,Value=lfmt-translate-chunk-LfmtPocProd \
    --start-time $(date -u -d '15 minutes ago' --iso-8601=seconds) \
    --end-time $(date -u --iso-8601=seconds) \
    --period 300 \
    --statistics Sum
```

**Expected Outcome**: All systems operational, no active alarms

---

### 5. Communication (Throughout Incident)

#### Internal Updates

- **Start of incident**: Notify team in Slack/email
- **Every 30 minutes**: Send status update (P0/P1 incidents)
- **Resolution**: Send incident summary

#### External Updates (Production Only)

- **Start of incident** (P0/P1): Update status page (if applicable)
- **Resolution**: Post-mortem summary for affected users

---

### 6. Post-Incident Review (Within 48 hours)

#### Post-Mortem Template

```markdown
# Incident Post-Mortem: [Incident Title]

**Date**: 2025-04-05
**Severity**: P1
**Duration**: 45 minutes
**Impact**: 50% of translation requests failed

## Timeline

- 14:00 UTC: CloudWatch alarm triggered (Lambda error rate > 5%)
- 14:05 UTC: Incident acknowledged, investigation started
- 14:15 UTC: Root cause identified (new Lambda deployment broke translation logic)
- 14:25 UTC: Rollback initiated using automated script
- 14:35 UTC: Rollback completed, service restored
- 14:45 UTC: Verification complete, incident closed

## Root Cause

Lambda function `lfmt-translate-chunk-LfmtPocProd` deployed at 13:55 UTC contained
a bug in error handling that caused all Gemini API 429 errors to fail permanently
instead of retrying.

## Resolution

Rolled back Lambda function to version 12 using `./scripts/rollback-lambda.sh`.

## Action Items

- [ ] Add integration test for Gemini API 429 error handling
- [ ] Improve smoke tests to catch this issue before production deployment
- [ ] Document Gemini API rate limiting behavior in developer docs

## Lessons Learned

- **What went well**: Automated rollback script worked perfectly, incident resolved in 35 minutes
- **What could improve**: Should have caught this in smoke tests, need better test coverage for error handling
```

---

## Common Incident Scenarios

### Scenario 1: API Gateway 5xx Errors Spike

**Symptoms**: CloudWatch alarm "API Gateway 5xx error rate > 1%"

**Likely Causes**:
1. Lambda function crashing (check Lambda logs)
2. DynamoDB throttling (check consumed capacity)
3. Recent deployment introduced bug

**Resolution**:
```bash
# Check which Lambda is failing
aws logs filter-log-events \
    --log-group-name /aws/lambda/lfmt-* \
    --start-time $(date -u -d '1 hour ago' +%s)000 \
    --filter-pattern "ERROR"

# If recent deployment, rollback
./scripts/rollback-cdk-stack.sh LfmtPocProd
```

---

### Scenario 2: Translation Jobs Stuck in "IN_PROGRESS"

**Symptoms**: Users report translation never completes

**Likely Causes**:
1. Step Functions execution failed (check state machine logs)
2. Gemini API rate limiting (check rate limiter metrics)
3. Lambda timeout (check Lambda duration metrics)

**Resolution**:
```bash
# Check Step Functions executions
aws stepfunctions list-executions \
    --state-machine-arn $STATE_MACHINE_ARN \
    --status-filter FAILED

# Describe failed execution
aws stepfunctions describe-execution \
    --execution-arn <execution-arn>

# If rate limiting issue, wait for cooldown (distributed rate limiter resets every 60s)
# If Lambda timeout, increase timeout in CDK and redeploy
```

---

### Scenario 3: DynamoDB Throttling Alarm

**Symptoms**: CloudWatch alarm "DynamoDB throttled requests > 10"

**Likely Causes**:
1. Traffic spike (check CloudWatch metrics)
2. Inefficient query patterns (check DynamoDB query metrics)

**Resolution**:
```bash
# Check consumed capacity
aws cloudwatch get-metric-statistics \
    --namespace AWS/DynamoDB \
    --metric-name ConsumedReadCapacityUnits \
    --dimensions Name=TableName,Value=lfmt-jobs-LfmtPocProd \
    --start-time $(date -u -d '1 hour ago' --iso-8601=seconds) \
    --end-time $(date -u --iso-8601=seconds) \
    --period 300 \
    --statistics Sum

# Temporary fix: Enable autoscaling (manual step via AWS Console)
# Long-term: Optimize queries, add caching
```

---

### Scenario 4: Runaway AWS Costs

**Symptoms**: AWS Budget alarm "80% of monthly budget exceeded"

**Likely Causes**:
1. Infinite loop in Lambda function
2. Large number of failed retries (check Step Functions execution count)
3. Unexpected traffic spike

**Resolution**:
```bash
# Emergency: Stop all Step Functions executions
./scripts/emergency-cost-control.sh  # See runbook: cost-monitoring.md

# Check largest cost drivers
aws ce get-cost-and-usage \
    --time-period Start=$(date -u -d '7 days ago' +%Y-%m-%d),End=$(date -u +%Y-%m-%d) \
    --granularity DAILY \
    --metrics BlendedCost \
    --group-by Type=SERVICE
```

---

## Emergency Contacts

| Role | Name | Contact | Timezone |
|------|------|---------|----------|
| Primary On-Call | DevOps Team | devops@yourcompany.com | UTC |
| Secondary On-Call | Project Owner | raymond@yourcompany.com | UTC |
| AWS Support | N/A | AWS Console | 24/7 |

---

## Appendix: CloudWatch Insights Queries

### Find all errors in last hour

```
fields @timestamp, @message, @logStream
| filter level = "ERROR"
| sort @timestamp desc
| limit 100
```

### Track request by correlation ID

```
fields @timestamp, level, message, metadata
| filter correlationId = "<correlation-id>"
| sort @timestamp asc
```

### Find slow requests (>3s)

```
fields @timestamp, correlationId, message, metadata.duration
| filter metadata.duration > 3000
| sort @timestamp desc
```
