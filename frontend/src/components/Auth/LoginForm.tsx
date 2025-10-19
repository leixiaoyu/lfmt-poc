/**
 * LoginForm Component
 *
 * User authentication form with email/password validation.
 * Uses React Hook Form for form management and Zod for schema validation.
 *
 * Features:
 * - Email validation (required, valid email format)
 * - Password validation (required)
 * - Loading state during submission
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
import { ROUTES } from '../../config/constants';
import type { LoginRequest } from '../../services/authService';

/**
 * Login form validation schema
 */
const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z
    .string()
    .min(1, 'Password is required'),
});

type LoginFormData = z.infer<typeof loginSchema>;

/**
 * LoginForm Props
 */
export interface LoginFormProps {
  /** Callback when form is submitted with valid data */
  onSubmit: (data: LoginRequest) => Promise<void>;
}

/**
 * LoginForm Component
 *
 * @example
 * ```tsx
 * <LoginForm onSubmit={async (data) => {
 *   await authService.login(data);
 * }} />
 * ```
 */
export function LoginForm({ onSubmit }: LoginFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
  });

  // Watch form values to clear errors when user types
  const watchedValues = watch();

  useEffect(() => {
    // Clear submit error when user starts typing
    if (submitError) {
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedValues.email, watchedValues.password]);

  /**
   * Handle form submission
   */
  const onSubmitHandler = async (data: LoginFormData) => {
    try {
      setIsSubmitting(true);
      setSubmitError(null);

      await onSubmit(data);

      // Clear form on successful login
      reset();
    } catch (error) {
      // Display error message from API
      const apiError = error as { message?: string };
      setSubmitError(apiError.message || 'An error occurred during login');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmitHandler)}
      noValidate
      sx={{ width: '100%', maxWidth: 400 }}
    >
      <Typography variant="h4" component="h1" gutterBottom align="center">
        Log In
      </Typography>

      <Typography
        variant="body2"
        color="text.secondary"
        gutterBottom
        align="center"
        sx={{ mb: 3 }}
      >
        Sign in to your account to continue
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
        inputProps={{
          'aria-describedby': errors.email ? 'email-error' : undefined,
        }}
      />

      <TextField
        {...register('password')}
        label="Password"
        type="password"
        fullWidth
        margin="normal"
        autoComplete="current-password"
        error={!!errors.password}
        helperText={errors.password?.message}
        disabled={isSubmitting}
        inputProps={{
          'aria-describedby': errors.password ? 'password-error' : undefined,
        }}
      />

      <Box sx={{ textAlign: 'right', mt: 1, mb: 2 }}>
        <Link
          component={RouterLink}
          to={ROUTES.FORGOT_PASSWORD}
          variant="body2"
          underline="hover"
        >
          Forgot password?
        </Link>
      </Box>

      <Button
        type="submit"
        fullWidth
        variant="contained"
        size="large"
        disabled={isSubmitting}
        sx={{ mt: 1, mb: 2 }}
      >
        {isSubmitting ? (
          <>
            <CircularProgress size={20} sx={{ mr: 1 }} color="inherit" />
            Logging in...
          </>
        ) : (
          'Log In'
        )}
      </Button>

      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Don't have an account?{' '}
          <Link
            component={RouterLink}
            to={ROUTES.REGISTER}
            variant="body2"
            underline="hover"
          >
            Sign up
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}
