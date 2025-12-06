# LFMT POC - Deployment Guide

**Last Updated**: 2025-11-30
**Environment**: Development (LfmtPocDev stack)

---

## Quick Deploy (Hotfix)

For immediate frontend-only hotfix deployment:

```bash
# 1. Ensure correct environment variables are loaded
cd frontend
cp .env.production .env

# 2. Build frontend with production config
npm run build

# 3. Deploy to S3
aws s3 sync dist/ s3://lfmt-frontend-lfmtpocdev/ --delete

# 4. Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id E3EV4PBKYTNTRE --paths "/*"

# 5. Verify deployment
curl -s https://d39xcun7144jgl.cloudfront.net/assets/index-*.js | grep -o "https://[^\"]*execute-api[^\"]*" | head -1
# Should output: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1
```

---

## Environment Variables

### Frontend Configuration

The frontend requires these environment variables for CloudFront deployment:

**File**: `frontend/.env.production`
```bash
VITE_API_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1
VITE_AWS_REGION=us-east-1
VITE_COGNITO_USER_POOL_ID=us-east-1_tyG2buO70
VITE_COGNITO_CLIENT_ID=4qlc7n27ptoad18k3rlj1nipg7
VITE_COGNITO_DOMAIN=lfmt-lfmtpocdev-ndi3mjyy
VITE_APP_ENV=production
VITE_APP_NAME=LFMT Translation Service (Dev)
VITE_MOCK_API=false
VITE_FEATURE_DARK_MODE=false
```

**Important**: Vite requires `.env` or `.env.production.local` files for production builds. The `.env.production` file alone is NOT automatically loaded.

### Deployment Workaround

Before building for CloudFront deployment:
```bash
cd frontend
cp .env.production .env
npm run build
```

This ensures Vite picks up the production API configuration.

---

## Full Stack Deployment

### Prerequisites
- AWS CLI configured with `us-east-1` region
- Node.js 18+
- AWS CDK v2

### Backend + Infrastructure
```bash
cd backend/infrastructure
npx cdk deploy --context environment=dev --require-approval never
```

### Frontend Only
```bash
# Build
cd frontend
cp .env.production .env
npm run build

# Deploy
aws s3 sync dist/ s3://lfmt-frontend-lfmtpocdev/ --delete
aws cloudfront create-invalidation --distribution-id E3EV4PBKYTNTRE --paths "/*"
```

---

## Common Issues

### Issue: 401 Unauthorized after deployment

**Symptom**: Frontend shows "Unauthorized" error when uploading files

**Root Causes**:
1. **Email not verified**: Cognito User Pool requires `email_verified: true` for API authorization
2. **Expired token**: Cognito access tokens expire after 1 hour
3. **Wrong API endpoint**: Frontend using localhost instead of AWS API Gateway

**Solutions**:

1. **Email Verification Issue (Primary Fix - Dec 2, 2024)**:
   - **Root Cause**: Dev environment disabled email auto-verification to avoid AWS SES limits (50 emails/day)
   - **Solution**: Pre-signup Lambda trigger now auto-verifies email for all new dev users
   - **Infrastructure**: `/backend/infrastructure/lib/lfmt-infrastructure-stack.ts:339-368`
   - For existing users with `email_verified: false`:
     ```bash
     aws cognito-idp admin-update-user-attributes \
       --user-pool-id us-east-1_tyG2buO70 \
       --username <email> \
       --user-attributes Name=email_verified,Value=true
     ```
   - User must log out and log back in after attribute update

2. **Check deployed bundle has correct API URL**:
   ```bash
   curl -s https://d39xcun7144jgl.cloudfront.net/assets/index-*.js | grep -o "execute-api"
   ```
   Should find `execute-api` in the bundle. If not, rebuild with `.env` file.

3. **Clear user tokens**:
   - User should log out and log back in
   - Or run in browser console:
     ```javascript
     localStorage.clear();
     location.reload();
     ```

4. **Verify .env file was used during build**:
   ```bash
   cd frontend
   cat .env  # Should contain VITE_API_URL with execute-api URL
   ```

### Issue: CloudFront serves old cached version

**Solution**: Always invalidate cache after S3 upload
```bash
aws cloudfront create-invalidation --distribution-id E3EV4PBKYTNTRE --paths "/*"
```

Wait 30-60 seconds for invalidation to complete, then hard-refresh browser (Cmd+Shift+R).

---

## Deployment Checklist

- [ ] Backend tests passing (`cd backend/functions && npm test`)
- [ ] Frontend tests passing (`cd frontend && npm test`)
- [ ] `.env.production` file has correct API endpoint
- [ ] Copy `.env.production` to `.env` before build
- [ ] Build frontend (`npm run build`)
- [ ] Deploy to S3 (`aws s3 sync`)
- [ ] Invalidate CloudFront cache
- [ ] Verify deployed bundle has correct API URL
- [ ] Test end-to-end workflow (login, upload, translate)

---

## URLs

- **Frontend (CloudFront)**: https://d39xcun7144jgl.cloudfront.net
- **API Gateway**: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
- **CloudFront Distribution ID**: E3EV4PBKYTNTRE
- **S3 Frontend Bucket**: s3://lfmt-frontend-lfmtpocdev/

---

## Notes

- All deployments should go through GitHub Actions workflow when possible
- Manual deployments are for hotfixes only
- Always create a PR documenting manual deployment changes
- The `.env` file is gitignored - never commit it
