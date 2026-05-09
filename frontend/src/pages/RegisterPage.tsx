/**
 * Register Page
 *
 * Provides the registration interface using the RegisterForm component.
 * Handles user registration flow with auto-login on success (issue #222).
 *
 * Post-registration flow (dev environment — Cognito auto-confirm enabled):
 *   1. POST /auth/register succeeds (201, no tokens returned by real backend).
 *   2. Silently attempt login with the same credentials via the shared login().
 *   3a. Login succeeds  → navigate to /dashboard (user is already authenticated).
 *   3b. Login fails     → navigate to /login with a friendly message in router
 *       state so the user can sign in manually without losing their credentials.
 *       The RegisterForm surfaces the error; this page does NOT crash.
 */

import { useNavigate } from 'react-router-dom';
import { Container, Box, Paper } from '@mui/material';
import { RegisterForm } from '../components/Auth/RegisterForm';
import { useAuth } from '../contexts/AuthContext';
import { ROUTES } from '../config/constants';
import type { RegisterRequest } from '../services/authService';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, login } = useAuth();

  const handleRegister = async (formData: {
    email: string;
    password: string;
    confirmPassword: string;
    firstName: string;
    lastName: string;
  }) => {
    // Add required fields that aren't in the form (POC simplification)
    const registrationData: RegisterRequest = {
      ...formData,
      acceptedTerms: true,
      acceptedPrivacy: true,
    };

    // Step 1: create the account (201; real backend does not return tokens).
    await register(registrationData);

    // Step 2: silently auto-login using the same credentials so the user
    // lands on /dashboard without having to retype their password (issue #222).
    // In dev, Cognito auto-confirms the account immediately after registration,
    // so login succeeds synchronously. In prod (email verification required)
    // this call will fail — we catch it and fall back to /login gracefully.
    try {
      await login({ email: formData.email, password: formData.password });
      navigate(ROUTES.DASHBOARD);
    } catch {
      // Auto-login failed (e.g., prod env where email verification is still
      // required, or a transient network error). Redirect to /login and pass
      // a friendly hint so the user knows their account was created.
      navigate(ROUTES.LOGIN, {
        state: {
          message:
            'Account created! Please sign in — check your email if verification is required.',
        },
      });
    }
  };

  return (
    <Container component="main" maxWidth="md">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Paper
          elevation={3}
          sx={{
            padding: 4,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <RegisterForm onSubmit={handleRegister} />
        </Paper>
      </Box>
    </Container>
  );
}
