import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { env } from '../config/env';
import { User, EmailVerification, CreditBalance } from '../db/schemas';
import type { JwtPayload, ServiceResult } from '../types';
import { generateVerificationCode, hashSHA256 } from '../utils/helpers';
import { EmailService } from './email.service';

const SALT_ROUNDS = 12;
const VERIFICATION_EXPIRY_MINUTES = 10;

export interface SignupResult {
  userId: string;
  email: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
  };
}

export class AuthService {
  /**
   * Register a new user
   */
  static async signup(email: string, password: string): Promise<ServiceResult<SignupResult>> {
    try {
      // Check if user already exists
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return {
          success: false,
          error: 'Email already registered',
          code: 'EMAIL_EXISTS',
        };
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

      // Create user
      const user = await User.create({
        email: email.toLowerCase(),
        passwordHash,
        emailVerified: false,
        createdAt: new Date(),
      });

      // Create credit balance for user (starting with 0)
      await CreditBalance.create({
        userId: user._id,
        balance: 0,
        updatedAt: new Date(),
      });

      // Generate and send verification code
      await this.sendVerificationCode(user._id.toString(), email);

      return {
        success: true,
        data: {
          userId: user._id.toString(),
          email: user.email,
        },
      };
    } catch (error) {
      console.error('Signup error:', error);
      return {
        success: false,
        error: 'Failed to create account',
        code: 'SIGNUP_FAILED',
      };
    }
  }

  /**
   * Send verification code to user email
   */
  static async sendVerificationCode(userId: string, email: string): Promise<ServiceResult<void>> {
    try {
      // Generate 6-digit code
      const code = generateVerificationCode();
      const codeHash = hashSHA256(code);
      const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MINUTES * 60 * 1000);

      // Remove any existing verification codes for this user
      await EmailVerification.deleteMany({ userId: new Types.ObjectId(userId) });

      // Store new verification code
      await EmailVerification.create({
        userId: new Types.ObjectId(userId),
        codeHash,
        expiresAt,
        createdAt: new Date(),
      });

      // Send email
      await EmailService.sendVerificationEmail(email, code);

      return { success: true };
    } catch (error) {
      console.error('Send verification error:', error);
      return {
        success: false,
        error: 'Failed to send verification email',
        code: 'EMAIL_SEND_FAILED',
      };
    }
  }

  /**
   * Verify email with code
   */
  static async verifyEmail(email: string, code: string): Promise<ServiceResult<LoginResult>> {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return {
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        };
      }

      if (user.emailVerified) {
        return {
          success: false,
          error: 'Email already verified',
          code: 'ALREADY_VERIFIED',
        };
      }

      // Find verification record
      const verification = await EmailVerification.findOne({
        userId: user._id,
        expiresAt: { $gt: new Date() },
      });

      if (!verification) {
        return {
          success: false,
          error: 'Verification code expired or not found',
          code: 'CODE_EXPIRED',
        };
      }

      // Check code
      const codeHash = hashSHA256(code);
      if (codeHash !== verification.codeHash) {
        return {
          success: false,
          error: 'Invalid verification code',
          code: 'INVALID_CODE',
        };
      }

      // Mark email as verified
      user.emailVerified = true;
      await user.save();

      // Delete verification record
      await EmailVerification.deleteOne({ _id: verification._id });

      // Send welcome email (non-blocking)
      EmailService.sendWelcomeEmail(user.email).catch((err) => {
        console.error('Failed to send welcome email:', err);
      });

      // Generate tokens
      const tokens = this.generateTokens(user._id.toString(), user.email);

      return {
        success: true,
        data: {
          ...tokens,
          user: {
            id: user._id.toString(),
            email: user.email,
          },
        },
      };
    } catch (error) {
      console.error('Verify email error:', error);
      return {
        success: false,
        error: 'Verification failed',
        code: 'VERIFICATION_FAILED',
      };
    }
  }

  /**
   * Login with email and password
   */
  static async login(email: string, password: string): Promise<ServiceResult<LoginResult>> {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return {
          success: false,
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        };
      }

      // Check if email is verified
      if (!user.emailVerified) {
        return {
          success: false,
          error: 'Please verify your email before logging in',
          code: 'EMAIL_NOT_VERIFIED',
        };
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        return {
          success: false,
          error: 'Invalid email or password',
          code: 'INVALID_CREDENTIALS',
        };
      }

      // Generate tokens
      const tokens = this.generateTokens(user._id.toString(), user.email);

      return {
        success: true,
        data: {
          ...tokens,
          user: {
            id: user._id.toString(),
            email: user.email,
          },
        },
      };
    } catch (error) {
      console.error('Login error:', error);
      return {
        success: false,
        error: 'Login failed',
        code: 'LOGIN_FAILED',
      };
    }
  }

  /**
   * Refresh access token
   */
  static async refreshToken(refreshToken: string): Promise<ServiceResult<{ accessToken: string }>> {
    try {
      const payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as JwtPayload;

      // Check if user still exists
      const user = await User.findById(payload.userId);
      if (!user) {
        return {
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND',
        };
      }

      // Generate new access token
      const accessToken = jwt.sign(
        { userId: user._id.toString(), email: user.email },
        env.JWT_SECRET,
        { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
      );

      return {
        success: true,
        data: { accessToken },
      };
    } catch (error) {
      return {
        success: false,
        error: 'Invalid refresh token',
        code: 'INVALID_TOKEN',
      };
    }
  }

  /**
   * Verify JWT token
   */
  static verifyToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    } catch {
      return null;
    }
  }

  /**
   * Generate access and refresh tokens
   */
  private static generateTokens(userId: string, email: string): { accessToken: string; refreshToken: string } {
    const accessToken = jwt.sign(
      { userId, email },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
    );

    const refreshToken = jwt.sign(
      { userId, email },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'] }
    );

    return { accessToken, refreshToken };
  }

  /**
   * Request password reset
   */
  static async forgotPassword(email: string): Promise<ServiceResult<void>> {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        // Return success even if user doesn't exist (security)
        return { success: true };
      }

      // Generate reset code (reusing verification flow)
      const code = generateVerificationCode();
      const codeHash = hashSHA256(code);
      const expiresAt = new Date(Date.now() + VERIFICATION_EXPIRY_MINUTES * 60 * 1000);

      await EmailVerification.deleteMany({ userId: user._id });
      await EmailVerification.create({
        userId: user._id,
        codeHash,
        expiresAt,
        createdAt: new Date(),
      });

      await EmailService.sendPasswordResetEmail(email, code);

      return { success: true };
    } catch (error) {
      console.error('Forgot password error:', error);
      return {
        success: false,
        error: 'Failed to process request',
        code: 'REQUEST_FAILED',
      };
    }
  }

  /**
   * Reset password with code
   */
  static async resetPassword(email: string, code: string, newPassword: string): Promise<ServiceResult<void>> {
    try {
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return {
          success: false,
          error: 'Invalid request',
          code: 'INVALID_REQUEST',
        };
      }

      const verification = await EmailVerification.findOne({
        userId: user._id,
        expiresAt: { $gt: new Date() },
      });

      if (!verification) {
        return {
          success: false,
          error: 'Reset code expired',
          code: 'CODE_EXPIRED',
        };
      }

      const codeHash = hashSHA256(code);
      if (codeHash !== verification.codeHash) {
        return {
          success: false,
          error: 'Invalid reset code',
          code: 'INVALID_CODE',
        };
      }

      // Update password
      user.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
      await user.save();

      // Delete verification record
      await EmailVerification.deleteOne({ _id: verification._id });

      return { success: true };
    } catch (error) {
      console.error('Reset password error:', error);
      return {
        success: false,
        error: 'Password reset failed',
        code: 'RESET_FAILED',
      };
    }
  }
}

