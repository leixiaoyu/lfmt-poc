# LFMT POC - Testing Instructions (Phase 10)

**Created**: 2025-12-21
**Purpose**: Step-by-step guide for testing the LFMT POC application with demo account

---

## 🎯 Testing Overview

This document provides detailed instructions for manually testing the translation workflow using the demo account. Follow these steps to validate the end-to-end translation functionality and capture metrics for investor demonstrations.

---

## 📋 Prerequisites

### Required Information
- **Frontend URL**: https://d39xcun7144jgl.cloudfront.net
- **Demo Account Email**: `demo@lfmt-poc.dev`
- **Demo Account Password**: (See `demo/CREDENTIALS.md` - not committed to git)
- **Test Documents**: Located in `demo/test-documents/`
- **AWS Region**: us-east-1
- **Environment**: Development (LfmtPocDev)

### Browser Setup
- **Recommended**: Chrome or Edge (for Claude for Chrome extension compatibility)
- **Extensions**: Claude for Chrome (optional, for AI-assisted testing)
- **Network**: Stable internet connection (translations may take 30 min to 6 hours)

---

## 🚀 Testing Workflow

### Step 1: Login to Application

1. **Open Frontend URL**:
   ```
   https://d39xcun7144jgl.cloudfront.net
   ```

2. **Click "Login" or navigate to login page**

3. **Enter Demo Credentials**:
   - Email: `demo@lfmt-poc.dev`
   - Password: (from `demo/CREDENTIALS.md`)

4. **Verify Successful Login**:
   - Should redirect to dashboard/home page
   - Should see user menu with email `demo@lfmt-poc.dev`
   - No email verification required (auto-verified in dev environment)

**✅ Expected Result**: Successfully logged in, redirected to main application interface

---

### Step 2: Upload Test Document #1 - Sherlock Holmes (Spanish)

#### Document Details
- **File**: `demo/test-documents/sherlock-holmes.txt`
- **Word Count**: 107,562 words
- **Target Language**: Spanish
- **Estimated Time**: 30-45 minutes
- **Estimated Cost**: $0.02-0.03

#### Upload Steps

1. **Navigate to "New Translation" or "Upload" page**

2. **Select File**:
   - Click "Choose File" or drag-and-drop
   - Select `demo/test-documents/sherlock-holmes.txt`

3. **Configure Translation**:
   - **Target Language**: Spanish (Español)
   - **Source Language**: Auto-detect or English
   - Verify file name and size displayed correctly

4. **Legal Attestation** (if required):
   - ✅ "I confirm I own the copyright to this document or have permission to translate it"
   - ✅ "I understand I am responsible for ensuring translation rights"
   - ✅ "I accept liability for any copyright violations"
   - Click "I Agree" or "Accept"

5. **Initiate Translation**:
   - Click "Start Translation" or "Upload"
   - **Record Start Time**: Note exact timestamp

6. **Monitor Progress**:
   - Watch progress bar and percentage updates
   - Observe adaptive polling behavior (15s → 30s → 60s intervals)
   - Note any status changes: PENDING → CHUNKING → CHUNKED → TRANSLATING → COMPLETED

**✅ Expected Result**: Translation starts, progress indicator shows 0% → increasing percentage

---

### Step 3: Upload Test Document #2 - Pride and Prejudice (French)

#### Document Details
- **File**: `demo/test-documents/pride-and-prejudice.txt`
- **Word Count**: 127,381 words
- **Target Language**: French
- **Estimated Time**: 60-90 minutes
- **Estimated Cost**: $0.03-0.04

#### Upload Steps
1. **Repeat Step 2 workflow** with following changes:
   - File: `demo/test-documents/pride-and-prejudice.txt`
   - Target Language: French (Français)
   - **Record Start Time**: Note exact timestamp

2. **Verify Parallel Processing** (if Sherlock Holmes still running):
   - Both translations should process simultaneously
   - Progress tracking should work independently for each job

**✅ Expected Result**: Second translation starts, both jobs running in parallel

---

### Step 4: Upload Test Document #3 - War and Peace (German)

#### Document Details
- **File**: `demo/test-documents/war-and-peace.txt`
- **Word Count**: 566,338 words
- **Target Language**: German
- **Estimated Time**: 4-6 hours (overnight run recommended)
- **Estimated Cost**: $0.10-0.15

#### Upload Steps
1. **Repeat Step 2 workflow** with following changes:
   - File: `demo/test-documents/war-and-peace.txt`
   - Target Language: German (Deutsch)
   - **Record Start Time**: Note exact timestamp

2. **Plan for Long-Running Translation**:
   - This translation will take 4-6 hours
   - Can close browser tab (translation continues server-side)
   - Can check progress by refreshing translation history page

**✅ Expected Result**: Large document translation starts, system handles long-running job correctly

---

## 📊 Metrics Collection

For **each translation job**, capture the following metrics:

### 1. Performance Metrics

**During Translation**:
- [ ] Start timestamp (when "Start Translation" clicked)
- [ ] First chunk processing time (time until progress > 0%)
- [ ] Progress update intervals (15s, 30s, 60s - observe adaptive polling)
- [ ] Any rate limiting delays observed in UI

**After Completion**:
- [ ] End timestamp (when progress reaches 100%)
- [ ] Total processing time (end - start)
- [ ] Total chunks processed / total chunks (should be 100%)
- [ ] Average time per chunk (total time / chunk count)

**Data to Record**:
```json
{
  "performance": {
    "startTime": "2025-12-21T10:00:00Z",
    "endTime": "2025-12-21T10:35:00Z",
    "totalDurationMinutes": 35,
    "chunksProcessed": 42,
    "totalChunks": 42,
    "averageSecondsPerChunk": 50,
    "rateLimitingDelays": "None observed"
  }
}
```

---

### 2. Cost Metrics

**Access AWS CloudWatch Logs**:
```bash
# View translateChunk Lambda logs
aws logs tail /aws/lambda/lfmt-translate-chunk-LfmtPocDev --follow --filter-pattern "usageMetadata"

# Extract token usage
aws logs filter-log-events \
  --log-group-name /aws/lambda/lfmt-translate-chunk-LfmtPocDev \
  --filter-pattern "usageMetadata" \
  --query 'events[*].message' \
  --output text
```

**Data to Extract**:
- Input tokens per chunk
- Output tokens per chunk
- Total input tokens for document
- Total output tokens for document

**Calculate Costs** (Gemini 2.5 Flash Free Tier):
- Free tier limits: 5 RPM, 250K TPM, 25 RPD
- Cost per 1 million tokens: $0 (within free tier)
- Estimated cost if paid: Input $0.075/1M tokens, Output $0.30/1M tokens

**Data to Record**:
```json
{
  "cost": {
    "inputTokens": 150000,
    "outputTokens": 120000,
    "estimatedCostUSD": 0.047,
    "freeTierUsed": true,
    "actualCostUSD": 0.00
  }
}
```

---

### 3. Quality Metrics

**Spot-Check Translation Quality**:
1. **Download Translated Document** from UI
2. **Select 5-10 Passages** (beginning, middle, end, dialogue, narrative)
3. **Evaluate Each Passage** using criteria below

**Evaluation Criteria** (1-5 scale):
- **Coherence**: Does translation read naturally? (1=broken, 5=fluent)
- **Context Preservation**: Are connections between chunks maintained? (1=lost, 5=perfect)
- **Semantic Accuracy**: Does meaning match source text? (1=incorrect, 5=accurate)
- **Formatting**: Are paragraphs, chapters, spacing preserved? (1=broken, 5=perfect)

**Example Spot-Check**:
```json
{
  "quality": {
    "passagesChecked": 8,
    "averageCoherenceScore": 4.5,
    "averageContextScore": 4.2,
    "averageAccuracyScore": 4.7,
    "averageFormattingScore": 5.0,
    "overallQualityScore": 4.6,
    "notes": "Excellent translation quality, minor context loss at one chunk boundary (ch. 12)"
  }
}
```

---

### 4. Technical Metrics

**Access AWS CloudWatch**:

**Step Functions Execution**:
```bash
# List recent executions
aws stepfunctions list-executions \
  --state-machine-arn arn:aws:states:us-east-1:$(aws sts get-caller-identity --query Account --output text):stateMachine:LfmtTranslationWorkflow-LfmtPocDev \
  --max-results 10

# Get execution details
aws stepfunctions describe-execution \
  --execution-arn <execution-arn>
```

**Lambda Performance**:
```bash
# View translateChunk Lambda metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Duration \
  --dimensions Name=FunctionName,Value=lfmt-translate-chunk-LfmtPocDev \
  --start-time 2025-12-21T00:00:00Z \
  --end-time 2025-12-21T23:59:59Z \
  --period 3600 \
  --statistics Average,Maximum,Minimum
```

**S3 Upload/Download Times**:
```bash
# View S3 request metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/S3 \
  --metric-name FirstByteLatency \
  --dimensions Name=BucketName,Value=lfmt-documents-lfmtpocdev \
  --start-time 2025-12-21T00:00:00Z \
  --end-time 2025-12-21T23:59:59Z \
  --period 3600 \
  --statistics Average
```

**Data to Record**:
```json
{
  "technical": {
    "stepFunctionsExecutionTime": "2100s",
    "lambdaColdStartAvg": "1.2s",
    "lambdaWarmStartAvg": "0.3s",
    "s3UploadLatencyAvg": "120ms",
    "s3DownloadLatencyAvg": "85ms",
    "dynamoDBQueryLatencyAvg": "15ms"
  }
}
```

---

## 📝 Saving Metrics

For **each translation**, create a metrics file:

**File Path**: `demo/results/<document-name>-metrics.json`

**Example** (`demo/results/sherlock-holmes-spanish-metrics.json`):
```json
{
  "document": {
    "name": "sherlock-holmes.txt",
    "wordCount": 107562,
    "targetLanguage": "Spanish",
    "translationDate": "2025-12-21"
  },
  "performance": {
    "startTime": "2025-12-21T10:00:00Z",
    "endTime": "2025-12-21T10:35:00Z",
    "totalDurationMinutes": 35,
    "chunksProcessed": 42,
    "totalChunks": 42,
    "averageSecondsPerChunk": 50
  },
  "cost": {
    "inputTokens": 150000,
    "outputTokens": 120000,
    "estimatedCostUSD": 0.047,
    "actualCostUSD": 0.00
  },
  "quality": {
    "passagesChecked": 8,
    "averageCoherenceScore": 4.5,
    "overallQualityScore": 4.6
  },
  "technical": {
    "stepFunctionsExecutionTime": "2100s",
    "lambdaColdStartAvg": "1.2s"
  }
}
```

---

## 🐛 Troubleshooting

### Issue: Upload Fails
- **Check**: File size limit (CloudFront default: 1MB, CDK configured: 100MB)
- **Check**: File encoding (must be UTF-8)
- **Check**: Network connectivity
- **Solution**: Try smaller file or check browser console for errors

### Issue: Translation Stuck at 0%
- **Check**: AWS CloudWatch logs for Lambda errors
- **Check**: Step Functions execution status
- **Solution**: Contact AWS admin or check DynamoDB job status

### Issue: Progress Not Updating
- **Check**: Browser console for polling errors
- **Check**: CORS configuration (should allow CloudFront origin)
- **Solution**: Hard refresh (Ctrl+Shift+R) or check API Gateway logs

### Issue: Rate Limiting Errors
- **Expected**: Gemini API has 5 RPM, 250K TPM limits
- **Behavior**: System should retry with exponential backoff
- **Solution**: Wait and monitor - system handles automatically

---

## ✅ Testing Checklist

### Pre-Testing
- [ ] Demo account created and credentials accessible
- [ ] Frontend URL accessible in browser
- [ ] Test documents downloaded in `demo/test-documents/`
- [ ] AWS CLI configured for metrics collection

### Translation Testing
- [ ] Login successful with demo account
- [ ] Sherlock Holmes (Spanish) uploaded and translating
- [ ] Pride and Prejudice (French) uploaded and translating
- [ ] War and Peace (German) uploaded and translating
- [ ] All translations completed successfully

### Metrics Collection
- [ ] Performance metrics captured for all 3 translations
- [ ] Cost metrics extracted from CloudWatch logs
- [ ] Quality metrics documented (spot-checked translations)
- [ ] Technical metrics retrieved from AWS services
- [ ] All metrics saved to `demo/results/*.json`

### Documentation
- [ ] Screenshots captured for investor pitch deck
- [ ] Translation history page documented
- [ ] Error handling tested (if any failures occurred)
- [ ] Demo script prepared based on actual workflow

---

## 📸 Screenshots to Capture

For investor demonstrations, capture screenshots of:

1. **Login Page** - Clean, professional UI
2. **Dashboard/Home Page** - After successful login
3. **New Translation Page** - File upload interface
4. **Progress Tracking** - Translation in progress (various %)
5. **Translation History** - List of completed translations
6. **Completed Translation** - Download button, 100% complete
7. **Translated Document** - Sample of output quality

Save to: `demo/results/screenshots/`

---

## 🎯 Success Criteria

- ✅ All 3 test documents translate successfully (>90% chunks processed)
- ✅ Processing times within 150% of estimates
- ✅ Total demo translation cost <$0.50
- ✅ Translation quality verified as coherent (average score >4.0/5.0)
- ✅ No permanent processing failures
- ✅ Metrics fully documented for investor presentation

---

**Next Steps**: After completing testing and metrics collection, proceed to create demo documentation (pitch deck, demo script, FAQ, key differentiators).
