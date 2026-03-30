# Production Smoke Tests

Lightweight smoke tests to verify critical functionality in production and staging environments.

## Overview

These tests cover:
- ✅ **Health Check**: API reachability, CORS configuration, response times
- ✅ **Authentication Flow**: Register → Login → getCurrentUser
- ✅ **Upload Flow**: Presigned URL request
- ✅ **Translation Status**: Job status and translation status polling
- ✅ **Error Handling**: Invalid requests, malformed payloads, resilience

## Usage

### Prerequisites

```bash
cd backend/tests/smoke
npm install
```

### Running Tests

**Against Dev Environment:**
```bash
API_URL=https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1 npm test
```

**Against Production Environment:**
```bash
API_URL=https://api.production.example.com npm test
```

**Against Local Development:**
```bash
API_URL=http://localhost:3000/api npm test
```

### Environment Variables

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `API_URL` | ✅ Yes | Base URL of the API to test | `https://api.example.com` |

## Test Coverage

### Health Check & API Reachability
- API is reachable and responding
- CORS headers are present
- Critical endpoints are available
- Response times are acceptable (<5s)

### Authentication Flow
- Register new user
- Login with credentials
- Get current user info with access token
- Reject requests without valid token

### Upload Presigned URL Request
- Request presigned upload URL
- Reject upload without authentication
- Reject invalid upload payloads

### Translation Status Polling
- Poll job status
- Poll translation status
- Reject unauthenticated status requests
- Reject requests for non-existent jobs
- Handle rapid sequential polls

### Error Handling & Resilience
- Handle invalid endpoints gracefully
- Handle malformed JSON payloads
- Return proper error messages

## CI/CD Integration

Add to GitHub Actions workflow:

```yaml
- name: Run Smoke Tests
  env:
    API_URL: ${{ secrets.API_URL }}
  run: |
    cd backend/tests/smoke
    npm install
    npm test
```

## Best Practices

1. **Keep Tests Fast**: Smoke tests should complete in <2 minutes
2. **Use Unique Test Data**: Each test run generates unique test users
3. **Don't Clean Up**: Leave test data for debugging (use unique IDs)
4. **Parameterize API URL**: Always use `API_URL` env var
5. **Test Real Endpoints**: Don't mock - test actual API

## Troubleshooting

### Error: "API_URL environment variable is required"
Set the `API_URL` environment variable before running tests.

### Error: "ECONNREFUSED"
The API is not reachable. Check:
- API URL is correct
- API is deployed and running
- Network/firewall allows connections

### Error: "Timeout"
The API is responding too slowly. Check:
- Lambda cold starts (first request may be slow)
- Network latency
- API Gateway configuration

### Tests Failing on Authentication
Check:
- Cognito User Pool configuration
- Auto-confirm is enabled for test emails
- Password policy allows test passwords

## Maintenance

- Update tests when API changes
- Review test timeouts periodically
- Keep dependencies up to date
- Monitor test execution time

## Contact

For issues or questions, see [Issue #57](https://github.com/leixiaoyu/lfmt-poc/issues/57).
