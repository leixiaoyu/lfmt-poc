/**
 * Dashboard Page
 *
 * Main dashboard page for authenticated users with quick actions for translation workflow.
 */

import { Container, Box, Typography, Button, Paper, Grid, Card, CardContent, CardActions } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '../config/constants';
import AddIcon from '@mui/icons-material/Add';
import HistoryIcon from '@mui/icons-material/History';
import TranslateIcon from '@mui/icons-material/Translate';

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate(ROUTES.LOGIN);
  };

  return (
    <Container component="main" maxWidth="lg" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Dashboard
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Welcome back, {user?.firstName} {user?.lastName}!
          </Typography>
        </Box>
        <Button variant="outlined" color="primary" onClick={handleLogout}>
          Logout
        </Button>
      </Box>

      {/* Quick Actions */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={6}>
          <Card elevation={2}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <AddIcon color="primary" sx={{ fontSize: 40, mr: 2 }} />
                <Box>
                  <Typography variant="h6">New Translation</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Upload a document and start translating
                  </Typography>
                </Box>
              </Box>
            </CardContent>
            <CardActions>
              <Button
                size="large"
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/translation/upload')}
                fullWidth
              >
                Upload Document
              </Button>
            </CardActions>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card elevation={2}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <HistoryIcon color="primary" sx={{ fontSize: 40, mr: 2 }} />
                <Box>
                  <Typography variant="h6">Translation History</Typography>
                  <Typography variant="body2" color="text.secondary">
                    View and manage your translations
                  </Typography>
                </Box>
              </Box>
            </CardContent>
            <CardActions>
              <Button
                size="large"
                variant="outlined"
                startIcon={<HistoryIcon />}
                onClick={() => navigate('/translation/history')}
                fullWidth
              >
                View History
              </Button>
            </CardActions>
          </Card>
        </Grid>
      </Grid>

      {/* Info Section */}
      <Paper elevation={1} sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <TranslateIcon color="primary" sx={{ fontSize: 32, mr: 2 }} />
          <Typography variant="h6">About LFMT Translation Service</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" paragraph>
          LFMT (Long-Form Machine Translation) enables you to translate large documents while
          maintaining context and coherence throughout the entire text.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Supported languages: Spanish, French, German, Italian, Chinese
        </Typography>
      </Paper>
    </Container>
  );
}
