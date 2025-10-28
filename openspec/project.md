# Project Context

## Purpose

LFMT POC (Long-Form Translation Service) is a proof-of-concept serverless application that translates extremely long documents (65K-400K words) from Project Gutenberg using Claude Sonnet 4 API. The system addresses the key technical challenge of processing documents that exceed LLM context windows through intelligent chunking and reassembly strategies.

**Key Goals**:
- Translate documents within Claude Sonnet 4's 200K token context window
- Maintain translation coherence across chunks using sliding window context
- Provide cost-effective solution (<$50/month for 1000 translations)
- Ensure legal compliance with 7-year attestation retention
- Deliver production-ready architecture despite POC status

**Current Status**: Phase 5 - Document Chunking Service (Next) | ~30% Complete
- ✅ Infrastructure (AWS CDK, DynamoDB, S3, API Gateway, Cognito)
- ✅ Authentication (Backend Lambda + Frontend React)
- ✅ Document Upload Service (S3 presigned URLs, file validation)
- 🔄 Document Chunking Service (In Progress)
- ⏳ Translation Engine (Claude API integration)
- ⏳ Legal Attestation System

## Tech Stack

### Frontend
- **Framework**: React 18 with TypeScript (strict mode)
- **UI Library**: Material-UI (MUI) v5
- **Routing**: React Router v6
- **Build Tool**: Vite
- **Form Management**: React Hook Form + Zod validation
- **HTTP Client**: Axios with interceptors (auto token refresh)
- **Testing**: Vitest + React Testing Library (91.66% coverage)
- **E2E Testing**: Playwright

### Backend
- **Infrastructure**: AWS CDK v2 (TypeScript)
- **Compute**:
  - AWS Lambda (Node.js 18, ARM64 for 20% cost savings)
  - ECS Fargate (planned for long-running translation jobs)
- **API**: API Gateway REST API with JWT authorizers
- **Database**: DynamoDB (on-demand billing)
  - Tables: Jobs, Users, LegalAttestations
  - GSIs for efficient querying
- **Storage**: S3 with intelligent tiering and lifecycle policies
  - Buckets: Documents, Results
- **Authentication**: AWS Cognito User Pool
  - JWT tokens with automatic refresh
  - Strong password policy (min 8 chars, complexity requirements)
- **Orchestration**: AWS Step Functions (planned for translation workflow)

### Translation Engine
- **LLM Provider**: Claude Sonnet 4 API (Anthropic)
- **Chunking Strategy**: 3,500 tokens primary + 250 tokens overlap
- **Rate Limiting**: 45 req/min, 405K input tokens/min, 81K output tokens/min
- **Supported Languages**: Spanish, French, Italian, German, Chinese

### Shared Infrastructure
- **Monorepo Tool**: npm workspaces
- **Package Manager**: npm 8+
- **Node Version**: 18+ (LTS)
- **Shared Types**: `@lfmt/shared-types` package for type safety

### DevOps & CI/CD
- **CI/CD**: GitHub Actions
  - Automated testing on PRs
  - Auto-deploy to dev on main branch push
  - Manual workflow dispatch for staging/production
- **IaC**: AWS CDK with multi-environment support (dev/staging/prod)
- **Authentication**: OIDC (no static AWS credentials)
- **Security**: Branch protection, pre-push hooks, npm audit
- **Monitoring**: CloudWatch (logs, metrics, dashboards)

## Project Conventions

### Code Style

**TypeScript**:
- Strict mode enabled across all packages
- Explicit return types for exported functions
- No `any` types (use `unknown` or proper types)
- Prefer interfaces over types for object shapes
- Use `const` for immutable values, `let` only when necessary

**Naming Conventions**:
- **Components**: PascalCase (e.g., `LoginForm`, `ProtectedRoute`)
- **Files**: kebab-case for utilities, PascalCase for React components
- **Functions/Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE for true constants
- **Interfaces**: PascalCase with `I` prefix for props (e.g., `ILoginFormProps`)
- **Types**: PascalCase
- **Lambda Functions**: kebab-case directory names (e.g., `auth/login`)

**Formatting**:
- ESLint + Prettier configured
- 2-space indentation
- Single quotes for strings
- Trailing commas in objects/arrays
- Max line length: 100 characters

**React Conventions**:
- Functional components only (no class components)
- Custom hooks prefixed with `use` (e.g., `useAuth`, `useUpload`)
- Context providers in `/contexts` directory
- Services layer for API calls (no direct axios in components)
- Protected routes use `ProtectedRoute` wrapper component

### Architecture Patterns

**Backend (Serverless)**:
- **Lambda Design**: Single responsibility per function
- **Error Handling**: Structured error responses with HTTP status codes
- **Validation**: Input validation on all Lambda handlers
- **Security**: IAM least-privilege access, no hardcoded credentials
- **Logging**: Structured JSON logs for CloudWatch
- **Environment Variables**: Stack-specific configuration via CDK context

**Frontend (SPA)**:
- **Component Structure**: Atomic design (atoms → molecules → organisms → pages)
- **State Management**: React Context API for global state (auth, upload)
- **API Layer**: Centralized service classes with error handling
- **Auth Flow**: JWT tokens with automatic refresh on 401 errors
- **Request Queuing**: Failed requests retry after token refresh
- **Form Validation**: Zod schemas for type-safe validation

**Infrastructure (IaC)**:
- **Multi-Environment**: Dev, Staging, Production via CDK context
- **Stack Organization**: Logical constructs (Database, API, Auth, Storage)
- **Resource Naming**: `{StackName}-{Resource}-{Environment}` pattern
- **Tagging**: Consistent tags (Environment, Project, ManagedBy)
- **Cost Optimization**: ARM64 Lambda, on-demand DynamoDB, S3 lifecycle policies

**Translation Processing** (Planned):
- **Chunking**: Sliding window approach with 250-token overlap
- **Context Management**: Last 2 chunks provide context for next translation
- **Rate Limiting**: Exponential backoff for Claude API
- **Progress Tracking**: Polling-based architecture (15s → 30s → 60s intervals)

### Testing Strategy

**Coverage Requirements**:
- **Minimum**: 90% overall coverage (enforced)
- **Critical Paths**: 100% coverage (auth, upload, chunking)
- **Current Status**: 91.66% frontend, 100% critical components

**Test Types**:
1. **Unit Tests**:
   - All business logic functions
   - React components with user interactions
   - Lambda handlers with mocked AWS SDK
   - Utility functions and helpers

2. **Integration Tests**:
   - API Gateway → Lambda → DynamoDB flows
   - Frontend → Backend authentication flows
   - File upload end-to-end (presigned URL → S3)

3. **Infrastructure Tests**:
   - CDK stack synthesis validation
   - Resource property verification
   - IAM policy compliance checks
   - 20 infrastructure test cases passing

4. **E2E Tests** (Planned):
   - Playwright for critical user flows
   - Authentication workflows
   - Document upload and translation

**Test Organization**:
- Frontend: `__tests__/` directory alongside components
- Backend: `*.test.ts` files alongside Lambda handlers
- Infrastructure: `/test` directory in CDK package
- Shared: Vitest for all TypeScript testing

**Mocking Strategy**:
- AWS SDK calls always mocked in unit tests
- API calls mocked with axios-mock-adapter
- React Testing Library for component testing (no Enzyme)

### Git Workflow

**Branch Strategy**:
- **`main`**: Production-ready code with branch protection
- **Feature Branches**: `feature/description` (e.g., `feature/document-chunking`)
- **Fix Branches**: `fix/issue-description`
- **Chore Branches**: `chore/task-description`

**Branch Protection Rules** (main):
- ✅ Require pull request before merging
- ✅ Require status checks to pass (Run Tests, Build Infrastructure)
- ✅ Require conversation resolution
- ✅ No direct pushes allowed
- ✅ Enforce linear history

**Commit Message Convention**:
```
<type>(<scope>): <subject>

<optional body>

<optional footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `ci`: CI/CD pipeline changes

**Scopes**:
- `auth`: Authentication/authorization
- `api`: API Gateway/endpoints
- `ui`: Frontend components
- `infra`: Infrastructure/CDK
- `deploy`: Deployment scripts
- `security`: Security-related changes
- `upload`: Document upload functionality
- `chunking`: Document chunking logic
- `translation`: Translation engine

**Examples**:
- `feat(upload): add S3 presigned URL generation`
- `fix(auth): handle token refresh on 401 errors`
- `docs(readme): update deployment instructions`
- `test(chunking): add edge case tests for token counting`

**CI/CD Automation**:
- All PRs trigger automated testing
- Main branch push auto-deploys to dev environment
- Staging/Production deployments via manual workflow dispatch
- Pre-push hooks validate tests and types locally

## Domain Context

**Translation Processing**:
- **Document Sources**: Project Gutenberg public domain books
- **Input Format**: Plain text (.txt files)
- **Output Format**: Translated text files
- **Chunk Size**: 3,500 tokens (primary content) + 250 tokens (context overlap)
- **Token Counting**: Claude's tokenizer (not standard word count)
- **Context Window**: 200K tokens (Claude Sonnet 4 limit)
- **Processing Time**: 30-60 min (65K words) to 2-6 hours (400K words)

**Legal Compliance**:
- **Copyright Attestation**: Users must confirm ownership/rights
- **Retention Period**: 7 years for legal attestations
- **Audit Trail**: IP tracking, document hashing, timestamp logging
- **Storage**: DynamoDB (7-year TTL) + S3 Glacier for archival

**Cost Modeling**:
- **Target**: <$0.05 per 100K word document
- **Monthly Budget**: <$50 for 1000 translations
- **Primary Cost Driver**: Claude API calls (~$0.02-0.04 per 100K words)
- **Optimization**: ARM64 Lambda (20% savings), S3 lifecycle policies

**Rate Limiting**:
- **Claude API Limits**:
  - 45 requests per minute
  - 405K input tokens per minute
  - 81K output tokens per minute
- **Strategy**: Exponential backoff with jitter
- **Queue Management**: DynamoDB-based job queue (planned)

## Important Constraints

**Technical Constraints**:
- **Context Window**: Claude Sonnet 4 limited to 200K tokens
- **File Size**: Documents up to 400K words (~500K tokens)
- **Chunking Overhead**: 250-token overlap reduces effective throughput
- **API Rate Limits**: Must respect Claude API throttling
- **Cold Start**: Lambda functions have 1-3 second cold start latency

**Business Constraints**:
- **POC Status**: Production-ready architecture but limited feature set
- **Budget**: <$50/month operational cost target
- **No Revenue Model**: Free service for POC (no payment processing)
- **Single User**: No multi-tenancy considerations for POC

**Regulatory/Legal Constraints**:
- **Copyright Compliance**: Required legal attestation before processing
- **Data Retention**: 7-year retention for audit purposes
- **Privacy**: No personally identifiable information (PII) stored
- **GDPR Considerations**: Data deletion on user request (planned)

**Security Constraints**:
- **No Static Credentials**: OIDC authentication for CI/CD
- **Encryption**: AES-256 at rest, TLS 1.3 in transit
- **Secret Scanning**: Automated checks prevent credential leaks
- **IAM Policies**: Least-privilege access for all resources
- **No MFA**: Not enabled for POC (recommended for production)

**Development Constraints**:
- **Node Version**: 18+ required (LTS)
- **AWS Account**: Single AWS account for all environments
- **Region**: us-east-1 only (multi-region not supported)
- **Test Coverage**: 90% minimum enforced by CI/CD

## External Dependencies

**Cloud Services (AWS)**:
- **AWS CDK**: Infrastructure as code framework
- **API Gateway**: REST API with caching and rate limiting
- **Lambda**: Serverless compute (Node.js 18 runtime)
- **DynamoDB**: NoSQL database with on-demand billing
- **S3**: Object storage with intelligent tiering
- **Cognito**: User authentication and JWT tokens
- **CloudWatch**: Logging, metrics, and dashboards
- **Step Functions**: Workflow orchestration (planned)
- **ECS Fargate**: Long-running translation jobs (planned)
- **Secrets Manager**: API key storage (planned)

**AI/ML Services**:
- **Anthropic Claude API**: Sonnet 4 model for translations
  - API Endpoint: `https://api.anthropic.com/v1/messages`
  - Authentication: API key in headers
  - Rate Limits: See Domain Context section

**Third-Party Libraries**:
- **React Ecosystem**: react, react-dom, react-router-dom
- **UI Framework**: Material-UI (MUI) v5
- **HTTP Client**: axios (with interceptors)
- **Form Validation**: react-hook-form, zod
- **Testing**: vitest, @testing-library/react, playwright
- **Build Tools**: vite, typescript, esbuild

**Development Tools**:
- **GitHub Actions**: CI/CD automation
- **ESLint/Prettier**: Code quality and formatting
- **npm**: Package management and workspaces
- **Git Hooks**: Pre-push validation scripts

**Documentation**:
- **Obsidian Vault**: Project requirements and architecture docs
- **Markdown**: All documentation in `.md` format
- **Mermaid**: Diagrams in documentation (planned)
