# Proposal: Fix CI/CD Deployment Workflow

**Change ID**: `fix-cicd-deployment-workflow`
**Status**: Proposed
**Priority**: P1 - HIGH (Critical Team Velocity Blocker)
**Related Issues**: N/A (workflow configuration issue)
**Owner**: xlei-raymond (Principal Engineer / Team Lead)
**Created**: 2025-11-08

## Problem Statement

The GitHub Actions deployment workflow (`.github/workflows/deploy.yml`) is not triggering automatically when pull requests are merged to `main`. This causes:

1. **Stale Development Environment**: The `dev` environment does not reflect the latest merged code
2. **E2E Tests Not Running**: End-to-end tests that validate the full deployment are not executing
3. **Reduced Team Velocity**: Manual deployment interventions are required
4. **Confidence Gap**: No automated validation that merged PRs deploy successfully

### Current Behavior

The `deploy.yml` workflow currently has triggers that do not fire on PR merges:
- Workflow runs on push to specific branches but not after PR merge
- Dependent jobs (like `e2e-tests`) have incorrect conditions
- No automatic deployment to `dev` environment after merge

### Business Impact

- **Team Velocity**: Developers cannot validate their changes in deployed environments
- **Quality Risk**: Deployment issues are discovered late in the cycle
- **CI/CD Pipeline Broken**: Core automation is not functioning as designed
- **Developer Experience**: Manual workarounds reduce productivity

## Proposed Solution

Fix the GitHub Actions workflow configuration to:

1. **Auto-trigger on PR merge to main**
2. **Ensure dependent jobs execute correctly**
3. **Validate deployment with E2E tests**
4. **Maintain clear deployment status visibility**

## Technical Approach

### 1. Update deploy.yml Triggers

**Current (Non-functional)**:
```yaml
on:
  push:
    branches:
      - main
      - dev
  workflow_dispatch:
```

**Proposed (Fixed)**:
```yaml
on:
  push:
    branches:
      - main  # Triggers on direct push AND PR merge to main
  pull_request:
    types: [closed]  # Additional trigger for PR closure
  workflow_dispatch:  # Keep manual trigger option
```

### 2. Fix Dependent Job Conditions

**Current (Incorrect)**:
```yaml
e2e-tests:
  needs: [deploy-dev]
  runs-on: ubuntu-latest
  # Missing condition check
```

**Proposed (Fixed)**:
```yaml
e2e-tests:
  needs: [deploy-dev]
  runs-on: ubuntu-latest
  if: |
    github.event_name == 'push' ||
    (github.event_name == 'pull_request' && github.event.pull_request.merged == true)
  steps:
    - name: Wait for deployment
      run: sleep 30  # Allow deployment to stabilize
    - name: Run E2E tests
      run: npm run test:e2e
      env:
        API_URL: ${{ secrets.DEV_API_URL }}
```

### 3. Add Deployment Status Reporting

```yaml
- name: Report deployment status
  if: always()
  uses: actions/github-script@v7
  with:
    script: |
      const status = '${{ job.status }}';
      const message = status === 'success'
        ? '✅ Deployment to dev successful'
        : '❌ Deployment to dev failed';

      github.rest.repos.createCommitStatus({
        owner: context.repo.owner,
        repo: context.repo.repo,
        sha: context.sha,
        state: status === 'success' ? 'success' : 'failure',
        context: 'Deploy / dev',
        description: message
      });
```

### 4. Add E2E Test Failure Notifications

```yaml
- name: Notify on E2E failure
  if: failure() && steps.e2e.outcome == 'failure'
  uses: actions/github-script@v7
  with:
    script: |
      github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.payload.pull_request?.number || context.issue.number,
        body: '🚨 E2E tests failed after deployment. Please investigate.'
      });
```

## Success Criteria

### Functional Requirements
- ✅ Workflow triggers automatically on PR merge to main
- ✅ `dev` environment deploys with latest code
- ✅ E2E tests run after successful deployment
- ✅ Deployment status visible in PR checks
- ✅ Manual workflow_dispatch option still available

### Quality Requirements
- ✅ E2E tests validate deployed application
- ✅ Failed deployments are visible and reported
- ✅ No manual intervention required for standard merges

### Performance Requirements
- ✅ Deployment completes within 10 minutes
- ✅ E2E tests complete within 5 minutes
- ✅ Total pipeline time <15 minutes

## Implementation Plan

### Phase 1: Fix Workflow Triggers (Day 1)
1. Update `deploy.yml` trigger configuration
2. Add PR merge condition checks
3. Test with sample PR merge

### Phase 2: Fix Dependent Jobs (Day 1)
1. Add proper conditions to E2E test job
2. Add deployment stabilization wait
3. Configure environment-specific secrets

### Phase 3: Add Status Reporting (Day 2)
1. Implement deployment status reporting
2. Add E2E test failure notifications
3. Test notification delivery

### Phase 4: Validation (Day 2)
1. Create test PR and merge to main
2. Verify workflow triggers automatically
3. Confirm E2E tests execute
4. Validate status reporting

## Risks & Mitigation

### Risk 1: Workflow Triggers Too Frequently
**Likelihood**: Low
**Impact**: Medium (increased GitHub Actions costs)
**Mitigation**:
- Trigger only on PR merge, not all pushes to main
- Use `if` conditions to filter events
- Monitor Actions usage in first week

### Risk 2: E2E Tests Flaky
**Likelihood**: Medium
**Impact**: High (blocks merges if tests fail randomly)
**Mitigation**:
- Add retry logic for E2E tests
- Implement test stabilization wait period
- Clear test data between runs

### Risk 3: Deployment Secrets Missing
**Likelihood**: Low
**Impact**: High (deployment fails)
**Mitigation**:
- Validate all required secrets exist before deployment
- Document required secrets in README
- Add secret validation step to workflow

## Dependencies

### Required Resources
- GitHub Actions workflow configuration access
- Repository secrets (DEV_API_URL, AWS credentials)
- E2E test suite (already exists)

### Blocked By
- None

### Blocks
- Automated testing pipeline
- Developer confidence in merges
- Rapid iteration cycles

## Testing Strategy

### Workflow Testing
1. Create test PR with minimal change
2. Merge PR to main
3. Verify workflow triggers automatically
4. Confirm deployment to dev succeeds
5. Validate E2E tests execute

### E2E Test Validation
1. Confirm tests run against deployed environment
2. Validate test results are reported
3. Check failure notifications work

### Rollback Testing
1. Verify manual workflow_dispatch still works
2. Test workflow with failed deployment
3. Confirm status reporting on failures

## Approval Requirements

- [ ] Team lead approval (xlei-raymond)
- [ ] DevOps review (workflow configuration)
- [ ] Test strategy approval

## Metrics & Monitoring

### Key Performance Indicators (KPIs)
- **Deployment Success Rate**: >95% of merges deploy successfully
- **E2E Test Execution Rate**: 100% of deployments run E2E tests
- **Pipeline Duration**: <15 minutes total
- **Manual Interventions**: 0 per week

### GitHub Actions Metrics
- Workflow run success/failure rates
- Average workflow duration
- E2E test pass/fail rates
- Actions minutes consumed

## References

- **Team Lead Execution Plan**: project_priorities_proposal.md (Phase 2)
- **Current Workflow**: .github/workflows/deploy.yml
- **GitHub Actions Documentation**: [Workflow triggers](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows)

---

**Status**: Proposed - Awaiting Approval
**Next Step**: Team lead review and approval to proceed with implementation
**Estimated Effort**: 2 days
