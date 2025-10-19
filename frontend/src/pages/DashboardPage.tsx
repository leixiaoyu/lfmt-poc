/**
 * Dashboard Page
 *
 * Main dashboard page for authenticated users.
 * This is a placeholder that will be implemented in later phases.
 */

import { Container, Box, Typography, Button } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../config/constants';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <Container component="main" maxWidth="lg">
      <Box
        sx={{
          marginTop: 8,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Typography variant="h3" component="h1" gutterBottom>
          Dashboard
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          Welcome {user?.firstName} {user?.lastName}!
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Email: {user?.email}
        </Typography>

        <Button variant="contained" color="primary" onClick={handleLogout}>
          Logout
        </Button>

        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Dashboard content will be implemented in later phases.
          </Typography>
        </Box>
      </Box>
    </Container>
  );
}
