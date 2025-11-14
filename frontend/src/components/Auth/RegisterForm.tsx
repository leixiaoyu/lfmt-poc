/**
 * RegisterForm Component
 *
 * User registration form with comprehensive validation.
 * Uses React Hook Form for form management and Zod for schema validation.
 *
 * Features:
 * - Name fields (first name, last name)
 * - Email validation (required, valid email format)
 * - Strong password requirements (length, uppercase, lowercase, number, special char)
 * - Password confirmation matching
 * - Loading state during submission
 * - Error display from submission failures
 * - Auto-clear errors on user input
 * - Accessible form controls
 */

import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
  Grid,
  FormControlLabel,
  Checkbox,
  FormHelperText,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { ROUTES } from '../../config/constants';

/**
 * Registration form validation schema
 */
const registerSchema = z.object({
  firstName: z
    .string()
    .min(1, 'First name is required')
    .max(50, 'First name must be less than 50 characters'),
  lastName: z
    .string()
    .min(1, 'Last name is required')
    .max(50, 'Last name must be less than 50 characters'),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Invalid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z
    .string()
    .min(1, 'Please confirm your password'),
  acceptedTerms: z
    .boolean()
    .refine((val) => val === true, {
      message: 'You must accept the Terms of Service to register',
    }),
  acceptedPrivacy: z
    .boolean()
    .refine((val) => val === true, {
      message: 'You must accept the Privacy Policy to register',
    }),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

/**
 * RegisterForm data (collected by the form)
 */
type RegisterFormData = z.infer<typeof registerSchema>;

/**
 * RegisterForm Props
 */
export interface RegisterFormProps {
  /** Callback when form is submitted with valid data */
  onSubmit: (data: RegisterFormData) => Promise<void>;
}

/**
 * RegisterForm Component
 *
 * @example
 * ```tsx
 * <RegisterForm onSubmit={async (data) => {
 *   await authService.register(data);
 * }} />
 * ```
 */
export function RegisterForm({ onSubmit }: RegisterFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    watch,
    control,
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    mode: 'onSubmit',
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      confirmPassword: '',
      acceptedTerms: false,
      acceptedPrivacy: false,
    },
  });

  // Watch form values to clear errors when user types
  const watchedValues = watch();

  useEffect(() => {
    // Clear submit error when user starts typing
    if (submitError) {
      setSubmitError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchedValues.firstName, watchedValues.lastName, watchedValues.email, watchedValues.password, watchedValues.confirmPassword]);

  /**
   * Handle form submission
   */
  const onSubmitHandler = async (data: RegisterFormData) => {
    try {
      setIsSubmitting(true);
      setSubmitError(null);

      // Keep confirmPassword for backend validation
      await onSubmit(data);

      // Clear form on successful registration
      reset();
    } catch (error) {
      // Display error message from API
      const apiError = error as { message?: string };
      setSubmitError(apiError.message || 'An error occurred during registration');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit(onSubmitHandler)}
      noValidate
      sx={{ width: '100%', maxWidth: 500 }}
    >
      <Typography variant="h4" component="h1" gutterBottom align="center">
        Sign Up
      </Typography>

      <Typography
        variant="body2"
        color="text.secondary"
        gutterBottom
        align="center"
        sx={{ mb: 3 }}
      >
        Create your account to get started
      </Typography>

      {submitError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {submitError}
        </Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} sm={6}>
          <TextField
            {...register('firstName')}
            label="First Name"
            fullWidth
            autoComplete="given-name"
            autoFocus
            error={!!errors.firstName}
            helperText={errors.firstName?.message}
            disabled={isSubmitting}
          />
        </Grid>

        <Grid item xs={12} sm={6}>
          <TextField
            {...register('lastName')}
            label="Last Name"
            fullWidth
            autoComplete="family-name"
            error={!!errors.lastName}
            helperText={errors.lastName?.message}
            disabled={isSubmitting}
          />
        </Grid>
      </Grid>

      <TextField
        {...register('email')}
        label="Email"
        type="email"
        fullWidth
        margin="normal"
        autoComplete="email"
        error={!!errors.email}
        helperText={errors.email?.message}
        disabled={isSubmitting}
      />

      <TextField
        {...register('password')}
        label="Password"
        type="password"
        fullWidth
        margin="normal"
        autoComplete="new-password"
        error={!!errors.password}
        helperText={errors.password?.message}
        disabled={isSubmitting}
      />

      <TextField
        {...register('confirmPassword')}
        label="Confirm Password"
        type="password"
        fullWidth
        margin="normal"
        autoComplete="new-password"
        error={!!errors.confirmPassword}
        helperText={errors.confirmPassword?.message}
        disabled={isSubmitting}
      />

      {/* Terms of Service Checkbox */}
      <Box sx={{ mt: 2 }}>
        <Controller
          name="acceptedTerms"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={
                <Checkbox
                  {...field}
                  checked={field.value || false}
                  color="primary"
                  disabled={isSubmitting}
                />
              }
              label="I agree to the Terms of Service"
            />
          )}
        />
        {errors.acceptedTerms && (
          <FormHelperText error sx={{ mt: -1, mb: 1, ml: 4 }}>
            {errors.acceptedTerms.message}
          </FormHelperText>
        )}
      </Box>

      {/* Privacy Policy Checkbox */}
      <Box sx={{ mt: 1 }}>
        <Controller
          name="acceptedPrivacy"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={
                <Checkbox
                  {...field}
                  checked={field.value || false}
                  color="primary"
                  disabled={isSubmitting}
                />
              }
              label="I agree to the Privacy Policy"
            />
          )}
        />
        {errors.acceptedPrivacy && (
          <FormHelperText error sx={{ mt: -1, mb: 1, ml: 4 }}>
            {errors.acceptedPrivacy.message}
          </FormHelperText>
        )}
      </Box>

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
            Creating account...
          </>
        ) : (
          'Sign Up'
        )}
      </Button>

      <Box sx={{ textAlign: 'center', mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Already have an account?{' '}
          <Link
            component={RouterLink}
            to={ROUTES.LOGIN}
            variant="body2"
            underline="hover"
          >
            Sign in
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}
