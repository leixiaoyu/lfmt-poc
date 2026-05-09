/**
 * Terms of Service Page
 *
 * Stub legal page — POC quality only.
 * Real terms of service will be drafted by legal counsel before production launch.
 *
 * Linked from the registration form "Terms of Service" checkbox label (issue #223).
 */

import { Container, Box, Typography, Alert, Divider, Paper } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { Link } from '@mui/material';
import { ROUTES } from '../config/constants';

export default function TermsOfServicePage() {
  return (
    <Container component="main" maxWidth="md">
      <Box sx={{ marginTop: 6, marginBottom: 6 }}>
        <Paper elevation={2} sx={{ p: 4 }}>
          {/* Demo disclosure banner */}
          <Alert severity="warning" sx={{ mb: 4 }}>
            <strong>Demo / POC Only.</strong> This is a placeholder document. Real Terms of Service
            will be prepared by qualified legal counsel before any production launch. Nothing on this
            page constitutes a binding legal agreement.
          </Alert>

          <Typography variant="h4" component="h1" gutterBottom>
            Terms of Service
          </Typography>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Last updated: May 2026 (stub — not legally binding)
          </Typography>

          <Divider sx={{ mb: 3 }} />

          <Typography variant="h6" component="h2" gutterBottom>
            1. Acceptance of Terms
          </Typography>
          <Typography variant="body1" paragraph>
            By accessing or using the LFMT Long-Form Translation Service (&ldquo;Service&rdquo;),
            you agree to be bound by these Terms of Service. If you do not agree, do not use the
            Service.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            2. Description of Service
          </Typography>
          <Typography variant="body1" paragraph>
            LFMT provides AI-assisted translation of long-form documents (65,000–400,000 words)
            using third-party language model APIs. The Service is provided on an &ldquo;as-is&rdquo;
            basis for demonstration and evaluation purposes.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            3. User Responsibilities
          </Typography>
          <Typography variant="body1" paragraph>
            You are solely responsible for ensuring you have the legal right to upload and translate
            any document submitted to the Service. You must not submit documents that infringe
            third-party intellectual property rights.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            4. Intellectual Property
          </Typography>
          <Typography variant="body1" paragraph>
            You retain ownership of content you upload. By using the Service you grant LFMT a
            limited, non-exclusive licence to process your content solely for the purpose of
            providing the translation.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            5. Limitation of Liability
          </Typography>
          <Typography variant="body1" paragraph>
            To the maximum extent permitted by applicable law, LFMT shall not be liable for any
            indirect, incidental, or consequential damages arising from use of the Service.
          </Typography>

          <Typography variant="h6" component="h2" gutterBottom>
            6. Governing Law
          </Typography>
          <Typography variant="body1" paragraph>
            These Terms will be governed by and construed in accordance with applicable law. The
            specific jurisdiction will be determined prior to production launch.
          </Typography>

          <Divider sx={{ mt: 3, mb: 3 }} />

          <Typography variant="body2" color="text.secondary">
            Questions about these terms? Contact{' '}
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
