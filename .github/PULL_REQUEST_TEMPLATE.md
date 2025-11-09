# Pull Request

## Description
<!-- Provide a brief description of the changes in this PR -->

## Type of Change
<!-- Mark the relevant option with an "x" -->

- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Infrastructure/CDK changes
- [ ] Documentation update
- [ ] Refactoring (no functional changes)

## Related Issues
<!-- Link to related issues using #issue_number -->

Fixes #
Related to #

## Testing
<!-- Describe the tests you ran and their results -->

- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] All tests passing locally
- [ ] Tested in dev environment

## Infrastructure/CDK Changes Checklist
<!-- Complete this section if your PR modifies AWS infrastructure or CDK code -->

### IAM Policy Changes
- [ ] **Policy Count**: Does this PR modify IAM roles or policies?
  - If yes: Review total number of inline policies per role (AWS limit: varies by service)
  - Consider using managed policies instead of inline policies

- [ ] **Policy Size**: Have you reviewed policy statement count and size?
  - Single policy limit: 6,144 characters for inline, 10,240 bytes for managed
  - Use `@aws-cdk/aws-iam:minimizePolicies` context flag (already enabled in cdk.json)

- [ ] **ARN References**: Are you using CloudFormation intrinsics or CDK tokens?
  - ❌ **Avoid**: `${AWS::Region}`, `${AWS::AccountId}` in CDK code (treated as literal strings)
  - ✅ **Use**: `Stack.of(this).region`, `Stack.of(this).account`, `Fn.ref()`, etc.
  - See: [CDK Best Practices - Tokens vs Intrinsics](../docs/cdk-best-practices.md)

- [ ] **Wildcards**: Do your policies use wildcards (`*`) in actions or resources?
  - Document justification for wildcards in PR description
  - Consider more restrictive alternatives where possible

### Deployment Validation
- [ ] CDK synthesis succeeds locally (`npx cdk synth`)
- [ ] No new CloudFormation warnings or errors in synthesis output
- [ ] Reviewed generated CloudFormation template for unexpected changes

## Screenshots/Logs
<!-- Include relevant screenshots or log snippets if applicable -->

## Checklist
- [ ] My code follows the project's style guidelines
- [ ] I have performed a self-review of my code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

## Additional Notes
<!-- Add any additional context about the PR here -->
