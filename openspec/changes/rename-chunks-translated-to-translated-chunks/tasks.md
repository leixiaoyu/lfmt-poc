## 1. shared-types

- [x] 1.1 Rename `chunksTranslated` → `translatedChunks` on `TranslationStatusApiResponse`
- [x] 1.2 Rename `chunksTranslated` → `translatedChunks` on `StartTranslationApiResponse`
- [x] 1.3 Update JSDoc on both interfaces

## 2. Backend Lambdas

- [x] 2.1 `getTranslationStatus.ts`: update response builder and internal variable names
- [x] 2.2 `startTranslation.ts`: update response builder
- [x] 2.3 Update unit tests for both Lambdas; add regression guard (`not.toHaveProperty('chunksTranslated')`)

## 3. Frontend

- [x] 3.1 `translationJobMapper.ts`: update `TranslationJobWire.chunksTranslated` → `translatedChunks`
- [x] 3.2 `translationJobMapper.ts`: update `toTranslationJob` to read `wire.translatedChunks`
- [x] 3.3 `translationService.ts`: update inline mapping in `startTranslation` path
- [x] 3.4 `mocks/handlers.ts`: update `toWireTranslationStatus` and translate handler

## 4. Tests

- [x] 4.1 `translationJobMapper.test.ts`: update wire fixture field names
- [x] 4.2 `apiEnvelopeContract.test.ts`: assert `translatedChunks` present, `chunksTranslated` absent
- [x] 4.3 `translationService.test.ts`: update all wire fixture objects
