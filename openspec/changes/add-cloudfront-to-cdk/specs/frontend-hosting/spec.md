# Spec Delta: Frontend Hosting

This is a new capability being added to the LFMT infrastructure.

## ADDED Requirements

### Requirement: CloudFront Distribution Management
The system SHALL manage the CloudFront distribution for frontend hosting using AWS CDK Infrastructure as Code, ensuring version-controlled, reproducible, and environment-specific configuration.

#### Scenario: Create CloudFront distribution via CDK
- **GIVEN** the CDK infrastructure stack is being deployed
- **WHEN** the stack synthesis and deployment runs
- **THEN** a new CloudFront distribution SHALL be created with:
  - S3 origin configured with Origin Access Control (OAC)
  - HTTPS-only viewer protocol policy (redirect HTTP to HTTPS)
  - Default root object set to `index.html`
  - IPv6 enabled for global accessibility
  - Compression enabled (gzip and brotli)

#### Scenario: CloudFront distribution exists in each environment
- **GIVEN** multiple deployment environments (dev, staging, prod)
- **WHEN** the CDK stack is deployed to each environment
- **THEN** each environment SHALL have its own CloudFront distribution
- **AND** each distribution SHALL be tagged with the environment name
- **AND** the distribution SHALL be isolated from other environments

#### Scenario: Retrieve CloudFront URL from stack outputs
- **GIVEN** the CDK stack has been deployed
- **WHEN** retrieving stack outputs via AWS CLI or CloudFormation API
- **THEN** the following outputs SHALL be available:
  - `FrontendBucketName` - S3 bucket name for frontend assets
  - `CloudFrontDistributionId` - CloudFront distribution ID
  - `CloudFrontDistributionDomain` - CloudFront domain (e.g., `d1abc123.cloudfront.net`)
  - `FrontendUrl` - Full HTTPS URL of the frontend (e.g., `https://d1abc123.cloudfront.net`)

### Requirement: Single Page Application (SPA) Routing Support
The system SHALL configure CloudFront to properly handle client-side routing for React Single Page Applications, ensuring that direct navigation to any route serves the application correctly.

#### Scenario: Direct navigation to SPA route returns React app
- **GIVEN** the React application uses client-side routing (React Router)
- **WHEN** a user navigates directly to a non-root path (e.g., `/dashboard`, `/translation/upload`)
- **THEN** CloudFront SHALL serve `/index.html` with HTTP 200 status
- **AND** the React Router SHALL handle the routing client-side
- **AND** the URL in the browser SHALL remain unchanged

#### Scenario: Handle S3 403 errors for non-existent routes
- **GIVEN** the S3 bucket has restricted access (no public read)
- **WHEN** CloudFront requests a non-existent object from S3 (e.g., `/dashboard`)
- **THEN** S3 SHALL return 403 Forbidden (not 404, due to bucket permissions)
- **AND** CloudFront SHALL intercept the 403 error
- **AND** CloudFront SHALL serve `/index.html` with HTTP 200 status to the client
- **AND** the custom error response SHALL cache for 300 seconds (5 minutes)

#### Scenario: Handle S3 404 errors for non-existent routes
- **GIVEN** the S3 bucket has restricted access
- **WHEN** CloudFront requests a non-existent object from S3
- **AND** S3 returns 404 Not Found (rare case with certain bucket configurations)
- **THEN** CloudFront SHALL intercept the 404 error
- **AND** CloudFront SHALL serve `/index.html` with HTTP 200 status to the client
- **AND** the custom error response SHALL cache for 300 seconds (5 minutes)

#### Scenario: Browser refresh on SPA route stays on current route
- **GIVEN** a user has navigated to a non-root route via React Router (e.g., `/dashboard`)
- **WHEN** the user refreshes the browser (F5 or Cmd+R)
- **THEN** CloudFront SHALL serve `/index.html` with HTTP 200 status
- **AND** the React Router SHALL restore the route from the URL
- **AND** the user SHALL remain on the same route (no redirect to homepage)

### Requirement: Frontend Asset Storage
The system SHALL provide a dedicated S3 bucket for storing frontend static assets (HTML, CSS, JavaScript, images) with appropriate access controls and lifecycle policies.

#### Scenario: Create frontend S3 bucket via CDK
- **GIVEN** the CDK infrastructure stack is being deployed
- **WHEN** the stack synthesis and deployment runs
- **THEN** a new S3 bucket SHALL be created with:
  - Public access blocked (all four block settings enabled)
  - Static website hosting disabled (CloudFront-only access)
  - Versioning enabled for rollback capability
  - Server-side encryption with S3-managed keys (SSE-S3)
  - Lifecycle policy to delete objects older than 90 days

#### Scenario: CloudFront has exclusive access to frontend bucket
- **GIVEN** the frontend S3 bucket has been created
- **WHEN** the bucket policy is configured
- **THEN** only the CloudFront distribution's Origin Access Control SHALL have read access
- **AND** all public access SHALL be denied
- **AND** direct S3 access via URL SHALL return Access Denied error

#### Scenario: Deploy frontend assets to S3 bucket
- **GIVEN** the frontend React application has been built (`npm run build`)
- **WHEN** the deployment workflow runs
- **THEN** the build artifacts SHALL be synced to the frontend S3 bucket
- **AND** old files not present in the new build SHALL be deleted (via `--delete` flag)
- **AND** object metadata SHALL include proper `Content-Type` headers

### Requirement: CloudFront Cache Invalidation
The system SHALL provide automated cache invalidation for CloudFront after frontend deployments to ensure users receive the latest version of the application immediately.

#### Scenario: Invalidate CloudFront cache after deployment
- **GIVEN** new frontend assets have been deployed to S3
- **WHEN** the deployment workflow completes the S3 sync
- **THEN** a CloudFront invalidation SHALL be created for all paths (`/*`)
- **AND** the invalidation SHALL be submitted to CloudFront via AWS CLI
- **AND** the deployment workflow SHALL wait for invalidation to complete (or continue asynchronously)

#### Scenario: Invalidation completes within acceptable time
- **GIVEN** a CloudFront invalidation has been created
- **WHEN** CloudFront processes the invalidation request
- **THEN** the invalidation SHALL complete within 15 minutes (CloudFront SLA)
- **AND** users SHALL receive the latest frontend assets after invalidation completes
- **AND** the deployment workflow SHALL log the invalidation ID for tracking

### Requirement: Security Headers Configuration
The system SHALL configure CloudFront to add security headers to all responses, protecting against common web vulnerabilities and enforcing browser security policies.

#### Scenario: Add security headers to CloudFront responses
- **GIVEN** the CloudFront distribution is configured
- **WHEN** a user requests any resource from the distribution
- **THEN** the response SHALL include the following security headers:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (HSTS for 1 year)
  - `X-Content-Type-Options: nosniff` (prevent MIME sniffing)
  - `X-Frame-Options: DENY` (prevent clickjacking)
  - `X-XSS-Protection: 1; mode=block` (enable XSS filter)
  - `Content-Security-Policy` (strict CSP for React SPA)
  - `Referrer-Policy: strict-origin-when-cross-origin` (limit referrer leakage)

#### Scenario: Enforce HTTPS-only access
- **GIVEN** the CloudFront distribution is configured with HTTPS-only viewer protocol policy
- **WHEN** a user attempts to access the frontend via HTTP (e.g., `http://d1abc123.cloudfront.net`)
- **THEN** CloudFront SHALL redirect the request to HTTPS with 301 Moved Permanently
- **AND** the browser SHALL automatically retry the request over HTTPS

### Requirement: Environment-Specific Configuration
The system SHALL support different CloudFront configurations for each deployment environment (dev, staging, prod) while maintaining consistency in core functionality.

#### Scenario: Dev environment configuration
- **GIVEN** the CDK stack is deployed to the `dev` environment
- **WHEN** the CloudFront distribution is created
- **THEN** the distribution SHALL be configured with:
  - Lower TTL for cache (faster iteration)
  - Cost-optimized edge locations (e.g., North America and Europe only)
  - Removal policy set to DESTROY (allow deletion on stack teardown)

#### Scenario: Production environment configuration
- **GIVEN** the CDK stack is deployed to the `prod` environment
- **WHEN** the CloudFront distribution is created
- **THEN** the distribution SHALL be configured with:
  - Optimized TTL for cache (balance freshness and cost)
  - Global edge locations (best performance worldwide)
  - Removal policy set to RETAIN (prevent accidental deletion)
  - Access logging enabled for audit and analytics

### Requirement: API Gateway CORS Integration
The system SHALL automatically configure API Gateway CORS allowed origins to include the CloudFront distribution URL, enabling secure frontend-to-backend communication.

#### Scenario: Update API Gateway CORS with CloudFront URL
- **GIVEN** the CloudFront distribution has been created
- **WHEN** the API Gateway REST API is configured
- **THEN** the CORS allowed origins SHALL include the CloudFront distribution URL
- **AND** the CloudFront URL SHALL be retrieved from CDK stack outputs (not hardcoded)
- **AND** localhost origins SHALL still be allowed for local development

#### Scenario: Remove hardcoded CloudFront URLs
- **GIVEN** the API Gateway CORS configuration previously used hardcoded CloudFront URLs
- **WHEN** the CDK stack is updated to use CloudFront from IaC
- **THEN** all hardcoded CloudFront URLs (e.g., `https://d1yysvwo9eg20b.cloudfront.net`) SHALL be removed
- **AND** the CORS configuration SHALL use the CDK-outputted CloudFront URL
- **AND** the configuration SHALL be environment-specific (dev, staging, prod)

### Requirement: Deployment Workflow Integration
The system SHALL integrate CloudFront distribution management into the CI/CD deployment workflow, automating frontend deployments and cache invalidations.

#### Scenario: Deploy frontend to CDK-managed S3 bucket
- **GIVEN** the deployment workflow is triggered (e.g., PR merge to main)
- **WHEN** the frontend deployment step runs
- **THEN** the workflow SHALL retrieve the `FrontendBucketName` from CDK stack outputs
- **AND** the workflow SHALL sync frontend build artifacts to the CDK-managed S3 bucket
- **AND** the workflow SHALL NOT use hardcoded bucket names

#### Scenario: Update E2E tests to use CloudFront URL from CDK
- **GIVEN** the E2E tests need to run against the deployed frontend
- **WHEN** the E2E test workflow step runs
- **THEN** the workflow SHALL retrieve the `FrontendUrl` from CDK stack outputs
- **AND** the workflow SHALL pass the CloudFront URL to Playwright via environment variable
- **AND** the E2E tests SHALL NOT use hardcoded CloudFront URLs

### Requirement: Infrastructure Testing
The system SHALL include automated tests for CloudFront distribution configuration to ensure proper setup and prevent regressions.

#### Scenario: Test CloudFront distribution exists
- **GIVEN** the CDK infrastructure tests are run
- **WHEN** the stack is synthesized
- **THEN** the CloudFormation template SHALL include a CloudFront distribution resource
- **AND** the distribution SHALL have the correct logical ID

#### Scenario: Test custom error responses configured
- **GIVEN** the CDK infrastructure tests are run
- **WHEN** the CloudFront distribution configuration is validated
- **THEN** the distribution SHALL have custom error response for 403 errors
- **AND** the distribution SHALL have custom error response for 404 errors
- **AND** both error responses SHALL redirect to `/index.html` with 200 status

#### Scenario: Test HTTPS-only viewer protocol policy
- **GIVEN** the CDK infrastructure tests are run
- **WHEN** the CloudFront distribution security configuration is validated
- **THEN** the viewer protocol policy SHALL be set to `redirect-to-https`
- **AND** HTTP requests SHALL NOT be allowed directly

#### Scenario: Test S3 bucket has public access blocked
- **GIVEN** the CDK infrastructure tests are run
- **WHEN** the frontend S3 bucket configuration is validated
- **THEN** all four block public access settings SHALL be enabled
- **AND** the bucket policy SHALL only allow CloudFront OAC access

### Requirement: Documentation and Migration Guidance
The system SHALL provide comprehensive documentation for CloudFront distribution management, SPA routing best practices, and migration from manual infrastructure.

#### Scenario: Document CloudFront configuration in CLAUDE.md
- **GIVEN** the CloudFront distribution is managed via CDK
- **WHEN** a developer or AI assistant consults the project documentation
- **THEN** `CLAUDE.md` SHALL include:
  - CloudFront configuration details (custom error responses, security headers)
  - Explanation of why both 403 and 404 error responses are required
  - SPA routing best practices for CloudFront + S3
  - CloudFront invalidation usage and timing

#### Scenario: Provide blue-green deployment migration guide
- **GIVEN** the system is transitioning from manual CloudFront to CDK-managed distribution
- **WHEN** the infrastructure team plans the migration
- **THEN** a migration guide (`CLOUDFRONT-MIGRATION.md`) SHALL be available with:
  - Pre-migration checklist (backup current config, notify team)
  - Blue-green deployment steps (create new distribution, test, switch traffic)
  - Rollback procedure (revert DNS, redeploy to old bucket)
  - Post-migration validation (E2E tests, smoke tests)
  - Timeline for deleting old manual distribution (30-day grace period)

## MODIFIED Requirements

None - this is a new capability.

## REMOVED Requirements

None - this is a new capability.

## RENAMED Requirements

None - this is a new capability.
