# CI/CD Architecture

This document describes how the LFMT CI/CD pipeline is structured and why.
It is intended to be the entry point for anyone modifying GitHub Actions
workflows in this repository.

## Files

| File | Purpose | Trigger |
|---|---|---|
| `.github/workflows/ci.yml` | PR-time gates (lint, format, type-check, full unit tests, security audit, workflow lint) | All PRs targeting `main`/`develop`; pushes to non-main branches |
| `.github/workflows/deploy-backend.yml` | Backend deploy + API verification (CDK deploy of Lambdas/DynamoDB/API Gateway/Step Functions, smoke tests against the deployed API, integration tests) | `push` to `main` touching `backend/**`, `shared-types/**`, or the workflow file itself; `workflow_dispatch` for staging/prod |
| `.github/workflows/deploy-frontend.yml` | Frontend deploy + browser verification (S3 sync, CloudFront invalidation, Playwright smoke + E2E) | `push` to `main` touching `frontend/**`, `shared-types/**`, or the workflow file itself; `workflow_dispatch` for manual redeploy |

## Why the split (Issue #157)

The deploy pipeline used to live in a single 980-line `deploy.yml`. After
PR #154 added `frontend/**` to its `on.push.paths` (closing a real gap
where frontend-only PRs never triggered a deploy), every CSS tweak began
running the full backend pipeline:

- Backend lint + format + tests + coverage (~3-4 min)
- Full CDK deploy of Lambdas + DynamoDB + API Gateway + Cognito + Step
  Functions (~5-7 min, including a no-op CloudFormation roundtrip when
  nothing changed)
- Backend integration tests against an unchanged API (~3-5 min)

For frontend-only commits this is wasted work. The split moves frontend
and backend onto independent, path-scoped pipelines so each commit type
runs only what's relevant.

### Performance impact

| Commit type | Before | After |
|---|---|---|
| Backend-only | ~15-20 min (full pipeline) | ~15-20 min (deploy-backend.yml only) |
| Frontend-only | ~15-20 min (full pipeline) | ~5-7 min (deploy-frontend.yml only) |
| `shared-types` change | ~15-20 min (full pipeline) | ~15-20 min (both run, sequentially or in parallel) |

## Shared-types contract

`shared-types/**` is a path filter on BOTH workflows. A change to the
shared types package will trigger BOTH `deploy-backend.yml` and
`deploy-frontend.yml`. This is intentional:

- Backend Lambdas import from `@lfmt/shared-types` and may need a fresh
  bundle to reflect type changes that surface as runtime
  serialization/deserialization differences.
- Frontend imports the same package and similarly needs a fresh bundle.

The two workflows run in parallel (no cross-workflow dependency); the
backend's CDK deploy will rotate the API URL only if the actual
infrastructure changed, in which case the backend's own frontend rebuild
step (still present in `deploy-backend.yml`) handles the in-step rebuild.
The frontend workflow's no-CDK rebuild reads the CFN-output API URL,
so it converges on the same final state regardless of ordering.

## Backend's frontend rebuild step

`deploy-backend.yml`'s `deploy-dev` job still rebuilds and pushes the
frontend at the end. This is intentional and NOT redundant with
`deploy-frontend.yml`:

- `VITE_API_URL` is a build-time variable (Vite inlines it into the
  bundle). If a backend change rotates the API Gateway URL, the
  in-flight frontend bundle on S3 is pointing at the old URL and would
  fail at runtime.
- Backend deploys must therefore rebuild the frontend bundle with the
  fresh API URL and push it to S3 in the same workflow run, before
  smoke/integration tests verify the new API.

`deploy-frontend.yml`'s `deploy-dev-frontend` job handles the inverse
case (frontend-only commit, no backend change): it READS the existing
API URL from CloudFormation outputs without running `cdk deploy`, then
rebuilds and pushes. The two paths are complementary, not duplicative.

## Bootstrap order (first deploy on a new environment)

`deploy-frontend.yml` does NOT run `cdk deploy`. It depends on a
pre-existing CloudFormation stack (`LfmtPocDev` / `LfmtPocStaging` /
`LfmtPocProd`) to read the frontend bucket name, CloudFront distribution
ID, and API URL from. On a brand-new environment, `deploy-backend.yml`
must run first to create the stack. If you trigger `deploy-frontend.yml`
against an environment whose backend stack does not exist, the
`Get API URL from existing stack` step will fail with an explicit error
message.

## Operational coordination required

### Branch protection rules

GitHub branch-protection identifies required status checks by job name
string. The split changes the names of the deploy-time test jobs:

| Old required check (in branch protection) | New required check(s) |
|---|---|
| `Run Tests` | `Run Tests (Backend)` AND `Run Tests (Frontend)` |
| `Build Infrastructure` | `Build Infrastructure` (unchanged — still in ci.yml) |

After this PR merges, a repo admin must update the main branch
protection rule (Settings → Branches → main → Require status checks)
to replace the single `Run Tests` requirement with the two new names
above. Until that update happens:

- The current `Run Tests` requirement will become unsatisfiable on PRs
  (no job emits that exact name from a deploy workflow anymore — though
  ci.yml's `Run Tests` job continues to satisfy it for PR builds, since
  ci.yml hasn't been split).
- The new `Run Tests (Backend)` / `Run Tests (Frontend)` checks will
  appear on every PR but won't be enforced.

The cleanest remediation is to drop `Run Tests` from required checks
and add the two new names; ci.yml's PR-time `Run Tests` job remains
present and will continue to run, just without being a hard gate (it
already wasn't the historical "main gate" — `Run Tests` historically
referred to the deploy.yml job, per CLAUDE.md memory).

### Workflow-lint parity check

`ci.yml`'s `workflow-lint` job runs a Python parity check that ensures
the `deploy-dev` job and its trailing verification jobs share an
identical `if:` expression. The check has been updated in this PR to
iterate over BOTH `deploy-backend.yml` and `deploy-frontend.yml`
independently. Adding a new gated verification job to either workflow
requires updating the corresponding entry in `DEPLOY_WORKFLOWS` in
`ci.yml`'s parity check.

## Verification

To verify the split is working correctly after merge:

1. **Backend-only commit**: edit a file under `backend/`, commit + push.
   Expected: only `deploy-backend.yml` runs. `deploy-frontend.yml` is
   skipped (path filter excludes the change).
2. **Frontend-only commit**: edit a file under `frontend/`, commit +
   push. Expected: only `deploy-frontend.yml` runs.
3. **Shared-types commit**: edit a file under `shared-types/`, commit +
   push. Expected: BOTH workflows run.

## Out of scope (follow-up)

- **CDK noop-skip (#163)**: `deploy-backend.yml`'s `cdk deploy` runs
  unconditionally. Adding a `cdk diff` short-circuit so noop deploys
  finish in seconds instead of minutes is a separate optimization.
- **Programmatic ci/deploy parity check extension (#156)**: a separate
  issue tracks deeper parity-check scaffolding beyond the gated-job
  condition check that ci.yml already runs.
- **Staging/prod GHA Environments-scoped secrets**: tracked elsewhere;
  unaffected by this split.

## Drift-prevention history

The deploy pipeline has had several trigger-related incidents in the
past quarter that this split inherits and preserves:

- **Issue #149**: backend lint regression deployed because deploy.yml's
  `Run Tests` job lacked the lint step that ci.yml ran. Fixed by adding
  parity. The split preserves the lint step in
  `Run Tests (Backend)`.
- **PR #152**: deploy.yml failed at `Type-check frontend` because
  `shared-types` wasn't built before frontend type-check. Fixed by
  adding a `Build shared-types` step. The split preserves this in both
  `Run Tests (Backend)` (for backend type-checks) and
  `Run Tests (Frontend)`.
- **PR #154**: frontend-only PRs merged to main but never triggered a
  deploy because deploy.yml's `on.push.paths` lacked `frontend/**`.
  Fixed by adding the path. The split preserves this — frontend paths
  are in `deploy-frontend.yml`'s trigger.
- **PR #159**: `workflow_dispatch=dev` was inadvertently routed away
  from deploy-dev. Fixed by adjusting the `if:` expression. The split
  preserves the same expression in both `deploy-backend.yml`'s
  `deploy-dev` and `deploy-frontend.yml`'s `deploy-dev-frontend`.

Do NOT remove the `Build shared-types` step, the `paths:` filter, or
the `if:` expression from either workflow without consulting this
history. Each of these was added in response to a real production
incident.
