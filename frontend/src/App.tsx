/**
 * Main Application Component
 *
 * Sets up the application with:
 * - Material-UI Theme Provider
 * - Authentication Context Provider
 * - React Router with protected routes
 * - Global layout structure
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline, Container, Box } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';
import { MockModeBanner } from './components/common/MockModeBanner';
import { theme } from './theme';
import { ROUTES, FEATURE_FLAGS } from './config/constants';
import { queryClient } from './lib/queryClient';

// Lazy load pages for better performance
import { lazy, Suspense } from 'react';

// Page components
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TranslationUpload = lazy(() =>
  import('./pages/TranslationUpload').then((m) => ({ default: m.TranslationUpload }))
);
const TranslationHistory = lazy(() =>
  import('./pages/TranslationHistory').then((m) => ({ default: m.TranslationHistory }))
);
const TranslationDetail = lazy(() =>
  import('./pages/TranslationDetail').then((m) => ({ default: m.TranslationDetail }))
);
const TranslationCompare = lazy(() =>
  import('./pages/TranslationCompare').then((m) => ({ default: m.TranslationCompare }))
);

// Loading fallback component
function LoadingFallback() {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
      }}
    >
      <Container maxWidth="sm">
        <p>Loading...</p>
      </Container>
    </Box>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/*
          MockModeBanner is mounted at the top of the tree (before the
          router) so it is visible on every route — login, register,
          dashboard, and all translation pages — whenever
          VITE_MOCK_API=true. It returns null in normal mode.
        */}
        <MockModeBanner />
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<LoadingFallback />}>
              <Routes>
                {/* Public routes */}
                <Route path={ROUTES.LOGIN} element={<LoginPage />} />
                <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
                <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />

                {/* Legal pages (public, no auth required — issue #223) */}
                <Route path={ROUTES.LEGAL_TERMS} element={<TermsOfServicePage />} />
                <Route path={ROUTES.LEGAL_PRIVACY} element={<PrivacyPolicyPage />} />

                {/* Protected routes */}
                <Route
                  path={ROUTES.DASHBOARD}
                  element={
                    <ProtectedRoute>
                      <DashboardPage />
                    </ProtectedRoute>
                  }
                />

                {/* Translation routes */}
                <Route
                  path={ROUTES.TRANSLATION_UPLOAD}
                  element={
                    <ProtectedRoute>
                      <TranslationUpload />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTES.TRANSLATION_HISTORY}
                  element={
                    <ProtectedRoute>
                      <TranslationHistory />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path={ROUTES.TRANSLATION_DETAIL}
                  element={
                    <ProtectedRoute>
                      <TranslationDetail />
                    </ProtectedRoute>
                  }
                />
                {/*
                  Compare route gated behind FEATURE_FLAGS.COMPARE_VIEW —
                  source-pane retrieval API is not yet implemented.
                */}
                {FEATURE_FLAGS.COMPARE_VIEW && (
                  <Route
                    path={ROUTES.TRANSLATION_COMPARE}
                    element={
                      <ProtectedRoute>
                        <TranslationCompare />
                      </ProtectedRoute>
                    }
                  />
                )}

                {/* Default redirect to login */}
                <Route path="/" element={<Navigate to={ROUTES.LOGIN} replace />} />

                {/* 404 catch-all */}
                <Route path="*" element={<Navigate to={ROUTES.LOGIN} replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
