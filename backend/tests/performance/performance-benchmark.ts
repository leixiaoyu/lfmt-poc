/**
 * Performance Benchmark Suite for Parallel Translation
 *
 * This script validates and benchmarks the parallel translation performance
 * to ensure we meet the 5-7x performance target compared to sequential processing.
 *
 * Issue: #56 - Validate and Benchmark Parallel Translation Performance
 *
 * Requirements:
 * 1. Prepare large test documents (65K and 400K words)
 * 2. Run multiple translation jobs
 * 3. Measure and document end-to-end processing time
 * 4. Compare results to baseline to confirm 5-7x performance target
 * 5. Monitor CloudWatch for rate-limiting errors
 *
 * Usage:
 *   npm run benchmark -- --api-url=<API_URL> --doc-size=<65k|400k|all>
 */

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

interface BenchmarkConfig {
  apiUrl: string;
  email: string;
  password: string;
  documentSize: '65k' | '400k' | 'all';
  iterations: number;
}

interface BenchmarkResult {
  documentSize: string;
  wordCount: number;
  estimatedChunks: number;
  startTime: number;
  endTime: number;
  durationMs: number;
  durationMinutes: number;
  throughputWordsPerMinute: number;
  success: boolean;
  error?: string;
}

interface BenchmarkReport {
  timestamp: string;
  config: BenchmarkConfig;
  results: BenchmarkResult[];
  summary: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    averageDuration65k?: number;
    averageDuration400k?: number;
    averageThroughput65k?: number;
    averageThroughput400k?: number;
    performanceTargetMet: boolean;
  };
}

/**
 * Load test document from demo folder
 */
function loadTestDocument(size: '65k' | '400k'): { content: string; wordCount: number } {
  let filePath: string;
  let targetWordCount: number;

  switch (size) {
    case '65k':
      // Use Pride and Prejudice (~127K words, we'll truncate to ~65K)
      filePath = path.join(__dirname, '../../../demo/test-documents/pride-and-prejudice.txt');
      targetWordCount = 65000;
      break;
    case '400k':
      // Use War and Peace (~566K words, we'll truncate to ~400K)
      filePath = path.join(__dirname, '../../../demo/test-documents/war-and-peace.txt');
      targetWordCount = 400000;
      break;
    default:
      throw new Error(`Invalid document size: ${size}`);
  }

  const fullContent = fs.readFileSync(filePath, 'utf-8');
  const words = fullContent.split(/\s+/);

  // Truncate to target word count
  const truncatedWords = words.slice(0, targetWordCount);
  const content = truncatedWords.join(' ');
  const wordCount = truncatedWords.length;

  return { content, wordCount };
}

/**
 * Authenticate and get access token
 */
async function authenticate(apiUrl: string, email: string, password: string): Promise<string> {
  try {
    const response = await axios.post(`${apiUrl}auth/login`, {
      email,
      password,
    });
    return response.data.accessToken;
  } catch (error: any) {
    throw new Error(`Authentication failed: ${error.message}`);
  }
}

/**
 * Upload document and start translation
 */
async function startTranslation(
  apiUrl: string,
  accessToken: string,
  content: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  try {
    // Step 1: Request upload URL
    const uploadRequestResponse = await axios.post(
      `${apiUrl}upload/request`,
      {
        fileName: 'benchmark-test.txt',
        contentType: 'text/plain',
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    const { jobId, uploadUrl, documentKey } = uploadRequestResponse.data;

    // Step 2: Upload document to S3
    await axios.put(uploadUrl, content, {
      headers: {
        'Content-Type': 'text/plain',
      },
    });

    // Step 3: Complete upload and start translation
    await axios.post(
      `${apiUrl}upload/complete`,
      {
        jobId,
        documentKey,
        sourceLanguage,
        targetLanguage,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    return jobId;
  } catch (error: any) {
    throw new Error(`Translation start failed: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Poll translation status until complete
 */
async function waitForTranslationComplete(
  apiUrl: string,
  accessToken: string,
  jobId: string,
  timeoutMs: number = 3600000 // 1 hour default timeout
): Promise<void> {
  const startTime = Date.now();
  const pollIntervalMs = 10000; // Poll every 10 seconds

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await axios.get(`${apiUrl}translation/status/${jobId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const { status } = response.data;

      if (status === 'completed') {
        return; // Success
      } else if (status === 'failed') {
        throw new Error('Translation failed');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    } catch (error: any) {
      throw new Error(
        `Status polling failed: ${error.response?.data?.message || error.message}`
      );
    }
  }

  throw new Error(`Translation timed out after ${timeoutMs}ms`);
}

/**
 * Run a single benchmark iteration
 */
async function runBenchmark(
  config: BenchmarkConfig,
  documentSize: '65k' | '400k'
): Promise<BenchmarkResult> {
  const { apiUrl, email, password } = config;
  const { content, wordCount } = loadTestDocument(documentSize);
  const estimatedChunks = Math.ceil(wordCount / 3500); // 3,500 words per chunk

  console.log(`\n🚀 Starting benchmark for ${documentSize} document (${wordCount} words)...`);

  const result: BenchmarkResult = {
    documentSize,
    wordCount,
    estimatedChunks,
    startTime: 0,
    endTime: 0,
    durationMs: 0,
    durationMinutes: 0,
    throughputWordsPerMinute: 0,
    success: false,
  };

  try {
    // Authenticate
    console.log('   Authenticating...');
    const accessToken = await authenticate(apiUrl, email, password);

    // Start translation
    console.log('   Starting translation...');
    result.startTime = Date.now();
    const jobId = await startTranslation(accessToken, apiUrl, content, 'en', 'es');

    // Wait for completion
    console.log(`   Waiting for translation to complete (Job ID: ${jobId})...`);
    await waitForTranslationComplete(apiUrl, accessToken, jobId);

    result.endTime = Date.now();
    result.durationMs = result.endTime - result.startTime;
    result.durationMinutes = result.durationMs / 60000;
    result.throughputWordsPerMinute = wordCount / result.durationMinutes;
    result.success = true;

    console.log(`   ✅ Completed in ${result.durationMinutes.toFixed(2)} minutes`);
    console.log(
      `   📊 Throughput: ${result.throughputWordsPerMinute.toFixed(0)} words/minute`
    );
  } catch (error: any) {
    result.endTime = Date.now();
    result.durationMs = result.endTime - result.startTime;
    result.error = error.message;
    result.success = false;
    console.log(`   ❌ Failed: ${error.message}`);
  }

  return result;
}

/**
 * Generate benchmark report
 */
function generateReport(config: BenchmarkConfig, results: BenchmarkResult[]): BenchmarkReport {
  const successfulRuns = results.filter((r) => r.success);
  const failedRuns = results.filter((r) => !r.success);

  const results65k = successfulRuns.filter((r) => r.documentSize === '65k');
  const results400k = successfulRuns.filter((r) => r.documentSize === '400k');

  const averageDuration65k =
    results65k.length > 0
      ? results65k.reduce((sum, r) => sum + r.durationMinutes, 0) / results65k.length
      : undefined;

  const averageDuration400k =
    results400k.length > 0
      ? results400k.reduce((sum, r) => sum + r.durationMinutes, 0) / results400k.length
      : undefined;

  const averageThroughput65k =
    results65k.length > 0
      ? results65k.reduce((sum, r) => sum + r.throughputWordsPerMinute, 0) / results65k.length
      : undefined;

  const averageThroughput400k =
    results400k.length > 0
      ? results400k.reduce((sum, r) => sum + r.throughputWordsPerMinute, 0) / results400k.length
      : undefined;

  // Performance target: With parallel processing (maxConcurrency: 10), we expect:
  // - 65K words: ~3-5 minutes (baseline sequential: 20-30 minutes)
  // - 400K words: ~15-25 minutes (baseline sequential: 120-180 minutes)
  // This represents a 5-7x improvement
  const performanceTargetMet =
    (averageDuration65k !== undefined && averageDuration65k <= 5) ||
    (averageDuration400k !== undefined && averageDuration400k <= 25);

  return {
    timestamp: new Date().toISOString(),
    config,
    results,
    summary: {
      totalRuns: results.length,
      successfulRuns: successfulRuns.length,
      failedRuns: failedRuns.length,
      averageDuration65k,
      averageDuration400k,
      averageThroughput65k,
      averageThroughput400k,
      performanceTargetMet,
    },
  };
}

/**
 * Print benchmark report to console
 */
function printReport(report: BenchmarkReport): void {
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 PERFORMANCE BENCHMARK REPORT');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Timestamp: ${report.timestamp}`);
  console.log(`API URL: ${report.config.apiUrl}`);
  console.log(`Total Runs: ${report.summary.totalRuns}`);
  console.log(`Successful: ${report.summary.successfulRuns}`);
  console.log(`Failed: ${report.summary.failedRuns}`);
  console.log('───────────────────────────────────────────────────────────');

  if (report.summary.averageDuration65k !== undefined) {
    console.log(`\n65K Document Performance:`);
    console.log(`  Average Duration: ${report.summary.averageDuration65k.toFixed(2)} minutes`);
    console.log(
      `  Average Throughput: ${report.summary.averageThroughput65k?.toFixed(0)} words/minute`
    );
    console.log(
      `  Target Met: ${report.summary.averageDuration65k <= 5 ? '✅ YES' : '❌ NO'} (target: ≤5 minutes)`
    );
  }

  if (report.summary.averageDuration400k !== undefined) {
    console.log(`\n400K Document Performance:`);
    console.log(`  Average Duration: ${report.summary.averageDuration400k.toFixed(2)} minutes`);
    console.log(
      `  Average Throughput: ${report.summary.averageThroughput400k?.toFixed(0)} words/minute`
    );
    console.log(
      `  Target Met: ${report.summary.averageDuration400k <= 25 ? '✅ YES' : '❌ NO'} (target: ≤25 minutes)`
    );
  }

  console.log('\n───────────────────────────────────────────────────────────');
  console.log(
    `Overall Performance Target: ${report.summary.performanceTargetMet ? '✅ MET' : '❌ NOT MET'}`
  );
  console.log('═══════════════════════════════════════════════════════════\n');

  // Print individual run details
  if (report.results.length > 0) {
    console.log('\nDetailed Results:');
    report.results.forEach((r, idx) => {
      console.log(`\nRun #${idx + 1}:`);
      console.log(`  Document Size: ${r.documentSize} (${r.wordCount} words)`);
      console.log(`  Status: ${r.success ? '✅ Success' : '❌ Failed'}`);
      if (r.success) {
        console.log(`  Duration: ${r.durationMinutes.toFixed(2)} minutes`);
        console.log(`  Throughput: ${r.throughputWordsPerMinute.toFixed(0)} words/minute`);
      } else {
        console.log(`  Error: ${r.error}`);
      }
    });
  }
}

/**
 * Save benchmark report to file
 */
function saveReport(report: BenchmarkReport): void {
  const outputDir = path.join(__dirname, '../../../benchmark-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `benchmark-${timestamp}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`\n📝 Report saved to: ${filepath}`);
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  const apiUrl =
    args.find((arg) => arg.startsWith('--api-url='))?.split('=')[1] ||
    process.env.API_BASE_URL ||
    'https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/';

  const docSize =
    (args.find((arg) => arg.startsWith('--doc-size='))?.split('=')[1] as
      | '65k'
      | '400k'
      | 'all'
      | undefined) || 'all';

  const iterations =
    parseInt(args.find((arg) => arg.startsWith('--iterations='))?.split('=')[1] || '1', 10) || 1;

  const email = process.env.TEST_EMAIL || 'benchmark@example.com';
  const password = process.env.TEST_PASSWORD || 'BenchmarkPass123!';

  const config: BenchmarkConfig = {
    apiUrl,
    email,
    password,
    documentSize: docSize,
    iterations,
  };

  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔬 STARTING PERFORMANCE BENCHMARK');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`API URL: ${config.apiUrl}`);
  console.log(`Document Size: ${config.documentSize}`);
  console.log(`Iterations: ${config.iterations}`);
  console.log('═══════════════════════════════════════════════════════════');

  const results: BenchmarkResult[] = [];

  // Run benchmarks
  for (let i = 0; i < iterations; i++) {
    if (docSize === 'all' || docSize === '65k') {
      results.push(await runBenchmark(config, '65k'));
    }
    if (docSize === 'all' || docSize === '400k') {
      results.push(await runBenchmark(config, '400k'));
    }
  }

  // Generate and print report
  const report = generateReport(config, results);
  printReport(report);
  saveReport(report);

  // Exit with appropriate code
  process.exit(report.summary.failedRuns > 0 ? 1 : 0);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Benchmark failed:', error);
    process.exit(1);
  });
}

export { runBenchmark, generateReport, BenchmarkConfig, BenchmarkResult, BenchmarkReport };
