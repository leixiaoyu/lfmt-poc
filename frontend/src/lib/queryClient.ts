/**
 * React Query Client Configuration
 *
 * Global query client with default settings for:
 * - Polling optimization with background sync
 * - Automatic refetching on window focus
 * - Error handling and retry logic
 */

import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Refetch on window focus to keep data fresh
      refetchOnWindowFocus: true,
      // Retry failed requests up to 3 times
      retry: 3,
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
