/**
 * Forgot Password Page
 *
 * Provides the password reset request interface using the ForgotPasswordForm component.
 * Allows users to request a password reset link via email.
 */

import { Container, Box, Paper } from '@mui/material';
import { ForgotPasswordForm } from '../components/Auth/ForgotPasswordForm';
import { authService } from '../services/authService';

export default function ForgotPasswordPage() {
  const handleForgotPassword = async (email: string) => {
    await authService.requestPasswordReset(email);
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
          <ForgotPasswordForm onSubmit={handleForgotPassword} />
        </Paper>
      </Box>
    </Container>
  );
}
