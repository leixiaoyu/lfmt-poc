## OMC R1 Self-Review — Wave 1 Track C frontend types (#199, #217, #215, #200)

Branch: `refactor/wave1-track-c-frontend-types`
Date: 2026-05-09

Commits reviewed (smallest-to-largest order as implemented):

1. `782afb4` — chore(auth): document StoredSession migration removal window (#199)
2. `02dc9fd` — perf(frontend): add manualChunks hint for translation-services group (#217)
3. `4d224e9` — refactor(frontend): replace S3_UPLOAD_BLOCKED_MESSAGE sentinel with typed errorCode discriminator (#215)
4. `07c4902` — refactor(auth): unify frontend User with shared UserProfile (#200)

---

### Category pass/fail matrix

| Category                | Result | Notes                                                                                                        |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Architecture / SOLID    | PASS   | errorCode dispatch is open/closed; storage/service/context boundaries maintained                             |
| Type safety             | PASS   | No `any` in production paths; `as unknown as UserProfile` casts are test-only migration fixtures             |
| Test coverage           | PASS   | 7 new tests (4 errorCode discriminator, 3 narrowStoredUser userId→id); 776 total, 0 regressions              |
| Security                | PASS   | No new auth surface; StoredSession migration window correctly gated to 2026-06-04                            |
| Boy-scout               | PASS   | Inline mock class constructors corrected; orphan `expiresAt` field removed from StoredSession                |
| PR alignment            | PASS   | No conflict with main; shared-types build passes both CJS and ESM                                            |
| Performance             | PASS   | translation-services chunk: App-\*.js −28.6% (131 kB vs 180 kB); no runtime overhead                         |
| OpenSpec alignment      | PASS   | All 4 issues addressed; backwards compat preserved for pre-rollover sessions                                 |
| Backwards compatibility | PASS   | User=UserProfile alias; narrowStoredUser accepts id AND userId; StoredSession.user cast handles legacy blobs |

---

### Findings

| Severity | Category                    | Finding                                                                                                                                                                                                                                                                                 | Resolution                               |
| -------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Low      | #199 timing                 | Migration removal date is future-dated (2026-06-04 = 30 days after 2026-05-04 deploy). Cannot remove code yet — documented safe date rather than premature removal.                                                                                                                     | ACCEPTED — conservative, correct.        |
| Low      | #200 cast scope             | `as unknown as UserProfile` casts in test files are intentional: they test storage-layer behavior with partial blobs the migration path produces at runtime. A production-code cast would be a defect; here it's documenting real legacy shapes.                                        | ACCEPTED — comments explain intent.      |
| Low      | #215 deprecation            | `S3_UPLOAD_BLOCKED_MESSAGE` string constant is kept as a `@deprecated` re-export for backwards compatibility with any consumers that reference it by string value (e.g. snapshot tests).                                                                                                | ACCEPTED — removal tracked in follow-up. |
| Info     | #200 `emailVerified` bridge | `narrowStoredUser` maps `isEmailVerified` (UserProfile canonical) → `emailVerified` (NarrowedStoredUser legacy). This bridge is one-way; the reverse mapping (writing `emailVerified` back to UserProfile) is not needed because the SPA never writes session fields from the UI layer. | No action required.                      |

No Critical or High findings. No code changes required from this review.

---

### Issue-by-issue analysis

#### #199 — StoredSession migration removal

- Safe to document, NOT safe to remove (Cognito refresh token lifetime = 30 days; deploy was 2026-05-04).
- `AUTH_CONFIG.LEGACY` keys and the `readLegacySession()` / `deleteLegacyKeys()` functions remain.
- Date-stamped comment added to both `constants.ts` and `api.ts` so future cleanup has a concrete signal.
- Correct: one-time migration is idempotent; the `legacyKeysKnownAbsent` short-circuit prevents per-request overhead once the sweep completes.

#### #217 — Vite manualChunks for translation-services

- `translationService`, `uploadService`, and `headerFilters` are correctly co-located in a single chunk (shared S3 path, same lazy-load boundary).
- Verified post-build: `App-*.js` does NOT contain `translationService` symbols; `translation-services-*.js` does.
- Bundle delta: App chunk −28.6% gzip (63.38 kB → 45.23 kB). New chunk: 33.75 kB gzip. Net neutral on first-load; positive on repeat navigation (cached chunk).
- No new dynamic import required — Rollup handles the split transparently.

#### #215 — TranslationErrorCode typed discriminator

- `TranslationErrorCode` union (`S3_UPLOAD_BLOCKED | S3_HTTP_ERROR | API_GENERIC`) replaces the sentinel string pattern.
- Exhaustiveness enforced via `Partial<Record<TranslationErrorCode, string>>` COPY_BY_CODE: adding a new code without a copy entry is NOT a compile error (intentional — `API_GENERIC` must fall through). Comment documents the design choice.
- Dispatch order (0→5) is correct: typed code fires before HTTP status table.
- Inline mock class `TranslationServiceError` constructors in `TranslationDetail.test.tsx` and `TranslationHistory.test.tsx` corrected to match new 4-arg signature — this was a pre-existing latent bug that would have silently miscreated `statusCode` as a string.
- 4 new tests cover: S3_UPLOAD_BLOCKED takes precedence over statusCode; API_GENERIC falls through; S3_HTTP_ERROR falls through; precedence over 403.

#### #200 — User / UserProfile type unification

- `UserProfile` updated: `id?` alias added; `isEmailVerified`, `mfaEnabled`, `role`, `preferences` made optional (were required — breaking for SPA session use); `createdAt` made optional (not always in refresh responses); `StoredSession.user` promoted from `unknown` to `UserProfile`.
- `User = UserProfile` deprecated alias: allows existing importers (`DashboardPage.test.tsx`, `ProtectedRoute.test.tsx`) to continue importing `User` by name without mass rename churn. The alias is the SSoT bridge — no parallel interface maintained.
- `narrowStoredUser()` now accepts `userId` (canonical) OR `id` (legacy) and normalises to `id` in `NarrowedStoredUser`. The `isEmailVerified` → `emailVerified` bridge handles the field-name difference in the same pass.
- All test mock user objects updated to include `userId` (required canonical field). Partial-blob storage tests use `as unknown as UserProfile` casts with inline explanatory comments.
- 3 new narrowStoredUser tests cover: userId→id normalisation; userId preferred over id when both present; isEmailVerified→emailVerified bridge.

---

### Test results

| Package                                   | Tests | Skipped           | Result           |
| ----------------------------------------- | ----- | ----------------- | ---------------- |
| `frontend` (Vitest)                       | 776   | 14 (pre-existing) | PASS             |
| `shared-types` build                      | n/a   | —                 | PASS (CJS + ESM) |
| Frontend type-check (`tsc --noEmit`)      | n/a   | —                 | PASS             |
| Frontend lint (ESLint `--max-warnings=0`) | n/a   | —                 | PASS             |
| Frontend prettier                         | n/a   | —                 | PASS             |
| Frontend Vite build                       | n/a   | —                 | PASS             |

Baseline on main was 769 tests / 37 files. Branch adds 7 tests, zero regressions.
