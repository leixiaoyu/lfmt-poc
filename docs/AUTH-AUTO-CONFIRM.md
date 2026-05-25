# Email Verification Auto-Confirm Feature

**Status**: Implemented for dev environment.
**Last Updated**: 2026-05-25
**Mechanism**: Cognito Pre-Sign-Up Lambda trigger (since PR #178, Wave 2 — 2026-05-13)

> **Architecture change**: The original implementation (PR #72, 2025-11-12)
> had `register.ts` call `AdminConfirmSignUpCommand` after `SignUpCommand`,
> which required a privileged `cognito-idp:AdminConfirmSignUp` IAM grant on
> the auth role. PR #178 removed that call (the AdminConfirmSignUp races
> against the User Pool's own confirm and silently fails as a no-op) and
> moved auto-confirm to a **Cognito Pre-Sign-Up Lambda trigger** that runs
> as part of `SignUpCommand` itself. This doc describes the **current**
> mechanism.

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
| ----------- | ------------ | ------------------ |
| **Dev**     | ✅ Enabled   | ❌ Disabled        |
| **Staging** | ❌ Disabled  | ✅ Required        |
| **Prod**    | ❌ Disabled  | ✅ Required        |

**Key Point**: Auto-confirm is **only active** when `ENVIRONMENT` variable contains "Dev".

---

## Configuration

### Environment Variable

**Location**: `backend/functions/auth/register.ts:40-44`

```typescript
const COGNITO_CLIENT_ID = getRequiredEnv('COGNITO_CLIENT_ID');
const ENVIRONMENT = getOptionalEnv('ENVIRONMENT', 'dev');

// Determines which success message to return; auto-confirm is handled by
// the Cognito PreSignUp trigger and pool configuration — no Lambda call needed.
const IS_DEV = ENVIRONMENT.includes('Dev');
```

**How It Works**:

- `IS_DEV` controls only the **wording of the success response** ("You can now log in" vs "Please check your email").
- Actual auto-confirm behavior is decided at infrastructure-deploy time by the CDK stack (`isDev` check on `stackName`), not at request time by the Lambda.

**Examples**:

- `ENVIRONMENT=Dev` → ✅ dev success message (and the dev stack also wires the Pre-Sign-Up trigger; see below)
- `ENVIRONMENT=LfmtPocDev` → ✅ dev success message
- `ENVIRONMENT=Staging` → ❌ prod-style success message
- `ENVIRONMENT=Prod` → ❌ prod-style success message

---

## Implementation

### Registration Flow

**Location**: `backend/functions/auth/register.ts:46-145`

**Steps**:

1. **Parse + validate** request body via `registerRequestSchema` (Zod).
2. **`SignUpCommand`** — register the user with Cognito.
3. **(dev only) Pre-Sign-Up trigger fires synchronously inside Cognito** — sets `event.response.autoConfirmUser = true` and `event.response.autoVerifyEmail = true`. No additional Lambda-to-Cognito calls.
4. **Success response** — `201` with environment-specific message.

**Code** (current register.ts, post-PR #178):

```typescript
const command = new SignUpCommand({
  ClientId: COGNITO_CLIENT_ID,
  Username: email,
  Password: password,
  UserAttributes: [
    { Name: 'email', Value: email },
    { Name: 'given_name', Value: firstName },
    { Name: 'family_name', Value: lastName },
  ],
});

await cognitoClient.send(command);

// No follow-up AdminConfirmSignUp call. The Pre-Sign-Up trigger has already
// run synchronously inside Cognito as part of SignUpCommand processing, so
// the user is already CONFIRMED when SignUpCommand returns (in dev).

return createFlatResponse(
  201,
  {
    message: IS_DEV
      ? 'User registered successfully. You can now log in.'
      : 'User registered successfully. Please check your email to verify your account.',
  } satisfies Pick<RegisterResponse, 'message'>,
  requestId,
  requestOrigin
);
```

### Why a Pre-Sign-Up Trigger (and not AdminConfirmSignUp)?

**Pre-Sign-Up trigger flow** (dev environment, current):

1. Client calls `POST /auth/register` → Lambda invokes `SignUpCommand`.
2. **Inside Cognito**, before user creation, the Pre-Sign-Up Lambda trigger runs.
3. The trigger sets `event.response.autoConfirmUser = true` and `event.response.autoVerifyEmail = true` in its response.
4. Cognito completes `SignUp` with the user already `CONFIRMED` and `email_verified = true`.
5. `SignUpCommand` returns — user can log in immediately.

**Standard flow** (staging/prod, no trigger):

1. Client calls `POST /auth/register` → Lambda invokes `SignUpCommand`.
2. Cognito creates user with status `UNCONFIRMED` and sends a verification email.
3. User confirms email via the link → status flips to `CONFIRMED`.

**Why not call `AdminConfirmSignUpCommand` from the Lambda?**

PR #178 removed that path. The reason: when a Pre-Sign-Up trigger has
already auto-confirmed the user, a follow-up `AdminConfirmSignUpCommand`
either races and fails with `"Current status is CONFIRMED"`, or
succeeds as a no-op. Keeping the call alive required an unnecessary
`cognito-idp:AdminConfirmSignUp` IAM grant on the shared `authRole`.
Removing both shrinks the IAM surface and eliminates the race.

---

## IAM Permissions

### Auth role (register / login / refresh / reset-password / getCurrentUser)

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:790-806`

The shared auth role's Cognito grants (post-PR #178):

```typescript
new iam.PolicyStatement({
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
    // cognito-idp:AdminConfirmSignUp REMOVED (#178): the PreSignUp Lambda
    // trigger auto-confirms users as part of SignUp itself, so the grant
    // is unnecessary.
  ],
  resources: [this.userPool.userPoolArn],
});
```

**What changed**: `cognito-idp:AdminConfirmSignUp` is no longer granted.
Do not re-add it — the Pre-Sign-Up trigger covers the same behavior with
no race and a smaller IAM blast radius.

### Pre-Sign-Up trigger Lambda role

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:572-596`

The Pre-Sign-Up trigger Lambda is created with the **default Lambda
execution role** (CloudWatch Logs write only). It does not need any
Cognito IAM permissions — Cognito invokes it as a trigger and reads its
return value; the trigger never calls back into Cognito.

The trigger Lambda is also **gated behind `if (isDev)`** in the stack —
staging/prod stacks do not wire a Pre-Sign-Up trigger at all, so the
email-verification flow runs unmodified there.

---

## Cognito Configuration

### User Pool Settings

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:517-567`

```typescript
const isDev = this.stackName.toLowerCase().includes('dev');

this.userPool = new cognito.UserPool(this, 'UserPool', {
  userPoolName: `lfmt-users-${this.stackName}`,
  removalPolicy,
  signInCaseSensitive: false,
  signInAliases: { email: true },
  selfSignUpEnabled: true,

  // Environment-conditional email verification:
  // - dev: empty (no auto-send) — paired with the Pre-Sign-Up trigger below
  //        which sets autoConfirmUser + autoVerifyEmail synchronously
  // - staging/prod: { email: true } — Cognito sends a verification email
  autoVerify: isDev ? {} : { email: true },

  userVerification: isDev
    ? undefined
    : {
        emailSubject: 'LFMT Account Verification',
        emailBody: 'Please verify your account by clicking the link: {##Verify Email##}',
        emailStyle: cognito.VerificationEmailStyle.LINK,
      },

  passwordPolicy: {
    minLength: 8,
    requireLowercase: true,
    requireUppercase: true,
    requireDigits: true,
    requireSymbols: true,
  },
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,

  standardAttributes: {
    email: { required: true, mutable: true },
    givenName: { required: true, mutable: true },
    familyName: { required: true, mutable: true },
  },
});
```

### Pre-Sign-Up trigger (dev only)

**Location**: `backend/infrastructure/lib/lfmt-infrastructure-stack.ts:569-599`

```typescript
if (isDev) {
  const preSignUpFunction = new lambda.Function(this, 'PreSignUpTrigger', {
    runtime: LAMBDA_RUNTIME,
    architecture: LAMBDA_ARCHITECTURE,
    handler: 'index.handler',
    code: lambda.Code.fromInline(`
      exports.handler = async (event) => {
        const isDev = process.env.ENVIRONMENT === 'dev';
        if (isDev) {
          event.response.autoConfirmUser = true;
          event.response.autoVerifyEmail = true;
        }
        return event;
      };
    `),
    description: 'Auto-confirm users and verify email in dev environment',
    environment: { ENVIRONMENT: isDev ? 'dev' : 'prod' },
    logRetention: logs.RetentionDays.ONE_WEEK,
  });

  this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, preSignUpFunction);
}
```

**Key points**:

- The trigger is **only added in dev stacks** (`isDev` check on `stackName`).
- Staging/prod User Pools have no Pre-Sign-Up trigger; standard email
  verification flow runs unmodified.
- The trigger is **inline code** (no separate handler file). Defense-in-depth: even though the trigger is only wired in dev, the inline handler also re-checks `process.env.ENVIRONMENT === 'dev'` before setting the auto-confirm flags.

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

1. **Confirm the dev stack actually wired the Pre-Sign-Up trigger**:

   ```bash
   aws cognito-idp describe-user-pool \
     --user-pool-id "$COGNITO_USER_POOL_ID" \
     --query 'UserPool.LambdaConfig.PreSignUp'
   ```

   Expected: an ARN like `arn:aws:lambda:...:function:LfmtPocDev-PreSignUpTrigger...`. If `null`, the stack did not deploy as a dev stack (CDK `isDev` check inspects `stackName` for `dev`).

2. **Tail the Pre-Sign-Up trigger logs during a registration**:

   ```bash
   aws logs tail /aws/lambda/<stack>-PreSignUpTrigger<...> --follow
   ```

   You should see the trigger fire once per `SignUpCommand` and complete in <100 ms. No log entry → trigger isn't wired or Cognito isn't routing to it.

3. **Confirm the Lambda's `ENVIRONMENT` env var**:

   ```bash
   aws lambda get-function-configuration \
     --function-name <stack>-PreSignUpTrigger<...> \
     --query 'Environment.Variables.ENVIRONMENT'
   ```

   Expected: `dev`. If it's `prod`, the inner `if (isDev)` short-circuit will skip the auto-confirm flags even though Cognito routes to the trigger.

4. **Confirm the register Lambda's `ENVIRONMENT` (controls the success message only)**:

   ```bash
   aws lambda get-function-configuration \
     --function-name lfmt-register-LfmtPocDev \
     --query 'Environment.Variables.ENVIRONMENT'
   ```

   Expected: value contains "Dev".

**Solutions**:

- If the trigger isn't wired: redeploy the dev stack and confirm `stackName` contains `dev`.
- If the trigger fires but doesn't auto-confirm: check that its `ENVIRONMENT` env var is `dev`.
- Do **not** re-add `cognito-idp:AdminConfirmSignUp` to the auth role — that path was removed in PR #178 and would re-introduce the race.

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

**Last Updated**: 2026-05-25
**Related PRs**: #72 (original AdminConfirmSignUp implementation; superseded), #178 (Pre-Sign-Up trigger refactor; removes the AdminConfirmSignUp call + IAM grant)
