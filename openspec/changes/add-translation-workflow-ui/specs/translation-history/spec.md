# Translation History - Specification Delta

## ADDED Requirements

### Requirement: Job List Display
The history page SHALL display all translation jobs for the authenticated user.

#### Scenario: Jobs table rendering
- **WHEN** a user accesses the translation history page
- **THEN** they see a table with columns: File Name, Language, Status, Created, Actions
- **AND** jobs are sorted by creation date (newest first) by default
- **AND** each row is clickable to navigate to job detail

#### Scenario: Empty state
- **WHEN** a user has no translation jobs
- **THEN** displays empty state message "No translations yet"
- **AND** shows "Start New Translation" button
- **AND** no table is rendered

#### Scenario: Loading state
- **WHEN** job list is being fetched
- **THEN** displays loading skeleton with table structure
- **AND** shows 5 skeleton rows as placeholder

### Requirement: Status Filtering
The history page SHALL allow filtering jobs by status.

#### Scenario: Filter by status
- **WHEN** a user selects a status filter
- **THEN** only jobs with that status are displayed
- **AND** filter options include: All, In Progress, Completed, Failed
- **AND** "All" is selected by default

#### Scenario: In Progress filter
- **WHEN** "In Progress" filter is selected
- **THEN** displays jobs with status: PENDING, CHUNKING, CHUNKED, IN_PROGRESS
- **AND** updates count badge to show number of matching jobs

#### Scenario: Completed filter
- **WHEN** "Completed" filter is selected
- **THEN** displays only jobs with status: COMPLETED
- **AND** shows completed date in table

#### Scenario: Failed filter
- **WHEN** "Failed" filter is selected
- **THEN** displays jobs with status: CHUNKING_FAILED, TRANSLATION_FAILED
- **AND** shows error indicator in table

### Requirement: Sorting and Pagination
The history page SHALL support sorting and pagination for large job lists.

#### Scenario: Sort by date
- **WHEN** a user clicks the "Created" column header
- **THEN** jobs are sorted by creation date
- **AND** clicking again reverses the sort order
- **AND** sort direction indicator is shown (arrow up/down)

#### Scenario: Sort by filename
- **WHEN** a user clicks the "File Name" column header
- **THEN** jobs are sorted alphabetically by filename
- **AND** clicking again reverses the sort order

#### Scenario: Pagination
- **WHEN** a user has more than 20 jobs
- **THEN** jobs are paginated at 20 per page
- **AND** pagination controls are shown at bottom of table
- **AND** user can navigate between pages
- **AND** current page and total pages are displayed

### Requirement: Search Functionality
The history page SHALL allow searching jobs by filename.

#### Scenario: Search by filename
- **WHEN** a user types in the search box
- **THEN** table filters to show matching filenames (case-insensitive)
- **AND** search is debounced by 300ms
- **AND** search works across all pages (not just current page)

#### Scenario: Clear search
- **WHEN** a user clears the search box
- **THEN** all jobs are shown again (respecting current filter)
- **AND** pagination resets to page 1

#### Scenario: No search results
- **WHEN** search returns no matches
- **THEN** shows "No matching translations found" message
- **AND** shows "Clear Search" button

### Requirement: Job Actions
The history page SHALL provide quick actions for jobs.

#### Scenario: View details action
- **WHEN** a user clicks on a job row
- **THEN** navigates to translation detail page for that job
- **AND** preserves current page/filter state in history

#### Scenario: Download action
- **WHEN** a user clicks download button for a COMPLETED job
- **THEN** initiates download of translated document
- **AND** does not navigate away from history page

#### Scenario: Retry action
- **WHEN** a user clicks retry button for a FAILED job
- **THEN** calls startTranslation API for that job
- **AND** updates status to IN_PROGRESS
- **AND** shows success notification

### Requirement: Real-time Updates
The history page SHALL refresh job statuses periodically for in-progress jobs.

#### Scenario: Automatic refresh
- **WHEN** history page has IN_PROGRESS jobs visible
- **THEN** refreshes status every 30 seconds
- **AND** updates table rows with new status
- **AND** does not reset pagination or filters

#### Scenario: Stop refresh when no active jobs
- **WHEN** all visible jobs are COMPLETED or FAILED
- **THEN** stops automatic refresh
- **AND** resumes refresh if new IN_PROGRESS job appears

### Requirement: Status Indicators
The history page SHALL use visual indicators for job status.

#### Scenario: Status chip colors
- **WHEN** jobs are displayed in table
- **THEN** COMPLETED jobs show green status chip
- **AND** IN_PROGRESS jobs show blue status chip with pulse animation
- **AND** FAILED jobs show red status chip
- **AND** PENDING jobs show grey status chip

#### Scenario: Progress indication for active jobs
- **WHEN** a job is IN_PROGRESS
- **THEN** shows mini progress bar in status column
- **AND** displays percentage if available
- **AND** updates on each refresh

### Requirement: Accessibility for History Table
The history page SHALL be accessible via keyboard and screen readers.

#### Scenario: Keyboard navigation
- **WHEN** a user navigates with keyboard
- **THEN** can tab through all interactive elements
- **AND** can use arrow keys to navigate table rows
- **AND** can press Enter to open job details
- **AND** can use spacebar to activate action buttons

#### Scenario: Screen reader support
- **WHEN** a screen reader user accesses the history page
- **THEN** table headers are properly announced
- **AND** row count is announced ("Showing 10 of 25 translations")
- **AND** status changes are announced when refreshed
- **AND** sort order is announced when changed

#### Scenario: ARIA labels
- **WHEN** history page renders
- **THEN** all interactive elements have proper ARIA labels
- **AND** status chips have aria-label with full status text
- **AND** action buttons have descriptive labels
- **AND** table has aria-label "Translation history"
