# Design & Implementation Plan: M1.1 - Translation History Page

> **Implementation status**: The shipped implementation at [`frontend/src/pages/TranslationHistory.tsx`](../../frontend/src/pages/TranslationHistory.tsx) uses `useEffect` + `useState` rather than the `react-query` (`useQuery`) approach this design doc specified. Migrating to `react-query` is a follow-up cleanup item (issue TBD).

**To:** LFMT Development Team
**From:** Senior Staff Engineer / Team Lead
**Date:** 2025-11-30
**Subject:** Implementation Plan for Milestone 1.1: Results Management UI

---

## 1. Objective

This document outlines the technical plan for implementing the "Translation History" page. This is the first major feature in our "Frontend Delivery" phase and will establish key patterns for all subsequent UI development.

- **User Story:** As a logged-in user, I want to see a history of all my past and current translation jobs so that I can track their status and access the results.

- **Acceptance Criteria:**
  - A user can navigate to a "History" page.
  - The page displays a loading indicator while jobs are being fetched.
  - If an error occurs, a clear error message is displayed.
  - If the user has no jobs, a clear "empty state" message is shown.
  - If the user has jobs, they are displayed in a table with key information.
  - Each job entry links to its (future) detail page.

---

## 2. Key Technical Decisions

To ensure quality, consistency, and maintainability, the implementation of this feature **must** adhere to the following technical decisions.

1.  **State Management:** All server state (fetching the list of jobs) **must** be managed using the **`react-query`** library (`useQuery` hook). A manual implementation using `useEffect` and `useState` is not acceptable, as `react-query` provides caching, automatic refetching, and simplified state management (loading, error, data) out of the box.

2.  **UI Components:** All UI elements **must** be built using our existing **Material-UI** component library to maintain visual consistency. Key components will include `Table`, `TableBody`, `TableCell`, `TableContainer`, `TableHead`, `TableRow`, `Paper`, `Chip`, `CircularProgress`, and `Typography`.

---

## 3. Implementation Playbook (Step-by-Step)

### Step 3.1: Backend API Contract

The frontend will consume the following backend endpoint.

- **Endpoint:** `GET /jobs/history`
- **Authentication:** Required (The user's JWT `idToken` must be sent).
- **Response Body (Success):** `200 OK` with a JSON array of `Job` objects.
  ```json
  [
    {
      "jobId": "uuid-string-1",
      "userId": "user-uuid-string",
      "originalFilename": "document1.txt",
      "targetLanguage": "es",
      "status": "COMPLETED",
      "createdAt": "2025-11-30T10:00:00Z",
      "updatedAt": "2025-11-30T11:30:00Z"
    },
    {
      "jobId": "uuid-string-2",
      "originalFilename": "document2.txt",
      "targetLanguage": "fr",
      "status": "TRANSLATING",
      "createdAt": "2025-11-30T12:00:00Z",
      "updatedAt": "2025-11-30T12:15:00Z"
    }
  ]
  ```

### Step 3.2: Frontend Service Layer

- **File:** `frontend/src/services/translationService.ts`
- **Action:** Add a new asynchronous function `getTranslationHistory`.

  ```typescript
  import { api } from '../utils/api'; // Our configured axios instance

  export interface Job {
    jobId: string;
    originalFilename: string;
    targetLanguage: string;
    status: 'PENDING' | 'TRANSLATING' | 'COMPLETED' | 'FAILED';
    createdAt: string;
    // ... any other fields
  }

  export const getTranslationHistory = async (): Promise<Job[]> => {
    const response = await api.get<Job[]>('/jobs/history');
    return response.data;
  };
  ```

### Step 3.3: React Component (`TranslationHistoryPage.tsx`)

- **File:** `frontend/src/pages/TranslationHistoryPage.tsx`
- **Action:** Create the main page component.
- **Data Fetching:** Use the `useQuery` hook from `react-query` to call the `getTranslationHistory` service function.

  ```typescript
  import { useQuery } from '@tanstack/react-query';
  import { getTranslationHistory } from '../services/translationService';

  const TranslationHistoryPage = () => {
    const {
      data: jobs,
      isLoading,
      isError,
      error,
    } = useQuery({
      queryKey: ['translationHistory'],
      queryFn: getTranslationHistory,
    });

    // ... component logic ...
  };
  ```

- **State Handling:**
  - **Loading:** If `isLoading` is `true`, render a centered `<CircularProgress />`.
  - **Error:** If `isError` is `true`, render an `Alert` component with the `error.message`.
  - **Empty State:** If `jobs` is defined and `jobs.length === 0`, render a `Typography` component with a message like "You have no translation jobs yet."
  - **Success:** If `jobs` has data, render the history table.

### Step 3.4: UI Details

- **Table Columns:** The table should display: `Filename`, `Language`, `Status`, and `Date Created`.
- **Status Display:** The `status` field should be rendered using a Material-UI `<Chip>` component with colors for different statuses (e.g., `primary` for TRANSLATING, `success` for COMPLETED, `error` for FAILED).
- **Date Formatting:** The `createdAt` date string should be formatted into a human-readable format (e.g., using `new Date().toLocaleDateString()`).
- **Navigation:** Each row in the table should be a link that navigates to the job's detail page using React Router's `<Link>` component (e.g., `to={`/translations/${job.jobId}`} `).

---

## 4. Security Considerations

- **Backend Enforcement:** The `GET /jobs/history` endpoint on the backend **must** be responsible for scoping the data. It should use the `userId` from the JWT token to query DynamoDB and only ever return jobs owned by that specific user. The frontend must not be relied upon for any security filtering.

---

## 5. Testing Plan

1.  **Unit Tests (`TranslationHistoryPage.test.tsx`):**
    - Mock the `getTranslationHistory` service function.
    - Write separate tests to verify that the component correctly renders the **loading state**.
    - Write a test to verify that the component correctly renders the **error state**.
    - Write a test to verify that the component correctly renders the **empty state**.
    - Write a test to verify that the component correctly renders a **table with mock job data**.

2.  **E2E Tests (`translation-history.spec.ts`):**
    - Create a new E2E test file.
    - The test should log in as a test user.
    - It should intercept the `GET /jobs/history` API call and return a mock array of job data.
    - It should navigate to the "/history" page.
    - It should assert that the table is visible and contains the mock data.

---

## 6. Out of Scope for This Milestone

- Client-side searching or filtering of the history table.
- Real-time updates (e.g., via WebSockets). The page will rely on `react-query`'s standard refetching mechanisms.
- Pagination. The initial implementation will fetch and display all jobs. A "Load More" or pagination feature will be a separate, follow-up task if needed.
