/**
 * New Translation Page
 *
 * Page for starting a new document translation.
 * Users can upload their document and initiate the translation workflow.
 */

import { Container, Box, Typography, Paper, AppBar, Toolbar, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { FileUploadForm } from '../components/Translation';
import { useAuth } from '../contexts/AuthContext';
import { ROUTES } from '../config/constants';

export default function NewTranslationPage() {
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      navigate(ROUTES.LOGIN);
    } catch (error) {
      console.error('Logout failed:', error);
      // Do NOT navigate on error - user is still authenticated
    }
  };

  const handleUploadComplete = (fileId: string) => {
    console.log('Upload complete, fileId:', fileId);
    // TODO: Navigate to translation detail page when implemented
    // For now, show success and stay on page
    // Example: navigate(ROUTES.TRANSLATION_DETAIL.replace(':jobId', fileId));
  };

  const handleUploadError = (error: string) => {
    console.error('Upload error:', error);
    // Error is already displayed in the FileUploadForm component
  };

  return (
    <>
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            LFMT Translation Service
          </Typography>
          {user && (
            <Typography variant="body2" sx={{ mr: 2 }}>
              {user.email}
            </Typography>
          )}
          <Button color="inherit" onClick={handleLogout}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Container component="main" maxWidth="md">
        <Box
          sx={{
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <Typography variant="h3" component="h1" gutterBottom>
            New Translation
          </Typography>

          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ mb: 4, textAlign: 'center' }}
          >
            Upload your document to begin the translation process. We support
            text files up to 100MB.
          </Typography>

          <Paper
            elevation={3}
            sx={{
              p: 4,
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
            }}
          >
            <FileUploadForm
              onUploadComplete={handleUploadComplete}
              onUploadError={handleUploadError}
            />
          </Paper>
        </Box>
      </Container>
    </>
  );
}
