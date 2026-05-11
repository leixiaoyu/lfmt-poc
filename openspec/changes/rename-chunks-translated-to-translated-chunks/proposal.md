## Why

The chunk-progress count had three different names across three layers, creating
cognitive tax and masking the risk of future bugs:

- DDB column: `translatedChunks`
- Wire field: `chunksTranslated` (TranslationStatusApiResponse, StartTranslationApiResponse)
- Frontend model: `completedChunks` (TranslationJob)

The wire name `chunksTranslated` was an accidental invention — it does not match
the DDB column and forced the frontend mapper to maintain both the DDB→wire and
wire→frontend translations. Renaming the wire field to `translatedChunks` (the DDB
column name) eliminates the middle layer of drift with no DDB migration required.

**POC single-shot rationale**: the issue body proposed a transitional dual-emit
(emit both `chunksTranslated` and `translatedChunks` for one release). For this
POC we have exactly ONE consumer (the SPA we own), atomic deploys, and zero
third-party clients. A single-shot rename is lower risk than a dual-emit window
that requires a follow-up cleanup PR. This assumption is explicitly documented
in the PR body and in the shared-types JSDoc.

## What Changes

- `shared-types/src/jobs.ts`: rename `chunksTranslated` → `translatedChunks` on
  `TranslationStatusApiResponse` AND `StartTranslationApiResponse`. Update JSDoc.
- **BREAKING** (internal only, no external clients): wire field name changes.
- `backend/functions/jobs/getTranslationStatus.ts`: response builder updated.
- `backend/functions/jobs/startTranslation.ts`: response builder updated.
- `frontend/src/services/mappers/translationJobMapper.ts`: read `translatedChunks`
  from wire (frontend model `completedChunks` stays unchanged — ACL preserved).
- `frontend/src/mocks/handlers.ts`: `toWireTranslationStatus` and translate handler
  emit `translatedChunks`.
- All test files updated; regression guard added to prevent re-drift.

## Impact

- Affected specs: `jobs` (translation-status wire shape)
- Affected code: shared-types, getTranslationStatus, startTranslation,
  translationJobMapper, handlers.ts, and their tests
- Breaking change scope: internal POC only; no third-party consumers exist
