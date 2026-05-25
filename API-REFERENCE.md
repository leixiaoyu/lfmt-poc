# LFMT POC - API Reference

**API Base URL** (dev): `https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/`
**Auth Scheme**: AWS Cognito User Pool — `Authorization: Bearer <idToken>`
**Verified Against**: `main` @ `b91663c` (2026-05-25)

This document mirrors the actual code in `backend/functions/`,
`backend/infrastructure/lib/`, and `shared-types/src/`. If a divergence
is found, the code is authoritative and this file should be corrected.

---

## Endpoint Index

| #   | Method | Path                                            | Auth        | Handler                                                |
| --- | ------ | ----------------------------------------------- | ----------- | ------------------------------------------------------ |
| 1   | POST   | `/auth/register`                                | Public      | `backend/functions/auth/register.ts`                   |
| 2   | POST   | `/auth/login`                                   | Public      | `backend/functions/auth/login.ts`                      |
| 3   | POST   | `/auth/refresh`                                 | Public      | `backend/functions/auth/refreshToken.ts`               |
| 4   | POST   | `/auth/reset-password`                          | Public      | `backend/functions/auth/resetPassword.ts`              |
| 5   | GET    | `/auth/me`                                      | Cognito JWT | `backend/functions/auth/getCurrentUser.ts`             |
| 6   | POST   | `/jobs/upload`                                  | Cognito JWT | `backend/functions/jobs/uploadRequest.ts`              |
| 7   | GET    | `/jobs`                                         | Cognito JWT | `backend/functions/jobs/listJobs.ts`                   |
| 8   | GET    | `/jobs/{jobId}`                                 | Cognito JWT | `backend/functions/jobs/getJob.ts`                     |
| 9   | DELETE | `/jobs/{jobId}`                                 | Cognito JWT | `backend/functions/jobs/deleteJob.ts`                  |
| 10  | POST   | `/jobs/{jobId}/translate`                       | Cognito JWT | `backend/functions/jobs/startTranslation.ts`           |
| 11  | GET    | `/jobs/{jobId}/translation-status`              | Cognito JWT | `backend/functions/jobs/getTranslationStatus.ts`       |
| 12  | GET    | `/jobs/{jobId}/download[?format=md\|epub\|pdf]` | Cognito JWT | `backend/functions/translation/downloadTranslation.ts` |
| 13  | POST   | `/csp-report`                                   | Public      | `backend/functions/security/cspReport.ts`              |

---

## Response Envelopes

### Success — flat (used by all endpoints except `POST /jobs/upload`)

```json
{
  "message": "Optional human-readable message",
  "<field>": "<value>",
  "...": "...",
  "requestId": "<uuid>"
}
```

### Success — wrapped (`POST /jobs/upload` only)

```json
{
  "message": "...",
  "data": { "jobId": "...", "uploadUrl": "..." },
  "requestId": "<uuid>"
}
```

### Error

```json
{
  "message": "Operator-friendly error message",
  "requestId": "<uuid>",
  "errorCode": "JOB_NOT_FOUND",
  "errors": { "field": ["validation message", "..."] }
}
```

- `requestId` is always a UUID generated server-side. Clients should
  surface it in support contexts so we can correlate against CloudWatch.
- `errorCode` (PR #267 / #280 / #281) is a machine-readable string
  discriminator. Clients map it to copy via `COPY_BY_CODE` in
  `frontend/src/services/getApiErrorMessage.ts`.
- `errors` is field-keyed for validation failures (Zod issues).
- Backend `message` is preserved on 4xx (PR #283) and 5xx (PR #291) — it
  is no longer clobbered to a generic "Internal Server Error".

### Known `errorCode` values

| Code                          | Typical status | Where                                                  |
| ----------------------------- | -------------- | ------------------------------------------------------ |
| `INVALID_REQUEST`             | 400            | Zod validation failures                                |
| `MISSING_JOB_ID`              | 400            | Malformed `{jobId}` path param                         |
| `INVALID_JOB_STATUS`          | 409            | E.g., download before translation completes            |
| `TRANSLATION_ALREADY_STARTED` | 409            | `POST /jobs/{jobId}/translate` when status ≠ `CHUNKED` |
| `NO_CHUNKS_AVAILABLE`         | 404 / 409      | Download attempted with no translated chunks           |
| `JOB_NOT_FOUND`               | 404            | Unified for "not found" + "not owned" (PR #287)        |
| `INTERNAL_ERROR`              | 500            | Catch-all                                              |

---

## Authentication Endpoints

### 1. `POST /auth/register`

Register a new user. Auto-confirmed in dev via Cognito pre-signup trigger
(no email verification step). Production retains email verification.

**Request body** (`application/json`):

| Field              | Type    | Required | Notes                                               |
| ------------------ | ------- | -------- | --------------------------------------------------- |
| `email`            | string  | ✅       | Valid email                                         |
| `password`         | string  | ✅       | Min 8 chars; uppercase + lowercase + digit + symbol |
| `confirmPassword`  | string  | ✅       | Must equal `password`                               |
| `firstName`        | string  | ✅       | Min 1 char                                          |
| `lastName`         | string  | ✅       | Min 1 char                                          |
| `organization`     | string  | optional |                                                     |
| `acceptedTerms`    | boolean | ✅       | Must be `true`                                      |
| `acceptedPrivacy`  | boolean | ✅       | Must be `true`                                      |
| `marketingConsent` | boolean | optional |                                                     |

**Success (201)**

```json
{ "message": "User registered successfully.", "requestId": "..." }
```

**Errors**: `400` (validation / malformed JSON — PR #180), `409` (email
exists), `500`.

---

### 2. `POST /auth/login`

Returns ID token (use as Bearer credential), access token, refresh token.

**Request body**

| Field        | Type    | Required | Notes |
| ------------ | ------- | -------- | ----- |
| `email`      | string  | ✅       |       |
| `password`   | string  | ✅       |       |
| `rememberMe` | boolean | optional |       |
| `mfaCode`    | string  | optional |       |

**Success (200)**

```json
{
  "accessToken": "...",
  "idToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600,
  "user": { "userId": "...", "email": "...", "firstName": "...", "lastName": "..." },
  "requiresMfa": false,
  "requestId": "..."
}
```

> **Use `idToken` (not `accessToken`) as the `Authorization: Bearer ...`
> credential** for protected endpoints. The API Gateway Cognito authorizer
> validates ID tokens.

**Errors**: `400`, `401` (bad creds), `500`.

---

### 3. `POST /auth/refresh`

Refresh access/ID tokens using a valid refresh token. Cognito does **not**
rotate the refresh token on `REFRESH_TOKEN_AUTH`; the original remains
valid for 30 days from issuance.

**Request body**: `{ "refreshToken": "..." }`

**Success (200)**

```json
{
  "accessToken": "...",
  "idToken": "...",
  "expiresIn": 3600,
  "requestId": "..."
}
```

**Errors**: `400`, `401`, `500`.

---

### 4. `POST /auth/reset-password`

Complete a password reset using the confirmation code Cognito mails.

**Request body**

| Field             | Type   | Required | Notes                        |
| ----------------- | ------ | -------- | ---------------------------- |
| `token`           | string | ✅       | Confirmation code from email |
| `email`           | string | ✅       |                              |
| `newPassword`     | string | ✅       | Must satisfy Cognito policy  |
| `confirmPassword` | string | ✅       | Must equal `newPassword`     |

**Success (200)**: `{ "message": "...", "requestId": "..." }`
**Errors**: `400`, `404`, `500`.

---

### 5. `GET /auth/me`

Return the profile of the currently-authenticated user.

**Success (200)**

```json
{
  "user": {
    "userId": "...",
    "email": "...",
    "firstName": "...",
    "lastName": "...",
    "createdAt": "...",
    "lastLoginAt": "...",
    "isEmailVerified": true,
    "mfaEnabled": false,
    "role": "user",
    "preferences": {
      /* ... */
    }
  },
  "requestId": "..."
}
```

**Errors**: `401`, `500`.

---

## Job Management Endpoints

### 6. `POST /jobs/upload`

Request a presigned S3 PUT URL for a document upload. **The Lambda does
not accept the file**; the client uploads directly to S3 via the
presigned URL. S3 events then trigger asynchronous chunking.

**Request body**

| Field         | Type   | Required | Notes                                                                                                                                                    |
| ------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filename`    | string | ✅       | 1–255 chars; no path separators; no null bytes                                                                                                           |
| `fileSize`    | number | ✅       | 1 byte – 100 MB (104,857,600)                                                                                                                            |
| `contentType` | string | ✅       | One of `text/plain`, `text/markdown`, `application/pdf`, `application/msword`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |
| `contentHash` | string | optional | SHA256 hex digest for client-side verification                                                                                                           |

**Success (200)** — **wrapped envelope** (unique to this endpoint):

```json
{
  "message": "Upload URL created",
  "data": {
    "jobId": "...",
    "uploadUrl": "https://.../s3...X-Amz-Signature=...",
    "uploadUrlExpiresIn": 900,
    "bucketName": "...",
    "objectKey": "uploads/{jobId}/{filename}",
    "requiredHeaders": { "Content-Type": "text/plain" }
  },
  "requestId": "..."
}
```

**Errors**: `400` (validation, oversized), `401`, `409` (quota), `500`.

---

### 7. `GET /jobs`

List the caller's jobs, cursor-paginated. `userId` is always taken from
the Cognito claims — never from the query string (BOLA prevention,
issue #244).

**Query params**

| Param    | Type   | Notes                                                                              |
| -------- | ------ | ---------------------------------------------------------------------------------- |
| `cursor` | string | Opaque base64 of DynamoDB `LastEvaluatedKey`. Validated against caller's `userId`. |
| `limit`  | number | Optional; default 20                                                               |

**Success (200)**

```json
{
  "jobs": [
    {
      "jobId": "...",
      "userId": "...",
      "filename": "...",
      "targetLanguage": "spanish",
      "status": "CHUNKED",
      "translationStatus": "PENDING",
      "totalChunks": 12,
      "translatedChunks": 0,
      "createdAt": "..."
    }
  ],
  "nextCursor": "<opaque base64; omitted when last page>",
  "requestId": "..."
}
```

**Errors**: `400` (invalid cursor — issue #246: empty-object cursors now
rejected), `401`, `500`.

---

### 8. `GET /jobs/{jobId}`

Fetch one job. Returns `404` with `errorCode: JOB_NOT_FOUND` for both
missing jobs and jobs owned by another user (PR #287 privacy preservation).

**Success (200)**: Full job record (see ListJobs item shape, with
additional fields: `tone`, `translationStartedAt`, `translationCompletedAt`,
`estimatedCost`, `tokensUsed`, etc.)
**Errors**: `400`, `401`, `404`, `500`.

---

### 9. `DELETE /jobs/{jobId}`

Hard-delete the job from DynamoDB and cascade-delete uploaded documents
from S3. If the job's translation is in progress, the running Step
Functions execution is also stopped (`StopExecution`, PR #210).

> **Note**: A soft-delete proposal is scaffolded at
> `openspec/changes/add-soft-delete-jobs/` but **not yet implemented**.
> Current behavior is hard delete.

**Success (200)**

```json
{
  "message": "Job deleted successfully",
  "jobId": "...",
  "warning": "S3 cleanup partially failed (DDB delete succeeded).",
  "requestId": "..."
}
```

`warning` is only present when DDB delete succeeded but S3 cleanup failed.

**Errors**: `400`, `401`, `404`, `500`.

---

### 10. `POST /jobs/{jobId}/translate`

Start the translation workflow. Transitions the job `CHUNKED → IN_PROGRESS`
and invokes the Step Functions state machine.

**Request body**

| Field            | Type   | Required | Notes                                                                        |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `targetLanguage` | string | ✅       | Must be in `SUPPORTED_LANGUAGES` (spanish, french, italian, german, chinese) |
| `tone`           | string | optional | One of `'formal'`, `'informal'`, `'neutral'`                                 |

**Success (200)**

```json
{
  "message": "Translation started",
  "jobId": "...",
  "translationStatus": "IN_PROGRESS",
  "targetLanguage": "spanish",
  "totalChunks": 12,
  "translatedChunks": 0,
  "estimatedCompletion": "2026-05-25T...Z",
  "estimatedCost": 0.012,
  "executionArn": "arn:aws:states:us-east-1:...:execution:...",
  "requestId": "..."
}
```

**Errors**:

- `400` — validation, unsupported language
- `401` — unauthenticated
- `404` (`errorCode: JOB_NOT_FOUND`) — not found or not owned (PR #287)
- `409` (`errorCode: TRANSLATION_ALREADY_STARTED`, PR #267) — already in
  flight or completed
- `500`

---

### 11. `GET /jobs/{jobId}/translation-status`

Poll translation progress. Designed for the frontend's adaptive
polling cadence (15s → 30s → 60s).

**Success (200)**

```json
{
  "jobId": "...",
  "userId": "...",
  "fileName": "...",
  "fileSize": 12345,
  "contentType": "text/plain",
  "status": "CHUNKED",
  "translationStatus": "IN_PROGRESS",
  "targetLanguage": "spanish",
  "tone": "neutral",
  "totalChunks": 12,
  "translatedChunks": 5,
  "progressPercentage": 41.67,
  "tokensUsed": 17500,
  "estimatedCost": 0.012,
  "createdAt": "...",
  "translationStartedAt": "...",
  "translationCompletedAt": null,
  "estimatedCompletion": "...",
  "error": null,
  "requestId": "..."
}
```

The field is `translatedChunks` (not `chunksTranslated`) — see
issue #229 wire rename.

**Errors**: `400`, `401`, `404`, `500`.

---

### 12. `GET /jobs/{jobId}/download[?format=md|epub|pdf]`

Download the assembled translation. Default format is markdown (returned
inline as `text/plain`). ePub and PDF responses return a JSON envelope
with a 15-minute presigned S3 GET URL, bypassing the API Gateway 10 MB
direct-response limit.

**Query params**

| Param    | Type   | Default      | Allowed values                  |
| -------- | ------ | ------------ | ------------------------------- |
| `format` | string | `'markdown'` | `'markdown'`, `'epub'`, `'pdf'` |

**Success (markdown, 200)**

- Headers: `Content-Type: text/plain; charset=utf-8`, `Content-Disposition: attachment; filename="..."`, `Cache-Control: no-store`
- Body: raw assembled markdown

**Success (ePub / PDF, 200)**

- Headers: `Content-Type: application/json`, `Cache-Control: no-store`
- Body:

```json
{
  "format": "epub",
  "downloadUrl": "https://.../s3...X-Amz-Signature=...",
  "expiresInSeconds": 900,
  "objectKey": "translated-output/{jobId}/translation.epub"
}
```

ePub/PDF artefacts are lazily generated on first request, then cached
by S3 key (HeadObject probe). Concurrent requests reuse the existing
artefact. Source-document cap for conversion: 8 MB.

**Errors**:

- `400` — invalid jobId, unsupported `?format=` value
- `401` — unauthenticated
- `404` — not found or not owned
- `409` — job exists but `translationStatus` ≠ `COMPLETED`
- `413` — assembled markdown exceeds 6 MB inline cap; client should
  retry with `?format=epub` or `?format=pdf`
- `500` — S3 read or conversion error

Library choices (PR #263): `@lesjoursfr/html-to-epub@^6.1.0` (active
fork; `epub-gen` dead since 2019), `pdfkit@^0.18.0` (no React in the
Lambda bundle, unlike `@react-pdf/renderer`), `markdown-it@^14.1.1`.

---

## Security & Telemetry Endpoint

### 13. `POST /csp-report`

CSP violation report sink. Intentionally unauthenticated — browsers
strip credentials from CSP report submissions. The Lambda IAM role is
restricted to CloudWatch Logs write only (no DDB / S3 access).

**Request**

- `Content-Type`: one of `application/csp-report` (legacy) or
  `application/reports+json` (modern Reporting API). Other types → `400`.
- Body size cap: 64 KB → `400` if exceeded.
- Legacy payload: `{ "csp-report": { "violated-directive": "...", "blocked-uri": "...", ... } }`
- Reporting API payload (array): `[{ "type": "csp-violation", "body": { "effectiveDirective": "...", "blockedURL": "...", ... } }]`

**Success (204 No Content)** — always returned on valid input. Empty body.

**Errors**: `400` for malformed JSON, oversized body, unknown content
type, or missing required fields.

**Defensive behaviors** (PR #257):

- Field allowlist on log emission (no unknown keys forwarded).
- Per-field truncation at 2 KB.
- No user-agent / PII forwarding.
- Never echoes the payload back (XS-Leak defense).
- API Gateway throttle protects against floods (no DDB rate limiter — POC decision).

---

## CORS

Allowed origins are environment-dependent and set in the CDK stack
(`backend/infrastructure/lib/lfmt-infrastructure-stack.ts`):

- **dev**: `http://localhost:3000`, `https://localhost:3000`, CloudFront
  distribution URL (currently `https://d39xcun7144jgl.cloudfront.net`)
- **staging**: `https://staging.lfmt.<future-domain>`
- **prod**: `https://lfmt.<future-domain>`

Protected endpoints: credentials allowed on success responses; gateway
error responses use wildcard origin (CORS spec compliance).
`POST /csp-report` uses wildcard origin without credentials (browsers
require this for report submissions).

For configuration details, troubleshooting, and the multi-origin
implementation, see [docs/CORS-REFERENCE.md](docs/CORS-REFERENCE.md).

---

## Testing the API Locally

### Register a new user (multi-line — avoids shell escaping of `!`)

```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "confirmPassword": "SecurePass123!",
    "firstName": "Test",
    "lastName": "User",
    "acceptedTerms": true,
    "acceptedPrivacy": true
  }'
```

### Login

```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "user@example.com", "password": "SecurePass123!" }'
```

Capture `idToken` from the response and use it as the Bearer credential.

### List jobs (authenticated)

```bash
curl -H "Authorization: Bearer $ID_TOKEN" \
  https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/jobs
```

### Download ePub

```bash
curl -H "Authorization: Bearer $ID_TOKEN" \
  "https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/jobs/$JOB_ID/download?format=epub"
# → returns JSON with downloadUrl; follow the presigned URL to fetch the artefact
```

---

## Monitoring & Debugging

```bash
# Tail Lambda logs
aws logs tail /aws/lambda/lfmt-login-LfmtPocDev          --region us-east-1 --follow
aws logs tail /aws/lambda/lfmt-uploadRequest-LfmtPocDev  --region us-east-1 --follow
aws logs tail /aws/lambda/lfmt-startTranslation-LfmtPocDev --region us-east-1 --follow
aws logs tail /aws/lambda/lfmt-cspReport-LfmtPocDev      --region us-east-1 --follow

# Stack outputs (API URL, Cognito IDs, bucket names)
aws cloudformation describe-stacks --stack-name LfmtPocDev \
  --query 'Stacks[0].Outputs'
```

To correlate a user-reported error to logs: the response envelope
includes a UUID `requestId` field. Use it as a CloudWatch Logs filter
to find the corresponding invocation.

---

**Last Updated**: 2026-05-25
**API Version**: v1
**Environment**: Development (LfmtPocDev)
