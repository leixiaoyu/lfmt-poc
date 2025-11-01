# Legal Attestation - Specification Delta

## ADDED Requirements

### Requirement: Copyright Ownership Attestation
The legal attestation component SHALL require users to confirm copyright ownership before upload.

#### Scenario: Copyright checkbox display
- **WHEN** user views the legal attestation form
- **THEN** sees checkbox labeled "I confirm that I own the copyright to this document or have authorization from the copyright holder to translate it"
- **AND** checkbox is unchecked by default
- **AND** checkbox is required (cannot proceed without checking)

#### Scenario: Copyright ownership validation
- **WHEN** user tries to proceed without checking copyright checkbox
- **THEN** form validation prevents progression
- **AND** shows error message "You must confirm copyright ownership"
- **AND** checkbox is highlighted with error styling

### Requirement: Translation Rights Attestation
The legal attestation component SHALL require users to confirm translation rights.

#### Scenario: Translation rights checkbox display
- **WHEN** user views the legal attestation form
- **THEN** sees checkbox labeled "I confirm that I have the right to create derivative works (translations) from this document"
- **AND** checkbox is unchecked by default
- **AND** checkbox is required

#### Scenario: Translation rights validation
- **WHEN** user tries to proceed without checking translation rights checkbox
- **THEN** form validation prevents progression
- **AND** shows error message "You must confirm translation rights"

### Requirement: Liability Terms Attestation
The legal attestation component SHALL require users to accept liability terms.

#### Scenario: Liability checkbox display
- **WHEN** user views the legal attestation form
- **THEN** sees checkbox labeled "I understand that I am solely responsible for ensuring I have the legal right to translate this document, and I indemnify LFMT from any copyright claims"
- **AND** checkbox is unchecked by default
- **AND** checkbox is required

#### Scenario: Liability acceptance validation
- **WHEN** user tries to proceed without checking liability checkbox
- **THEN** form validation prevents progression
- **AND** shows error message "You must accept liability terms"

### Requirement: User Context Capture
The legal attestation component SHALL capture user context for audit purposes.

#### Scenario: IP address capture
- **WHEN** user submits the attestation form
- **THEN** captures user's IP address
- **AND** includes IP address in attestation payload
- **AND** IP address is captured client-side or via API call

#### Scenario: User agent capture
- **WHEN** user submits the attestation form
- **THEN** captures browser user agent string
- **AND** includes user agent in attestation payload
- **AND** user agent is read from `navigator.userAgent`

#### Scenario: Timestamp capture
- **WHEN** user submits the attestation form
- **THEN** captures current timestamp (ISO 8601 format)
- **AND** includes timestamp in attestation payload
- **AND** timestamp reflects user's local time zone

### Requirement: Attestation Data Structure
The legal attestation component SHALL format attestation data according to backend contract.

#### Scenario: Attestation payload structure
- **WHEN** attestation data is submitted
- **THEN** payload includes: `acceptCopyrightOwnership: boolean`
- **AND** payload includes: `acceptTranslationRights: boolean`
- **AND** payload includes: `acceptLiabilityTerms: boolean`
- **AND** payload includes: `userIPAddress: string`
- **AND** payload includes: `userAgent: string`
- **AND** all boolean fields are `true` (validated)

#### Scenario: Attestation included in upload request
- **WHEN** user uploads a document
- **THEN** upload request includes `legalAttestation` object
- **AND** legalAttestation contains all required fields
- **AND** backend stores attestation for 7-year retention

### Requirement: Clear Legal Language
The legal attestation component SHALL use clear, understandable language.

#### Scenario: Plain language explanations
- **WHEN** user views legal attestation
- **THEN** sees introductory text explaining why attestation is required
- **AND** text explains legal implications in plain language
- **AND** text is readable at 8th-grade level or below

#### Scenario: Help text availability
- **WHEN** user views legal attestation
- **THEN** sees "Learn More" link next to each checkbox
- **AND** clicking link shows tooltip with additional explanation
- **AND** tooltip dismisses when clicking outside or pressing Escape

### Requirement: Attestation State Management
The legal attestation component SHALL manage attestation state properly.

#### Scenario: State persistence within session
- **WHEN** user checks attestation boxes and navigates backward in stepper
- **THEN** checkboxes remain checked when returning to attestation step
- **AND** state is preserved in component state
- **AND** state is cleared after successful upload or explicit reset

#### Scenario: State cleared between sessions
- **WHEN** user completes an upload and starts a new one
- **THEN** all attestation checkboxes are reset to unchecked
- **AND** user must attest again for new upload
- **AND** previous attestation data is not reused

### Requirement: Accessibility for Legal Attestation
The legal attestation component SHALL be fully accessible.

#### Scenario: Keyboard interaction
- **WHEN** user navigates with keyboard
- **THEN** can tab to each checkbox
- **AND** can check/uncheck with Spacebar
- **AND** can open help tooltips with Enter
- **AND** focus indicators are clearly visible

#### Scenario: Screen reader support
- **WHEN** screen reader user accesses attestation form
- **THEN** each checkbox label is read aloud
- **AND** checkbox state (checked/unchecked) is announced
- **AND** validation errors are announced immediately
- **AND** help tooltips are associated with checkboxes via aria-describedby

#### Scenario: ARIA attributes
- **WHEN** attestation form renders
- **THEN** checkboxes have proper labels (not just aria-label)
- **AND** error messages have role="alert"
- **AND** required fields have aria-required="true"
- **AND** fieldset has legend "Legal Attestation"

### Requirement: Visual Design for Legal Attestation
The legal attestation component SHALL have clear, professional visual design.

#### Scenario: Layout and spacing
- **WHEN** user views attestation form
- **THEN** checkboxes are vertically stacked with adequate spacing
- **AND** checkbox labels wrap to multiple lines if needed
- **AND** form uses consistent padding and margins

#### Scenario: Visual hierarchy
- **WHEN** user views attestation form
- **THEN** sees heading "Legal Attestation and Copyright Confirmation"
- **AND** sees introductory text before checkboxes
- **AND** checkboxes are visually grouped together
- **AND** error messages are prominently displayed

#### Scenario: Responsive design
- **WHEN** user views attestation form on mobile device
- **THEN** form is fully readable without horizontal scrolling
- **AND** checkboxes are touch-friendly (minimum 44x44px target)
- **AND** text wraps appropriately for narrow viewports
