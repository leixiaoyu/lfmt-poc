# Translation Workflow UI - Change Proposal

## Why

The frontend currently has authentication UI (Phase 3 completed) but lacks the core translation workflow functionality. Users cannot initiate translations, track progress, or download completed translations. The backend integration tests just validated the complete API workflow (upload → chunk → translate → complete), confirming the backend is ready for frontend integration.

**Problem**: Without translation workflow UI, users cannot leverage the deployed Gemini translation engine despite having a fully functional backend API.

**Opportunity**: Complete the frontend to enable end-to-end document translation with real-time progress tracking, legal compliance, and multi-language support.

## What Changes

### Frontend Capabilities (New)
- **Translation Service Layer**: API integration for job management and translation operations
- **Legal Attestation UI**: Copyright and rights compliance before upload
- **Translation Upload Flow**: File upload with language/tone selection
- **Progress Tracking**: Real-time translation status with polling
- **Translation History**: Job list with filtering and search
- **Translation Detail Page**: Individual job view with download capability

### Testing Infrastructure (New)
- **Playwright E2E Suite**: Complete workflow testing against live backend
- **Page Object Model**: Reusable page abstractions for maintainability
- **Test Fixtures**: Shared test documents matching backend integration tests
- **CI/CD Integration**: Automated E2E tests on every PR

### API Integration
- Connects to backend endpoints validated by integration tests:
  - `POST /jobs/upload` - Request presigned URL with legal attestation
  - `GET /jobs/:jobId` - Get job status
  - `POST /jobs/:jobId/translate` - Start translation
  - `GET /jobs/:jobId/translation-status` - Get translation progress

### Technical Enhancements
- **Polling Strategy**: Adaptive intervals (15s → 30s → 60s) for progress updates
- **State Management**: TranslationContext for translation-specific state
- **Error Handling**: Comprehensive error states with user-friendly messages
- **Accessibility**: WCAG 2.1 AA compliance for all new components

## Impact

### Affected Specs
- **NEW**: `translation-service` - Backend API integration layer
- **NEW**: `translation-upload` - File upload with legal attestation
- **NEW**: `translation-progress` - Real-time status tracking
- **NEW**: `translation-history` - Job list and history view
- **NEW**: `translation-detail` - Individual job detail page
- **NEW**: `legal-attestation` - Copyright compliance UI

### Affected Code
- **Frontend**:
  - `src/services/translationService.ts` (new)
  - `src/components/Translation/` (6 new components)
  - `src/pages/TranslationDetailPage.tsx` (complete)
  - `src/pages/TranslationHistoryPage.tsx` (new)
  - `src/pages/DashboardPage.tsx` (enhanced)
  - `src/contexts/TranslationContext.tsx` (new)
  - `src/App.tsx` (add routes)

- **Testing**:
  - `frontend/e2e/` (new Playwright test suite)
  - `frontend/playwright.config.ts` (new)
  - `.github/workflows/frontend-e2e.yml` (new)

- **Documentation**:
  - `frontend/e2e/README.md` (new)
  - `frontend/TESTING_STRATEGY.md` (new)
  - `frontend/README.md` (update)

### Dependencies
- **Runtime**: No new dependencies (uses existing axios, Material-UI, React Router)
- **Dev Dependencies**:
  - `@playwright/test` - E2E testing framework
  - `@playwright/test-runner` - Test runner

### Breaking Changes
None. This is purely additive functionality.

### Migration Path
N/A - New functionality, no migration needed.

### Risks
1. **Polling Performance**: Excessive polling could strain backend
   - **Mitigation**: Adaptive intervals reduce frequency over time
2. **E2E Test Reliability**: Network flakiness could cause test failures
   - **Mitigation**: Retry logic, proper waits, network error handling
3. **Backend API Changes**: If backend API changes during development
   - **Mitigation**: Backend integration tests provide contract stability

### Success Criteria
- ✅ User can upload document with legal attestation
- ✅ User can select target language (es, fr, de, it, zh) and tone (formal, informal, neutral)
- ✅ User can see real-time translation progress
- ✅ User can download completed translations
- ✅ User can view translation history
- ✅ All Playwright E2E tests passing
- ✅ 90%+ test coverage maintained
- ✅ WCAG 2.1 AA compliant
- ✅ No console errors in production build
- ✅ Lighthouse score 90+ for all metrics
