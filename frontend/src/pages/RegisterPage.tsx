/**
 * Register Page
 *
 * Provides the registration interface using the RegisterForm component.
 * Handles user registration flow and redirects to dashboard on success.
 */

import { useNavigate } from 'react-router-dom';
import { Container, Box, Paper } from '@mui/material';
import { RegisterForm } from '../components/Auth/RegisterForm';
import { useAuth } from '../contexts/AuthContext';
import { ROUTES } from '../config/constants';
import type { RegisterRequest } from '../services/authService';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register } = useAuth();

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
    await register(registrationData);
    navigate(ROUTES.DASHBOARD);
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
