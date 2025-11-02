# Frontend Deployment Guide

This document outlines how to deploy the LFMT frontend to create a complete dev environment with frontend + backend working together.

## Current Backend API
- **Base URL**: `https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1`
- **Status**: Deployed and working

## Deployment Options

### Option 1: AWS Amplify (Recommended - Easiest)

AWS Amplify provides automatic CI/CD and integrates seamlessly with your AWS backend.

#### Steps:

1. **Install AWS Amplify CLI** (if not already installed):
   ```bash
   npm install -g @aws-amplify/cli
   ```

2. **Configure Amplify** (one-time setup):
   ```bash
   amplify configure
   ```
   - Sign in to AWS Console
   - Create IAM user with Amplify permissions
   - Save access key

3. **Initialize Amplify in your project**:
   ```bash
   cd /Users/raymondl/Documents/LFMT\ POC/LFMT/lfmt-poc/frontend
   amplify init
   ```
   - Project name: `lfmt-frontend`
   - Environment: `dev`
   - Default editor: (your choice)
   - App type: `javascript`
   - Framework: `react`
   - Source directory: `src`
   - Distribution directory: `dist`
   - Build command: `npm run build`
   - Start command: `npm run dev`

4. **Add hosting**:
   ```bash
   amplify add hosting
   ```
   - Select: `Hosting with Amplify Console (Managed hosting with custom domains, Continuous deployment)`
   - Choose: `Continuous deployment (Git-based deployments)`

5. **Publish**:
   ```bash
   amplify publish
   ```

6. **Get the deployed URL**:
   - Amplify will provide a URL like: `https://dev.d1a2b3c4d5e6f7.amplifyapp.com`

---

### Option 2: AWS S3 + CloudFront (More Control)

This matches your architecture document's design.

#### Steps:

1. **Build the frontend**:
   ```bash
   cd /Users/raymondl/Documents/LFMT\ POC/LFMT/lfmt-poc/frontend
   npm run build
   ```

2. **Create S3 bucket for frontend**:
   ```bash
   aws s3 mb s3://lfmt-frontend-dev --region us-east-1
   ```

3. **Enable static website hosting**:
   ```bash
   aws s3 website s3://lfmt-frontend-dev \
     --index-document index.html \
     --error-document index.html
   ```

4. **Upload build files**:
   ```bash
   aws s3 sync dist/ s3://lfmt-frontend-dev --delete
   ```

5. **Set bucket policy for public read**:
   ```bash
   aws s3api put-bucket-policy --bucket lfmt-frontend-dev --policy '{
     "Version": "2012-10-17",
     "Statement": [{
       "Sid": "PublicReadGetObject",
       "Effect": "Allow",
       "Principal": "*",
       "Action": "s3:GetObject",
       "Resource": "arn:aws:s3:::lfmt-frontend-dev/*"
     }]
   }'
   ```

6. **Create CloudFront distribution** (optional, for HTTPS and caching):
   ```bash
   # Use AWS Console or CLI to create CloudFront distribution
   # pointing to S3 bucket
   ```

7. **Access your frontend**:
   - S3 website URL: `http://lfmt-frontend-dev.s3-website-us-east-1.amazonaws.com`
   - CloudFront URL (if configured): `https://d111111abcdef8.cloudfront.net`

---

### Option 3: Vercel (Fastest Deployment)

Perfect for quick testing and prototyping.

#### Steps:

1. **Install Vercel CLI**:
   ```bash
   npm install -g vercel
   ```

2. **Deploy**:
   ```bash
   cd /Users/raymondl/Documents/LFMT\ POC/LFMT/lfmt-poc/frontend
   vercel
   ```
   - Follow prompts
   - Set environment variable: `VITE_API_BASE_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1`

3. **Production deployment**:
   ```bash
   vercel --prod
   ```

4. **Get deployed URL**:
   - Vercel will provide a URL like: `https://lfmt-poc.vercel.app`

---

## Environment Variables

The frontend uses these environment variables:

- **Development** (`.env.development`):
  ```env
  VITE_API_BASE_URL=http://localhost:3000/api
  VITE_APP_NAME=LFMT Translation Service
  VITE_APP_ENV=development
  ```

- **Production** (`.env.production`):
  ```env
  VITE_API_BASE_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1
  VITE_APP_NAME=LFMT Translation Service
  VITE_APP_ENV=production
  ```

---

## CORS Configuration

**IMPORTANT**: Your backend API Gateway needs CORS configured to allow requests from your frontend domain.

### Update API Gateway CORS:

1. Go to AWS Console → API Gateway
2. Select your API: `LFMT-API`
3. Actions → Enable CORS
4. Add allowed origins:
   - For Amplify: `https://*.amplifyapp.com`
   - For Vercel: `https://*.vercel.app`
   - For S3: `http://lfmt-frontend-dev.s3-website-us-east-1.amazonaws.com`
5. Save changes
6. Redeploy API

---

## CI/CD with GitHub Actions

For automatic deployments on push to main:

1. **Create `.github/workflows/deploy-frontend.yml`**:
   ```yaml
   name: Deploy Frontend

   on:
     push:
       branches: [main]
       paths:
         - 'frontend/**'

   jobs:
     deploy:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v3

         - name: Setup Node.js
           uses: actions/setup-node@v3
           with:
             node-version: '18'

         - name: Install dependencies
           run: |
             cd frontend
             npm ci

         - name: Build
           run: |
             cd frontend
             npm run build
           env:
             VITE_API_BASE_URL: ${{ secrets.VITE_API_BASE_URL }}

         - name: Deploy to S3
           run: |
             cd frontend
             aws s3 sync dist/ s3://lfmt-frontend-dev --delete
           env:
             AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
             AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
             AWS_REGION: us-east-1
   ```

2. **Add GitHub Secrets**:
   - `VITE_API_BASE_URL`: Your API URL
   - `AWS_ACCESS_KEY_ID`: Your AWS access key
   - `AWS_SECRET_ACCESS_KEY`: Your AWS secret key

---

## Quick Start (Recommended)

For fastest deployment right now:

```bash
# Option 1: Vercel (2 minutes)
cd /Users/raymondl/Documents/LFMT\ POC/LFMT/lfmt-poc/frontend
npm install -g vercel
vercel --prod

# Option 2: AWS Amplify (5 minutes)
npm install -g @aws-amplify/cli
amplify init
amplify add hosting
amplify publish
```

---

## Testing the Deployment

After deployment, test these endpoints:

1. **Health Check**: `https://your-frontend-url/`
2. **API Connection**: Login and try uploading a file
3. **CORS**: Check browser console for CORS errors

---

## Troubleshooting

### CORS Errors
- Update API Gateway CORS settings
- Add your frontend domain to allowed origins
- Redeploy API Gateway

### 404 Errors on Refresh
- Ensure `index.html` is set as error document (for S3)
- Configure redirects in CloudFront/Amplify

### Environment Variables Not Working
- Ensure variables start with `VITE_`
- Rebuild after changing env vars
- Check build logs for variable values

---

## Next Steps

After deployment:
1. Update Cognito User Pool with frontend callback URL
2. Configure custom domain (optional)
3. Set up SSL/TLS certificate
4. Enable CloudWatch monitoring
5. Set up frontend error tracking (Sentry, etc.)
