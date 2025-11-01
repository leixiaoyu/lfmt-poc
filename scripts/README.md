# LFMT POC Scripts

Utility scripts for development, testing, and deployment.

## Available Scripts

### 🧪 Testing & CI

#### `simulate-ci.sh`
Simulates the exact GitHub Actions CI environment locally. **Use this to catch CI failures before pushing!**

```bash
# Run all CI checks (recommended before pushing)
./scripts/simulate-ci.sh

# Run only test jobs
./scripts/simulate-ci.sh --test

# Run only frontend tests (matches CI exactly)
./scripts/simulate-ci.sh --frontend

# Run only backend tests
./scripts/simulate-ci.sh --backend
```

**Why use this?**
- Catches CI failures locally before push
- Runs tests with **exact same flags** as CI (`--run` for frontend)
- Saves CI/CD time and AWS costs
- Instant feedback loop

#### `run-integration-tests.sh`
Runs integration and E2E tests against deployed environment.

```bash
# Run all integration tests
./scripts/run-integration-tests.sh

# Quick smoke tests
./scripts/run-integration-tests.sh --quick

# Backend API tests only
./scripts/run-integration-tests.sh --backend

# E2E tests only
./scripts/run-integration-tests.sh --e2e
```

### 🔒 Security

#### `security-scan.sh`
Comprehensive security scanner that runs automatically on pre-push.

```bash
# Scan all files
./scripts/security-scan.sh

# Scan only staged files (faster)
./scripts/security-scan.sh --staged
```

**Checks for:**
- Hardcoded AWS credentials (AKIA pattern)
- API keys & tokens (GitHub, Stripe, Google)
- Sensitive files tracked in git (.env, private keys)
- Private keys (PEM, RSA, DSA, EC, OpenSSH)
- Security-related TODO/FIXME comments
- console.log with sensitive data
- URLs with embedded credentials

## Common Workflows

### Before Pushing Code

```bash
# Option 1: Run CI simulation (recommended)
./scripts/simulate-ci.sh

# Option 2: Let pre-push hook run automatically
git push origin your-branch
# Hook will run all checks including frontend tests with --run flag
```

### Testing Against Deployed Environment

```bash
# Set API base URL (if not using default)
export API_BASE_URL=https://your-api.execute-api.us-east-1.amazonaws.com/v1

# Run all integration tests
./scripts/run-integration-tests.sh
```

### Security Audit

```bash
# Full security scan
./scripts/security-scan.sh

# Quick scan of staged changes
./scripts/security-scan.sh --staged
```

## Key Differences: Local vs CI

### Frontend Tests

**Local (default):**
```bash
npm test  # Runs in watch mode, doesn't fail on warnings
```

**CI (and our pre-push hook):**
```bash
npm test -- --run  # Runs once, exits, strict mode
```

**Solution:** Use `simulate-ci.sh` to run tests exactly like CI!

### Why Tests Pass Locally But Fail in CI

1. **Watch Mode vs Run Mode**: Local watch mode is permissive
2. **Environment Differences**: CI has fresh `node_modules`
3. **Timing**: CI runs tests in parallel, different timing
4. **Strict Checks**: CI fails on warnings that local might ignore

**Fix:** Always run `./scripts/simulate-ci.sh --frontend` before pushing frontend changes!

## Automation

### Pre-Push Hook
The `.githooks/pre-push` hook automatically runs:
1. Shared-types tests
2. Backend function tests (with 90%+ coverage)
3. Infrastructure compilation and tests
4. **Frontend tests with `--run` flag** (matches CI!)
5. Comprehensive security scan

### CI/CD Pipeline
- **On PR**: All tests run in GitHub Actions
- **On merge to main**: Tests + deployment + E2E tests
- **On push**: Security scan runs

## Troubleshooting

### "Frontend tests pass locally but fail in CI"

**Problem:** You're running tests in watch mode locally, but CI uses `--run` flag.

**Solution:**
```bash
# Run tests exactly like CI
cd frontend
npm test -- --run

# Or use the CI simulation script
./scripts/simulate-ci.sh --frontend
```

### "Pre-push hook is slow"

**Optimization:** Use cached `node_modules` and skip unnecessary steps:
```bash
# Pre-push uses npm cache
# First run is slow, subsequent runs are fast
```

### "Security scan flagging test files"

**This is intentional!** Test files are excluded from production checks but the scanner reports them for awareness.

## Best Practices

1. **Always run CI simulation before pushing major changes**
   ```bash
   ./scripts/simulate-ci.sh
   ```

2. **Use quick smoke tests for iterative development**
   ```bash
   ./scripts/run-integration-tests.sh --quick
   ```

3. **Run security scans on sensitive changes**
   ```bash
   ./scripts/security-scan.sh --staged
   ```

4. **Test against deployed environment before releasing**
   ```bash
   ./scripts/run-integration-tests.sh
   ```

## Contributing

When adding new scripts:
1. Make them executable: `chmod +x scripts/your-script.sh`
2. Add usage documentation in this README
3. Include color-coded output for better UX
4. Add error handling and clear error messages
5. Document any environment variables required
