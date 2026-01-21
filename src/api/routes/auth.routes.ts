import { Hono } from 'hono';
import { z } from 'zod';
import { AuthService, MagicLinkService } from '../../services';
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

// Magic link set password schema
const setPasswordViaMagicLinkSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

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

// ============================================================
// Magic Link Routes (for payment-created users)
// ============================================================

/**
 * GET /auth/magic/:token
 * Validate a magic link token
 * Frontend calls this to check if the link is valid before showing password form
 */
auth.get('/magic/:token', async (c) => {
  const token = c.req.param('token');

  if (!token) {
    return c.json({ valid: false, error: 'Token is required' }, 400);
  }

  const result = await MagicLinkService.validate(token);

  if (!result.success) {
    return c.json({ 
      valid: false, 
      error: result.error,
      code: result.code,
    }, 400);
  }

  return c.json({
    valid: true,
    email: result.data!.email,
  });
});

/**
 * POST /auth/magic/:token/set-password
 * Set password using a magic link token
 * Used by users who signed up via payment (affiliate or direct)
 */
auth.post('/magic/:token/set-password', validate(setPasswordViaMagicLinkSchema), async (c) => {
  const token = c.req.param('token');
  const body = c.get('validatedBody') as { password: string };

  if (!token) {
    return c.json({ error: 'Token is required', code: 'MISSING_TOKEN' }, 400);
  }

  // Validate token
  const validateResult = await MagicLinkService.validate(token);
  if (!validateResult.success) {
    return c.json({ 
      error: validateResult.error, 
      code: validateResult.code 
    }, 400);
  }

  const { userId, email } = validateResult.data!;

  // Hash and set password
  const bcrypt = await import('bcrypt');
  const passwordHash = await bcrypt.hash(body.password, 10);

  // Update user with password and mark verified
  await User.findByIdAndUpdate(userId, {
    passwordHash,
    emailVerified: true,
  });

  // Mark magic link as used
  await MagicLinkService.markUsed(token);

  // Generate tokens for immediate login
  const tokenResult = await AuthService.generateTokens(userId, email);

  if (!tokenResult.success) {
    return c.json({ 
      success: true, 
      message: 'Password set successfully. Please login.',
    });
  }

  console.log(`🔐 Password set via magic link for ${email}`);

  return c.json({
    success: true,
    message: 'Password set successfully',
    accessToken: tokenResult.data!.accessToken,
    refreshToken: tokenResult.data!.refreshToken,
    user: {
      email,
      emailVerified: true,
    },
  });
});

export { auth as authRoutes };


