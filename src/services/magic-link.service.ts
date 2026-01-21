import crypto from 'crypto';
import { MagicLink } from '../db/schemas';
import { env } from '../config/env';
import type { ServiceResult } from '../types';

export class MagicLinkService {
  /**
   * Generate a secure random token
   */
  private static generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Hash a token for storage
   */
  private static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Create a new magic link for a user
   * Returns the plain token (to be sent to user) - only returned once
   */
  static async create(userId: string): Promise<ServiceResult<{ token: string; expiresAt: Date }>> {
    try {
      // Invalidate any existing magic links for this user
      await MagicLink.updateMany(
        { userId, usedAt: null },
        { $set: { usedAt: new Date() } }
      );

      // Generate new token
      const plainToken = this.generateToken();
      const hashedToken = this.hashToken(plainToken);

      // Calculate expiry (default 24 hours)
      const expiryHours = env.MAGIC_LINK_EXPIRY_HOURS || 24;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiryHours);

      // Store hashed token
      await MagicLink.create({
        userId,
        token: hashedToken,
        expiresAt,
      });

      console.log(`🔗 Magic link created for user ${userId}, expires at ${expiresAt.toISOString()}`);

      return {
        success: true,
        data: {
          token: plainToken, // Return plain token to be sent to user
          expiresAt,
        },
      };
    } catch (error) {
      console.error('Failed to create magic link:', error);
      return {
        success: false,
        error: 'Failed to create magic link',
        code: 'MAGIC_LINK_CREATE_FAILED',
      };
    }
  }

  /**
   * Validate a magic link token
   * Returns the user ID if valid
   */
  static async validate(token: string): Promise<ServiceResult<{ userId: string; email: string }>> {
    try {
      const hashedToken = this.hashToken(token);

      // Find the magic link
      const magicLink = await MagicLink.findOne({
        token: hashedToken,
      }).populate('userId', 'email');

      if (!magicLink) {
        return {
          success: false,
          error: 'Invalid or expired link',
          code: 'INVALID_TOKEN',
        };
      }

      // Check if already used
      if (magicLink.usedAt) {
        return {
          success: false,
          error: 'This link has already been used',
          code: 'TOKEN_USED',
        };
      }

      // Check if expired
      if (new Date() > magicLink.expiresAt) {
        return {
          success: false,
          error: 'This link has expired',
          code: 'TOKEN_EXPIRED',
        };
      }

      // Get user email from populated field
      const user = magicLink.userId as any;
      
      return {
        success: true,
        data: {
          userId: magicLink.userId.toString(),
          email: user.email || '',
        },
      };
    } catch (error) {
      console.error('Failed to validate magic link:', error);
      return {
        success: false,
        error: 'Failed to validate link',
        code: 'VALIDATION_FAILED',
      };
    }
  }

  /**
   * Mark a magic link as used
   */
  static async markUsed(token: string): Promise<ServiceResult<void>> {
    try {
      const hashedToken = this.hashToken(token);

      const result = await MagicLink.findOneAndUpdate(
        {
          token: hashedToken,
          usedAt: null,
        },
        {
          $set: { usedAt: new Date() },
        }
      );

      if (!result) {
        return {
          success: false,
          error: 'Token not found or already used',
          code: 'TOKEN_NOT_FOUND',
        };
      }

      console.log(`🔗 Magic link marked as used`);

      return { success: true };
    } catch (error) {
      console.error('Failed to mark magic link as used:', error);
      return {
        success: false,
        error: 'Failed to mark link as used',
        code: 'MARK_USED_FAILED',
      };
    }
  }

  /**
   * Clean up expired magic links (can be run periodically)
   */
  static async cleanupExpired(): Promise<number> {
    try {
      const result = await MagicLink.deleteMany({
        $or: [
          { expiresAt: { $lt: new Date() } },
          { usedAt: { $ne: null } },
        ],
      });

      if (result.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${result.deletedCount} expired/used magic links`);
      }

      return result.deletedCount;
    } catch (error) {
      console.error('Failed to cleanup magic links:', error);
      return 0;
    }
  }
}
