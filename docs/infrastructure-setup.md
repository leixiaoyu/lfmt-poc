# LFMT Infrastructure Setup Guide

## Overview

This guide covers the complete setup of AWS infrastructure for the Long-Form Translation Service (LFMT) POC, implementing the specifications from our low-level design documents.

## Architecture Components

### Core Services Deployed

1. **DynamoDB Tables** (Document 7: Job State Management)
   - `lfmt-jobs-{env}`: Translation job tracking with progress state
   - `lfmt-users-{env}`: User profile and preference management  
   - `lfmt-attestations-{env}`: Legal attestation records (7-year retention)

2. **S3 Buckets** (Documents 3, 6)
   - `lfmt-documents-{env}`: Source document upload and storage
   - `lfmt-results-{env}`: Translated document output with intelligent tiering

3. **API Gateway** (Document 3: API Gateway & Lambda Functions)
   - RESTful API with caching enabled (30-second TTL)
   - CORS configured for frontend integration
   - Rate limiting: 100 req/sec with 200 burst

4. **Cognito User Pool** (Document 10: User Management & Authentication)
   - Email-based authentication with strong password policy
   - Self-signup and email verification enabled
   - JWT tokens with 1-hour access token validity

5. **CloudWatch Log Groups**
   - Centralized logging for all services
   - 30-day retention for cost optimization

6. **IAM Roles and Policies**
   - Least-privilege access patterns
   - Service-specific roles for Lambda and Step Functions

## Prerequisites

### Required Software
- AWS CLI v2 (`aws --version`)
- Node.js 18+ (`node --version`)
- AWS CDK v2 (`cdk --version`)
- Git (`git --version`)

### AWS Account Setup
1. **AWS Account** with appropriate permissions
2. **AWS CLI configured** with credentials
   ```bash
   aws configure
   # OR
   aws configure --profile lfmt-poc
   ```
3. **CDK Bootstrap** (automatic in deployment script)

## Deployment Process

### Method 1: Automated Deployment (Recommended)

```bash
# Development environment
./scripts/deploy-infrastructure.sh dev us-east-1 default

# Staging environment  
./scripts/deploy-infrastructure.sh staging us-east-1 default

# Production environment
./scripts/deploy-infrastructure.sh prod us-east-1 production-profile
```

### Method 2: Manual Deployment

```bash
cd backend/infrastructure

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run infrastructure tests
npm test

# Synthesize CloudFormation
cdk synth --context environment=dev

# Deploy
cdk deploy --context environment=dev
```

## Configuration Options

### Environment-Specific Settings

| Environment | Stack Name | Retain Data | Logging | Description |
|------------|------------|-------------|---------|-------------|
| `dev` | LfmtPocDev | No | Yes | Development environment |
| `staging` | LfmtPocStaging | Yes | Yes | Staging environment |  
| `prod` | LfmtPocProd | Yes | Yes | Production environment |

### Cost Optimization Features

1. **DynamoDB**: Pay-per-request billing mode
2. **S3**: Intelligent tiering and lifecycle policies
   - Documents: 90-day retention → deletion
   - Results: 7 days → IA → 14 days → Glacier → 30 days → deletion
3. **API Gateway**: Regional endpoints (lower cost than edge-optimized)
4. **CloudWatch**: 30-day log retention

## Security Features

### Data Protection
- **Encryption at Rest**: All DynamoDB tables and S3 buckets
- **Encryption in Transit**: TLS 1.3 for all API communication
- **Access Control**: IAM roles with least-privilege principles

### S3 Security
- **Public Access Blocked**: All buckets deny public access
- **Versioning**: Enabled on document bucket for data protection
- **CORS**: Configured for secure frontend integration

### API Security
- **Cognito Integration**: JWT-based authentication
- **Rate Limiting**: 100 requests/second with burst capacity
- **Request Validation**: Schema validation enabled

## Monitoring and Observability

### CloudWatch Metrics
- **DynamoDB**: Read/write capacity utilization
- **S3**: Object count, storage utilization
- **API Gateway**: Request count, latency, error rates
- **Cognito**: Sign-up and sign-in metrics

### Log Groups
- `/aws/apigateway/lfmt-api-{env}`: API Gateway access logs
- `/aws/lambda/lfmt-{env}`: Lambda function logs
- `/aws/stepfunctions/lfmt-{env}`: Step Functions execution logs

## Post-Deployment Validation

### 1. Verify Stack Deployment
```bash
aws cloudformation describe-stacks --stack-name LfmtPocDev
```

### 2. Test DynamoDB Tables
```bash
aws dynamodb describe-table --table-name lfmt-jobs-dev
aws dynamodb describe-table --table-name lfmt-users-dev
aws dynamodb describe-table --table-name lfmt-attestations-dev
```

### 3. Test S3 Buckets
```bash
aws s3 ls s3://lfmt-documents-dev/
aws s3 ls s3://lfmt-results-dev/
```

### 4. Test API Gateway
```bash
# Get API URL from stack outputs
API_URL=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

# Test API health
curl -X GET "$API_URL/health"
```

### 5. Test Cognito User Pool
```bash
# Get User Pool ID
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name LfmtPocDev \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

# Describe user pool
aws cognito-idp describe-user-pool --user-pool-id $USER_POOL_ID
```

## Stack Outputs Reference

The infrastructure deployment provides these outputs for use by other components:

| Output Key | Description | Used By |
|------------|-------------|---------|
| `JobsTableName` | DynamoDB jobs table | Lambda functions |
| `UsersTableName` | DynamoDB users table | Authentication Lambda |
| `AttestationsTableName` | DynamoDB attestations table | Legal compliance Lambda |
| `DocumentBucketName` | S3 document upload bucket | File upload Lambda |
| `ResultsBucketName` | S3 results bucket | Translation output Lambda |
| `UserPoolId` | Cognito User Pool ID | Frontend authentication |
| `UserPoolClientId` | Cognito Client ID | Frontend authentication |
| `ApiUrl` | API Gateway base URL | Frontend API calls |
| `ApiId` | API Gateway ID | Lambda function integration |

## Environment Variables

Set these environment variables in your Lambda functions:

```bash
# From stack outputs
export JOBS_TABLE_NAME="lfmt-jobs-dev"
export USERS_TABLE_NAME="lfmt-users-dev"
export ATTESTATIONS_TABLE_NAME="lfmt-attestations-dev"
export DOCUMENT_BUCKET_NAME="lfmt-documents-dev"
export RESULTS_BUCKET_NAME="lfmt-results-dev"
export USER_POOL_ID="us-east-1_xxxxxxxxx"
export API_URL="https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/v1"

# Service configuration
export AWS_REGION="us-east-1"
export NODE_ENV="development"
export LOG_LEVEL="info"
```

## Troubleshooting

### Common Issues

1. **CDK Bootstrap Required**
   ```bash
   cdk bootstrap aws://ACCOUNT-ID/REGION
   ```

2. **Insufficient Permissions**
   - Ensure AWS credentials have CloudFormation, DynamoDB, S3, API Gateway, Cognito, and IAM permissions

3. **Stack Already Exists**
   ```bash
   # Show differences
   cdk diff --context environment=dev
   
   # Force update
   cdk deploy --context environment=dev --force
   ```

4. **Resource Name Conflicts**
   - Ensure unique environment names
   - Check for existing resources with same names

### Rollback Procedure

```bash
# Delete stack (will retain data if retainData=true)
cdk destroy --context environment=dev

# Or use AWS CLI
aws cloudformation delete-stack --stack-name LfmtPocDev
```

### Stack Events
```bash
# Monitor deployment progress
aws cloudformation describe-stack-events --stack-name LfmtPocDev
```

## Cost Estimation

### Development Environment (Monthly)
- **DynamoDB**: ~$2-5 (pay-per-request)
- **S3**: ~$1-3 (with lifecycle policies)  
- **API Gateway**: ~$3-10 (based on requests)
- **CloudWatch**: ~$1-2 (logs and metrics)
- **Cognito**: Free tier (up to 50,000 MAUs)

**Total: ~$7-20/month for development**

### Production Scaling Considerations
- Enable DynamoDB Auto Scaling for consistent performance
- Consider API Gateway caching for high-traffic endpoints
- Implement CloudFront for global content delivery
- Add more restrictive lifecycle policies

## Next Steps

1. **✅ Infrastructure deployed**
2. **🔄 Deploy Lambda functions** (Phase 1, Milestone 1.2)
3. **🔄 Configure Step Functions workflows** (Phase 3)
4. **🔄 Deploy frontend application** (Phase 4)
5. **🔄 End-to-end testing** (Phase 5)

## Support

For infrastructure issues:
1. Check CloudFormation events for deployment errors
2. Verify AWS service limits haven't been exceeded
3. Review IAM permissions for the deployment role
4. Check CloudWatch logs for runtime errors

## Security Considerations

### Production Hardening
- [ ] Restrict API Gateway CORS to specific origins
- [ ] Enable AWS Config for compliance monitoring
- [ ] Set up AWS GuardDuty for threat detection
- [ ] Configure VPC endpoints for private API access
- [ ] Enable CloudTrail for audit logging
- [ ] Implement AWS WAF for API protection

### Data Protection
- [ ] Enable S3 MFA delete for production buckets
- [ ] Configure S3 cross-region replication for disaster recovery
- [ ] Set up DynamoDB point-in-time recovery
- [ ] Implement database encryption at rest with customer-managed keys