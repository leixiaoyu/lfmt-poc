/**
 * Login Page
 *
 * Provides the login interface using the LoginForm component.
 * Handles authentication flow and redirects to dashboard on success.
 *
 * Reads optional router state `{ message: string }` so that other pages
 * (e.g., RegisterPage auto-login fallback) can surface a friendly hint
 * without introducing a separate toast library.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { Container, Box, Paper, Alert } from '@mui/material';
import { LoginForm } from '../components/Auth/LoginForm';
import { useAuth } from '../contexts/AuthContext';
import { ROUTES } from '../config/constants';
import type { LoginRequest } from '../services/authService';

/** Shape of state that other pages may pass when redirecting here. */
interface LoginLocationState {
  message?: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  // Friendly message from a referring page (e.g., post-register fallback).
  const inboundMessage = (location.state as LoginLocationState | null)?.message;

  const handleLogin = async (data: LoginRequest) => {
    await login(data);
    navigate(ROUTES.DASHBOARD);
  };

  return (
    <Container component="main" maxWidth="sm">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {inboundMessage && (
          <Alert severity="info" sx={{ mb: 2, width: '100%' }}>
            {inboundMessage}
          </Alert>
        )}
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
          <LoginForm onSubmit={handleLogin} />
        </Paper>
      </Box>
    </Container>
  );
}
