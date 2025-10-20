# LFMT POC - Long-Form Translation Service

## Overview

This is a proof-of-concept implementation of a Long-Form Translation Service that translates 65K-400K word documents using Claude Sonnet 4 API with intelligent document chunking and AWS serverless infrastructure.

## Project Status

**Current Phase**: Phase 4 - Translation Workflow UI (Ready to Start)
**Implementation Plan**: [LFMT Implementation Plan v2.md](../LFMT%20Implementation%20Plan%20v2.md)
**Overall Progress**: ~75% (4.5 of 6 phases complete)

### ✅ Completed (Phase 1 - Infrastructure) - **DEPLOYED**
- [x] Project structure and shared types (100% design document compliance)
- [x] AWS CDK infrastructure stack deployed to AWS Dev
- [x] DynamoDB tables: Jobs, Users, LegalAttestations
- [x] S3 buckets: Documents, Results (with lifecycle policies)
- [x] API Gateway with caching and rate limiting
- [x] Cognito User Pool with domain and client configuration
- [x] Infrastructure validation tests (38 test cases passing)
- [x] **AWS Stack**: LfmtPocDev (UPDATE_COMPLETE)
- [x] **API Endpoint**: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/

### ✅ Completed (Phase 2 - Backend Lambda Functions) - **DEPLOYED**
- [x] Authentication Lambda functions (4 deployed)
  - Login authentication with Cognito
  - User registration with validation
  - Token refresh functionality
  - Password reset workflow
- [x] API Gateway integration with Lambda
- [x] DynamoDB integration for user data
- [x] CloudWatch logging and monitoring
- [x] Comprehensive unit and integration tests
- [x] **CI/CD Pipeline**: GitHub Actions (active)

### ✅ Completed (Phase 3 - Frontend Authentication)
- [x] React 18 + TypeScript + Material-UI setup
- [x] Authentication components (Login, Register, Forgot Password, Protected Routes)
- [x] Auth context and service layer with token management
- [x] API client with Axios interceptors
- [x] Mock API for development (ready to replace with real backend)
- [x] Comprehensive test suite with 231 passing tests
- [x] **91.66% overall test coverage** (exceeds 90% target)
- [x] All critical components at 100% coverage
- [x] React Router v6 integration
- [x] Form validation with React Hook Form + Zod

### 🔄 Next Steps
1. [ ] Connect frontend to real AWS Cognito backend
2. [ ] End-to-end authentication testing
3. [ ] Remove mock API dependency
4. [ ] Begin Phase 4: Translation workflow UI components
   - File upload with S3 integration
   - Translation job submission
   - Progress tracking (polling-based)
   - Job history and management

## Architecture

### Core Components
- **Frontend**: React 18 + TypeScript + Material-UI + React Query
- **Backend**: AWS Lambda + API Gateway + Step Functions + ECS Fargate
- **Database**: DynamoDB with appropriate GSIs
- **Storage**: S3 with intelligent tiering and lifecycle policies
- **Authentication**: AWS Cognito with JWT tokens
- **Translation Engine**: Claude Sonnet 4 API integration

### Key Features
- **Intelligent Chunking**: 3,500-token chunks with 250-token overlap
- **Adaptive Polling**: 15s → 30s → 60s intervals for progress tracking
- **Legal Compliance**: 7-year attestation retention with audit trails
- **Cost Optimization**: <$50/month operational target for 1000 translations
- **Security**: Encryption at rest/transit, IAM least-privilege access

## Quick Start

### Prerequisites
- Node.js 18+
- AWS CLI configured
- AWS CDK v2
- Git

### Installation
```bash
# Clone repository
git clone <repository-url>
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
```

### Deployment
```bash
# Deploy infrastructure (development)
./scripts/deploy-infrastructure.sh dev

# Deploy infrastructure (staging)  
./scripts/deploy-infrastructure.sh staging

# Deploy infrastructure (production)
./scripts/deploy-infrastructure.sh prod
```

## Project Structure
```
lfmt-poc/
├── backend/
│   ├── functions/           # Lambda functions
│   ├── infrastructure/      # AWS CDK infrastructure
│   ├── shared/             # Shared backend utilities
│   ├── step-functions/      # Step Functions definitions
│   └── tests/              # Backend integration tests
├── frontend/               # React application
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── services/       # API clients
│   │   └── types/          # TypeScript interfaces
│   └── tests/              # Frontend tests
├── shared-types/           # Shared TypeScript interfaces
├── docs/                   # Documentation
└── scripts/               # Deployment and utility scripts
```

## Development Guidelines

### Git Workflow
- **Main Branch**: `main` - Production-ready code
- **Development Branch**: `develop` - Integration branch
- **Feature Branches**: `feature/description` - Individual features
- **Hotfix Branches**: `hotfix/description` - Critical fixes

### Commit Messages
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**: feat, fix, docs, style, refactor, test, chore  
**Scopes**: auth, docs, api, ui, infra, deploy

### Code Standards
- TypeScript strict mode enabled
- 95%+ test coverage required
- ESLint and Prettier configured
- Pre-commit hooks for validation

## Testing

### Infrastructure Tests
```bash
cd backend/infrastructure
npm test
```

### Shared Types Validation
```bash
cd shared-types
node validate-types.js
```

### Full Test Suite (when implemented)
```bash
# All tests
npm run test

# Coverage report
npm run test:coverage

# E2E tests
npm run test:e2e
```

## Documentation

- **[Infrastructure Setup Guide](docs/infrastructure-setup.md)** - Complete AWS deployment guide
- **[Implementation Plan v2](../LFMT%20Implementation%20Plan%20v2.md)** - Updated with CI/CD integration
- **[Design Documents](../)** - All 10 low-level design documents
- **[Technical Architecture](../Long-Form%20Translation%20Service%20-%20Technical%20Architecture%20Design%20v2.0.md)** - High-level architecture

## Monitoring & Observability

### CloudWatch Dashboards
- API Gateway metrics (latency, errors, requests)
- Lambda function performance (duration, errors, throttles)
- DynamoDB metrics (read/write capacity, throttles)
- S3 storage utilization and costs

### Alerts
- API Gateway error rate > 5%
- Lambda function errors > 1%
- Monthly costs > $60
- DynamoDB throttling events

## Security

### Data Protection
- **Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Access Control**: IAM roles with least-privilege principles
- **Authentication**: Cognito with strong password policies
- **Secrets Management**: AWS Secrets Manager integration

### Compliance
- Legal attestation system with 7-year retention
- Audit trails for all user actions
- GDPR compliance considerations
- Regular security scans and updates

## Cost Optimization

### Current Estimates (Monthly)
- **Development**: ~$10-20/month
- **Staging**: ~$15-30/month  
- **Production**: ~$30-50/month (target for 1000 translations)

### Optimization Features
- DynamoDB on-demand billing
- S3 intelligent tiering and lifecycle policies
- Lambda ARM64 for 20% cost reduction
- Automated resource cleanup

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes with appropriate tests
4. Commit your changes (`git commit -m 'feat(scope): add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## Support

### Getting Help
- Check documentation in `docs/` directory
- Review implementation plan for current status
- Check CloudWatch logs for runtime issues
- Verify AWS resource status in CloudFormation console

### Common Issues
- **CDK Bootstrap Required**: Run `cdk bootstrap aws://ACCOUNT/REGION`
- **Insufficient Permissions**: Ensure AWS credentials have required permissions
- **Resource Conflicts**: Check for existing resources with same names

## License

This is a proof-of-concept project. All rights reserved.

---

**Last Updated**: 2025-10-19
**Implementation Plan Version**: v2.0
**Current Phase**: Phase 4 - Translation Workflow UI (Ready to Start)
**Overall Progress**: ~75% complete

## 🎯 AWS Deployment Information

### Deployed Resources (Development Environment)
- **AWS Region**: us-east-1
- **Stack Name**: LfmtPocDev
- **Stack Status**: UPDATE_COMPLETE
- **API Endpoint**: https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1/
- **Cognito User Pool**: us-east-1_tyG2buO70
- **Cognito Client ID**: 4qlc7n27ptoad18k3rlj1nipg7
- **Cognito Domain**: lfmt-lfmtpocdev-ndi3mjyy

### Lambda Functions (4 Deployed)
1. `lfmt-login-LfmtPocDev` - User authentication
2. `lfmt-register-LfmtPocDev` - User registration
3. `lfmt-refresh-token-LfmtPocDev` - Token refresh
4. `lfmt-reset-password-LfmtPocDev` - Password reset

### DynamoDB Tables
1. `lfmt-jobs-LfmtPocDev` - Translation jobs
2. `lfmt-users-LfmtPocDev` - User data
3. `lfmt-attestations-LfmtPocDev` - Legal attestations

### S3 Buckets
1. `lfmt-documents-lfmtpocdev` - Document uploads
2. `lfmt-results-lfmtpocdev` - Translation results

### CI/CD Status
- **GitHub Actions**: Active and operational
- **Workflow**: `.github/workflows/deploy.yml`
- **Latest Deployment**: October 18, 2025 (successful)
- **Automated**: Deploys on push to main branch

## 🔄 Next Session Tasks

1. **Frontend-Backend Integration** (Priority 1)
   - Connect frontend to real AWS Cognito
   - Replace mock API with actual endpoints
   - Test end-to-end authentication flow

2. **Phase 4 Development** (Priority 2)
   - File upload component
   - Translation job submission UI
   - Progress tracking interface

**Repository**: https://github.com/leixiaoyu/lfmt-poc
**Branch**: `main`
