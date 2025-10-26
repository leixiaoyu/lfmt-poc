# LFMT POC - Long-Form Translation Service

## Overview

This is a proof-of-concept implementation of a Long-Form Translation Service that translates 65K-400K word documents using Claude Sonnet 4 API with intelligent document chunking and AWS serverless infrastructure.

## Project Status

**Current Phase**: Phase 5 - Document Chunking Service (Next)
**Implementation Plan**: [LFMT Implementation Plan v2.md](../LFMT%20Implementation%20Plan%20v2.md)
**Overall Progress**: ~30% (Infrastructure, Auth, and Document Upload Complete)

### ✅ Completed Components

#### Infrastructure & DevOps (100% Complete)
- [x] AWS CDK infrastructure stack (Multi-environment: Dev, Staging, Prod)
- [x] DynamoDB tables: Jobs, Users, LegalAttestations
- [x] S3 buckets: Documents, Results (with lifecycle policies)
- [x] API Gateway with CORS, caching, and rate limiting
- [x] Cognito User Pool with MFA-ready configuration
- [x] Infrastructure validation tests (20 test cases passing)
- [x] **Production Stack**: LfmtPocProd (CREATE_COMPLETE)
- [x] **Production API**: https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/v1/
- [x] **CI/CD Pipeline**: GitHub Actions with comprehensive testing
  - Automated testing (unit, integration, infrastructure)
  - Automated deployment to dev on main branch push
  - Manual workflow dispatch for staging/production
  - Security scanning and dependency audits

#### Backend Authentication (100% Complete)
- [x] Authentication Lambda functions (4 deployed to production)
  - Login authentication with Cognito
  - User registration with validation
  - Token refresh functionality
  - Password reset workflow
- [x] API Gateway integration with Lambda
- [x] DynamoDB integration for user data
- [x] CloudWatch logging and monitoring
- [x] Comprehensive unit and integration tests
- [x] Production deployment verified

#### Frontend Authentication & UI (100% Complete)
- [x] React 18 + TypeScript + Material-UI setup
- [x] Authentication components (Login, Register, Forgot Password, Protected Routes)
- [x] Auth context and service layer with token management
- [x] API client with Axios interceptors
- [x] **Automatic token refresh on 401 errors** with request queuing
- [x] **Logout button with user context display** in app bar
- [x] Comprehensive test suite with 252+ passing tests
- [x] **91.66% overall test coverage** (exceeds 90% target)
- [x] All critical components at 100% coverage
- [x] React Router v6 integration
- [x] Form validation with React Hook Form + Zod
- [x] Production environment configuration ready
- [x] **API Gateway CORS fixes** for error responses (401, 403, 400, 5XX)
- [x] **File upload UI component** with drag-and-drop and progress tracking

#### Phase 4: Document Upload Service (100% Complete)
- [x] Frontend upload component with drag-and-drop
- [x] Upload progress tracking UI
- [x] File validation (size, type) on client and server side
- [x] Upload service integration layer
- [x] **S3 signed URL generation endpoint (backend)** - Deployed to dev
- [x] **Job record creation in DynamoDB (backend)** - Deployed with comprehensive validation
- [x] **API Gateway endpoint POST /jobs/upload** - Live with Cognito auth
- [x] **All 49 backend unit tests passing**
- [x] **End-to-end upload flow verified** - Frontend to S3 via presigned URLs

### 🔄 In Progress

Currently working on: Phase 5 - Document Chunking Service

### 📋 Upcoming Features

#### Translation Core Features (Phase 5-6)
- [ ] Document chunking service (3,500 tokens + 250 overlap)
- [ ] Claude API integration
- [ ] Translation processing pipeline
- [ ] Legal attestation system
- [ ] Job polling endpoint
- [ ] Result download endpoint
- [ ] Job history management

## Architecture

### Core Components
- **Frontend**: React 18 + TypeScript + Material-UI + React Query
- **Backend**: AWS Lambda + API Gateway + Step Functions + ECS Fargate
- **Database**: DynamoDB with appropriate GSIs
- **Storage**: S3 with intelligent tiering and lifecycle policies
- **Authentication**: AWS Cognito with JWT tokens
- **Translation Engine**: Claude Sonnet 4 API integration (planned)

### Key Features
- **Intelligent Chunking**: 3,500-token chunks with 250-token overlap (planned)
- **Adaptive Polling**: 15s → 30s → 60s intervals for progress tracking (planned)
- **Legal Compliance**: 7-year attestation retention with audit trails (planned)
- **Cost Optimization**: <$50/month operational target for 1000 translations
- **Security**: Encryption at rest/transit, IAM least-privilege access, OIDC authentication

## Quick Start

### Prerequisites
- Node.js 18+
- AWS CLI configured
- AWS CDK v2
- Git

### Installation
```bash
# Clone repository
git clone https://github.com/leixiaoyu/lfmt-poc
cd lfmt-poc

# Install shared types
cd shared-types
npm install

# Install infrastructure dependencies
cd ../backend/infrastructure
npm install

# Build and test
npm run build
npm test

# Install frontend dependencies
cd ../../frontend
npm install
npm test
```

### Local Development
```bash
# Start frontend development server
cd frontend
npm run dev
# Access at http://localhost:5173

# Run frontend tests
npm test

# Run infrastructure tests
cd backend/infrastructure
npm test
```

### Deployment

#### Manual Deployment
```bash
# Deploy to development
cd backend/infrastructure
npx cdk deploy --context environment=dev

# Deploy to staging
npx cdk deploy --context environment=staging

# Deploy to production
npx cdk deploy --context environment=prod
```

#### Automated Deployment (GitHub Actions)
- **Development**: Automatic deployment on push to `main` branch
- **Staging/Production**: Manual workflow dispatch from GitHub Actions UI

For detailed deployment instructions, see [PRODUCTION-SETUP-CHECKLIST.md](PRODUCTION-SETUP-CHECKLIST.md)

## Project Structure
```
lfmt-poc/
├── .github/
│   └── workflows/          # GitHub Actions CI/CD
│       ├── ci.yml         # Pull request testing
│       └── deploy.yml     # Multi-environment deployment
├── backend/
│   ├── functions/         # Lambda functions
│   │   └── auth/         # Authentication functions
│   ├── infrastructure/    # AWS CDK infrastructure
│   └── shared/           # Shared backend utilities
├── frontend/              # React application
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── contexts/     # React contexts
│   │   ├── hooks/        # Custom React hooks
│   │   ├── pages/        # Page components
│   │   ├── services/     # API clients
│   │   └── types/        # TypeScript interfaces
│   └── __tests__/        # Frontend tests
├── shared-types/          # Shared TypeScript interfaces
├── scripts/               # Deployment and utility scripts
└── docs/                  # Documentation
```

## Development Guidelines

### Git Workflow
- **Main Branch**: `main` - Production-ready code with branch protection
- **Feature Branches**: `feature/description` - Individual features
- **Pull Requests**: Required for all changes to main
- **CI/CD**: Automated testing on all PRs

### Branch Protection Rules
- Require pull request before merging
- Require status checks to pass (Run Tests, Build Infrastructure)
- Require conversation resolution
- No direct pushes to main

### Commit Messages
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**: feat, fix, docs, style, refactor, test, chore, ci
**Scopes**: auth, docs, api, ui, infra, deploy, security

### Code Standards
- TypeScript strict mode enabled
- 90%+ test coverage required
- ESLint and Prettier configured
- Pre-commit hooks for validation
- Security-first development practices

## Testing

### Infrastructure Tests
```bash
cd backend/infrastructure
npm test                    # Run all tests
npm run test:coverage      # Coverage report
```

### Frontend Tests
```bash
cd frontend
npm test                    # Run all tests
npm run test:coverage      # Coverage report
npm run test:ui            # Interactive test UI
```

### CI/CD Pipeline Tests
All pull requests automatically run:
- Shared-types validation
- Function unit tests with coverage
- Infrastructure TypeScript compilation
- Infrastructure tests
- Linting and format checks
- Security audits (npm audit)

## Documentation

- **[Production Setup Checklist](PRODUCTION-SETUP-CHECKLIST.md)** - Complete production deployment guide
- **[Production Deployment Guide](PRODUCTION-DEPLOYMENT-GUIDE.md)** - Detailed deployment procedures
- **[Production Security](PRODUCTION-SECURITY-DEPLOYMENT.md)** - Optional security enhancements
- **[Security Policy](SECURITY.md)** - Security practices and reporting
- **[Implementation Plan v2](../LFMT%20Implementation%20Plan%20v2.md)** - Detailed implementation roadmap
- **[Technical Architecture v2](../Long-Form%20Translation%20Service%20-%20Technical%20Architecture%20Design%20v2.0.md)** - High-level architecture

## Monitoring & Observability

### CloudWatch Dashboards
- API Gateway metrics (latency, errors, requests)
- Lambda function performance (duration, errors, throttles)
- DynamoDB metrics (read/write capacity, throttles)
- S3 storage utilization and costs

### Cost Monitoring
- AWS Budget configured ($100/month for production)
- CloudWatch alarms for cost thresholds
- Resource tagging for cost allocation
- Monthly cost reports

### Alerts (Configured)
- API Gateway error rate > 5%
- Lambda function errors > 1%
- DynamoDB throttling events

## Security

### Data Protection
- **Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Access Control**: IAM roles with least-privilege principles
- **Authentication**: Cognito with strong password policies (min 8 chars, complexity requirements)
- **Secrets Management**: AWS Secrets Manager integration (planned)
- **OIDC**: GitHub Actions uses OIDC for secure AWS access (no static credentials)

### Security Features
- Branch protection on main branch
- Required pull request reviews
- Automated security scanning (npm audit)
- Pre-push validation hooks
- Secret scanning enabled
- All production credentials redacted from documentation

### Compliance
- Legal attestation system (planned)
- Audit trails for all user actions (planned)
- 7-year data retention for legal compliance (planned)
- GDPR compliance considerations

## Cost Optimization

### Current Estimates (Monthly)
- **Development**: ~$10-20/month
- **Staging**: ~$15-30/month
- **Production**: ~$30-50/month (target for 1000 translations)

### Optimization Features
- DynamoDB on-demand billing
- S3 intelligent tiering and lifecycle policies
- Lambda ARM64 for 20% cost reduction
- API Gateway caching to reduce Lambda invocations
- Automated resource cleanup

## Deployed Environments

### Production Environment
- **AWS Region**: us-east-1
- **Stack Name**: LfmtPocProd
- **Stack Status**: CREATE_COMPLETE
- **API Endpoint**: https://YOUR_PROD_API_ID.execute-api.us-east-1.amazonaws.com/v1/
- **Cognito User Pool**: us-east-1_XXXXXXXXX
- **Cognito Client ID**: YOUR_CLIENT_ID
- **Deployment Date**: 2025-10-21

### Development Environment
- **Stack Name**: LfmtPocDev
- **API Endpoint**: https://YOUR_DEV_API_ID.execute-api.us-east-1.amazonaws.com/v1/
- **Auto-deploys**: On push to main branch

**Note**: Actual endpoint URLs and resource IDs are stored in local `.env.production` file (gitignored)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with appropriate tests (90%+ coverage required)
4. Commit your changes (`git commit -m 'feat(scope): add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request
7. Ensure all CI/CD checks pass
8. Request review from maintainers

## Support

### Getting Help
- Check documentation in root directory
- Review implementation plan for current status
- Check CloudWatch logs for runtime issues
- Verify AWS resource status in CloudFormation console

### Common Issues
- **CDK Bootstrap Required**: Run `cdk bootstrap aws://ACCOUNT/REGION`
- **Insufficient Permissions**: Ensure AWS credentials have required permissions
- **Resource Conflicts**: Check for existing resources with same names
- **PR Blocked**: Ensure all required status checks pass (see CI/CD pipeline)

## License

This is a proof-of-concept project. All rights reserved.

---

**Last Updated**: 2025-10-26
**Implementation Plan Version**: v2.0
**Current Phase**: Phase 5 - Document Chunking Service (Next)
**Overall Progress**: ~30% complete
**Repository**: https://github.com/leixiaoyu/lfmt-poc
**Branch**: `main`

## 🎯 Next Steps

### Immediate Priorities (This Week)
1. **Document Chunking Service** (P0 - Next)
   - Implement 3,500 token chunking algorithm
   - Add token counting logic
   - Handle txt file parsing
   - Unit tests for edge cases

### Short-term Goals (Next 2 Weeks)
2. **Claude API Integration** (P1)
   - Create Claude service wrapper
   - Implement rate limiting
   - Add exponential backoff
   - Test with sample chunks

3. **Translation Processing** (P2)
   - Job creation endpoint
   - Translation Lambda implementation
   - Result assembly service
   - Job polling endpoint

For detailed implementation roadmap, see [PROGRESS.md](PROGRESS.md)
