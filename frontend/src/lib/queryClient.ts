/**
 * React Query Client Configuration
 *
 * Global query client with default settings for:
 * - Polling optimization with background sync
 * - Automatic refetching on window focus
 * - Error handling and retry logic (skip 4xx — only retry 5xx/network errors)
 */

import { QueryClient } from '@tanstack/react-query';

/**
 * Determines whether a failed query should be retried.
 *
 * Retry up to 3 times for:
 * - Network errors (no statusCode)
 * - Server errors (5xx)
 *
 * Do NOT retry for:
 * - Client errors (4xx) — retrying won't help (404, 403, 401, etc.)
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;

  // Extract statusCode from error (TranslationServiceError, AxiosError, generic)
  const statusCode =
    (error as { statusCode?: number })?.statusCode ??
    (error as { response?: { status?: number } })?.response?.status ??
    0;

  // Retry network errors (no status) and 5xx server errors. Skip 4xx client errors.
  if (statusCode === 0) return true; // Network error — retry
  return statusCode >= 500;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetch on window focus to keep data fresh
      refetchOnWindowFocus: true,
      // Skip retries on 4xx (client errors won't be helped by retrying)
      retry: shouldRetryQuery,
      // Cache data for 5 minutes
      gcTime: 5 * 60 * 1000,
      // Consider data stale after 1 minute
      staleTime: 1 * 60 * 1000,
      // Refetch interval for polling (disabled by default, enable per-query)
      refetchInterval: false,
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
    },
  },
});
