import { Hono } from 'hono';
import { AuthService } from '../../services/auth.service';
import { validate } from '../middleware/validate.middleware';
import {
  signupSchema,
  loginSchema,
  verifyEmailSchema,
  resendCodeSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshTokenSchema,
  type SignupInput,
  type LoginInput,
  type VerifyEmailInput,
  type ResendCodeInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type RefreshTokenInput,
} from '../validators/auth.validator';
import { canResendVerification, setVerificationCooldown } from '../../db/redis';
import { User } from '../../db/schemas';

const auth = new Hono();

/**
 * POST /auth/signup
 * Register a new user account
 */
auth.post('/signup', validate(signupSchema), async (c) => {
  const body = c.get('validatedBody') as SignupInput;

  const result = await AuthService.signup(body.email, body.password);

  if (!result.success) {
    const status = result.code === 'EMAIL_EXISTS' ? 409 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json(
    {
      message: 'Account created. Please check your email for verification code.',
      userId: result.data!.userId,
      email: result.data!.email,
    },
    201
  );
});

/**
 * POST /auth/verify
 * Verify email with 6-digit code
 */
auth.post('/verify', validate(verifyEmailSchema), async (c) => {
  const body = c.get('validatedBody') as VerifyEmailInput;

  const result = await AuthService.verifyEmail(body.email, body.code);

  if (!result.success) {
    const status = result.code === 'USER_NOT_FOUND' ? 404 : 400;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({
    message: 'Email verified successfully',
    accessToken: result.data!.accessToken,
    refreshToken: result.data!.refreshToken,
    user: result.data!.user,
  });
});

/**
 * POST /auth/resend-code
 * Resend verification code with cooldown
 */
auth.post('/resend-code', validate(resendCodeSchema), async (c) => {
  const body = c.get('validatedBody') as ResendCodeInput;

  // Find user
  const user = await User.findOne({ email: body.email.toLowerCase() });
  if (!user) {
    // Return success even if user doesn't exist (security)
    return c.json({ message: 'If the email exists, a verification code has been sent.' });
  }

  if (user.emailVerified) {
    return c.json({ error: 'Email already verified', code: 'ALREADY_VERIFIED' }, 400);
  }

  // Check cooldown
  const canResend = await canResendVerification(user._id.toString());
  if (!canResend) {
    return c.json(
      { error: 'Please wait before requesting a new code', code: 'COOLDOWN_ACTIVE' },
      429
    );
  }

  // Send new code
  const result = await AuthService.sendVerificationCode(user._id.toString(), user.email);

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, 500);
  }

  // Set cooldown
  await setVerificationCooldown(user._id.toString(), 60);

  return c.json({ message: 'Verification code sent' });
});

/**
 * POST /auth/login
 * Login with email and password
 */
auth.post('/login', validate(loginSchema), async (c) => {
  const body = c.get('validatedBody') as LoginInput;

  const result = await AuthService.login(body.email, body.password);

  if (!result.success) {
    const status = result.code === 'EMAIL_NOT_VERIFIED' ? 403 : 401;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({
    accessToken: result.data!.accessToken,
    refreshToken: result.data!.refreshToken,
    user: result.data!.user,
  });
});

/**
 * POST /auth/refresh
 * Refresh access token
 */
auth.post('/refresh', validate(refreshTokenSchema), async (c) => {
  const body = c.get('validatedBody') as RefreshTokenInput;

  const result = await AuthService.refreshToken(body.refreshToken);

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, 401);
  }

  return c.json({ accessToken: result.data!.accessToken });
});

/**
 * POST /auth/forgot-password
 * Request password reset code
 */
auth.post('/forgot-password', validate(forgotPasswordSchema), async (c) => {
  const body = c.get('validatedBody') as ForgotPasswordInput;

  await AuthService.forgotPassword(body.email);

  // Always return success (security - don't reveal if email exists)
  return c.json({ message: 'If the email exists, a reset code has been sent.' });
});

/**
 * POST /auth/reset-password
 * Reset password with code
 */
auth.post('/reset-password', validate(resetPasswordSchema), async (c) => {
  const body = c.get('validatedBody') as ResetPasswordInput;

  const result = await AuthService.resetPassword(body.email, body.code, body.newPassword);

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, 400);
  }

  return c.json({ message: 'Password reset successful' });
});

export { auth as authRoutes };


