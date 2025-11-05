# LFMT POC - Development Roadmap

**Last Updated:** 2025-11-04
**Team Lead:** xlei-raymond (Principal Engineer)
**Based on:** Project Priorities Proposal v2 (2025-11-02)

---

## Executive Summary

With the successful implementation of the Step Functions orchestrator (PR #33), we have achieved a critical milestone: **a functional, end-to-end V1 translation workflow**. Our focus now shifts from initial implementation to **viability and performance**.

The two most critical risks to the project's success are:
1. **Unresolved cost model discrepancy** (Claude vs. Gemini pricing)
2. **Known performance bottleneck** of sequential translation

This roadmap prioritizes tackling these issues head-on with a clear, phased approach.

---

## Completed Milestones ✅

### V1 End-to-End Workflow (Phase 6 - Complete)
- **Status**: ✅ Merged via PR #33 (2025-11-04)
- **Achievement**: Core Step Functions state machine implemented, tested, and deployed
- **Test Coverage**: 25/25 infrastructure tests, 296/296 backend function tests
- **Performance**: Sequential processing (V1) - 65K words: ~100s, 400K words: ~600s
- **Related Issues**: #22 (Missing Step Functions orchestrator)

**Key Implementations:**
- Step Functions workflow with Map state for chunk processing
- Retry logic with exponential backoff (2s → 4s → 8s)
- DynamoDB service integration for job status updates
- CloudWatch logging and X-Ray tracing
- IAM least-privilege permissions

---

## Updated Roadmap: 4-Phase Approach

### **Phase 1: Foundational Viability & Performance** (Immediate Focus - P0/P1)

This phase ensures the project is both economically viable and technically performant.

#### P0 - Validate Cost Model & Engine Choice
**Priority**: CRITICAL - Highest business risk
**Status**: 🔴 BLOCKED - Requires business decision
**Related Issue**: #13

**Description:**
The conflict between the project's cost targets and the estimated cost of the translation engine must be resolved.

**Action Items:**
- [ ] Finalize choice of translation engine (Claude Sonnet 4 vs. Gemini 1.5 Pro)
- [ ] Get business approval on realistic cost model
- [ ] Update all documentation to reflect final engine choice
- [ ] Update infrastructure to support chosen engine

**Decision Criteria:**
- **Claude Sonnet 4**: Higher quality, $3 per 1M input tokens
- **Gemini 1.5 Pro**: Free tier (5 RPM, 250K TPM, 25 RPD), then $1.25 per 1M tokens
- **Cost Target**: <$50/month for 1000 translations

---

#### P1 - Enable Parallel Translation
**Priority**: HIGH - Critical performance blocker
**Status**: 🟡 READY - Unblocked after cost model decision
**Related Issue**: #23

**Description:**
The V1 orchestrator intentionally processes chunks sequentially (`maxConcurrency: 1`). This was a temporary trade-off for context continuity that must now be addressed to meet performance goals.

**Current Performance (Sequential):**
- 65K words (10 chunks): ~100 seconds
- 400K words (60 chunks): ~600 seconds (10 minutes)

**Target Performance (Parallel):**
- 65K words (10 chunks): ~15-20 seconds (5-7x faster)
- 400K words (60 chunks): ~60-90 seconds (6-10x faster)

**Action Items:**
- [ ] Modify `translateChunk` function to use pre-calculated context from chunk object
- [ ] Remove `maxConcurrency: 1` limitation in Step Functions Map state
- [ ] Implement distributed rate limiting for parallel execution
- [ ] Add integration tests for parallel translation
- [ ] Update performance benchmarks and documentation

**Technical Approach:**
1. Chunk metadata already includes context windows (250-token overlap)
2. Each chunk is self-contained with pre-calculated context
3. Remove sequential constraint and rely on pre-calculated context
4. Implement global rate limiter to respect API limits

---

#### P1 - Address Core Scalability Blockers
**Priority**: HIGH - Will cause failures at scale
**Status**: 🟡 READY - Can start immediately
**Related Issues**: #24, #25

**Two major scalability issues:**

**Issue #24: In-Memory File Processing**
- **Problem**: Chunking Lambda loads entire document into memory
- **Risk**: Lambda OOM errors for 400K word documents (~2-3 MB plain text)
- **Solution**: Stream processing from S3 with chunk-by-chunk processing
- **Impact**: Enables processing of documents up to 10 MB without Lambda limits

**Issue #25: Distributed Rate Limiter**
- **Problem**: Current rate limiting is per-Lambda instance, not global
- **Risk**: Parallel execution will violate API rate limits
- **Solution**: DynamoDB-backed distributed rate limiter with token bucket algorithm
- **Impact**: Safe parallel processing up to API limits

**Action Items:**
- [ ] Implement S3 streaming for chunking Lambda
- [ ] Add memory usage monitoring and alerts
- [ ] Implement DynamoDB token bucket rate limiter
- [ ] Add rate limit monitoring and throttling metrics
- [ ] Load test with 10+ concurrent documents

---

### **Phase 2: Stabilize and Secure** (P1)

With a scalable workflow, fix remaining bugs and security flaws.

#### P1 - Fix Critical Bugs
**Status**: 🟡 READY - Can start immediately
**Related Issues**: #10, #12, #15, #26

**Bug Inventory:**

| Issue | Priority | Description | Impact |
|-------|----------|-------------|--------|
| #10 | P1 | Inconsistent environment variables | Deployment failures |
| #12 | P1 | Unprotected `/auth/me` endpoint | Security vulnerability |
| #15 | P1 | Incorrect API Gateway caching on auth endpoints | Stale auth responses |
| #26 | P1 | Hardcoded fallback URL in frontend | Breaks non-dev environments |

**Action Items:**
- [ ] Audit and standardize all environment variable usage
- [ ] Add Cognito authorizer to `/auth/me` endpoint
- [ ] Configure API Gateway cache exclusions for auth endpoints
- [ ] Replace hardcoded URL with environment-based configuration
- [ ] Add integration tests for each bug fix

---

#### P1 - Harden Security
**Status**: 🟡 READY - Can start immediately
**Related Issues**: #11, #14

**Security Issues:**

**Issue #11: Wildcard CORS Vulnerability**
- **Problem**: API Gateway allows `Access-Control-Allow-Origin: *`
- **Risk**: CSRF attacks, credential leakage
- **Solution**: Restrict to specific frontend origins
- **Action**: Update API Gateway CORS configuration

**Issue #14: Overly Permissive IAM Role**
- **Problem**: Some Lambda roles have broader permissions than needed
- **Risk**: Privilege escalation, blast radius expansion
- **Solution**: Apply least-privilege principles
- **Action**: Audit all IAM roles and scope down permissions

**Action Items:**
- [ ] Update CORS to whitelist specific origins (dev, staging, prod)
- [ ] Audit all Lambda IAM policies
- [ ] Remove unnecessary permissions
- [ ] Add IAM policy validation to CI/CD
- [ ] Security audit with AWS IAM Access Analyzer

---

### **Phase 3: Feature Enhancement & Technical Debt** (P2)

Once the core service is stable, performant, and secure, focus on user-facing features and developer experience.

#### P2 - Implement High-Value Features
**Status**: ⏸️ BLOCKED - Waiting on Phase 1/2 completion
**Related Issues**: #29, #27, #28

**Feature Priority:**

1. **Post-Translation Editor** (#29) - Highest user value
   - Allow users to refine translations before export
   - Inline editing with original context
   - Track user modifications for quality improvement

2. **Side-by-Side Viewer** (#27) - Quality validation
   - Display original and translated text in parallel
   - Highlight chunk boundaries
   - Enable quick quality checks

3. **ePub/PDF Support** (#28) - Format expansion
   - Support beyond plain text
   - Preserve formatting and structure
   - Handle embedded images and metadata

**Action Items:**
- [ ] Design and prototype Post-Translation Editor UI
- [ ] Implement backend API for translation updates
- [ ] Build Side-by-Side Viewer component
- [ ] Add ePub/PDF parsing and generation
- [ ] User acceptance testing for each feature

---

#### P2 - Address Technical Debt
**Status**: ⏸️ BLOCKED - Waiting on Phase 1/2 completion
**Related Issues**: #18, #20, #19

**Technical Debt Items:**

**Issue #18: Integrate React Query**
- **Benefit**: Better caching, automatic refetching, optimistic updates
- **Scope**: Replace current API client with React Query
- **Effort**: Medium (2-3 days)

**Issue #20: Centralize Shared Constants**
- **Benefit**: Single source of truth, easier maintenance
- **Scope**: Move constants from `shared-types` to centralized module
- **Effort**: Low (1 day)

**Issue #19: Improve File Upload UX**
- **Benefit**: Better user experience, clearer feedback
- **Scope**: Enhanced progress tracking, better error handling
- **Effort**: Medium (2 days)

**Action Items:**
- [ ] Implement React Query for all API calls
- [ ] Create centralized constants module
- [ ] Enhance file upload component with better UX
- [ ] Refactor components to use new patterns
- [ ] Update tests for refactored code

---

### **Phase 4: Polish and Cleanup** (P3 - Ongoing)

Minor cleanup tasks addressed as bandwidth allows.

#### P3 - Chores and Documentation
**Status**: 🟢 ONGOING - As bandwidth permits
**Related Issues**: #17, #16, #21

**Chores:**
- Update outdated dependencies
- Refactor deprecated API usage
- Improve code comments and documentation
- Cleanup unused code and assets

**Action Items:**
- [ ] Quarterly dependency updates
- [ ] Documentation reviews
- [ ] Code cleanup sprints
- [ ] Performance profiling and optimization

---

## Implementation Strategy

### Priority Sequence

```
                ┌─────────────────────────────────┐
                │  P0: Cost Model Decision        │ ◄── CRITICAL
                └─────────────┬───────────────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │  P1: Parallel Translation       │ ◄── HIGH
                └─────────────┬───────────────────┘
                              │
                ┌─────────────┴───────────────┐
                │                             │
                ▼                             ▼
   ┌────────────────────────┐    ┌────────────────────────┐
   │  P1: Scalability       │    │  P1: Bugs & Security   │
   │      Blockers          │    │                        │
   └────────────┬───────────┘    └───────────┬────────────┘
                │                             │
                └─────────────┬───────────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │  P2: Features & Tech Debt       │
                └─────────────┬───────────────────┘
                              │
                              ▼
                ┌─────────────────────────────────┐
                │  P3: Polish & Cleanup           │
                └─────────────────────────────────┘
```

### Team Allocation (Recommended)

**Week 1-2: Foundation**
- **P0** - Business stakeholders: Finalize cost model decision
- **P1** - Backend team: Start distributed rate limiter (#25)
- **P1** - Infrastructure team: Start S3 streaming (#24)

**Week 3-4: Performance**
- **P1** - Full team: Implement parallel translation (#23)
- **P1** - Backend team: Fix critical bugs (#10, #12, #15, #26)

**Week 5-6: Security & Stabilization**
- **P1** - Security team: CORS and IAM hardening (#11, #14)
- **P1** - QA team: Comprehensive load testing
- **P2** - Begin technical debt reduction (#18, #20)

**Week 7+: Features**
- **P2** - Frontend team: Post-Translation Editor (#29)
- **P2** - Full stack team: Side-by-Side Viewer (#27)
- **P3** - Ongoing: Polish and cleanup

---

## Success Metrics

### Phase 1 (Viability & Performance)
- [ ] Cost model approved by business stakeholders
- [ ] Translation speed: <20s for 65K words, <90s for 400K words
- [ ] Zero OOM errors in chunking Lambda
- [ ] Zero rate limit violations in production

### Phase 2 (Stability & Security)
- [ ] All P1 bugs resolved
- [ ] Zero security vulnerabilities in automated scans
- [ ] CORS restricted to specific origins
- [ ] IAM policies follow least-privilege

### Phase 3 (Features & Debt)
- [ ] Post-Translation Editor user satisfaction >80%
- [ ] React Query implemented across frontend
- [ ] Code coverage maintained at 90%+

### Phase 4 (Polish)
- [ ] All dependencies up-to-date
- [ ] Documentation accuracy >95%
- [ ] Technical debt backlog <10 items

---

## Testing Strategy

### Phase-Specific Testing

**Phase 1: Performance Testing**
- Load testing with 10+ concurrent translations
- Memory profiling for chunking Lambda
- Rate limit compliance testing

**Phase 2: Security Testing**
- OWASP Top 10 vulnerability scanning
- Penetration testing for auth endpoints
- IAM policy validation

**Phase 3: User Acceptance Testing**
- Beta testing for Post-Translation Editor
- Usability testing for new features
- A/B testing for UX improvements

**Phase 4: Regression Testing**
- Automated regression suite for all features
- Performance regression detection
- Security regression monitoring

---

## Risk Management

### High-Risk Items

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Cost model rejected | Medium | Critical | Prepare fallback options (Gemini free tier) |
| Parallel translation breaks context | Low | High | Comprehensive testing with pre-calculated context |
| Rate limiter fails at scale | Medium | High | Load testing before production rollout |
| Security vulnerability discovered | Low | Critical | Regular security audits, automated scanning |

### Contingency Plans

**If P0 is delayed:**
- Continue with P1 items that don't depend on engine choice (#24, #25)
- Use Gemini free tier as temporary solution
- Delay parallel translation (#23) until cost model is approved

**If performance targets not met:**
- Re-evaluate chunk size and overlap
- Consider moving to ECS Fargate for long-running processes
- Implement caching for repeated translations

---

## Communication Plan

### Weekly Updates
- **Monday**: Sprint planning, priority review
- **Wednesday**: Mid-week sync, blocker resolution
- **Friday**: Sprint demo, retrospective

### Stakeholder Updates
- **Bi-weekly**: Business stakeholders (cost, timeline, risks)
- **Monthly**: Full team retrospective and roadmap adjustment

### Documentation
- Update [PROGRESS.md](PROGRESS.md) after each completed milestone
- Update this roadmap quarterly or when priorities shift
- Maintain issue tracking in GitHub Projects

---

## References

- **Progress Tracking**: [PROGRESS.md](PROGRESS.md)
- **Implementation Plan**: [LFMT Implementation Plan v2.md](../LFMT%20Implementation%20Plan%20v2.md)
- **Technical Architecture**: [Technical Architecture Design v2.0.md](../Long-Form%20Translation%20Service%20-%20Technical%20Architecture%20Design%20v2.0.md)
- **Team Lead Proposal**: [Project Priorities Proposal v2](/Users/raymondl/Documents/LFMT%20POC/LFMT/project_priorities_proposal.md)

---

**Last Updated**: 2025-11-04
**Next Review**: 2025-11-18
**Owner**: xlei-raymond (Principal Engineer / Team Lead)
