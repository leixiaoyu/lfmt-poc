# Security Policy and Best Practices

## Overview

This document outlines the security measures, policies, and best practices for the LFMT POC project.

## Security Audit History

### 2025-10-21: Security Hardening

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
- Shared-types tests (11/11 passing)
- Infrastructure tests (20/20 passing)
- TypeScript compilation checks
- Security scans for hardcoded secrets

**Git Configuration**:
- Author email: `leixiaoyu@users.noreply.github.com` (prevents email harvesting)
- Git hooks enforce pre-push validation

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

## Version History

| Date       | Version | Changes                                      |
|------------|---------|----------------------------------------------|
| 2025-10-21 | 1.0     | Initial security policy and audit results    |

## Contact

Security Contact: `leixiaoyu@users.noreply.github.com`
Repository: https://github.com/leixiaoyu/lfmt-poc
