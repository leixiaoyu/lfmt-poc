# Proposal: Implement Production Smoke Tests

**Change ID**: `implement-production-smoke-tests`
**Status**: Proposed
**Priority**: P1 - HIGH (Critical Deployment Safety)
**Related Issues**: N/A (new capability)
**Owner**: xlei-raymond (Principal Engineer / Team Lead)
**Created**: 2025-11-08

## Problem Statement

The LFMT POC currently lacks automated post-deployment validation for production deployments. This creates significant risk:

1. **No Automated Verification**: Deployments succeed/fail with no validation of actual functionality
2. **Silent Failures**: Production issues may go undetected for extended periods
3. **Rollback Delays**: Manual testing required to detect deployment problems
4. **User Impact**: Broken deployments can affect users before detection

### Current State

- Production deployments complete without automated validation
- Manual testing required to verify each deployment
- No immediate feedback on deployment success
- Rollback decisions made without automated data

### Business Impact

- **Risk**: Broken production deployments can persist undetected
- **User Experience**: Users may encounter errors before team awareness
- **Confidence**: No automated assurance that deployments are safe
- **Velocity**: Manual validation slows deployment process

## Proposed Solution

Implement a comprehensive production smoke test suite that:

1. **Executes Immediately After Production Deployment**
2. **Tests Critical User Paths**
3. **Provides Immediate Pass/Fail Feedback**
4. **Enables Automated Rollback (Future)**

The smoke tests will validate the single most critical user journey:
**Login → Upload Small File → Start Translation → Poll for Completion**

## Technical Approach

### 1. Create Dedicated `@smoke` Test Suite

Add Playwright tests tagged with `@smoke` for production validation:

```typescript
// frontend/e2e/smoke/critical-path.spec.ts
import { test, expect } from '@playwright/test';

test.describe('@smoke Critical User Path', () => {
  test('should complete full translation workflow', async ({ page }) => {
    // 1. Login
    await page.goto(process.env.PROD_URL!);
    await page.fill('[data-testid="email"]', process.env.SMOKE_TEST_USER_EMAIL!);
    await page.fill('[data-testid="password"]', process.env.SMOKE_TEST_USER_PASSWORD!);
    await page.click('[data-testid="login-button"]');

    await expect(page).toHaveURL(/\/dashboard/);

    // 2. Upload small test file
    const testFile = await page.locator('[data-testid="file-input"]');
    await testFile.setInputFiles({
      name: 'smoke-test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This is a smoke test document for automated validation.')
    });

    // 3. Accept legal attestation
    await page.check('[data-testid="copyright-checkbox"]');
    await page.check('[data-testid="rights-checkbox"]');
    await page.check('[data-testid="liability-checkbox"]');

    // 4. Start translation
    await page.selectOption('[data-testid="target-language"]', 'es');
    await page.click('[data-testid="start-translation"]');

    // 5. Poll for completion (max 2 minutes for small file)
    await expect(page.locator('[data-testid="job-status"]')).toHaveText('COMPLETED', {
      timeout: 120000 // 2 minutes max
    });

    // 6. Verify translated file available
    const downloadButton = page.locator('[data-testid="download-translation"]');
    await expect(downloadButton).toBeEnabled();

    // 7. Verify translation metadata
    await expect(page.locator('[data-testid="source-language"]')).toHaveText('English');
    await expect(page.locator('[data-testid="target-language"]')).toHaveText('Spanish');
    await expect(page.locator('[data-testid="word-count"]')).toContainText('10');

    console.log('✅ Smoke test passed: Full translation workflow successful');
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Test error handling for smoke test resilience
    await page.goto(`${process.env.PROD_URL}/invalid-route`);
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
  });
});
```

### 2. Add `smoke-test-production` Job to deploy.yml

```yaml
smoke-test-production:
  needs: [deploy-production]
  runs-on: ubuntu-latest
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'

  steps:
    - name: Checkout code
      uses: actions/checkout@v4

    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
        cache-dependency-path: frontend/package-lock.json

    - name: Install dependencies
      working-directory: frontend
      run: npm ci

    - name: Install Playwright browsers
      working-directory: frontend
      run: npx playwright install --with-deps chromium

    - name: Wait for deployment to stabilize
      run: sleep 60  # Allow CloudFront/Lambda cold starts

    - name: Run production smoke tests
      working-directory: frontend
      run: npx playwright test --grep @smoke
      env:
        PROD_URL: ${{ secrets.PROD_URL }}
        SMOKE_TEST_USER_EMAIL: ${{ secrets.SMOKE_TEST_USER_EMAIL }}
        SMOKE_TEST_USER_PASSWORD: ${{ secrets.SMOKE_TEST_USER_PASSWORD }}

    - name: Upload test results
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: smoke-test-results
        path: frontend/playwright-report/
        retention-days: 30

    - name: Report smoke test failure
      if: failure()
      uses: actions/github-script@v7
      with:
        script: |
          github.rest.issues.create({
            owner: context.repo.owner,
            repo: context.repo.repo,
            title: '🚨 Production Smoke Tests Failed',
            body: `Production deployment smoke tests failed.

            **Deployment**: ${{ github.sha }}
            **Run**: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}

            **Action Required**: Investigate immediately and consider rollback.`,
            labels: ['production', 'urgent', 'smoke-test-failure']
          });
```

### 3. Configure Production-Specific Secrets

Add to GitHub repository secrets:
- `PROD_URL`: Production CloudFront URL
- `SMOKE_TEST_USER_EMAIL`: Dedicated smoke test user email
- `SMOKE_TEST_USER_PASSWORD`: Dedicated smoke test user password

### 4. Create Dedicated Smoke Test User

```bash
# AWS Cognito user for smoke tests only
# Email: smoke-test@lfmt-internal.example.com
# Attributes: email_verified=true, test_user=true
```

### 5. Future: Automated Rollback Strategy

**Phase 2 Enhancement (Not in Initial Implementation)**:

```yaml
rollback-on-smoke-failure:
  needs: [smoke-test-production]
  runs-on: ubuntu-latest
  if: failure() && needs.smoke-test-production.result == 'failure'

  steps:
    - name: Get previous successful deployment
      id: previous
      run: |
        PREV_SHA=$(git rev-parse HEAD~1)
        echo "sha=$PREV_SHA" >> $GITHUB_OUTPUT

    - name: Rollback to previous version
      run: |
        aws cloudformation update-stack \
          --stack-name lfmt-prod \
          --template-url s3://lfmt-cfn-templates/prod-${{ steps.previous.outputs.sha }}.yaml

    - name: Verify rollback success
      run: |
        aws cloudformation wait stack-update-complete \
          --stack-name lfmt-prod
```

## Success Criteria

### Functional Requirements
- ✅ Smoke tests execute after every production deployment
- ✅ Tests validate critical user path end-to-end
- ✅ Test failure creates immediate alert/issue
- ✅ Test results archived for investigation
- ✅ Tests complete within 3 minutes

### Quality Requirements
- ✅ **Test Reliability**: >99% success rate (no false positives)
- ✅ **Coverage**: Tests cover authentication, upload, translation, download
- ✅ **Isolation**: Tests use dedicated test user, don't affect production data
- ✅ **Cleanup**: Tests clean up after themselves

### Performance Requirements
- ✅ **Execution Time**: <3 minutes for full smoke test suite
- ✅ **Deployment Time Impact**: <5 minutes added to deployment pipeline
- ✅ **Resource Usage**: Minimal (one Playwright test run)

## Implementation Plan

### Phase 1: Create Smoke Test Suite (Day 1-2)
1. Create `frontend/e2e/smoke/` directory
2. Implement critical path smoke test
3. Add error handling smoke test
4. Test locally against dev environment

### Phase 2: GitHub Actions Integration (Day 2-3)
1. Add `smoke-test-production` job to deploy.yml
2. Configure production secrets
3. Test workflow with staging environment

### Phase 3: Production User Setup (Day 3)
1. Create dedicated Cognito smoke test user
2. Configure user permissions
3. Document credentials in 1Password

### Phase 4: Validation & Monitoring (Day 4)
1. Deploy to production with smoke tests
2. Monitor first 5 deployments
3. Tune test timeouts if needed
4. Document runbook for smoke test failures

### Phase 5: Future Enhancements (Future Sprint)
1. Investigate automated rollback on failure
2. Add more smoke test scenarios
3. Implement smoke test metrics dashboard

## Risks & Mitigation

### Risk 1: Smoke Tests Are Flaky
**Likelihood**: Medium
**Impact**: High (false alarms reduce trust)
**Mitigation**:
- Use stable test selectors (`data-testid`)
- Add generous timeouts for async operations
- Implement retry logic for transient failures
- Monitor test reliability metrics

### Risk 2: Smoke Test User Permissions Issues
**Likelihood**: Low
**Impact**: Medium (tests fail incorrectly)
**Mitigation**:
- Document user setup process
- Verify permissions before deployment
- Add user validation in test setup

### Risk 3: Test Execution Timeout
**Likelihood**: Low
**Impact**: Medium (blocks deployment pipeline)
**Mitigation**:
- Set reasonable timeout (3 minutes)
- Use small test file (<1KB)
- Monitor test execution times
- Optimize test steps

### Risk 4: Production Secrets Leakage
**Likelihood**: Very Low
**Impact**: Critical
**Mitigation**:
- Use GitHub encrypted secrets
- Never log sensitive values
- Rotate credentials quarterly
- Limit access to production secrets

## Dependencies

### Required Resources
- Playwright test framework (already installed)
- GitHub Actions workflow access
- Production environment access
- AWS Cognito user creation access

### Blocked By
- None (can implement independently)

### Blocks
- Automated rollback implementation (Phase 2)
- Deployment confidence metrics

## Testing Strategy

### Smoke Test Development Testing
1. Run smoke tests against dev environment
2. Verify all assertions pass
3. Test error handling scenarios
4. Validate cleanup logic

### CI/CD Integration Testing
1. Create test deployment to staging
2. Verify smoke tests trigger automatically
3. Confirm test results upload
4. Test failure notification workflow

### Production Validation
1. Monitor first production deployment with smoke tests
2. Verify test user can complete workflow
3. Confirm test execution time is acceptable
4. Validate issue creation on failure

## Approval Requirements

- [ ] Team lead approval (xlei-raymond)
- [ ] Security review (production access, credentials)
- [ ] DevOps review (workflow integration)

## Metrics & Monitoring

### Key Performance Indicators (KPIs)
- **Smoke Test Success Rate**: >99% (excluding actual deployment failures)
- **Test Execution Time**: <3 minutes average
- **Deployment Detection Rate**: 100% of broken deployments caught
- **False Positive Rate**: <1% of test runs

### Smoke Test Metrics
- Test execution duration
- Test pass/fail rates
- Failure reasons (categorized)
- Production deployment frequency

### Alerts
- 🚨 **Critical**: Smoke test failure (immediate investigation)
- ⚠️ **Warning**: Smoke test execution time >3 minutes
- 📊 **Info**: Smoke test success (deployment validated)

## References

- **Team Lead Execution Plan**: project_priorities_proposal.md (Phase 2)
- **Playwright Documentation**: https://playwright.dev/
- **GitHub Actions Artifacts**: https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts

---

**Status**: Proposed - Awaiting Approval
**Next Step**: Team lead review and approval to proceed with implementation
**Estimated Effort**: 4 days (smoke tests + integration + validation)
