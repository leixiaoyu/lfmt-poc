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
import { AuthProvider } from './contexts/AuthContext';
import { ProtectedRoute } from './components/Auth/ProtectedRoute';
import { theme } from './theme';
import { ROUTES } from './config/constants';

// Lazy load pages for better performance
import { lazy, Suspense } from 'react';

// Page components
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const TranslationUpload = lazy(() => import('./pages/TranslationUpload').then(m => ({ default: m.TranslationUpload })));
const TranslationHistory = lazy(() => import('./pages/TranslationHistory').then(m => ({ default: m.TranslationHistory })));
const TranslationDetail = lazy(() => import('./pages/TranslationDetail').then(m => ({ default: m.TranslationDetail })));

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
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              {/* Public routes */}
              <Route path={ROUTES.LOGIN} element={<LoginPage />} />
              <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
              <Route path={ROUTES.FORGOT_PASSWORD} element={<ForgotPasswordPage />} />

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
                path="/translation/upload"
                element={
                  <ProtectedRoute>
                    <TranslationUpload />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/translation/history"
                element={
                  <ProtectedRoute>
                    <TranslationHistory />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/translation/:jobId"
                element={
                  <ProtectedRoute>
                    <TranslationDetail />
                  </ProtectedRoute>
                }
              />

              {/* Default redirect to login */}
              <Route path="/" element={<Navigate to={ROUTES.LOGIN} replace />} />

              {/* 404 catch-all */}
              <Route path="*" element={<Navigate to={ROUTES.LOGIN} replace />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
