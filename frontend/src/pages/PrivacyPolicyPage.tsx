/**
 * Privacy Policy Page
 *
 * Stub legal page — POC quality only.
 * Real privacy policy will be drafted by legal counsel before production launch.
 *
 * Linked from the registration form "Privacy Policy" checkbox label (issue #223).
 */

import { Container, Box, Typography, Alert, Divider, Paper, Link } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../config/constants';

export default function PrivacyPolicyPage() {
  return (
    <Container component="main" maxWidth="md">
      <Box sx={{ marginTop: 6, marginBottom: 6 }}>
        <Paper elevation={2} sx={{ p: 4 }}>
          {/* Demo disclosure banner */}
          <Alert severity="warning" sx={{ mb: 4 }}>
            <strong>Demo / POC Only.</strong> This is a placeholder document. A real Privacy Policy
            compliant with GDPR, CCPA, and other applicable regulations will be prepared by
            qualified legal counsel before any production launch. Nothing on this page constitutes a
            binding legal commitment.
          </Alert>

          <Typography variant="h4" component="h1" gutterBottom>
            Privacy Policy
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last updated: May 2026 (stub — not legally binding)
          </Typography>

          <Divider sx={{ mb: 3 }} />

          <Typography variant="h6" component="h2" gutterBottom>
            1. Information We Collect
          </Typography>
          <Typography variant="body1" paragraph>
            We collect information you provide directly when registering (name, email address) and
            information generated when you use the Service (document metadata, translation job
            status, IP address, browser information, and usage timestamps).
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            2. How We Use Your Information
          </Typography>
          <Typography variant="body1" paragraph>
            We use the information we collect to operate and improve the Service, authenticate
            users, process translation jobs, comply with legal obligations (including copyright
            attestation records retained for 7 years), and communicate service updates.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            3. Data Storage and Security
          </Typography>
          <Typography variant="body1" paragraph>
            User data and uploaded documents are stored on AWS infrastructure in the United States.
            We implement industry-standard security measures including encryption at rest and in
            transit, access controls, and audit logging.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            4. Data Sharing
          </Typography>
          <Typography variant="body1" paragraph>
            We do not sell your personal information. Document content is processed by third-party
            AI translation APIs (currently Google Gemini) under contractual data processing
            agreements. We may disclose data when required by law.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            5. Your Rights
          </Typography>
          <Typography variant="body1" paragraph>
            Depending on your jurisdiction, you may have rights to access, correct, delete, or
            export your personal data. To exercise these rights, contact us at the address below.
            Specific rights and timelines will be detailed in the production privacy policy.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            6. Cookies and Tracking
          </Typography>
          <Typography variant="body1" paragraph>
            The Service uses session storage and local storage for authentication tokens. We do not
            use third-party advertising cookies. Analytics usage, if any, will be disclosed in the
            production policy.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            7. Changes to This Policy
          </Typography>
          <Typography variant="body1" paragraph>
            We will notify registered users of material changes to the Privacy Policy via email at
            least 30 days before they take effect.
          </Typography>

          <Divider sx={{ mt: 3, mb: 3 }} />

          <Typography variant="body2" color="text.secondary">
            Privacy inquiries:{' '}
            <Link href="mailto:support@lfmt.example.com" underline="hover">
              support@lfmt.example.com
            </Link>
            .
          </Typography>

          <Box sx={{ mt: 3 }}>
            <Link component={RouterLink} to={ROUTES.REGISTER} underline="hover" variant="body2">
              &larr; Back to registration
            </Link>
          </Box>
        </Paper>
      </Box>
    </Container>
  );
}
