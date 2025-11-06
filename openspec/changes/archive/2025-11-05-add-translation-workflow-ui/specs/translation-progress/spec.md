# Translation Progress - Specification Delta

## ADDED Requirements

### Requirement: Adaptive Polling Mechanism
The progress component SHALL poll translation status with adaptive intervals to balance responsiveness and backend load.

#### Scenario: Initial rapid polling
- **WHEN** translation starts
- **THEN** the component polls every 15 seconds
- **AND** continues at 15s intervals for the first 2 minutes

#### Scenario: Medium-interval polling
- **WHEN** translation has been running for 2-5 minutes
- **THEN** the component increases poll interval to 30 seconds
- **AND** continues at 30s intervals until 5 minutes elapsed

#### Scenario: Long-interval polling
- **WHEN** translation has been running for over 5 minutes
- **THEN** the component increases poll interval to 60 seconds
- **AND** continues at 60s intervals until completion

#### Scenario: Polling stops on completion
- **WHEN** translation status becomes "COMPLETED" or "TRANSLATION_FAILED"
- **THEN** the component stops polling immediately
- **AND** does not send any additional requests

### Requirement: Job Status Display
The progress component SHALL display current job status with visual indicators.

#### Scenario: Pending status
- **WHEN** job status is "PENDING"
- **THEN** shows "Pending" status chip with grey color
- **AND** displays "Waiting to start" message

#### Scenario: Chunking status
- **WHEN** job status is "CHUNKING"
- **THEN** shows "Chunking" status chip with blue color
- **AND** displays "Breaking document into chunks" message
- **AND** shows indeterminate progress indicator

#### Scenario: Chunked status
- **WHEN** job status is "CHUNKED"
- **THEN** shows "Ready for Translation" status chip with green color
- **AND** displays "Start Translation" button
- **AND** shows total chunks count

#### Scenario: Translation in progress
- **WHEN** translation status is "IN_PROGRESS"
- **THEN** shows "Translating" status chip with blue color
- **AND** displays determinate progress bar with percentage
- **AND** shows chunks completed out of total

#### Scenario: Translation completed
- **WHEN** translation status is "COMPLETED"
- **THEN** shows "Completed" status chip with green color
- **AND** displays "Download Translation" button
- **AND** shows final metrics (total chunks, tokens used, estimated cost)

#### Scenario: Translation failed
- **WHEN** translation status is "TRANSLATION_FAILED"
- **THEN** shows "Failed" status chip with red color
- **AND** displays error message
- **AND** shows "Retry Translation" button

### Requirement: Progress Metrics Display
The progress component SHALL display translation progress metrics.

#### Scenario: Chunk progress
- **WHEN** translation is in progress
- **THEN** displays chunksTranslated / totalChunks (e.g., "3 / 5 chunks")
- **AND** displays progressPercentage as number (e.g., "60%")
- **AND** updates metrics each time status is polled

#### Scenario: Cost metrics
- **WHEN** translation status includes cost data
- **THEN** displays tokensUsed (e.g., "12,500 tokens")
- **AND** displays estimatedCost (e.g., "$0.000938")
- **AND** formats numbers with proper thousand separators

#### Scenario: Time estimates
- **WHEN** translation is in progress
- **THEN** displays elapsed time since start
- **AND** displays estimated completion time (if provided by backend)
- **AND** updates time displays each poll cycle

### Requirement: Polling Cleanup
The progress component SHALL properly clean up polling on unmount.

#### Scenario: Component unmount
- **WHEN** user navigates away from progress view
- **THEN** the component clears all polling timers
- **AND** cancels any in-flight API requests
- **AND** does not cause memory leaks

#### Scenario: Job completion cleanup
- **WHEN** translation completes while component is mounted
- **THEN** polling stops automatically
- **AND** timers are cleared
- **AND** component remains responsive

### Requirement: Error Handling During Polling
The progress component SHALL handle polling errors gracefully.

#### Scenario: Temporary network error
- **WHEN** a status poll fails due to network error
- **THEN** the component retries the next poll cycle
- **AND** does not show error to user for single failure
- **AND** continues polling at same interval

#### Scenario: Repeated polling failures
- **WHEN** 3 consecutive status polls fail
- **THEN** the component shows an error message
- **AND** offers "Retry Now" button
- **AND** stops automatic polling until manual retry

#### Scenario: Backend error
- **WHEN** backend returns a 500 error
- **THEN** the component shows error message
- **AND** stops polling
- **AND** allows manual retry

### Requirement: Accessibility for Progress Updates
The progress component SHALL announce progress updates to screen readers.

#### Scenario: Status change announcement
- **WHEN** translation status changes
- **THEN** the new status is announced via ARIA live region
- **AND** uses "polite" announcement (doesn't interrupt)

#### Scenario: Progress percentage announcement
- **WHEN** progress percentage increases by 10% or more
- **THEN** the new percentage is announced
- **AND** includes context (e.g., "60% complete")

#### Scenario: Completion announcement
- **WHEN** translation completes
- **THEN** announces "Translation completed successfully"
- **AND** announces availability of download button
