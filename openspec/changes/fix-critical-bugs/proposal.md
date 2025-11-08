# Proposal: Fix Critical Bugs

**Change ID**: `fix-critical-bugs`
**Status**: Proposed
**Priority**: P1 - HIGH
**Related Issues**: #10, #12, #15, #26
**Owner**: xlei-raymond (Principal Engineer / Team Lead)
**Created**: 2025-11-08

## Problem Statement

Four critical bugs are blocking production readiness and causing runtime failures:

### Issue #10: Runtime Failures Due to Mismatched Environment Variables
- **Impact**: Auth and jobs handlers crash at runtime
- **Root Cause**: Environment variable names inconsistent between code and infrastructure
- **Risk**: Production deployment failures

### Issue #12: Unprotected /auth/me Endpoint
- **Impact**: Endpoint cannot retrieve user data; security risk
- **Root Cause**: Missing authentication middleware
- **Risk**: Unauthorized access to user information

### Issue #15: API Gateway Caching Incorrectly Enabled for Auth Endpoints
- **Impact**: Stale authentication responses; login failures
- **Root Cause**: Caching configured on authentication endpoints
- **Risk**: User cannot login after password change

### Issue #26: Hardcoded Fallback API URL is Incorrect
- **Impact**: Frontend fails to connect to backend in production
- **Root Cause**: Hardcoded localhost URL in frontend
- **Risk**: Production application non-functional

## Proposed Solution

Fix all four bugs in a single coordinated effort:

1. **Standardize environment variables** across infrastructure and code
2. **Add authentication middleware** to /auth/me endpoint
3. **Disable API Gateway caching** for all /auth/* endpoints
4. **Replace hardcoded URL** with environment-based configuration

## Implementation Plan

### Task 1: Fix Environment Variables (#10) - 2 hours
- Audit all environment variable usage
- Standardize naming convention
- Update CDK infrastructure
- Update Lambda code
- Add validation tests

### Task 2: Protect /auth/me Endpoint (#12) - 1 hour
- Add JWT authentication middleware
- Update endpoint handler
- Add integration tests
- Verify user data retrieval

### Task 3: Fix API Gateway Caching (#15) - 1 hour
- Disable caching for /auth/* routes in CDK
- Add cache control headers
- Test login/logout flow
- Verify no stale responses

### Task 4: Fix Hardcoded Frontend URL (#26) - 2 hours
- Add environment variable for API URL
- Update Vite configuration
- Replace hardcoded values
- Test in all environments

## Success Criteria

- ✅ All four issues resolved
- ✅ No runtime failures in auth/jobs handlers
- ✅ /auth/me endpoint returns user data correctly
- ✅ Login works immediately after password change
- ✅ Frontend connects to correct backend in all environments
- ✅ Integration tests pass in CI/CD

## Timeline

**Total Effort**: 1 day (6 hours)
**Target Completion**: Within 1 sprint

## References

- **Team Lead Execution Plan**: project_priorities_proposal.md (Phase 2)
- **GitHub Issues**: #10, #12, #15, #26

---

**Status**: Proposed - Awaiting Approval
**Next Step**: Team lead approval to proceed
