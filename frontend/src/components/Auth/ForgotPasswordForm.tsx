/**
 * ForgotPasswordForm Component
 *
 * Password reset request form with email validation.
 * Uses React Hook Form for form management and Zod for schema validation.
 *
 * Features:
 * - Email validation (required, valid email format)
 * - Loading state during submission
 * - Success state with helpful message
 * - Error display from submission failures
 * - Auto-clear errors on user input
 * - Accessible form controls
 */

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Box,
  TextField,
  Button,
  Link,
  Typography,
  Alert,
  CircularProgress,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { CheckCircleOutline as CheckIcon } from '@mui/icons-material';
import { ROUTES } from '../../config/constants';

/**
 * Forgot password form validation schema
 */
const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
});

type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

/**
 * ForgotPasswordForm Props
 */
export interface ForgotPasswordFormProps {
  /** Callback when form is submitted with valid email */
  onSubmit: (email: string) => Promise<void>;
}

/**
 * ForgotPasswordForm Component
 *
 * @example
 * ```tsx
 * <ForgotPasswordForm onSubmit={async (email) => {
 *   await authService.requestPasswordReset(email);
 * }} />
 * ```
 */
export function ForgotPasswordForm({ onSubmit }: ForgotPasswordFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
    mode: 'onSubmit',
  });

  // Watch email value to clear errors when user types
  const emailValue = watch('email');

  useEffect(() => {
    // Clear submit error when user starts typing
    if (submitError && emailValue) {
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailValue]);

  /**
   * Handle form submission
   */
  const onSubmitHandler = async (data: ForgotPasswordFormData) => {
    try {
      setIsSubmitting(true);
      setSubmitError(null);

      await onSubmit(data.email);

      // Show success state
      setIsSuccess(true);
    } catch (error) {
      // Display error message from API
      const apiError = error as { message?: string };
      setSubmitError(apiError.message || 'An error occurred while requesting password reset');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Show success state after successful submission
  if (isSuccess) {
    return (
      <Box sx={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
        <Box sx={{ mb: 3 }}>
          <CheckIcon sx={{ fontSize: 64, color: 'success.main' }} />
        </Box>

        <Typography variant="h4" component="h1" gutterBottom>
          Check Your Email
        </Typography>

        <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
          We've sent password reset instructions to your email address.
          Please check your inbox and follow the link to reset your password.
        </Typography>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Didn't receive the email? Check your spam folder or try again.
        </Typography>

        <Link
          component={RouterLink}
          to={ROUTES.LOGIN}
          variant="body2"
          underline="hover"
        >
          Back to login
        </Link>
      </Box>
    );
  }

  // Show form
  return (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmitHandler)}
      noValidate
      sx={{ width: '100%', maxWidth: 400 }}
    >
      <Typography variant="h4" component="h1" gutterBottom align="center">
        Forgot Password?
      </Typography>

      <Typography
        variant="body2"
        color="text.secondary"
        gutterBottom
        align="center"
        sx={{ mb: 3 }}
      >
        Enter your email address and we'll send you a link to reset your password.
      </Typography>

      {submitError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {submitError}
        </Alert>
      )}

      <TextField
        {...register('email')}
        label="Email"
        type="email"
        fullWidth
        margin="normal"
        autoComplete="email"
        autoFocus
        error={!!errors.email}
        helperText={errors.email?.message}
        disabled={isSubmitting}
      />

      <Button
        type="submit"
        fullWidth
        variant="contained"
        size="large"
        disabled={isSubmitting}
        sx={{ mt: 3, mb: 2 }}
      >
        {isSubmitting ? (
          <>
            <CircularProgress size={20} sx={{ mr: 1 }} color="inherit" />
            Sending...
          </>
        ) : (
          'Send Reset Link'
        )}
      </Button>

      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <Link
          component={RouterLink}
          to={ROUTES.LOGIN}
          variant="body2"
          underline="hover"
        >
          Back to login
        </Link>
      </Box>
    </Box>
  );
}
