# LFMT POC - Long-Form Translation Service

## Overview

This is a proof-of-concept implementation of a Long-Form Translation Service that translates 65K-400K word documents using Google Gemini 1.5 Pro API (POC phase) with intelligent document chunking and AWS serverless infrastructure.

**For detailed implementation progress and status, see [PROGRESS.md](PROGRESS.md)**

## Architecture

### Core Components
- **Frontend**: React 18 + TypeScript + Material-UI + React Query
- **Backend**: AWS Lambda + API Gateway + Step Functions
- **Database**: DynamoDB with appropriate GSIs
- **Storage**: S3 with intelligent tiering and lifecycle policies
- **Authentication**: AWS Cognito with JWT tokens
- **Translation Engine**: Google Gemini 1.5 Pro (POC phase)
  - **Note**: Using Gemini free tier for POC to meet <$50/month cost target
  - **Future**: May upgrade to Claude Sonnet 4 for production if quality requirements increase

### Key Features
- **Intelligent Chunking**: 3,500-token chunks with 250-token overlap
- **S3 Event-Driven Architecture**: Automatic upload→chunking workflow
- **Step Functions Orchestration**: Scalable translation workflow with retry logic
- **Adaptive Polling**: 15s → 30s → 60s intervals for progress tracking
- **Legal Compliance**: 7-year attestation retention with audit trails
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
# Access at http://localhost:3000

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
│   │   ├── auth/         # Authentication functions
│   │   ├── jobs/         # Job management functions
│   │   ├── chunking/     # Document chunking functions
│   │   └── translation/  # Translation engine functions
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
npm test                    # Run all unit tests (499 tests)
npm run test:coverage      # Coverage report (99% on translation components)
npm run test:ui            # Interactive test UI
npm run test:e2e           # Run E2E tests (58 tests, requires local dev server)
npm run test:e2e:ui        # Interactive E2E testing with Playwright UI
```

### CI/CD Pipeline Tests
All pull requests automatically run:
- Shared-types validation (11 tests)
- Backend function unit tests (328 tests)
- Infrastructure tests (33 tests)
- Frontend unit tests (499 tests)
- Linting and format checks
- Security audits (npm audit)
- E2E tests (temporarily disabled - requires backend API or mock API setup)
- Pre-push validation hooks enforce local testing

## Documentation

### Core Documentation
- **[PROGRESS.md](PROGRESS.md)** - Detailed implementation status and progress tracking
- **[TESTING-GUIDE.md](TESTING-GUIDE.md)** - Comprehensive local testing guide (unit, integration, E2E)
- **[DEVELOPMENT-ROADMAP.md](DEVELOPMENT-ROADMAP.md)** - Project roadmap and priorities
- **[Production Setup Checklist](PRODUCTION-SETUP-CHECKLIST.md)** - Complete production deployment guide
- **[Production Deployment Guide](PRODUCTION-DEPLOYMENT-GUIDE.md)** - Detailed deployment procedures
- **[Production Security](PRODUCTION-SECURITY.md)** - Optional security enhancements
- **[Security Policy](SECURITY.md)** - Security practices and reporting
- **[API Reference](API-REFERENCE.md)** - API endpoint documentation
- **[Testing Strategy](TESTING.md)** - Comprehensive testing guidelines
- **[frontend/e2e/README.md](frontend/e2e/README.md)** - E2E testing with Playwright guide

### External References
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
- **Secrets Management**: AWS Secrets Manager integration
- **OIDC**: GitHub Actions uses OIDC for secure AWS access (no static credentials)

### Security Features
- Branch protection on main branch
- Required pull request reviews
- Automated security scanning (npm audit)
- Pre-push validation hooks
- Secret scanning enabled
- All production credentials redacted from documentation

### Compliance
- Legal attestation system
- Audit trails for all user actions
- 7-year data retention for legal compliance
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
- **API Endpoint**: https://YOUR_PROD_API_ID.execute-api.us-east-1.amazonaws.com/v1/
- **Cognito User Pool**: us-east-1_XXXXXXXXX
- **Cognito Client ID**: YOUR_CLIENT_ID

**Note**: Actual endpoint URLs and resource IDs are stored in local `.env.production` file (gitignored)

### Development Environment
- **Stack Name**: LfmtPocDev
- **API Endpoint**: https://YOUR_DEV_API_ID.execute-api.us-east-1.amazonaws.com/v1/
- **Auto-deploys**: On push to main branch

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
- Review [PROGRESS.md](PROGRESS.md) for current implementation status
- Review [DEVELOPMENT-ROADMAP.md](DEVELOPMENT-ROADMAP.md) for project priorities
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

**Last Updated**: 2025-11-20
**Repository**: https://github.com/leixiaoyu/lfmt-poc
**Current Status**: See [PROGRESS.md](PROGRESS.md) for detailed status
