# CORS Resolution Plan: A Systematic Approach

**Objective:** To definitively identify and resolve all outstanding CORS issues, unblocking the end-to-end user journey. This is a P0 initiative to be executed immediately.

**Owner:** Team Lead / Senior Staff Engineer

---

### Introduction

The team has been blocked by persistent CORS (Cross-Origin Resource Sharing) errors. This indicates a misconfiguration somewhere in the request lifecycle between our frontend (CloudFront) and our backend (API Gateway/Lambda). This plan outlines a systematic, multi-layered approach to validate our infrastructure, diagnose the precise point of failure, and implement a permanent fix. We will move from trial-and-error to a methodical process.

---

### Phase 1: Full-Stack Infrastructure Validation

This phase verifies the deployed backend infrastructure from the command line, bypassing the browser to confirm our AWS configuration is correct.

- **Step 1.1: Validate API Gateway Preflight Configuration**
  - **Purpose:** To simulate a browser's preflight `OPTIONS` request and check if API Gateway is configured to respond correctly to cross-origin requests from our deployed frontend.
  - **Action:** Execute the following `curl` command in your terminal.

    ```sh
    # Replace with actual dev environment URLs if they have changed
    CLOUDFRONT_URL="https://d39xcun7144jgl.cloudfront.net"
    API_GATEWAY_URL="https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1"

    echo "Testing preflight for POST /jobs/upload..."
    curl -i -X OPTIONS ${API_GATEWAY_URL}/jobs/upload \
      -H "Origin: ${CLOUDFRONT_URL}" \
      -H "Access-Control-Request-Method: POST" \
      -H "Access-Control-Request-Headers: authorization,content-type"
    ```

  - **Success Criteria:** The response headers **must** include `Access-Control-Allow-Origin: https://d39xcun7144jgl.cloudfront.net` and `Access-Control-Allow-Methods` that includes `POST`.
  - **Implication:** If this fails, the problem is in our CDK infrastructure code (`lfmt-infrastructure-stack.ts`), specifically the API Gateway's `defaultCorsPreflightOptions`.

- **Step 1.2: Validate Lambda Response Headers**
  - **Purpose:** To make a direct, authenticated API call to a protected endpoint to ensure the Lambda function itself is returning the correct CORS headers in its final response.
  - **Action:** Obtain a valid ID token for a test user and execute the following `curl` command.

    ```sh
    # Replace with actual dev environment URLs and a valid token
    CLOUDFRONT_URL="https://d39xcun7144jgl.cloudfront.net"
    API_GATEWAY_URL="https://8brwlwf68h.execute-api.us-east-1.amazonaws.com/v1"
    ID_TOKEN="<PASTE_VALID_ID_TOKEN_HERE>"

    echo "Testing GET request to /jobs/some-job-id/translation-status..."
    curl -i -X GET ${API_GATEWAY_URL}/jobs/some-job-id/translation-status \
      -H "Origin: ${CLOUDFRONT_URL}" \
      -H "Authorization: Bearer ${ID_TOKEN}"
    ```

  - **Success Criteria:** The response headers **must** include `Access-Control-Allow-Origin: https://d39xcun7144jgl.cloudfront.net`.
  - **Implication:** If this fails, the problem is in the specific Lambda's response generation logic (likely the `api-response.ts` helper or how it's being used).

---

### Phase 2: Frontend Diagnosis

If Phase 1 passes, the backend is correctly configured, and the issue lies with the client-side application.

- **Step 2.1: Capture the Exact Failing Request**
  - **Action:** Use the browser's Developer Tools (Network tab) on the deployed CloudFront site (`https://d39xcun7144jgl.cloudfront.net`) to capture the _exact_ details of the first request that fails due to CORS.
  - **Information to Capture and Document:**
    1.  **Request URL & Method:** The full URL and HTTP method (`OPTIONS`, `POST`, etc.).
    2.  **Request Headers:** A screenshot or list of all headers sent by the browser, especially `Origin`, `Access-Control-Request-Method`, and `Access-Control-Request-Headers`.
    3.  **Console Error:** The precise, verbatim error message from the browser console.

- **Step 2.2: Replicate in Isolation**
  - **Action:** Use the data from Step 2.1 to build a `curl` command that perfectly mimics the failing browser request.
  - **Implication:** If this `curl` command succeeds while the browser fails, it proves the backend is correct. The issue is then specific to the frontend's code (e.g., a library issue) or a browser security policy like CSP (Content Security Policy).

---

### Phase 3: Targeted Resolution & Prevention

Based on the diagnosis, we will execute one of the following targeted fixes.

- **Scenario A: Preflight `OPTIONS` Request Fails (Phase 1.1 Failure)**
  - **Fix:** Modify `backend/infrastructure/lib/lfmt-infrastructure-stack.ts`. Review the `defaultCorsPreflightOptions` for our API Gateway. Ensure `allowOrigins` contains the correct CloudFront URL, `allowMethods` includes the failing method, and `allowHeaders` includes all headers the client is sending (e.g., `Content-Type`, `Authorization`). Deploy the infrastructure change and re-run validation.

- **Scenario B: Lambda Response Header is Missing (Phase 1.2 Failure)**
  - **Fix:** Modify the relevant Lambda function (e.g., `getTranslationStatus.ts`). Ensure it correctly extracts the `origin` from the request headers and passes it to the `api-response.ts` helper. Add a specific unit test to assert the presence of the `Access-Control-Allow-Origin` header in the response.

- **Scenario C: Frontend Request is the Issue (Phase 2 Discrepancy)**
  - **Fix:** Modify the relevant frontend service file (e.g., `frontend/src/services/translationService.ts`). Compare the request being built by `axios` with the failing request from the browser's network tab. Adjust the frontend code to align with what the backend's CORS policy allows (e.g., remove a non-standard header).

### Final Deliverable: Prevention

To prevent this issue in the future, a new document will be created.

- **File:** `CORS-DEBUGGING-GUIDE.md`
- **Content:** This guide will contain the systematic `curl`-based validation steps from Phase 1. It will serve as a permanent, reusable playbook for any developer to quickly and reliably diagnose CORS issues, preventing the team from "spinning in circles" again.
