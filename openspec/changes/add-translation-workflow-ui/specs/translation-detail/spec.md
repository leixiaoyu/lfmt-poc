# Translation Detail - Specification Delta

## ADDED Requirements

### Requirement: Job Detail Display
The detail page SHALL display comprehensive information about a translation job.

#### Scenario: Job metadata display
- **WHEN** a user views a translation detail page
- **THEN** displays job ID, file name, file size, content type
- **AND** displays target language and tone
- **AND** displays creation date and last updated date
- **AND** displays current status with visual indicator

#### Scenario: User identification
- **WHEN** job details are loaded
- **THEN** verifies job belongs to authenticated user
- **AND** displays user email
- **AND** prevents access if job belongs to different user

#### Scenario: Breadcrumb navigation
- **WHEN** detail page renders
- **THEN** shows breadcrumb: Dashboard → Translation History → [Filename]
- **AND** each breadcrumb link is clickable
- **AND** current page is highlighted in breadcrumb

### Requirement: Progress Integration
The detail page SHALL integrate the translation progress component.

#### Scenario: Progress component display
- **WHEN** job is in PENDING, CHUNKING, or IN_PROGRESS status
- **THEN** displays TranslationProgress component
- **AND** shows real-time progress updates via polling
- **AND** displays all progress metrics

#### Scenario: Completed job display
- **WHEN** job status is COMPLETED
- **THEN** displays final metrics (total chunks, tokens used, cost)
- **AND** shows completion timestamp
- **AND** shows success indicator

#### Scenario: Failed job display
- **WHEN** job status is FAILED
- **THEN** displays error message with details
- **AND** shows failure timestamp
- **AND** shows error indicator with red styling

### Requirement: Action Buttons
The detail page SHALL provide context-appropriate action buttons.

#### Scenario: Download button (completed job)
- **WHEN** job status is COMPLETED
- **THEN** displays "Download Translation" button
- **AND** button is enabled and clickable
- **AND** clicking button downloads the translated file

#### Scenario: Start translation button (chunked job)
- **WHEN** job status is CHUNKED
- **THEN** displays "Start Translation" button
- **AND** clicking button initiates translation
- **AND** updates status to IN_PROGRESS

#### Scenario: Retry button (failed job)
- **WHEN** job status is TRANSLATION_FAILED
- **THEN** displays "Retry Translation" button
- **AND** clicking button calls startTranslation API
- **AND** resets status to IN_PROGRESS

#### Scenario: Cancel button (in progress job)
- **WHEN** job status is IN_PROGRESS
- **THEN** displays "Cancel Translation" button (if backend supports)
- **OR** button is hidden (if backend doesn't support cancellation)

### Requirement: Route Parameter Handling
The detail page SHALL properly handle route parameters and loading states.

#### Scenario: Valid job ID
- **WHEN** page loads with valid job ID in URL
- **THEN** fetches job details from API
- **AND** displays loading skeleton while fetching
- **AND** displays job details when loaded

#### Scenario: Invalid job ID
- **WHEN** page loads with invalid or malformed job ID
- **THEN** shows error message "Job not found"
- **AND** displays "Go to History" button
- **AND** logs error for debugging

#### Scenario: Unauthorized access
- **WHEN** user tries to access another user's job
- **THEN** shows 403 error message
- **AND** redirects to dashboard after 3 seconds

### Requirement: Real-time Status Updates
The detail page SHALL automatically update when job status changes.

#### Scenario: Status polling
- **WHEN** job is not in terminal state (COMPLETED/FAILED)
- **THEN** polls job status every 15-60 seconds (adaptive)
- **AND** updates UI when status changes
- **AND** stops polling when terminal state reached

#### Scenario: Status change notification
- **WHEN** job status changes while page is open
- **THEN** shows notification banner with new status
- **AND** updates action buttons appropriately
- **AND** updates progress component

### Requirement: Error State Handling
The detail page SHALL handle various error states gracefully.

#### Scenario: Network error
- **WHEN** API call fails due to network error
- **THEN** shows error banner with retry button
- **AND** preserves current UI state
- **AND** retries on user action

#### Scenario: Job not found error
- **WHEN** API returns 404 for job ID
- **THEN** shows "Job not found" error page
- **AND** provides navigation back to history
- **AND** does not continue polling

#### Scenario: Server error
- **WHEN** API returns 500 error
- **THEN** shows "Service temporarily unavailable" message
- **AND** provides retry button
- **AND** logs error for monitoring

### Requirement: Loading States
The detail page SHALL provide clear loading indicators.

#### Scenario: Initial page load
- **WHEN** page is first loading
- **THEN** displays full-page loading skeleton
- **AND** skeleton matches final layout structure
- **AND** shows loading for minimum 300ms (avoid flash)

#### Scenario: Action button loading
- **WHEN** user clicks action button (download, start, retry)
- **THEN** button shows loading spinner
- **AND** button is disabled during action
- **AND** shows success/error feedback after action completes

### Requirement: Accessibility for Detail Page
The detail page SHALL be fully accessible.

#### Scenario: Keyboard navigation
- **WHEN** user navigates with keyboard
- **THEN** all interactive elements are reachable via Tab
- **AND** action buttons activate with Enter or Space
- **AND** breadcrumbs navigate with Enter
- **AND** focus indicators are visible

#### Scenario: Screen reader support
- **WHEN** screen reader user accesses detail page
- **THEN** page title is announced
- **AND** job metadata is announced in logical order
- **AND** status changes are announced via live region
- **AND** action buttons have descriptive labels

#### Scenario: ARIA landmarks
- **WHEN** detail page renders
- **THEN** uses proper ARIA landmarks (main, navigation)
- **AND** error messages have role="alert"
- **AND** status changes use aria-live="polite"
- **AND** progress updates announced to screen readers
