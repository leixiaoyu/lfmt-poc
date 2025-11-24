# Email Verification Auto-Confirm Feature

**Status**: Implemented for dev environment (since PR #72, 2025-11-12)

This document describes the auto-confirm email verification feature that allows users to register and immediately log in without email verification in development environments.

---

## Table of Contents

1. [Overview](#overview)
2. [Configuration](#configuration)
3. [Implementation](#implementation)
4. [IAM Permissions](#iam-permissions)
5. [Cognito Configuration](#cognito-configuration)
6. [Login Integration](#login-integration)
7. [Testing](#testing)
8. [Production Considerations](#production-considerations)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### Purpose

The auto-confirm feature streamlines the development and testing workflow by:
- ✅ Eliminating email verification step in dev environment
- ✅ Allowing immediate login after registration
- ✅ Reducing SES configuration requirements for local development
- ✅ Speeding up automated testing

### Environment-Based Behavior

| Environment | Auto-Confirm | Email Verification |
|-------------|--------------|-------------------|
| **Dev** | ✅ Enabled | ❌ Disabled |
| **Staging** | ❌ Disabled | ✅ Required |
| **Prod** | ❌ Disabled | ✅ Required |

**Key Point**: Auto-confirm is **only active** when `ENVIRONMENT` variable contains "Dev".

---

## Configuration

### Environment Variable

**Location**: `backend/functions/auth/register.ts:30-36`

```typescript
const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');
const COGNITO_USER_POOL_ID = getRequiredEnv('COGNITO_USER_POOL_ID');
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';

// Auto-confirm users in dev environment (email verification disabled)
const AUTO_CONFIRM_USERS = ENVIRONMENT.includes('Dev');
```

**How It Works**:
- If `ENVIRONMENT` contains "Dev" → `AUTO_CONFIRM_USERS = true`
- Otherwise → `AUTO_CONFIRM_USERS = false`

**Examples**:
- `ENVIRONMENT=Dev` → ✅ Auto-confirm enabled
- `ENVIRONMENT=LfmtPocDev` → ✅ Auto-confirm enabled
- `ENVIRONMENT=Staging` → ❌ Auto-confirm disabled
- `ENVIRONMENT=Prod` → ❌ Auto-confirm disabled

---

## Implementation

### Registration Flow

**Location**: `backend/functions/auth/register.ts:87-123`

**Steps**:

1. **User Registration** - Create user in Cognito with `SignUpCommand`
2. **Auto-Confirm** (dev only) - Immediately confirm user with `AdminConfirmSignUpCommand`
3. **Success Response** - Return environment-specific message

**Code**:

```typescript
// Step 1: Register user with Cognito
const signUpCommand = new SignUpCommand({
  ClientId: COGNITO_CLIENT_ID,
  Username: email,
  Password: password,
  UserAttributes: [
    { Name: 'email', Value: email },
    { Name: 'given_name', Value: firstName },
    { Name: 'family_name', Value: lastName },
  ],
});

await cognitoClient.send(signUpCommand);

// Step 2: Auto-confirm user if in dev environment
if (AUTO_CONFIRM_USERS) {
  logger.info('Auto-confirming user (dev environment)', {
    requestId,
    email: email.toLowerCase(),
  });

  const confirmCommand = new AdminConfirmSignUpCommand({
    UserPoolId: COGNITO_USER_POOL_ID,
    Username: email,
  });

  await cognitoClient.send(confirmCommand);
}

// Step 3: Return success response
return createSuccessResponse(
  201,
  {
    message: AUTO_CONFIRM_USERS
      ? 'User registered successfully. You can now log in.'
      : 'User registered successfully. Please check your email to verify your account.',
  },
  requestId
);
```

### Why AdminConfirmSignUpCommand?

**Standard Flow** (without auto-confirm):
1. User registers → Cognito status: `UNCONFIRMED`
2. User receives email with verification code
3. User confirms email → Cognito status: `CONFIRMED`

**Auto-Confirm Flow** (dev environment):
1. User registers → Cognito status: `UNCONFIRMED`
2. Lambda calls `AdminConfirmSignUpCommand` → Cognito status: `CONFIRMED`
3. User can immediately log in

**Important**: Even with `autoVerify: {}` in Cognito config, users are created as `UNCONFIRMED` by default. The `AdminConfirmSignUpCommand` explicitly changes the status to `CONFIRMED`.

---

## IAM Permissions

### Required Permission

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:520-530`

The Register Lambda function requires the `cognito-idp:AdminConfirmSignUp` IAM permission:

```typescript
const authLambdaPolicy = new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    'cognito-idp:SignUp',
    'cognito-idp:InitiateAuth',
    'cognito-idp:ForgotPassword',
    'cognito-idp:ConfirmForgotPassword',
    'cognito-idp:AdminCreateUser',
    'cognito-idp:AdminSetUserPassword',
    'cognito-idp:AdminGetUser',
    'cognito-idp:AdminUpdateUserAttributes',
    'cognito-idp:AdminConfirmSignUp',  // ⭐ Required for auto-confirm
  ],
  resources: [userPool.userPoolArn],
});

registerFunction.role?.attachInlinePolicy(
  new iam.Policy(this, 'RegisterFunctionPolicy', {
    statements: [authLambdaPolicy],
  })
);
```

**Why Admin Action?**

`AdminConfirmSignUpCommand` is an **admin action** that requires:
- IAM permissions (cannot be called by frontend clients)
- UserPoolId parameter (not just ClientId)
- Backend-only execution (Lambda, not browser)

This ensures only authorized backend code can bypass email verification.

---

## Cognito Configuration

### User Pool Settings

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:278-295`

```typescript
const userPool = new cognito.UserPool(this, 'UserPool', {
  userPoolName: `lfmt-${this.stackName}`,

  // Email Verification Configuration
  autoVerify: {},  // ⭐ Empty = email verification disabled
  selfSignUpEnabled: true,

  // Sign-in Configuration
  signInAliases: {
    email: true,
  },

  // User Attributes
  standardAttributes: {
    email: {
      required: true,
      mutable: false,
    },
    givenName: {
      required: true,
      mutable: true,
    },
    familyName: {
      required: true,
      mutable: true,
    },
  },

  removalPolicy: RemovalPolicy.DESTROY,
});
```

**Key Settings**:
- `autoVerify: {}` - No automatic email verification configured
- `selfSignUpEnabled: true` - Users can register without admin approval
- `signInAliases: { email: true }` - Users sign in with email address

**Important**: The empty `autoVerify` doesn't prevent user creation, it just means Cognito won't send verification emails automatically. The auto-confirm Lambda logic explicitly confirms users.

---

## Login Integration

### Handling Unconfirmed Users

**Location**: `backend/functions/auth/login.ts:155-165`

The Login Lambda handles the case where a user hasn't been confirmed:

```typescript
try {
  // Attempt login
  const authCommand = new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: COGNITO_CLIENT_ID,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });

  const authResponse = await cognitoClient.send(authCommand);

  // ... success handling

} catch (error) {
  // Handle unconfirmed user error
  if (error instanceof UserNotConfirmedException) {
    logger.warn('Login failed: user not confirmed', {
      requestId,
      error: error.message,
    });

    return createErrorResponse(
      403,
      'Please verify your email address before logging in. Check your inbox for the verification link.',
      requestId
    );
  }

  // ... other error handling
}
```

**In Dev Environment**: This error should **never occur** because auto-confirm ensures all registered users are immediately confirmed.

**In Prod Environment**: This error correctly prompts users to check their email for verification.

---

## Testing

### Unit Tests

**Location**: `backend/functions/auth/__tests__/register.test.ts`

**Key Test Cases**:
- ✅ Successful registration returns 201
- ✅ Missing required fields returns 400
- ✅ Duplicate email returns 409
- ✅ Auto-confirm logic executes in dev environment

### Integration Tests

**Location**: `backend/functions/__tests__/integration/translation-flow.integration.test.ts`

**Key Test Flow**:
1. Register user
2. Immediately attempt login (no email verification step)
3. Access protected endpoints

### Manual Testing

**Register User**:

```bash
# Create test payload
cat > /tmp/register.json <<'EOF'
{
  "email": "test@example.com",
  "password": "TestPassword123!",
  "confirmPassword": "TestPassword123!",
  "firstName": "Test",
  "lastName": "User",
  "acceptedTerms": true,
  "acceptedPrivacy": true
}
EOF

# Register user (dev environment)
curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/register \
  -H "Content-Type: application/json" \
  -d @/tmp/register.json
```

**Expected Response** (dev):
```json
{
  "message": "User registered successfully. You can now log in.",
  "requestId": "abc-123-def"
}
```

**Expected Response** (prod):
```json
{
  "message": "User registered successfully. Please check your email to verify your account.",
  "requestId": "abc-123-def"
}
```

**Login Immediately** (no email verification):

```bash
cat > /tmp/login.json <<'EOF'
{
  "email": "test@example.com",
  "password": "TestPassword123!"
}
EOF

curl -X POST https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/auth/login \
  -H "Content-Type: application/json" \
  -d @/tmp/login.json
```

**Expected Response**:
```json
{
  "user": {
    "id": "user-123",
    "email": "test@example.com",
    "firstName": "Test",
    "lastName": "User"
  },
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIiwiYWxnIjoiUlNBLU9BRVAifQ...",
  "idToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

---

## Production Considerations

### Disabling Auto-Confirm for Production

**Method 1**: Environment Variable (Recommended)
- Ensure `ENVIRONMENT` is set to "Prod" or "Staging" (not "Dev")
- CDK automatically sets this based on deployment context

**Method 2**: Code Change
```typescript
// Force disable auto-confirm
const AUTO_CONFIRM_USERS = false;
```

### Email Configuration for Production

Once auto-confirm is disabled, configure Cognito email settings:

1. **SES Configuration**:
   ```typescript
   userPool.emailSettings = {
     from: 'noreply@yourdomain.com',
     replyTo: 'support@yourdomain.com',
   };
   ```

2. **Email Templates**:
   - Customize verification email template in Cognito console
   - Add company branding and clear instructions
   - Include support contact information

3. **Sender Email Verification**:
   - Verify sender email address in SES
   - Move SES out of sandbox for production
   - Configure DKIM and SPF records

### Security Benefits of Email Verification

**Why Require Email Verification in Production**:

1. ✅ **Prevents Fake Account Creation**: Requires valid email address
2. ✅ **Reduces Spam/Abuse**: Adds friction for malicious users
3. ✅ **Account Recovery**: Verified email enables password reset
4. ✅ **User Confirmation**: Ensures user owns the email address

**Additional Production Security**:
- Consider reCAPTCHA for registration
- Monitor registration patterns for abuse
- Implement rate limiting on registration endpoint
- Add CAPTCHA for suspicious IP addresses

### Rollback Procedure

If auto-confirm causes issues in production:

1. **Immediate Rollback**:
   ```bash
   # Redeploy with ENVIRONMENT=Prod
   npx cdk deploy --context environment=prod
   ```

2. **Verify Rollback**:
   - Register test user
   - Confirm email verification required
   - Check CloudWatch logs for auto-confirm disabled

---

## Troubleshooting

### Issue: Users Getting 403 "Please Verify Email" in Dev

**Symptoms**:
- User registers successfully
- Login fails with 403 error: "Please verify your email address"
- Auto-confirm should be working but isn't

**Diagnosis Steps**:

1. **Check Lambda Environment Variable**:
   ```bash
   aws lambda get-function-configuration \
     --function-name lfmt-auth-register-dev \
     --query 'Environment.Variables.ENVIRONMENT'
   ```
   Expected: Value contains "Dev"

2. **Check IAM Permissions**:
   ```bash
   aws iam get-role-policy \
     --role-name lfmt-auth-register-role-dev \
     --policy-name RegisterFunctionPolicy
   ```
   Expected: Includes `cognito-idp:AdminConfirmSignUp`

3. **Check CloudWatch Logs**:
   ```bash
   aws logs tail /aws/lambda/lfmt-auth-register-dev --follow
   ```
   Expected: Log message "Auto-confirming user (dev environment)"

4. **Verify Cognito User Pool ID**:
   ```bash
   aws lambda get-function-configuration \
     --function-name lfmt-auth-register-dev \
     --query 'Environment.Variables.COGNITO_USER_POOL_ID'
   ```
   Expected: Non-empty value

**Solutions**:
- Redeploy Lambda with correct `ENVIRONMENT` variable
- Update IAM role to include `AdminConfirmSignUp` permission
- Verify `COGNITO_USER_POOL_ID` is set in Lambda environment

---

### Issue: JSON Parsing Errors with Special Characters

**Symptoms**:
- Registration fails with JSON parsing error
- Password contains special characters (!, @, $, etc.)
- Works when testing in Postman but fails with curl

**Root Cause**:
Bash shell interprets special characters in inline JSON strings, causing malformed requests.

**Solution**: Use file-based JSON payloads

```bash
# ❌ WRONG (bash interprets ! and other special chars)
curl -d '{"email":"test@test.com","password":"Pass123!"}' ...

# ✅ CORRECT (file-based payload avoids shell interpretation)
cat > /tmp/register.json <<'EOF'
{
  "email": "test@test.com",
  "password": "Pass123!",
  "confirmPassword": "Pass123!",
  "firstName": "Test",
  "lastName": "User",
  "acceptedTerms": true,
  "acceptedPrivacy": true
}
EOF

curl -X POST https://api-url/auth/register \
  -H "Content-Type: application/json" \
  -d @/tmp/register.json
```

---

### Issue: Auto-Confirm Not Working After Deployment

**Symptoms**:
- Fresh deployment to dev environment
- Auto-confirm feature not working
- No error messages in logs

**Diagnosis**:
1. Check CDK deployment context:
   ```bash
   cd backend/infrastructure
   npx cdk synth --context environment=dev | grep ENVIRONMENT
   ```

2. Verify Lambda function was updated:
   ```bash
   aws lambda get-function \
     --function-name lfmt-auth-register-dev \
     --query 'Configuration.LastModified'
   ```

**Solution**:
- Force Lambda update: `npx cdk deploy --force`
- Invalidate CloudFormation cache: Delete and recreate stack

---

## Related Documentation

- **Authentication Flow**: See `backend/functions/auth/README.md`
- **Cognito Configuration**: See `docs/INFRASTRUCTURE-SETUP.md`
- **Lambda Functions**: See `backend/functions/auth/register.ts`
- **IAM Permissions**: See `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`

---

**Last Updated**: 2025-11-23 (extracted from CLAUDE.md)
**Related PRs**: #72 (Auto-confirm implementation)
