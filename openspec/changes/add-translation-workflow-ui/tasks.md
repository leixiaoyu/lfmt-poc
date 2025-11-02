# Translation Workflow UI - Implementation Tasks

## 1. Playwright E2E Test Infrastructure Setup
- [ ] 1.1 Install Playwright dependencies (`@playwright/test`, browsers)
- [ ] 1.2 Create `frontend/playwright.config.ts` with multi-browser configuration
- [ ] 1.3 Create E2E directory structure (`e2e/fixtures`, `e2e/pages`, `e2e/tests`, `e2e/utils`)
- [ ] 1.4 Create test fixtures matching backend integration test documents
- [ ] 1.5 Create Page Object Models for existing pages (Login, Register, Dashboard)
- [ ] 1.6 Write baseline E2E tests for authentication (should pass immediately)
- [ ] 1.7 Add Playwright scripts to `package.json` (`test:e2e`, `test:e2e:ui`, `test:e2e:report`)

## 2. Translation Service Layer (TDD Approach)
- [ ] 2.1 Write failing unit tests for `translationService.ts` (all methods)
- [ ] 2.2 Create `src/services/translationService.ts` with type definitions
- [ ] 2.3 Implement `getJobStatus(jobId)` - fetch job status from `/jobs/:jobId`
- [ ] 2.4 Implement `startTranslation(jobId, targetLanguage, tone)` - POST to `/jobs/:jobId/translate`
- [ ] 2.5 Implement `getTranslationStatus(jobId)` - GET `/jobs/:jobId/translation-status`
- [ ] 2.6 Implement `downloadTranslation(jobId)` - download completed translation
- [ ] 2.7 Add error handling and retry logic with exponential backoff
- [ ] 2.8 Write integration tests with mocked axios
- [ ] 2.9 Update `src/services/index.ts` to export translationService

## 3. Legal Attestation Component
- [ ] 3.1 Write failing E2E test for legal attestation flow
- [ ] 3.2 Write failing unit tests for `LegalAttestationForm.tsx`
- [ ] 3.3 Create `src/components/Translation/LegalAttestationForm.tsx`
- [ ] 3.4 Add checkboxes for: copyright ownership, translation rights, liability terms
- [ ] 3.5 Implement form validation (all checkboxes required)
- [ ] 3.6 Add IP address capture (via API call or client-side)
- [ ] 3.7 Add timestamp tracking
- [ ] 3.8 Style with Material-UI (Paper, Checkbox, Typography)
- [ ] 3.9 Add accessibility attributes (labels, ARIA)
- [ ] 3.10 Write component tests (interactions, validation, error states)

## 4. Translation Configuration Form
- [ ] 4.1 Write failing E2E test for language/tone selection
- [ ] 4.2 Write failing unit tests for `TranslationConfigForm.tsx`
- [ ] 4.3 Create `src/components/Translation/TranslationConfigForm.tsx`
- [ ] 4.4 Add language dropdown (Spanish, French, German, Italian, Chinese)
- [ ] 4.5 Add tone radio buttons (Formal, Informal, Neutral)
- [ ] 4.6 Implement form validation (both fields required)
- [ ] 4.7 Add form state management with React Hook Form + Zod
- [ ] 4.8 Style with Material-UI (Select, Radio, FormControl)
- [ ] 4.9 Add accessibility (labels, keyboard navigation)
- [ ] 4.10 Write component tests (interactions, validation)

## 5. Enhanced File Upload Flow
- [ ] 5.1 Write failing E2E test for complete upload flow with attestation
- [ ] 5.2 Update `FileUploadForm.tsx` to integrate legal attestation
- [ ] 5.3 Update `uploadService.ts` to include attestation in API payload
- [ ] 5.4 Add multi-step form state (attestation → config → upload)
- [ ] 5.5 Add progress stepper UI (optional but recommended)
- [ ] 5.6 Update `NewTranslationPage.tsx` to orchestrate multi-step flow
- [ ] 5.7 Add error handling for each step
- [ ] 5.8 Write integration tests for complete upload workflow
- [ ] 5.9 Update existing unit tests to accommodate changes

## 6. Translation Progress Component
- [ ] 6.1 Write failing E2E test for progress tracking
- [ ] 6.2 Write failing unit tests for `TranslationProgress.tsx`
- [ ] 6.3 Create `src/components/Translation/TranslationProgress.tsx`
- [ ] 6.4 Implement polling hook (`useTranslationPolling`) with adaptive intervals
- [ ] 6.5 Display job states: PENDING, CHUNKING, CHUNKED, IN_PROGRESS, COMPLETED, FAILED
- [ ] 6.6 Show progress metrics (totalChunks, chunksTranslated, progressPercentage)
- [ ] 6.7 Show cost metrics (tokensUsed, estimatedCost)
- [ ] 6.8 Add LinearProgress bar with percentage
- [ ] 6.9 Add estimated completion time display
- [ ] 6.10 Implement cleanup on unmount (stop polling)
- [ ] 6.11 Style with Material-UI (Card, LinearProgress, Chip for status)
- [ ] 6.12 Add accessibility (live regions for screen readers)
- [ ] 6.13 Write component tests (polling logic, state transitions)

## 7. Translation Detail Page
- [ ] 7.1 Write failing E2E test for translation detail page
- [ ] 7.2 Write failing unit tests for `TranslationDetailPage.tsx`
- [ ] 7.3 Create `src/pages/TranslationDetailPage.tsx`
- [ ] 7.4 Add route parameter parsing (`:jobId`)
- [ ] 7.5 Fetch job details on mount
- [ ] 7.6 Integrate `TranslationProgress` component
- [ ] 7.7 Display job metadata (fileName, fileSize, targetLanguage, tone, createdAt)
- [ ] 7.8 Add download button (enabled when COMPLETED)
- [ ] 7.9 Add cancel button (enabled when IN_PROGRESS, if backend supports)
- [ ] 7.10 Add error state display (if FAILED)
- [ ] 7.11 Add breadcrumb navigation
- [ ] 7.12 Add loading skeleton for initial load
- [ ] 7.13 Style with Material-UI layout
- [ ] 7.14 Add accessibility
- [ ] 7.15 Write page tests (routing, data fetching, interactions)

## 8. Translation History Page
- [ ] 8.1 Write failing E2E test for history page
- [ ] 8.2 Write failing unit tests for `TranslationHistoryPage.tsx`
- [ ] 8.3 Create `src/pages/TranslationHistoryPage.tsx`
- [ ] 8.4 Create API endpoint wrapper for fetching user's job list
- [ ] 8.5 Implement job list table/grid with Material-UI DataGrid or Table
- [ ] 8.6 Add filtering by status (All, In Progress, Completed, Failed)
- [ ] 8.7 Add sorting by date (newest first by default)
- [ ] 8.8 Add pagination (20 items per page)
- [ ] 8.9 Add search functionality (by filename)
- [ ] 8.10 Implement row click → navigate to detail page
- [ ] 8.11 Add status chips with color coding
- [ ] 8.12 Add empty state (no translations yet)
- [ ] 8.13 Add loading skeleton
- [ ] 8.14 Style with Material-UI
- [ ] 8.15 Add accessibility (table headers, keyboard navigation)
- [ ] 8.16 Write page tests (filtering, sorting, pagination, navigation)

## 9. Dashboard Enhancement
- [ ] 9.1 Write failing E2E test for enhanced dashboard
- [ ] 9.2 Write failing unit tests for updated `DashboardPage.tsx`
- [ ] 9.3 Add "New Translation" prominent CTA button
- [ ] 9.4 Add "Recent Translations" section (last 5 jobs)
- [ ] 9.5 Add quick stats cards (total translations, in progress, completed)
- [ ] 9.6 Add "View All" link to translation history
- [ ] 9.7 Update layout with Material-UI Grid
- [ ] 9.8 Add loading states
- [ ] 9.9 Update existing tests
- [ ] 9.10 Verify accessibility

## 10. Translation Context Provider
- [ ] 10.1 Write failing tests for `TranslationContext.tsx`
- [ ] 10.2 Create `src/contexts/TranslationContext.tsx`
- [ ] 10.3 Define context interface (current job, job list, actions)
- [ ] 10.4 Implement context provider with useReducer
- [ ] 10.5 Add actions: setCurrentJob, addJob, updateJob, removeJob
- [ ] 10.6 Add localStorage persistence for job list
- [ ] 10.7 Integrate with `App.tsx`
- [ ] 10.8 Write context tests (actions, state updates, persistence)

## 11. Routing Updates
- [ ] 11.1 Add route for `/translation/new` (NewTranslationPage - already exists)
- [ ] 11.2 Add route for `/translation/history` (TranslationHistoryPage)
- [ ] 11.3 Add route for `/translation/:jobId` (TranslationDetailPage)
- [ ] 11.4 Update navigation links in Dashboard
- [ ] 11.5 Add ProtectedRoute wrapper for all translation routes
- [ ] 11.6 Update `src/config/constants.ts` with new route constants
- [ ] 11.7 Test route navigation

## 12. E2E Test Suite - Translation Workflows
- [ ] 12.1 Create `e2e/tests/translation/upload-workflow.spec.ts`
- [ ] 12.2 Create `e2e/tests/translation/translation-progress.spec.ts`
- [ ] 12.3 Create `e2e/tests/translation/legal-attestation.spec.ts`
- [ ] 12.4 Create `e2e/tests/translation/download-translation.spec.ts`
- [ ] 12.5 Create `e2e/tests/integration/complete-workflow.spec.ts` (full E2E)
- [ ] 12.6 Create `e2e/tests/integration/multi-language.spec.ts` (test all languages)
- [ ] 12.7 Create `e2e/tests/integration/error-scenarios.spec.ts`
- [ ] 12.8 Create Page Object Models for all new pages
- [ ] 12.9 Verify all E2E tests pass locally
- [ ] 12.10 Run E2E tests in CI environment

## 13. CI/CD Integration
- [ ] 13.1 Create `.github/workflows/frontend-e2e.yml`
- [ ] 13.2 Configure Playwright in GitHub Actions
- [ ] 13.3 Add Playwright browser installation step
- [ ] 13.4 Configure test environment variables
- [ ] 13.5 Add artifact upload for Playwright reports
- [ ] 13.6 Add artifact upload for screenshots on failure
- [ ] 13.7 Update main deploy workflow to trigger E2E tests
- [ ] 13.8 Test CI/CD pipeline with test PR

## 14. Documentation
- [ ] 14.1 Create `frontend/e2e/README.md` (Playwright testing guide)
- [ ] 14.2 Create `frontend/TESTING_STRATEGY.md` (test pyramid documentation)
- [ ] 14.3 Update `frontend/README.md` (add E2E testing section, new features)
- [ ] 14.4 Update `frontend/VERIFICATION.md` (add new feature verification steps)
- [ ] 14.5 Add JSDoc comments to all new components
- [ ] 14.6 Add inline code comments for complex logic
- [ ] 14.7 Update architecture diagrams if needed

## 15. Polish & Quality Assurance
- [ ] 15.1 Run full test suite (unit + integration + E2E)
- [ ] 15.2 Verify test coverage remains above 90%
- [ ] 15.3 Run Lighthouse audit (target 90+ score)
- [ ] 15.4 Run accessibility audit (axe DevTools)
- [ ] 15.5 Test on multiple browsers (Chrome, Firefox, Safari)
- [ ] 15.6 Test on mobile viewports
- [ ] 15.7 Fix any linting errors
- [ ] 15.8 Fix any TypeScript errors
- [ ] 15.9 Optimize bundle size (check with `npm run build`)
- [ ] 15.10 Performance optimization (memoization, lazy loading)

## 16. Deployment Preparation
- [ ] 16.1 Update environment variables documentation
- [ ] 16.2 Verify production build succeeds
- [ ] 16.3 Test production build locally with `npm run preview`
- [ ] 16.4 Create deployment checklist
- [ ] 16.5 Prepare rollback plan
- [ ] 16.6 Schedule deployment window

## 17. Final Validation
- [ ] 17.1 Complete end-to-end manual testing
- [ ] 17.2 Verify all OpenSpec requirements met
- [ ] 17.3 Verify all success criteria achieved
- [ ] 17.4 Code review and approval
- [ ] 17.5 Merge to main branch
- [ ] 17.6 Monitor deployment
- [ ] 17.7 Verify production E2E tests pass
- [ ] 17.8 Archive OpenSpec change proposal
