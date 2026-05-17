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
 *   3b. Login fails     → navigate to /login with a router-state message of
 *       the form `"Account created. <actual-cause>"`. The actual-cause text
 *       is produced by the shared `getApiErrorMessage` extractor (issue
 *       #276), so the user sees the real failure (rate limit, network outage,
 *       email verification required, etc.) rather than a hardcoded
 *       "check your email" hint that misfires on every non-verification
 *       cause. The RegisterForm surfaces the error too; this page does NOT crash.
 */

import { useNavigate } from 'react-router-dom';
import { Container, Box, Paper } from '@mui/material';
import { RegisterForm } from '../components/Auth/RegisterForm';
import { useAuth } from '../contexts/AuthContext';
import { ROUTES } from '../config/constants';
import type { RegisterRequest } from '../services/authService';
import { getApiErrorMessage } from '../utils/translationErrorMessages';

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
    } catch (autoLoginError) {
      // Issue #276: Registration succeeded but the auto-login leg failed.
      // Possible causes are heterogeneous: 429 (Cognito rate limit on the
      // immediate follow-up InitiateAuth), 403 (email verification required
      // in prod), 5xx (transient backend), or a network outage. The previous
      // implementation swallowed the error with `catch {}` and surfaced a
      // hardcoded "check your email" hint regardless of cause — actively
      // misleading for the rate-limit / network cases.
      //
      // We route the actual error through the shared `getApiErrorMessage`
      // extractor (the same one the upload wizard and translation pages use)
      // and prefix it with "Account created." so the user keeps the positive
      // confirmation about the registration leg AND learns what to actually
      // do next (verify email, wait and retry, etc.). The /login route reads
      // `state.message` and renders it verbatim in an info <Alert>.
      const errorMessage = getApiErrorMessage(autoLoginError);
      navigate(ROUTES.LOGIN, {
        state: {
          message: `Account created. ${errorMessage}`,
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
