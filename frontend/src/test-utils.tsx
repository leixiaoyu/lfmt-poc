/**
 * Test Utilities
 *
 * Provides custom render function with all necessary providers
 * for testing Material-UI components and React Query.
 */

import React, { ReactElement, useState } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Create a default theme for tests
const theme = createTheme();

// Create a new QueryClient for each test to ensure test isolation
const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false, // Disable retries in tests for faster failures
        gcTime: 0, // Disable garbage collection time
        staleTime: 0, // Always consider data stale in tests
      },
      mutations: {
        retry: false, // Disable retries in tests
      },
    },
  });

interface AllTheProvidersProps {
  children: React.ReactNode;
}

// eslint-disable-next-line react-refresh/only-export-components
const AllTheProviders: React.FC<AllTheProvidersProps> = ({ children }) => {
  // Lazy init via useState — guarantees a single client instance per render tree,
  // so re-renders during a test don't blow away cached queries (was causing flakes).
  const [testQueryClient] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={testQueryClient}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </QueryClientProvider>
  );
};

const customRender = (ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) =>
  render(ui, { wrapper: AllTheProviders, ...options });

// Re-export everything
// eslint-disable-next-line react-refresh/only-export-components
export * from '@testing-library/react';

// Override render method
export { customRender as render };
