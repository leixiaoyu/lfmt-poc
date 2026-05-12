## MODIFIED Requirements

### Requirement: Translation Status Wire Shape — chunk-progress field name

The system SHALL use the field name `translatedChunks` (NOT `chunksTranslated`)
on all wire responses that surface the chunk-progress count. This name matches the
DynamoDB column name, eliminating the 3-tier naming drift between DDB, wire, and
frontend documented in issue #229.

Affected endpoints:
- `GET /v1/jobs/{jobId}/translation-status` → `TranslationStatusApiResponse.translatedChunks`
- `POST /v1/jobs/{jobId}/translate` → `StartTranslationApiResponse.translatedChunks`

The frontend Anti-Corruption Layer mapper (`translationJobMapper.toTranslationJob`)
continues to project the wire field to `completedChunks` on the internal frontend
model. This rename does not change the frontend model.

A contract test MUST assert that `chunksTranslated` is absent from both wire
responses to prevent future re-drift.

#### Scenario: getTranslationStatus returns translatedChunks not chunksTranslated

- **WHEN** `GET /v1/jobs/{jobId}/translation-status` is called for an in-progress job
- **THEN** the response body includes the numeric field `translatedChunks`
- **AND** the field `chunksTranslated` MUST NOT appear in the response body

#### Scenario: startTranslation returns translatedChunks not chunksTranslated

- **WHEN** `POST /v1/jobs/{jobId}/translate` is called and translation starts
- **THEN** the response body includes `translatedChunks: 0`
- **AND** the field `chunksTranslated` MUST NOT appear in the response body

#### Scenario: frontend mapper translates wire field to frontend model field

- **WHEN** the frontend receives a wire response with `translatedChunks: N`
- **THEN** the `TranslationJob` frontend model has `completedChunks: N`
- **AND** the `TranslationJob` object MUST NOT have a `translatedChunks` property
