# Gemini API Setup Guide

**For:** LFMT POC Translation Engine Integration
**Created:** 2025-10-29

## Quick Start (< 5 minutes)

### Step 1: Get Gemini API Key (2-3 minutes)

1. **Go to Google AI Studio:**
   - Visit: https://aistudio.google.com
   - Sign in with your Google account

2. **Get API Key:**
   - Click "Get API Key" button (top right)
   - Click "Create API Key"
   - Copy the generated key (starts with "AIza...")
   - **IMPORTANT:** Save this key securely - you won't see it again

### Step 2: Store API Key in AWS Secrets Manager (2 minutes)

```bash
# Navigate to project root
cd /Users/raymondl/Documents/LFMT\ POC/LFMT/lfmt-poc

# Store API key in AWS Secrets Manager (replace YOUR_API_KEY)
aws secretsmanager create-secret \
  --name lfmt-gemini-api-key-dev \
  --description "Gemini API key for LFMT POC dev environment" \
  --secret-string "YOUR_API_KEY" \
  --region us-east-1

# Verify it was stored
aws secretsmanager get-secret-value \
  --secret-id lfmt-gemini-api-key-dev \
  --region us-east-1 \
  --query SecretString \
  --output text
```

### Step 3: Test API Key (1 minute)

```bash
# Test the API key works
curl https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_API_KEY

# Expected response: List of available models including gemini-pro
```

## Gemini API Free Tier Limits

### Current Limits (as of 2025-10-29)

| Limit Type | Free Tier | Notes |
|------------|-----------|-------|
| **Requests Per Minute (RPM)** | 5 | Resets every minute |
| **Tokens Per Minute (TPM)** | 250,000 | Input + output combined |
| **Requests Per Day (RPD)** | 25 | Resets at midnight Pacific |
| **Context Window** | 1M tokens | Gemini 1.5 Pro |
| **Output Limit** | 8,192 tokens | Per request |

### Cost Estimate for POC

**Free Tier Pricing:** $0.075 per 1M input tokens

**Example Document (65K words = ~82K tokens):**
- Chunks needed: ~23 chunks (3,500 tokens each)
- Context per chunk: ~7,500 tokens (2 previous chunks)
- Total input tokens: 23 × (3,500 + 7,500) = 253K tokens
- Estimated cost: $0.019 (~2 cents)

**Monthly Budget (1000 docs × 65K words):**
- Total: $19 well within $50 budget ✅

## API Selection: Gemini 1.5 Pro vs Flash

### Recommendation: Gemini 1.5 Pro (Default)

**Gemini 1.5 Pro:**
- ✅ Better translation quality
- ✅ 1M token context window
- ✅ Suitable for long-form documents
- ⚠️ 5 RPM limit (slower)
- Cost: $0.075 per 1M input tokens

**Gemini 1.5 Flash:**
- ✅ 1000 RPM limit (much faster)
- ✅ No daily request limit
- ⚠️ Lower quality (optimized for speed)
- Cost: $0.10 per 1M input tokens (33% more expensive)

**Decision:** Start with Gemini 1.5 Pro for quality. If speed becomes an issue, consider Flash for testing.

## SDK Installation

### Install @google/genai Package

```bash
# Navigate to backend functions
cd backend/functions

# Install Gemini SDK
npm install @google/genai

# Verify installation
npm list @google/genai
# Should show: @google/genai@1.27.0 or later
```

### TypeScript Types

The @google/genai package includes built-in TypeScript definitions, no separate @types package needed.

## Testing API Connection

### Test Script (Optional)

Create a quick test to verify API connectivity:

```typescript
// backend/functions/translation/__tests__/gemini-api-test.ts
import { GoogleGenAI } from '@google/genai';

async function testGeminiAPI() {
  const apiKey = process.env.GEMINI_API_KEY; // Set this temporarily
  const ai = new GoogleGenAI({ apiKey });

  const model = ai.getGenerativeModel({ model: 'gemini-1.5-pro' });
  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [{ text: 'Translate to Spanish: Hello, world!' }]
    }]
  });

  console.log('Translation:', result.response.text());
  console.log('Token usage:', result.response.usageMetadata);
}

testGeminiAPI().catch(console.error);
```

Run test:
```bash
export GEMINI_API_KEY="YOUR_API_KEY"
npx ts-node backend/functions/translation/__tests__/gemini-api-test.ts
```

Expected output:
```
Translation: ¡Hola, mundo!
Token usage: { promptTokenCount: 7, candidatesTokenCount: 4, totalTokenCount: 11 }
```

## Upgrade to Paid Tier (If Needed)

### When to Upgrade

Consider upgrading if:
- Need > 5 requests per minute
- Processing > 25 documents per day
- Need guaranteed SLA

### How to Upgrade

1. Go to Google AI Studio
2. Click "Upgrade to Pay-as-you-go"
3. Add billing account
4. Limits increase automatically:
   - RPM: 360 (72x increase)
   - TPM: 4M (16x increase)
   - RPD: No limit

### Pricing (Paid Tier)

**Gemini 1.5 Pro:**
- Input: $1.25 per 1M tokens
- Output: $5.00 per 1M tokens
- Context caching available (90% discount)

## Monitoring and Alerts

### CloudWatch Metrics to Track

1. **gemini_requests_per_minute** - Current RPM usage
2. **gemini_tokens_per_minute** - Current TPM usage
3. **gemini_requests_per_day** - Daily request count
4. **gemini_api_errors** - Failed requests by error type
5. **gemini_estimated_cost** - Running cost total

### Recommended Alarms

```bash
# Alert when approaching daily limit (20 of 25 requests)
aws cloudwatch put-metric-alarm \
  --alarm-name lfmt-gemini-daily-limit-warning \
  --alarm-description "Gemini API approaching daily limit" \
  --metric-name gemini_requests_per_day \
  --namespace LFMT/Translation \
  --statistic Sum \
  --period 3600 \
  --threshold 20 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1

# Alert when approaching monthly budget ($40 of $50)
aws cloudwatch put-metric-alarm \
  --alarm-name lfmt-gemini-budget-warning \
  --alarm-description "Gemini API approaching monthly budget" \
  --metric-name gemini_estimated_cost \
  --namespace LFMT/Translation \
  --statistic Sum \
  --period 86400 \
  --threshold 40 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1
```

## Troubleshooting

### Error: 401 Unauthorized

**Problem:** Invalid API key

**Solution:**
```bash
# Verify API key in Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id lfmt-gemini-api-key-dev \
  --region us-east-1 \
  --query SecretString \
  --output text

# Test API key directly
curl "https://generativelanguage.googleapis.com/v1beta/models?key=YOUR_KEY"
```

### Error: 429 Rate Limit Exceeded

**Problem:** Hit 5 RPM or 250K TPM limit

**Solution:**
- Wait for rate limit window to reset (1 minute)
- Implement proper rate limiting in code
- Consider upgrading to paid tier

### Error: 400 Bad Request

**Problem:** Invalid request format or unsupported language

**Solution:**
- Check request body format matches API spec
- Verify target language is supported
- Check token count doesn't exceed limits

## Next Steps After Setup

1. ✅ Obtain Gemini API key from AI Studio
2. ✅ Store key in AWS Secrets Manager
3. ✅ Install @google/genai package
4. ⏭️ Proceed to Phase 1: Gemini Client Implementation
5. ⏭️ Test with small document (1K words)
6. ⏭️ Monitor costs and rate limits

## Resources

- **Google AI Studio:** https://aistudio.google.com
- **Gemini API Docs:** https://ai.google.dev/gemini-api/docs
- **Rate Limits:** https://ai.google.dev/gemini-api/docs/rate-limits
- **Pricing:** https://ai.google.dev/gemini-api/docs/pricing
- **SDK Reference:** https://googleapis.github.io/js-genai/

## Security Best Practices

### DO:
- ✅ Store API key in AWS Secrets Manager
- ✅ Rotate API key periodically (every 90 days)
- ✅ Use IAM roles for Lambda access to secrets
- ✅ Monitor API usage for anomalies
- ✅ Set up billing alerts

### DON'T:
- ❌ Commit API key to git
- ❌ Store API key in environment variables (use Secrets Manager)
- ❌ Share API key across environments (dev/staging/prod)
- ❌ Log API key in CloudWatch logs
- ❌ Expose API key in frontend code

## Contact

For questions about Gemini API setup:
- Google AI Studio Support: https://aistudio.google.com/help
- LFMT POC Project: Raymond Lei (thunder.rain.a@gmail.com)
