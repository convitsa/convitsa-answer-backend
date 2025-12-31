import { Types } from 'mongoose';
import { CreditBalance, CreditTransaction, User } from '../db/schemas';
import type { ServiceResult } from '../types';
import { calculateCredits, getCostBreakdown } from '../utils/helpers';
import { EmailService } from './email.service';

// Threshold for low credits warning (send when balance drops below this)
const LOW_CREDITS_THRESHOLD = 100;

export class CreditService {
  /**
   * Get credit balance for a user
   */
  static async getBalance(userId: string): Promise<number> {
    const balance = await CreditBalance.findOne({ userId: new Types.ObjectId(userId) });
    return balance?.balance ?? 0;
  }

  /**
   * Add credits to user balance
   */
  static async addCredits(
    userId: string,
    amount: number,
    reason: string
  ): Promise<ServiceResult<{ newBalance: number }>> {
    try {
      const userObjId = new Types.ObjectId(userId);

      // Update or create balance
      const result = await CreditBalance.findOneAndUpdate(
        { userId: userObjId },
        {
          $inc: { balance: amount },
          $set: { updatedAt: new Date() },
          $setOnInsert: { userId: userObjId },
        },
        { upsert: true, new: true }
      );

      // Record transaction
      await CreditTransaction.create({
        userId: userObjId,
        amount,
        type: 'credit',
        reason,
        createdAt: new Date(),
      });

      return {
        success: true,
        data: { newBalance: result.balance },
      };
    } catch (error) {
      console.error('Add credits error:', error);
      return {
        success: false,
        error: 'Failed to add credits',
        code: 'ADD_FAILED',
      };
    }
  }

  /**
   * Deduct credits from user balance
   * Includes 25% platform commission for Pro tier
   * Returns success even if insufficient balance (balance goes to 0)
   */
  static async deductCredits(
    userId: string,
    tokens: number,
    sessionId: string,
    reason: string = 'Chat usage'
  ): Promise<ServiceResult<{ creditsDeducted: number; newBalance: number; breakdown: ReturnType<typeof getCostBreakdown> }>> {
    try {
      const userObjId = new Types.ObjectId(userId);
      
      // Calculate credits with 25% platform commission
      const breakdown = getCostBreakdown(tokens);
      const creditsToDeduct = breakdown.totalCredits;

      // Get current balance
      const currentBalance = await this.getBalance(userId);

      // Calculate actual deduction (don't go negative)
      const actualDeduction = Math.min(creditsToDeduct, currentBalance);

      if (actualDeduction <= 0) {
        return {
          success: true,
          data: { 
            creditsDeducted: 0, 
            newBalance: 0,
            breakdown: { tokens: 0, baseCredits: 0, commissionRate: 0.25, commission: 0, totalCredits: 0 }
          },
        };
      }

      // Deduct credits
      const result = await CreditBalance.findOneAndUpdate(
        { userId: userObjId },
        {
          $inc: { balance: -actualDeduction },
          $set: { updatedAt: new Date() },
        },
        { new: true }
      );

      // Record transaction with detailed breakdown
      await CreditTransaction.create({
        userId: userObjId,
        amount: actualDeduction,
        type: 'debit',
        reason: `${reason} (${tokens} tokens, ${breakdown.baseCredits} base + ${breakdown.commission} commission)`,
        sessionId: new Types.ObjectId(sessionId),
        createdAt: new Date(),
      });

      const newBalance = result?.balance ?? 0;

      // Send email notifications based on new balance (non-blocking)
      this.sendCreditNotifications(userId, newBalance).catch((err) => {
        console.error('Failed to send credit notification:', err);
      });

      return {
        success: true,
        data: {
          creditsDeducted: actualDeduction,
          newBalance,
          breakdown,
        },
      };
    } catch (error) {
      console.error('Deduct credits error:', error);
      return {
        success: false,
        error: 'Failed to deduct credits',
        code: 'DEDUCT_FAILED',
      };
    }
  }

  /**
   * Check if user has sufficient credits for estimated usage
   */
  static async hasCredits(userId: string): Promise<boolean> {
    const balance = await this.getBalance(userId);
    return balance > 0;
  }

  /**
   * Get credit transaction history
   */
  static async getTransactionHistory(
    userId: string,
    page: number = 1,
    limit: number = 20
  ): Promise<{
    transactions: Array<{
      amount: number;
      type: 'credit' | 'debit';
      reason: string;
      createdAt: Date;
    }>;
    total: number;
  }> {
    const skip = (page - 1) * limit;
    const userObjId = new Types.ObjectId(userId);

    const [transactions, total] = await Promise.all([
      CreditTransaction.find({ userId: userObjId })
        .select('amount type reason createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      CreditTransaction.countDocuments({ userId: userObjId }),
    ]);

    return {
      transactions: transactions.map((t) => ({
        amount: t.amount,
        type: t.type,
        reason: t.reason,
        createdAt: t.createdAt,
      })),
      total,
    };
  }

  /**
   * Send credit-related email notifications based on balance
   */
  private static async sendCreditNotifications(userId: string, newBalance: number): Promise<void> {
    try {
      // Get user email
      const user = await User.findById(userId).select('email').lean();
      if (!user?.email) return;

      // Credits depleted
      if (newBalance === 0) {
        await EmailService.sendCreditsDepletedEmail(user.email);
        console.log(`✉️ Sent credits depleted email to ${user.email}`);
        return;
      }

      // Low credits warning (only if just crossed threshold)
      if (newBalance > 0 && newBalance < LOW_CREDITS_THRESHOLD) {
        // Check if we recently sent a low credits warning (within last 24 hours)
        const recentLowCreditsEmail = await CreditTransaction.findOne({
          userId: new Types.ObjectId(userId),
          reason: { $regex: /low credits warning sent/i },
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        }).lean();

        if (!recentLowCreditsEmail) {
          await EmailService.sendLowCreditsWarningEmail(user.email, newBalance);
          
          // Mark that we sent the warning (to avoid spamming)
          await CreditTransaction.create({
            userId: new Types.ObjectId(userId),
            amount: 0,
            type: 'debit',
            reason: 'Low credits warning sent (notification)',
            createdAt: new Date(),
          });
          
          console.log(`✉️ Sent low credits warning email to ${user.email}`);
        }
      }
    } catch (error) {
      console.error('Error sending credit notifications:', error);
    }
  }
}

