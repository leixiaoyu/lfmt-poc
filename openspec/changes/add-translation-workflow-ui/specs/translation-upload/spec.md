# Translation Upload - Specification Delta

## ADDED Requirements

### Requirement: Multi-Step Upload Workflow
The upload component SHALL guide users through a multi-step process including legal attestation, translation configuration, and file upload.

#### Scenario: Complete workflow progression
- **WHEN** a user starts the upload process
- **THEN** they see a stepper with 4 steps: Legal Attestation, Translation Settings, Upload Document, Review & Submit
- **AND** can only proceed to the next step after completing the current step
- **AND** can navigate backward to previous steps
- **AND** see visual indication of current step and completion status

#### Scenario: Step validation
- **WHEN** a user tries to proceed without completing required fields
- **THEN** the component shows validation errors
- **AND** prevents navigation to the next step
- **AND** focuses the first invalid field

### Requirement: Legal Attestation Integration
The upload component SHALL collect and include legal attestation data with every upload request.

#### Scenario: Attestation data included in upload
- **WHEN** a user uploads a document
- **THEN** the upload request includes attestation object with: acceptCopyrightOwnership, acceptTranslationRights, acceptLiabilityTerms, userIPAddress, userAgent
- **AND** all boolean fields are true (validated before upload)
- **AND** userIPAddress is captured from the client
- **AND** userAgent is captured from the browser

#### Scenario: Upload blocked without attestation
- **WHEN** a user tries to upload without accepting all attestation checkboxes
- **THEN** the upload button is disabled
- **AND** a validation message indicates attestation is required

### Requirement: Translation Configuration Selection
The upload component SHALL allow users to select target language and translation tone.

#### Scenario: Language selection
- **WHEN** a user views the translation settings step
- **THEN** they see a dropdown with language options: Spanish, French, German, Italian, Chinese
- **AND** can select one language
- **AND** the selected language is required before proceeding

#### Scenario: Tone selection
- **WHEN** a user views the translation settings step
- **THEN** they see radio buttons for tone options: Formal, Informal, Neutral
- **AND** can select one tone
- **AND** the selected tone is required before proceeding
- **AND** Neutral is selected by default

### Requirement: File Upload with Validation
The upload component SHALL validate files before allowing upload.

#### Scenario: Valid file upload
- **WHEN** a user uploads a .txt file under 100MB
- **THEN** the file is accepted
- **AND** shows file name and size
- **AND** enables the upload button

#### Scenario: Invalid file type
- **WHEN** a user tries to upload a non-.txt file
- **THEN** the component shows an error message
- **AND** rejects the file
- **AND** keeps the upload button disabled

#### Scenario: File too large
- **WHEN** a user tries to upload a file over 100MB
- **THEN** the component shows an error message indicating the size limit
- **AND** rejects the file

#### Scenario: File too small
- **WHEN** a user tries to upload a file under 1KB
- **THEN** the component shows an error message indicating minimum size
- **AND** rejects the file

### Requirement: Upload Progress Indication
The upload component SHALL show real-time upload progress.

#### Scenario: Upload progress display
- **WHEN** a file upload is in progress
- **THEN** the component shows a progress bar with percentage
- **AND** disables all navigation and form controls
- **AND** shows "Uploading..." status text

#### Scenario: Upload completion
- **WHEN** a file upload completes successfully
- **THEN** the component shows a success message
- **AND** redirects to the translation detail page for the new job
- **AND** clears the form state

#### Scenario: Upload failure
- **WHEN** a file upload fails
- **THEN** the component shows an error message with details
- **AND** allows the user to retry
- **AND** preserves form data (attestation, config, file)

### Requirement: Form State Persistence
The upload component SHALL preserve form state to prevent data loss.

#### Scenario: Form state preserved on navigation
- **WHEN** a user completes step 1 and navigates away
- **THEN** their selections are saved in component state
- **AND** are restored if they navigate back
- **AND** are cleared after successful upload or explicit form reset

#### Scenario: Browser back button handling
- **WHEN** a user uses the browser back button during upload flow
- **THEN** they are warned about losing progress (if upload in progress)
- **OR** navigate safely (if no upload in progress)
- **AND** form state is preserved if they choose to stay

### Requirement: Accessibility for Upload Flow
The upload component SHALL be fully accessible via keyboard and screen readers.

#### Scenario: Keyboard navigation
- **WHEN** a user navigates with keyboard only
- **THEN** they can tab through all form fields
- **AND** can navigate stepper with arrow keys
- **AND** can submit with Enter key
- **AND** see visible focus indicators

#### Scenario: Screen reader support
- **WHEN** a screen reader user accesses the upload form
- **THEN** all form fields have proper labels
- **AND** stepper announces current step and total steps
- **AND** validation errors are announced
- **AND** progress updates are announced via live regions
