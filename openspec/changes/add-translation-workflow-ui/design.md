# Translation Workflow UI - Technical Design

## Context

The frontend currently has authentication infrastructure but no translation capabilities. The backend API has been validated through comprehensive integration tests that confirm the complete workflow: upload → chunk → translate → complete. The frontend needs to provide a user interface for this workflow while maintaining high code quality, accessibility, and test coverage.

### Stakeholders
- **End Users**: Need intuitive UI for document translation with real-time progress
- **Developers**: Need maintainable, well-tested codebase
- **Product**: Need compliance with legal requirements (attestation)
- **Operations**: Need CI/CD confidence through automated E2E tests

### Constraints
- Must integrate with existing backend API (no API changes)
- Must maintain 90%+ test coverage
- Must achieve WCAG 2.1 AA accessibility
- Must support adaptive polling (avoid excessive backend load)
- Must work on mobile and desktop viewports

## Goals / Non-Goals

### Goals
1. Enable users to translate documents through intuitive multi-step workflow
2. Provide real-time translation progress with polling
3. Ensure legal compliance through mandatory attestation
4. Maintain high test coverage with comprehensive E2E tests
5. Deliver accessible, responsive UI across all devices
6. Support all backend translation options (5 languages, 3 tones)

### Non-Goals
1. ❌ Real-time WebSocket updates (using polling instead - simpler, matches backend architecture)
2. ❌ Offline translation capabilities (requires backend connectivity)
3. ❌ Batch upload of multiple documents (single document per job for POC)
4. ❌ Advanced job management (pause, resume, priority) - not supported by backend
5. ❌ Translation editing or review UI (future feature)
6. ❌ Cost estimation before upload (backend calculates after processing)

## Decisions

### Decision 1: Polling Architecture for Progress Tracking

**Choice**: Adaptive polling with increasing intervals (15s → 30s → 60s)

**Rationale**:
- **Simpler than WebSockets**: No persistent connection management, no connection drops
- **Backend Compatibility**: Backend designed for polling (integration tests use polling)
- **Cost Effective**: Reduces Lambda invocations compared to fixed-interval polling
- **User Experience**: 15s initial interval feels responsive, 60s max avoids excessive updates

**Implementation**:
```typescript
const useTranslationPolling = (jobId: string) => {
  const [interval, setInterval] = useState(15000); // Start at 15s
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    const timer = setInterval(async () => {
      const status = await getTranslationStatus(jobId);
      setElapsedTime(prev => prev + interval);

      // Adaptive interval: 15s → 30s after 2min, → 60s after 5min
      if (elapsedTime > 300000 && interval < 60000) {
        setInterval(60000);
      } else if (elapsedTime > 120000 && interval < 30000) {
        setInterval(30000);
      }

      if (status.translationStatus === 'COMPLETED' ||
          status.translationStatus === 'TRANSLATION_FAILED') {
        clearInterval(timer);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [jobId, interval, elapsedTime]);
};
```

**Alternatives Considered**:
1. **WebSocket Updates**: More complex, requires separate backend infrastructure
2. **Server-Sent Events (SSE)**: Better than polling but not supported by API Gateway REST
3. **Fixed Interval Polling**: Simpler but wastes backend resources

### Decision 2: Multi-Step Form with Stepper UI

**Choice**: Multi-step form with Material-UI Stepper component

**Rationale**:
- **Legal Compliance**: Attestation must be explicit and separate from file selection
- **User Guidance**: Clear progression through workflow reduces errors
- **Validation**: Each step validates before proceeding
- **Accessibility**: Stepper provides clear navigation landmarks

**Steps**:
1. **Legal Attestation**: Copyright, translation rights, liability (all required)
2. **Translation Configuration**: Language selection, tone selection
3. **File Upload**: Drag-and-drop or file picker
4. **Review**: Confirm all selections before submission

**Implementation**:
```typescript
const [activeStep, setActiveStep] = useState(0);
const [formData, setFormData] = useState({
  attestation: null,
  config: null,
  file: null,
});

const steps = [
  'Legal Attestation',
  'Translation Settings',
  'Upload Document',
  'Review & Submit',
];

const handleNext = () => {
  if (validateStep(activeStep)) {
    setActiveStep(prev => prev + 1);
  }
};
```

**Alternatives Considered**:
1. **Single Page Form**: Cluttered, harder to validate, poor UX for legal attestation
2. **Modal Dialogs**: Interrupts flow, doesn't show progress

### Decision 3: State Management with Context + useReducer

**Choice**: Dedicated `TranslationContext` with `useReducer` for complex state

**Rationale**:
- **Centralized State**: Translation jobs, current job, polling state
- **Predictable Updates**: useReducer provides predictable state transitions
- **Performance**: Context prevents prop drilling, selective re-renders
- **Testability**: Reducers are pure functions, easy to test

**State Shape**:
```typescript
interface TranslationState {
  currentJob: Job | null;
  jobs: Job[];
  isPolling: boolean;
  error: string | null;
}

type TranslationAction =
  | { type: 'SET_CURRENT_JOB'; payload: Job }
  | { type: 'UPDATE_JOB'; payload: Job }
  | { type: 'ADD_JOB'; payload: Job }
  | { type: 'SET_POLLING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string };
```

**Alternatives Considered**:
1. **useState Only**: Too many state variables, harder to coordinate
2. **Redux**: Overkill for this scope, adds complexity
3. **Component-Level State**: Prop drilling, difficult to share across pages

### Decision 4: Playwright E2E Testing with Page Object Model

**Choice**: Playwright with Page Object Model pattern

**Rationale**:
- **Multi-Browser**: Tests on Chromium, Firefox, WebKit
- **Auto-Wait**: Built-in waits reduce flakiness
- **Developer Experience**: Excellent debugging tools (UI mode, trace viewer)
- **CI/CD Ready**: First-class GitHub Actions integration
- **Page Objects**: Reduce duplication, centralize selectors

**Test Structure**:
```
e2e/
├── pages/           # Page Object Models
│   ├── NewTranslationPage.ts
│   └── TranslationDetailPage.ts
├── fixtures/        # Test helpers and data
│   ├── auth.ts
│   └── test-documents.ts
└── tests/           # Test specs
    ├── auth/
    ├── translation/
    └── integration/
```

**Example Page Object**:
```typescript
export class NewTranslationPage {
  constructor(private page: Page) {}

  async acceptLegalAttestation() {
    await this.page.check('[name="acceptCopyrightOwnership"]');
    await this.page.check('[name="acceptTranslationRights"]');
    await this.page.check('[name="acceptLiabilityTerms"]');
  }

  async selectLanguage(lang: string) {
    await this.page.selectOption('[name="targetLanguage"]', lang);
  }

  async uploadDocument(file: File) {
    await this.page.setInputFiles('input[type="file"]', file);
    await this.page.click('button:has-text("Upload")');
  }
}
```

**Alternatives Considered**:
1. **Cypress**: Good but slower, less multi-browser support
2. **TestCafe**: Older, less active development
3. **Selenium**: More complex setup, slower execution

### Decision 5: API Service Layer Pattern

**Choice**: Dedicated service classes for API calls, no direct axios in components

**Rationale**:
- **Separation of Concerns**: Components focus on UI, services handle API
- **Testability**: Mock services instead of axios everywhere
- **Error Handling**: Centralized error transformation
- **Type Safety**: Enforced request/response types

**Implementation**:
```typescript
// src/services/translationService.ts
export class TranslationService {
  async getJobStatus(jobId: string): Promise<JobStatus> {
    const response = await apiClient.get<JobStatus>(`/jobs/${jobId}`);
    return response.data;
  }

  async startTranslation(
    jobId: string,
    targetLanguage: string,
    tone: 'formal' | 'informal' | 'neutral'
  ): Promise<void> {
    await apiClient.post(`/jobs/${jobId}/translate`, {
      targetLanguage,
      tone,
    });
  }
}

export const translationService = new TranslationService();
```

**Usage in Components**:
```typescript
const TranslationDetailPage = () => {
  const [status, setStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    translationService.getJobStatus(jobId)
      .then(setStatus)
      .catch(handleError);
  }, [jobId]);
};
```

**Alternatives Considered**:
1. **Direct Axios Calls**: Harder to test, duplicated error handling
2. **React Query/SWR**: Adds dependency, overkill for simple CRUD

### Decision 6: Test Data Synchronization

**Choice**: Frontend E2E test fixtures match backend integration test fixtures

**Rationale**:
- **Consistency**: Same test documents across frontend and backend
- **Predictability**: Known word counts, chunk counts, translation times
- **Debugging**: Easier to correlate frontend failures with backend behavior

**Shared Fixture Structure**:
```typescript
// Match backend/functions/__tests__/integration/fixtures/test-documents.ts
export const TEST_DOCUMENTS = {
  MINIMAL: {
    name: 'minimal-test.txt',
    content: `The Art of Translation...`, // Exact same content as backend
    estimatedChunks: 1,
    estimatedTime: '30-60 seconds',
  },
  SMALL: {
    name: 'small-test.txt',
    content: `The History of Language Translation...`,
    estimatedChunks: 3,
    estimatedTime: '1-2 minutes',
  },
  // ... MEDIUM, LARGE
};
```

**Benefits**:
- E2E tests use MINIMAL for speed (30-60s)
- Can use SMALL for thorough testing (1-2min)
- MEDIUM/LARGE for stress testing in dedicated test runs

## Risks / Trade-offs

### Risk 1: Polling Performance Impact
**Risk**: Excessive polling could strain backend Lambda cold starts

**Mitigation**:
- Adaptive intervals reduce frequency over time
- Stop polling immediately when job completes
- Maximum interval capped at 60 seconds
- Monitor CloudWatch metrics for Lambda throttling

**Trade-off**: Slightly less responsive than WebSocket but much simpler

### Risk 2: E2E Test Flakiness
**Risk**: Network issues or backend delays could cause intermittent test failures

**Mitigation**:
- Playwright's auto-wait reduces timing issues
- Retry logic for flaky tests (max 2 retries in CI)
- Generous timeouts for translation operations (3-5 minutes)
- Use `waitForSelector` instead of fixed `setTimeout`
- Network error handling in tests

**Trade-off**: Tests run slower but are more reliable

### Risk 3: Legal Attestation UX Friction
**Risk**: Users might abandon flow due to legal step complexity

**Mitigation**:
- Clear, plain-language explanations
- Show stepper progress (users see they're 25% done)
- Allow "back" navigation to review choices
- Persist form data in localStorage (don't lose progress)

**Trade-off**: More steps in flow, but legally compliant

### Risk 4: Mobile Viewport Challenges
**Risk**: Complex forms may not work well on small screens

**Mitigation**:
- Mobile-first design approach
- Responsive stepper (vertical on mobile, horizontal on desktop)
- Touch-friendly file upload
- Test on actual devices (Playwright mobile viewports)

**Trade-off**: May need simplified mobile UX in future

## Migration Plan

N/A - This is new functionality with no existing users to migrate.

### Deployment Steps
1. Deploy frontend changes to staging environment
2. Run full E2E test suite against staging
3. Manual QA on staging (desktop and mobile)
4. Deploy to production with feature flag (optional)
5. Monitor error rates and performance metrics
6. Gradual rollout (if using feature flag)

### Rollback Plan
If critical issues discovered in production:
1. Revert deployment to previous version
2. Disable `/translation/*` routes via configuration
3. Show maintenance message to users
4. Fix issues in development
5. Re-deploy with fixes

## Open Questions

1. **Download Format**: Should translations be downloadable as .txt only, or support .docx/.pdf?
   - **Decision**: Start with .txt only (matches upload format), add others in future

2. **Job Retention**: How long should completed translation jobs be retained?
   - **Decision**: Follow backend retention policy (TBD by backend team)

3. **Concurrent Jobs**: Should users be allowed multiple simultaneous translation jobs?
   - **Decision**: Yes, no artificial limit for POC (backend handles queueing)

4. **Cost Display**: Should we show estimated cost before translation starts?
   - **Decision**: No for MVP (backend calculates after chunking), consider for future

5. **Error Retry**: Should failed translations be automatically retryable from UI?
   - **Decision**: Yes, add "Retry" button on FAILED status (calls same startTranslation API)

## Performance Considerations

### Bundle Size
- Target: <250KB initial bundle (gzipped)
- Lazy load translation pages (not needed for auth flow)
- Code split by route
- Tree shake unused Material-UI components

### Rendering Performance
- Memoize expensive computations (progress calculations)
- Use React.memo for pure components
- Avoid unnecessary re-renders (proper dependency arrays)
- Virtual scrolling for long job lists (if >100 items)

### API Performance
- Debounce search in history page (300ms)
- Cache job list (5 minute TTL)
- Batch status updates (if checking multiple jobs)
- Prefetch translation detail when hovering on history row

## Accessibility Checklist

- [ ] All form inputs have associated labels
- [ ] Keyboard navigation works for all interactions
- [ ] Focus indicators visible and clear
- [ ] Screen reader announcements for status changes (live regions)
- [ ] Color contrast ratios meet WCAG AA (4.5:1 for text)
- [ ] Error messages associated with form fields (aria-describedby)
- [ ] Stepper navigation accessible via keyboard
- [ ] File upload works with keyboard (not mouse-only)
- [ ] Progress updates announced to screen readers
- [ ] Download button has clear label and state

## Security Considerations

- ✅ No API keys in frontend code
- ✅ JWT tokens in httpOnly cookies (when backend supports) or localStorage with XSS protection
- ✅ Input validation on all form fields (Zod schemas)
- ✅ File type validation (only .txt allowed)
- ✅ File size validation (max 100MB)
- ✅ CSRF protection via Cognito tokens
- ✅ Sanitize user inputs before display
- ✅ No sensitive data in URL parameters (job IDs are not sensitive)

## Monitoring & Observability

**Frontend Metrics to Track**:
- Upload success/failure rates
- Translation completion rates
- Average time to completion
- Error rates by error type
- Page load times (Lighthouse CI)

**User Actions to Log** (anonymized):
- Upload initiated
- Translation started
- Download completed
- Errors encountered

**Performance Metrics**:
- Time to first byte (TTFB)
- First contentful paint (FCP)
- Largest contentful paint (LCP)
- Cumulative layout shift (CLS)
- Time to interactive (TTI)
