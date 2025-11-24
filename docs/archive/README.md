# Documentation Archive

This folder contains historical documentation, investigation reports, and resolved issue analyses that provide valuable context but are not needed for daily development.

---

## Contents

### Investigation Reports (P0)

| Document | Date | Topic | Status |
|----------|------|-------|--------|
| `P0-INVESTIGATION-CLOUDFRONT-SPA-ROUTING.md` | 2025-11-14 | CloudFront SPA routing 403 errors | ✅ Resolved (PR #66) |
| `P0-INVESTIGATION-COGNITO-SES-LIMIT.md` | 2025-11-09 | Cognito SES sandbox limits | ✅ Resolved (Auto-confirm feature) |
| `P0-INVESTIGATION-E2E-FAILURES.md` | 2025-11-09 | E2E test failures | ✅ Resolved (Test fixes) |

### Fix Summaries

| Document | Date | Topic | Related PR |
|----------|------|-------|------------|
| `CLOUDFRONT-FIX-SUMMARY.md` | 2025-11-14 | CloudFront CSP configuration fix | PR #66 |
| `CORS-TROUBLESHOOTING.md` | 2025-11-23 | CORS request origin investigation | PR #92 |
| `CORS-FIX-VALIDATION.md` | 2025-11-23 | CORS fix before/after validation | PR #92 |

### Consolidation Documentation

| Document | Date | Topic |
|----------|------|-------|
| `consolidation/DOCUMENTATION-CONSOLIDATION-PLAN.md` | 2025-11-23 | Phase 1 & 2 consolidation plan |
| `consolidation/DOCUMENTATION-CONSOLIDATION-SUMMARY.md` | 2025-11-23 | Phase 1 consolidation results |
| `consolidation/DOCUMENTATION-CONSOLIDATION-PHASE2-SUMMARY.md` | 2025-11-23 | Phase 2 consolidation results |

### Historical Documentation

| Document | Date | Topic |
|----------|------|-------|
| `DEPLOYMENT-CHECKLIST.md` | 2025-10-28 | Early deployment checklist |
| `DEPLOYMENT-VERIFICATION.md` | 2025-10-28 | Deployment verification steps |
| `DOCUMENTATION-CLEANUP-SUMMARY.md` | 2025-11-05 | Previous docs consolidation |
| `GEMINI-POC-REVIEW.md` | 2025-10-28 | Gemini translation POC review |
| `GITHUB-ACTIONS-SETUP.md` | 2025-10-28 | CI/CD setup documentation |
| `PROGRESS-SUMMARY.md` | 2025-10-28 | Historical progress summary |
| `SESSION-RECOVERY.md` | 2025-10-28 | Claude session recovery notes |

---

## Why Documents Are Archived

**Archived documents are**:
- ✅ Historically valuable for understanding project evolution
- ✅ Referenced from current documentation when relevant
- ✅ Kept for audit trail and knowledge preservation
- ❌ Not needed for daily development workflow
- ❌ Not actively maintained or updated

**Active documents are**:
- ✅ In project root or `docs/` folder (not archive)
- ✅ Actively maintained and updated
- ✅ Required for development, deployment, or troubleshooting
- ✅ Referenced in CLAUDE.md or other primary docs

---

## Accessing Archived Documents

### From Current Documentation

Many archived documents are referenced from active documentation:

- **CORS Issues**: `docs/CORS-REFERENCE.md` → `docs/archive/CORS-TROUBLESHOOTING.md`
- **CloudFront Setup**: `docs/CLOUDFRONT-SETUP.md` → `docs/archive/CLOUDFRONT-FIX-SUMMARY.md`

### Direct Access

```bash
# View archive contents
ls docs/archive/

# Read specific investigation
cat docs/archive/P0-INVESTIGATION-CLOUDFRONT-SPA-ROUTING.md

# Search archive
grep -r "CORS" docs/archive/
```

---

## Retention Policy

**Archive documents are**:
- **Retained**: Indefinitely (historical value)
- **Updated**: Never (frozen at time of archival)
- **Deleted**: Only if completely obsolete (rare)

**If you need information from archived docs**:
1. Read the archived document
2. Extract relevant information
3. Update active documentation if needed
4. Reference the archive from active docs

---

## Related Documentation

- **Active Docs**: Project root + `docs/` folder
- **CLAUDE.md**: Main development guide
- **PROGRESS.md**: Current project progress
- **Context Optimization**: `docs/CONTEXT-OPTIMIZATION-ANALYSIS.md`

---

**Last Updated**: 2025-11-23
**Archival Reason**: Phase 2 documentation consolidation
