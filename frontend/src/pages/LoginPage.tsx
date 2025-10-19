/**
 * Login Page
 *
 * Provides the login interface using the LoginForm component.
 * Handles authentication flow and redirects to dashboard on success.
 */

import { useNavigate } from 'react-router-dom';
import { Container, Box, Paper } from '@mui/material';
import { LoginForm } from '../components/Auth/LoginForm';
import { useAuth } from '../contexts/AuthContext';
import { ROUTES } from '../config/constants';
import type { LoginRequest } from '../services/authService';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

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
