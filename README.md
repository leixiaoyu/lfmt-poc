# LFMT POC - Long-Form Translation Service

## Overview

This is a proof-of-concept implementation of a Long-Form Translation Service that translates 65K-400K word documents using Claude Sonnet 4 API with intelligent document chunking and AWS serverless infrastructure.

## Project Status

**Current Phase**: Phase 1 - Foundation & Core Infrastructure  
**Implementation Plan**: [LFMT Implementation Plan v2.md](../LFMT%20Implementation%20Plan%20v2.md)

### ✅ Completed
- [x] Project structure and shared types (100% design document compliance)
- [x] AWS CDK infrastructure stack with comprehensive validation
- [x] DynamoDB tables for jobs, users, and legal attestations  
- [x] S3 buckets with lifecycle policies and security
- [x] API Gateway with caching and rate limiting
- [x] Cognito User Pool configuration
- [x] Infrastructure validation tests (38 test cases)
- [x] Git repository initialization

### 🔄 In Progress  
- [ ] AWS deployment and verification
- [ ] CI/CD pipeline setup
- [ ] Authentication Lambda functions

### 📋 Next Steps
- [ ] Deploy infrastructure to AWS dev environment
- [ ] Set up GitHub Actions CI/CD pipeline
- [ ] Implement user authentication system
- [ ] Build document processing engine

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

**Last Updated**: $(date)  
**Implementation Plan Version**: v2.0  
**Current Phase**: Phase 1 - Foundation & Core Infrastructure