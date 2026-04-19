# E2E Test Failure Analysis & Recommended Investigation Path

> **STATUS: RESOLVED** — closed by PR #99 (merged 2025-11-26). Preserved for historical context.

**To:** LFMT Development Team
**From:** Senior Staff Engineer / Team Lead
**Date:** 2025-11-30
**Subject:** Historical analysis of the CI E2E Test Suite failures (resolved)

## 1. Executive Summary

**Problem:** The "Run E2E Tests" job in our CI/CD pipeline is consistently failing. This is a P0 (highest priority) blocker as it prevents all pull requests from being merged and halts our deployment pipeline.

**Goal:** This document provides a deep analysis of the most probable root causes and a prioritized, step-by-step investigation path. The objective is to empower the assigned engineer to rapidly identify, fix, and verify the resolution, transforming this into a valuable team-wide learning experience on robust E2E testing.

**Most Probable Cause:** Based on recent backend stabilization and the nature of E2E tests, the failure is most likely due to a **data-fetching timing issue** in the frontend tests, where the test logic is not correctly waiting for an API call to complete before asserting on the result.

---

## 2. Symptom Analysis

The primary symptom is a failure in the CI environment, likely manifesting as a `TimeoutError`. This typically means the test was waiting for an element to appear or a condition to be met, and that condition was not met within the default timeout period (e.g., 5000ms).

This is not a "flaky" test; consistent failure in CI points to a deterministic bug in either the test itself or the application under the specific conditions of the CI environment.

---

## 3. Prioritized Investigation Paths

The assigned engineer should follow the **E2E Debugging Playbook** (outlined in `project_priorities_proposal.md`) and pursue these hypotheses in order.

### Path A: Data-Fetching and Timing Issues (Most Likely)

This is the most common cause of E2E failures after significant backend changes or when new data-driven UI is introduced.

- **Hypothesis:** The test performs an action (e.g., navigates to the History page) and immediately tries to find an element that is only rendered _after_ an API call completes. The test is faster than the API response, so it fails.
- **How to Validate:**
  1.  Run the failing test locally in **UI Mode** (`npm run test:e2e:ui -- [test-file]`).
  2.  Step through the test action by action.
  3.  At the failing step, open the "Network" tab in the test's browser window.
  4.  **Crucial Question:** Did the test try to find an element (e.g., a table row) _before_ the corresponding API call (e.g., `GET /jobs/history`) finished and the UI re-rendered? You will likely see the API call still pending or just finishing when the test fails.
- **Common Pitfall & The Correct Fix:**
  - **The Pitfall:** Adding a hard-coded sleep (`await page.waitForTimeout(3000);`). This is unacceptable as it creates slow, unreliable, and flaky tests. It hides the root cause.
  - **The Correct Fix:** Use web-first assertions that have built-in, automatic waiting. The test should wait for the _consequence_ of the action, not for an arbitrary amount of time.

    **Example:**

    ```typescript
    // Incorrect - Prone to race conditions
    await page.getByRole('link', { name: 'History' }).click();
    await page.waitForTimeout(1000); // BAD PRACTICE
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow).toContainText('COMPLETED');

    // Correct - Waits automatically for the row to appear
    await page.getByRole('link', { name: 'History' }).click();
    const firstRow = page.getByRole('row').nth(1);
    await expect(firstRow).toContainText('COMPLETED', { timeout: 10000 }); // Waits up to 10s
    ```

### Path B: Environment Mismatch (Possible)

- **Hypothesis:** The test fails in CI because the test environment's configuration or state is different from local. The most common culprits are environment variables or authentication state.
- **How to Validate:**
  1.  Inspect the GitHub Actions workflow file (`.github/workflows/ci.yml`). In the "Run E2E Tests" step, are all necessary environment variables (e.g., `VITE_API_BASE_URL`, `VITE_COGNITO_USER_POOL_ID`) being correctly set?
  2.  Inspect the Playwright global setup file (`e2e/setup/auth.setup.ts`). What user credentials does it use? Is it possible this user does not exist or has an invalid state in the CI environment?

### Path C: Incorrect Test Selector (Less Likely)

- **Hypothesis:** A class name, component structure, or visible text has changed in the application, making a test locator invalid.
- **How to Validate:** This is the easiest to diagnose in UI Mode. When the test fails, use the "Pick Locator" tool to find the element on the page and see what its correct, modern locator should be. Compare this to the locator used in the test code.

---

## 4. Recommended Action Plan

1.  **Assign Ownership:** Assign one developer to own this P0 issue from diagnosis to resolution.
2.  **Execute the Playbook:** Follow the **E2E Debugging Playbook** outlined in the execution proposal, starting with **Investigation Path A**, as it is the most probable cause.
3.  **Timebox:** Timebox the initial investigation to **2 hours**. If a root cause is not identified within that time, report back with findings (e.g., "I've confirmed it's not a timing issue, now investigating environment variables") so the team can assist.
4.  **Implement the Fix:** Create a pull request with the fix. The PR description must detail the root cause and the solution. **Under no circumstances will a PR containing `waitForTimeout()` be approved.**
5.  **Verify:** The PR must include a screenshot of the full E2E test suite passing in the CI pipeline on the author's forked repository. This is a mandatory quality gate.
