# Performance Benchmark Suite

## Overview

This benchmark suite validates the parallel translation performance against the baseline sequential processing to ensure we meet the **5-7x performance improvement target**.

**Issue**: [#56 - Validate and Benchmark Parallel Translation Performance](https://github.com/leixiaoyu/lfmt-poc/issues/56)

## Quick Start

```bash
# Install dependencies
cd backend/tests/performance
npm install

# Run benchmark against deployed environment
npm run benchmark -- --api-url=<YOUR_API_URL>

# Examples
npm run benchmark:65k --api-url=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
npm run benchmark:400k --api-url=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
npm run benchmark:all --api-url=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
```

## Test Documents

The benchmark uses real literary works from the `demo/test-documents/` directory:

- **65K words**: Pride and Prejudice (truncated to 65,000 words)
- **400K words**: War and Peace (truncated to 400,000 words)

## Performance Targets

Based on the parallel translation architecture with `maxConcurrency: 10`:

| Document Size | Target Duration | Baseline (Sequential) | Expected Improvement |
|---------------|-----------------|----------------------|---------------------|
| 65K words     | ≤5 minutes      | 20-30 minutes        | 5-7x faster         |
| 400K words    | ≤25 minutes     | 120-180 minutes      | 5-7x faster         |

## Benchmark Metrics

The benchmark measures:

1. **End-to-end processing time** - From upload to completion
2. **Throughput** - Words translated per minute
3. **Success rate** - Percentage of successful translation jobs
4. **Rate-limiting errors** - Monitor CloudWatch for throttling

## Command-Line Options

```bash
--api-url=<URL>          # API Gateway URL (required)
--doc-size=<65k|400k|all> # Document size to test (default: all)
--iterations=<N>         # Number of iterations per document size (default: 1)
```

## Environment Variables

```bash
API_BASE_URL=<URL>       # Alternative to --api-url flag
TEST_EMAIL=<email>       # Test user email (default: benchmark@example.com)
TEST_PASSWORD=<password> # Test user password (default: BenchmarkPass123!)
```

## Output

The benchmark generates two outputs:

1. **Console report** - Real-time progress and summary
2. **JSON report** - Detailed results saved to `../../../benchmark-results/`

### Example Console Output

```
═══════════════════════════════════════════════════════════
📊 PERFORMANCE BENCHMARK REPORT
═══════════════════════════════════════════════════════════
Timestamp: 2025-11-26T10:30:00.000Z
API URL: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
Total Runs: 2
Successful: 2
Failed: 0
───────────────────────────────────────────────────────────

65K Document Performance:
  Average Duration: 4.25 minutes
  Average Throughput: 15,294 words/minute
  Target Met: ✅ YES (target: ≤5 minutes)

400K Document Performance:
  Average Duration: 22.10 minutes
  Average Throughput: 18,099 words/minute
  Target Met: ✅ YES (target: ≤25 minutes)

───────────────────────────────────────────────────────────
Overall Performance Target: ✅ MET
═══════════════════════════════════════════════════════════
```

## Monitoring CloudWatch

While the benchmark runs, monitor CloudWatch for:

1. **Lambda invocations** - Check for throttling
2. **Step Functions executions** - Verify parallel processing
3. **Rate limiter metrics** - Confirm distributed rate limiting is working

```bash
# View Lambda logs
aws logs tail /aws/lambda/lfmt-translate-chunk-LfmtPocDev --follow

# Check Step Functions executions
aws stepfunctions list-executions --state-machine-arn <STATE_MACHINE_ARN>
```

## Integration with CI/CD

Add to `.github/workflows/deploy-backend.yml` for automated performance validation:

```yaml
- name: Run Performance Benchmark
  working-directory: backend/tests/performance
  run: npm run benchmark:65k
  env:
    API_BASE_URL: ${{ steps.get-api-url.outputs.api_url }}
    TEST_EMAIL: ${{ secrets.BENCHMARK_TEST_EMAIL }}
    TEST_PASSWORD: ${{ secrets.BENCHMARK_TEST_PASSWORD }}
```

## Troubleshooting

### Authentication Errors

Ensure the test user exists in Cognito:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <USER_POOL_ID> \
  --username benchmark@example.com \
  --user-attributes Name=email,Value=benchmark@example.com \
  --temporary-password "TempPass123!" \
  --message-action SUPPRESS
```

### Timeout Errors

For 400K documents, increase the timeout:

```bash
# Default timeout is 1 hour (3600000ms)
# Modify in performance-benchmark.ts if needed
```

### Rate Limiting

If you see rate-limiting errors:

1. Check DynamoDB rate limit buckets
2. Review Gemini API quota in Google Cloud Console
3. Verify distributed rate limiter configuration

## Related Documentation

- [Translation Workflow](../../../docs/TRANSLATION-UI-REFERENCE.md)
- [Architecture Overview](../../../CLAUDE.md)
- [Issue #56](https://github.com/leixiaoyu/lfmt-poc/issues/56)
