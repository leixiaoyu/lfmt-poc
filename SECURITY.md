# Security Policy and Best Practices

## Overview

This document outlines the security measures, policies, and best practices for the LFMT POC project.

## Security Audit History

### 2026-05 (rolling): CSP, Ownership Privacy, Side-Channel Analysis

Tracked in PR #257, #265, #287, #290, #292. Summarized in
[Current Security Posture](#current-security-posture) below.

- ✅ **CSP architecture overhaul** (#257) — Typed `Partial<Record<CspDirective, string[]>>` builder, extracted to `backend/infrastructure/lib/csp.ts`. Adds defensive `'object-src'`, `'base-uri'`, `'form-action'`, `'frame-ancestors'`, and `upgrade-insecure-requests`.
- ✅ **CSP violation telemetry endpoint** (#257) — `POST /csp-report` Lambda with strict input sanitization, 64 KB body cap, 2 KB per-field truncation, dedicated minimal IAM role (CloudWatch Logs write only).
- ✅ **CSP style-src static nonce** (#265, closes #254) — Build-time generated nonce written into `index.html` and the CSP header; `'unsafe-inline'` removed from `style-src`.
- ✅ **Privacy-preserving 404 on ownership-checked endpoints** (#287, closes #286) — Endpoints that confirm record ownership now return `404 Not Found` (not `403 Forbidden`) for jobs owned by other users. Prevents `jobId` existence-disclosure to non-owners. `errorCode` unified to `JOB_NOT_FOUND`.
- ✅ **Per-user rate-limiting decision record** (#290, closes #289) — Documented decision to **defer per-user rate-limiting until real users exist**. Current global Gemini-tier limiter (5 RPM / 250K TPM / 25 RPD) is correct for a single-user POC. Trigger conditions for revisiting the decision are captured in [PR #290](https://github.com/leixiaoyu/lfmt-poc/pull/290).
- ✅ **Cognito timing side-channel analytical conclusion** (#292, closes #288) — Measured `AdminInitiateAuth` differential timing for existing vs non-existing users. At p95 the distributions overlap within the network-jitter envelope; the side-channel is **not distinguishable from network jitter without privileged network position**. Methodology and conclusion are captured inline in [PR #292](https://github.com/leixiaoyu/lfmt-poc/pull/292).

### 2026-05-13: Auth + Workflow Hardening (PR #256)

- ✅ **Login/register 400-on-malformed-JSON** (#180) — Previously surfaced as 500.
- ✅ **Removed redundant `AdminConfirmSignUp` and over-privileged IAM grant** (#178) — Cognito pre-sign-up trigger already auto-confirms in dev.
- ✅ **`StopExecution` on Step Functions** when a job `DELETE` arrives while translation is in progress (#210) — Prevents orphaned executions burning Gemini quota.
- ✅ **`decodeCursor` empty-object rejection** (#246) — Tightened guard against malformed cursors.

### 2025-10-21: Initial Security Hardening

**Audit Conducted**: Comprehensive repository scan for exposed secrets and sensitive information.

**Critical Issues Resolved**:

- ✅ Redacted AWS Account ID from all documentation
- ✅ Redacted Cognito User Pool ID and Client ID from public files
- ✅ Redacted API Gateway URL from `.env.example`
- ✅ Updated GitHub Actions to dynamically fetch AWS Account ID
- ✅ Removed static AWS credentials from GitHub Secrets (now using OIDC only)
- ✅ Updated git configuration to use GitHub no-reply email

**Verified Safe**:

- `.env.local` was never committed to repository (confirmed via git log)
- All actual credentials remain secure in local `.env.local` file (gitignored)
- GitHub Actions properly configured with OIDC authentication

## Current Security Posture

### Authentication & Authorization

**AWS Cognito**:

- User Pool ID: Managed via CloudFormation outputs (not hardcoded)
- Client ID: CDK-managed, rotated via infrastructure updates
- Password Policy: Minimum 8 characters with complexity requirements
- MFA: Not enabled for POC (recommended for production)

**GitHub Actions**:

- OIDC authentication with AWS (no long-lived credentials)
- Role assumption via `AWS_ROLE_ARN` secret
- Least-privilege IAM policies

### Secrets Management

**What's Protected**:

- `.env` and `.env.local` files (gitignored)
- AWS credentials (never stored in code)
- API keys and tokens (environment variables only)
- Private keys and certificates (gitignored)

**GitHub Secrets** (Current):

- `AWS_ROLE_ARN` - IAM role for OIDC authentication

**Previously Removed**:

- `AWS_ACCESS_KEY_ID` - Replaced with OIDC
- `AWS_SECRET_ACCESS_KEY` - Replaced with OIDC

### Code Security

**Pre-Push Validation**:

- Full unit test suites in each package (see [PROGRESS.md](PROGRESS.md) for current counts)
- TypeScript compilation checks
- Security scans for hardcoded secrets

**Git Configuration**:

- Author email: `leixiaoyu@users.noreply.github.com` (prevents email harvesting)
- Git hooks enforce pre-push validation

### Content Security Policy

CSP is constructed via the typed builder in `backend/infrastructure/lib/csp.ts`
and applied to CloudFront responses by the `LfmtPocDev` (and staging/prod)
stacks. Key properties:

- `default-src 'self'` baseline.
- `style-src` uses a **build-time static nonce** (PR #265). `'unsafe-inline'`
  is removed. Each frontend build generates a fresh nonce written into both
  `index.html` and the CSP header simultaneously.
- `script-src 'self'` — `'unsafe-inline'` and `'unsafe-eval'` both removed.
- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`,
  `frame-ancestors 'none'`, `upgrade-insecure-requests`.
- `report-uri` points to the `POST /csp-report` Lambda; `report-to` group
  configured for the modern Reporting API. Violations are emitted as
  structured WARN logs to CloudWatch with strict field allowlisting (no
  PII forwarded; per-field 2 KB truncation; 64 KB request body cap).

### Privacy-Preserving Authorization

Ownership-checked endpoints (`GET /jobs/{jobId}`, `DELETE /jobs/{jobId}`,
`POST /jobs/{jobId}/translate`, `GET /jobs/{jobId}/translation-status`,
`GET /jobs/{jobId}/download`) return `404 Not Found` with `errorCode:
JOB_NOT_FOUND` for jobs owned by other users — identical to the response
for genuinely non-existent jobs. Prevents `jobId` enumeration / existence
disclosure. See PR #287.

### Stable Error Envelope

All Lambda handlers emit a typed `errorCode` (string discriminator) plus
UUID `requestId` on error responses (PRs #267 / #280 / #281). Client copy
maps via the `COPY_BY_CODE` lookup table in
`frontend/src/services/getApiErrorMessage.ts`. Backend `message` is now
preserved on 4xx (#283) and 5xx (#291) responses for operator-friendly
debugging, so user-reported error text can be correlated to CloudWatch
logs by `requestId`.

## Best Practices

### For Developers

1. **Never commit sensitive data**:
   - Use `.env.local` for local development credentials
   - Verify files before committing: `git diff --cached`
   - Review pre-push hook output before pushing

2. **Use placeholder values in documentation**:
   - AWS Account ID: `XXXXXXXXXXXX`
   - Cognito User Pool: `us-east-1_XXXXXXXXX`
   - API Gateway: `YOUR_API_GATEWAY_ID`

3. **Rotate credentials if exposed**:
   - If you accidentally commit secrets, rotate them immediately
   - Remove from git history using `git filter-branch` or BFG Repo Cleaner
   - Force push to remote (coordinate with team first)

4. **Keep dependencies updated**:
   - Run `npm audit` regularly
   - Update dependencies with known vulnerabilities
   - Review security advisories for used packages

### For Infrastructure

1. **OIDC over static credentials**:
   - Always use role assumption for CI/CD
   - Avoid long-lived access keys when possible
   - Rotate access keys every 90 days if required

2. **Least privilege**:
   - Grant minimum permissions required for each role
   - Use resource-based policies when possible
   - Regularly audit IAM policies

3. **Encryption**:
   - S3 buckets use AES-256 encryption
   - DynamoDB tables use AWS-managed encryption
   - Secrets Manager for production secrets

### For Deployment

1. **Environment separation**:
   - Dev, Staging, and Production have separate AWS accounts/resources
   - Different Cognito user pools per environment
   - Separate API Gateway stages

2. **CloudFormation Stack Protection**:
   - Enable termination protection on production stacks
   - Use stack policies to prevent accidental deletion
   - Tag all resources for cost tracking and compliance

## Incident Response

### If Secrets Are Exposed

1. **Immediate Actions**:
   - Revoke/rotate the exposed credential immediately
   - Remove from repository history
   - Check CloudTrail logs for unauthorized access
   - Notify team members

2. **Investigation**:
   - Determine scope of exposure (public repo, private repo, local only)
   - Check for unauthorized API calls or resource access
   - Review audit logs for suspicious activity

3. **Remediation**:
   - Update all systems using the exposed credential
   - Document the incident and lessons learned
   - Update security policies if needed

### Reporting Security Issues

If you discover a security vulnerability:

1. **Do NOT** create a public GitHub issue
2. Email the security contact: `leixiaoyu@users.noreply.github.com`
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if known)

## Compliance Checklist

### Before Each Deployment

- [ ] Run all tests (`npm test`)
- [ ] Run security scan (`npm run security:check`)
- [ ] Review CloudFormation changes (`cdk diff`)
- [ ] Verify no secrets in code (`git diff`)
- [ ] Check dependency vulnerabilities (`npm audit`)

### Monthly Security Review

- [ ] Review IAM policies and roles
- [ ] Check CloudWatch logs for anomalies
- [ ] Update dependencies with security patches
- [ ] Review access logs for unauthorized access
- [ ] Verify backup and recovery procedures

### Quarterly Security Audit

- [ ] Full codebase security scan
- [ ] Penetration testing (if applicable)
- [ ] Review and update security policies
- [ ] Credential rotation audit
- [ ] Third-party security assessment

## GitHub Secret Scanning

### Enabling Secret Scanning

GitHub Advanced Security provides automatic secret scanning for repositories. To enable:

1. Navigate to repository Settings → Security → Code security and analysis
2. Enable "Secret scanning"
3. Enable "Push protection" to prevent commits with secrets
4. Review and resolve any detected secrets

### Custom Patterns

Add custom patterns for project-specific secrets:

- Cognito User Pool IDs: `us-east-1_[a-zA-Z0-9]{9}`
- Cognito Client IDs: `[a-z0-9]{26}`
- API Gateway IDs: `[a-z0-9]{10}`

## Security Tools and Resources

### Recommended Tools

- **Git-secrets**: Prevents committing secrets to git

  ```bash
  brew install git-secrets
  git secrets --install
  git secrets --register-aws
  ```

- **TruffleHog**: Find secrets in git history

  ```bash
  docker run --rm -v $(pwd):/repo trufflesecurity/trufflehog git file:///repo
  ```

- **AWS IAM Access Analyzer**: Analyze resource access policies
- **npm audit**: Check for vulnerable dependencies

### AWS Security Best Practices

- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)
- [AWS Well-Architected Security Pillar](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)

## Open Security Follow-ups

| #                                                        | Title                                                               | Status                                                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#255](https://github.com/leixiaoyu/lfmt-poc/issues/255) | security: migrate auth tokens from localStorage to httpOnly cookies | Open. Blocked on custom-domain ACM/Route53 setup (CloudFront ↔ execute-api must share a registrable parent domain for httpOnly cookies). Needs CSRF + SameSite design decisions. |
| [#260](https://github.com/leixiaoyu/lfmt-poc/issues/260) | ci(deploy): post-deploy smoke + integration tests on staging/prod   | Open. Architectural — needs per-env secret routing (`STAGING_USER_POOL_ID` / `PROD_USER_POOL_ID`), OIDC role broadening, and a test-user-isolation policy.                       |

## Version History

| Date       | Version | Changes                                                                                                                                                                                                                                                                                   |
| ---------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-25 | 1.2     | Added CSP architecture, build-time static nonce (#265), CSP report endpoint (#257), privacy-preserving 404 on ownership endpoints (#287), per-user rate-limit decision record (#290), timing side-channel analytical conclusion (#292), stable error envelope (#267/#280/#281/#283/#291). |
| 2026-05-13 | 1.1     | Wave 2 Track B auth + workflow hardening: 400-on-malformed-JSON (#180), removed AdminConfirmSignUp grant (#178), StopExecution on DELETE (#210), tightened cursor decode (#246).                                                                                                          |
| 2025-10-21 | 1.0     | Initial security policy and audit results.                                                                                                                                                                                                                                                |

## Contact

Security Contact: `leixiaoyu@users.noreply.github.com`
Repository: https://github.com/leixiaoyu/lfmt-poc
