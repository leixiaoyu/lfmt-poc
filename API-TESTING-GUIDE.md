# LFMT POC - API Testing Guide

## ✅ Status: All Lambda Functions Working!

The Lambda functions are successfully deployed and operational. The initial JSON parsing error was due to test request format issues, not the Lambda code.

**API Base URL:** https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/

---

## Authentication Endpoints

### 1. User Registration

**Endpoint:** `POST /auth`

**Request Schema:**
```json
{
  "email": "string (email format)",
  "password": "string (min 8 chars, uppercase, lowercase, numbers, symbols)",
  "confirmPassword": "string (must match password)",
  "firstName": "string (min 1 char)",
  "lastName": "string (min 1 char)",
  "organization": "string (optional)",
  "acceptedTerms": true,
  "acceptedPrivacy": true,
  "marketingConsent": false (optional)
}
```

**Working curl Example (Multi-line):**
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "confirmPassword": "SecurePass123!",
    "firstName": "John",
    "lastName": "Doe",
    "acceptedTerms": true,
    "acceptedPrivacy": true
  }'
```

**Success Response (201):**
```json
{
  "message": "User registered successfully. Please check your email to verify your account.",
  "requestId": "..."
}
```

**Error Responses:**
- `400` - Validation failed / Invalid password / Invalid parameter
- `409` - Account with this email already exists
- `500` - Internal error

---

### 2. User Login

**Endpoint:** `POST /auth/login`

**Request Schema:**
```json
{
  "email": "string (email format)",
  "password": "string",
  "rememberMe": false (optional),
  "mfaCode": "string (optional)"
}
```

**curl Example:**
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

**Success Response (200):**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600,
  "user": {
    "userId": "...",
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe"
  }
}
```

**Error Responses:**
- `400` - Validation failed
- `401` - Incorrect email or password / Email not verified
- `500` - Internal error

---

### 3. Refresh Token

**Endpoint:** `POST /auth/refresh`

**Request Schema:**
```json
{
  "refreshToken": "string"
}
```

**curl Example:**
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "your-refresh-token-here"
  }'
```

**Success Response (200):**
```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresIn": 3600
}
```

---

### 4. Reset Password

**Endpoint:** `POST /auth/reset-password`

**Request Schema:**
```json
{
  "email": "string (email format)"
}
```

**curl Example:**
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com"
  }'
```

**Success Response (200):**
```json
{
  "message": "Password reset instructions sent to your email"
}
```

---

## Common Issues & Solutions

### Issue: JSON Parsing Error with Special Characters

**Problem:** Using single-line curl with passwords containing `!` fails:
```bash
# ❌ FAILS - Shell escapes the !
curl -d '{"password":"Pass123!"}' ...
```

**Solution:** Use multi-line format or escape properly:
```bash
# ✅ WORKS - Multi-line format
curl -d '{
  "password": "Pass123!"
}' ...

# ✅ WORKS - Single quotes prevent escaping
curl -d $'{"password":"Pass123!"}' ...
```

### Issue: Password Requirements

Cognito requires passwords to have:
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one symbol

**Example valid passwords:**
- `SecurePass123!`
- `MyP@ssw0rd`
- `Test#1234Abc`

### Issue: Email Verification Required

After registration, users must verify their email before logging in. Cognito sends a verification email with a code/link.

**Workaround for testing:**
```bash
# Verify user manually via AWS CLI
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --region us-east-1
```

---

## Testing Workflow

### 1. Register a New User
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser123@example.com",
    "password": "TestSecure123!",
    "confirmPassword": "TestSecure123!",
    "firstName": "Test",
    "lastName": "User",
    "acceptedTerms": true,
    "acceptedPrivacy": true
  }'
```

### 2. Verify Email (Manual)
```bash
aws cognito-idp admin-confirm-sign-up \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username testuser123@example.com \
  --region us-east-1
```

### 3. Login
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "testuser123@example.com",
    "password": "TestSecure123!"
  }'
```

### 4. Save Tokens
```bash
# Extract tokens from login response
ACCESS_TOKEN="eyJraWQiOiI..."
REFRESH_TOKEN="eyJjdHki..."
```

### 5. Refresh Token
```bash
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{
    \"refreshToken\": \"$REFRESH_TOKEN\"
  }"
```

---

## CORS Configuration

Current CORS settings allow requests from:
- `http://localhost:3000` (development)
- `https://localhost:3000` (development)

For production, update in `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`:
```typescript
getAllowedApiOrigins() {
  switch (this.node.tryGetContext('environment')) {
    case 'prod':
      return ['https://lfmt.yourcompany.com'];
    // ...
  }
}
```

---

## Monitoring & Debugging

### View Lambda Logs
```bash
# Register function
aws logs tail /aws/lambda/lfmt-register-LfmtPocDev \
  --region us-east-1 \
  --follow

# Login function
aws logs tail /aws/lambda/lfmt-login-LfmtPocDev \
  --region us-east-1 \
  --follow
```

### Check Cognito Users
```bash
aws cognito-idp list-users \
  --user-pool-id us-east-1_XXXXXXXXX \
  --region us-east-1
```

### Get User Details
```bash
aws cognito-idp admin-get-user \
  --user-pool-id us-east-1_XXXXXXXXX \
  --username user@example.com \
  --region us-east-1
```

---

## Response Headers

All responses include CORS headers:
```
access-control-allow-origin: http://localhost:3000
access-control-allow-headers: Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token
access-control-allow-methods: GET,POST,PUT,DELETE,OPTIONS
access-control-allow-credentials: true
```

---

## Next Steps

1. **Frontend Integration**: Build React SPA to consume these APIs
2. **Email Templates**: Customize Cognito verification emails
3. **MFA Setup**: Enable multi-factor authentication
4. **Social Login**: Add Google/Facebook OAuth integration
5. **Rate Limiting**: Implement API throttling per user
6. **Monitoring**: Set up CloudWatch alarms for errors

---

## Testing Tools

### Postman Collection
Create a Postman collection with these endpoints for easier testing.

### Automated Testing
```bash
# Run function tests
cd backend/functions
npm test

# Test with actual deployed API
npm run test:integration  # (to be implemented)
```

---

**Last Updated:** October 18, 2025
**API Version:** v1
**Environment:** Development (LfmtPocDev)
