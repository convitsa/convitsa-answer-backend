import { Types } from 'mongoose';
import { Subscription, User, Project } from '../db/schemas';
import { getSubscriptionPlan, env, openAIToConvitsaTokens } from '../config/env';
import { EmailService } from './email.service';
import type { ISubscription, SubscriptionTier, SubscriptionStatus, ServiceResult } from '../types';

// Low tokens warning threshold (% of limit)
const LOW_TOKENS_THRESHOLD_PERCENT = 10;

export interface CreateSubscriptionInput {
  tier: SubscriptionTier;
  dodoCustomerId?: string;
  dodoSubscriptionId?: string;
  dodoProductId?: string;
  currentPeriodEnd: Date;
  bonusTokens?: number; // For affiliate referrals
}

export interface UpdateSubscriptionInput {
  tier?: SubscriptionTier;
  status?: SubscriptionStatus;
  dodoCustomerId?: string;
  dodoSubscriptionId?: string;
  dodoProductId?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface UsageStats {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  tokensUsed: number;
  tokensLimit: number;
  bonusTokens: number;
  effectiveLimit: number;
  tokensRemaining: number;
  usagePercent: number;
  projectsUsed: number;
  projectsLimit: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  daysRemaining: number;
  cancelAtPeriodEnd: boolean;
}

export class SubscriptionService {
  /**
   * Get subscription for a user (creates free tier if none exists)
   */
  static async getSubscription(userId: string): Promise<ISubscription> {
    let subscription = await Subscription.findOne({ 
      userId: new Types.ObjectId(userId) 
    }).lean() as ISubscription | null;

    if (!subscription) {
      // Create free tier subscription for new users
      subscription = await this.createFreeSubscription(userId);
    }

    // Check if period needs reset
    if (new Date() >= subscription.currentPeriodEnd) {
      subscription = await this.resetPeriod(userId);
    }

    return subscription;
  }

  /**
   * Create a free subscription for a new user
   */
  static async createFreeSubscription(userId: string): Promise<ISubscription> {
    const freePlan = getSubscriptionPlan('free');
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const subscription = await Subscription.create({
      userId: new Types.ObjectId(userId),
      tier: 'free',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      tokensUsedThisMonth: 0,
      tokensLimit: freePlan.tokensPerMonth,
      projectsLimit: freePlan.projectsLimit,
      bonusTokens: 0,
    });

    console.log(`📝 Created free subscription for user ${userId}`);
    return subscription.toObject() as ISubscription;
  }

  /**
   * Create or update subscription from webhook
   */
  static async createSubscription(
    userId: string,
    input: CreateSubscriptionInput
  ): Promise<ServiceResult<ISubscription>> {
    try {
      const plan = getSubscriptionPlan(input.tier);
      const now = new Date();

      // Build update object
      const updateSet: Record<string, any> = {
        tier: input.tier,
        status: 'active',
        dodoCustomerId: input.dodoCustomerId,
        dodoSubscriptionId: input.dodoSubscriptionId,
        dodoProductId: input.dodoProductId,
        currentPeriodStart: now,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: false,
        tokensUsedThisMonth: 0,
        tokensLimit: plan.tokensPerMonth,
        projectsLimit: plan.projectsLimit,
        updatedAt: now,
      };
      
      // Add bonus tokens if provided (affiliate referral)
      if (input.bonusTokens && input.bonusTokens > 0) {
        updateSet.bonusTokens = input.bonusTokens;
      }

      const subscription = await Subscription.findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $set: updateSet,
          $setOnInsert: {
            bonusTokens: input.bonusTokens || 0,
            migratedFromCredits: 0,
          },
        },
        { upsert: true, new: true }
      );

      console.log(`✅ Created/updated subscription for user ${userId}: ${input.tier}`);

      // Send welcome email for paid plans
      if (input.tier !== 'free') {
        const user = await User.findById(userId).select('email').lean();
        if (user?.email) {
          // TODO: Create subscription welcome email
          console.log(`📧 Would send subscription welcome email to ${user.email}`);
        }
      }

      return {
        success: true,
        data: subscription.toObject() as ISubscription,
      };
    } catch (error) {
      console.error('Create subscription error:', error);
      return {
        success: false,
        error: 'Failed to create subscription',
        code: 'CREATE_FAILED',
      };
    }
  }

  /**
   * Update subscription (tier change, status change, etc.)
   */
  static async updateSubscription(
    userId: string,
    input: UpdateSubscriptionInput
  ): Promise<ServiceResult<ISubscription>> {
    try {
      const updateData: any = { updatedAt: new Date() };

      if (input.tier) {
        const plan = getSubscriptionPlan(input.tier);
        updateData.tier = input.tier;
        updateData.tokensLimit = plan.tokensPerMonth;
        updateData.projectsLimit = plan.projectsLimit;
      }
      if (input.status) updateData.status = input.status;
      if (input.dodoCustomerId) updateData.dodoCustomerId = input.dodoCustomerId;
      if (input.dodoSubscriptionId) updateData.dodoSubscriptionId = input.dodoSubscriptionId;
      if (input.dodoProductId) updateData.dodoProductId = input.dodoProductId;
      if (input.currentPeriodStart) updateData.currentPeriodStart = input.currentPeriodStart;
      if (input.currentPeriodEnd) updateData.currentPeriodEnd = input.currentPeriodEnd;
      if (typeof input.cancelAtPeriodEnd === 'boolean') updateData.cancelAtPeriodEnd = input.cancelAtPeriodEnd;

      const subscription = await Subscription.findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { $set: updateData },
        { new: true }
      ).lean();

      if (!subscription) {
        return {
          success: false,
          error: 'Subscription not found',
          code: 'NOT_FOUND',
        };
      }

      console.log(`✅ Updated subscription for user ${userId}`);

      return {
        success: true,
        data: subscription as ISubscription,
      };
    } catch (error) {
      console.error('Update subscription error:', error);
      return {
        success: false,
        error: 'Failed to update subscription',
        code: 'UPDATE_FAILED',
      };
    }
  }

  /**
   * Cancel subscription (sets cancelAtPeriodEnd)
   */
  static async cancelSubscription(userId: string): Promise<ServiceResult<ISubscription>> {
    return this.updateSubscription(userId, { cancelAtPeriodEnd: true });
  }

  /**
   * Reactivate a cancelled subscription
   */
  static async reactivateSubscription(userId: string): Promise<ServiceResult<ISubscription>> {
    return this.updateSubscription(userId, { cancelAtPeriodEnd: false, status: 'active' });
  }

  /**
   * Check if user has tokens remaining
   */
  static async hasTokensRemaining(userId: string): Promise<boolean> {
    const subscription = await this.getSubscription(userId);
    const effectiveLimit = subscription.tokensLimit + subscription.bonusTokens;
    return subscription.tokensUsedThisMonth < effectiveLimit;
  }

  /**
   * Get remaining tokens for a user
   */
  static async getTokensRemaining(userId: string): Promise<number> {
    const subscription = await this.getSubscription(userId);
    const effectiveLimit = subscription.tokensLimit + subscription.bonusTokens;
    return Math.max(0, effectiveLimit - subscription.tokensUsedThisMonth);
  }

  /**
   * Deduct tokens from user's monthly usage
   * @param userId - User ID
   * @param openAITokens - Raw OpenAI tokens from the API response
   * @param sessionId - Optional session ID for tracking
   * @param reason - Reason for deduction
   * 
   * Note: openAITokens are converted to Convitsa tokens before deduction
   * Default rate: 100 OpenAI tokens = 1 Convitsa token
   */
  static async deductTokens(
    userId: string,
    openAITokens: number,
    sessionId?: string,
    reason: string = 'Chat usage'
  ): Promise<ServiceResult<{ tokensDeducted: number; tokensRemaining: number; openAITokensUsed: number }>> {
    try {
      // Convert OpenAI tokens to Convitsa tokens
      const convitsaTokens = openAIToConvitsaTokens(openAITokens);
      
      console.log(`📊 Token conversion: ${openAITokens} OpenAI tokens → ${convitsaTokens} Convitsa tokens`);

      const subscription = await this.getSubscription(userId);
      const effectiveLimit = subscription.tokensLimit + subscription.bonusTokens;
      const tokensRemaining = Math.max(0, effectiveLimit - subscription.tokensUsedThisMonth);

      // Deduct what we can (don't go over limit)
      const tokensToDeduct = Math.min(convitsaTokens, tokensRemaining);

      if (tokensToDeduct <= 0) {
        return {
          success: true,
          data: { tokensDeducted: 0, tokensRemaining: 0, openAITokensUsed: openAITokens },
        };
      }

      // Update usage
      const result = await Subscription.findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $inc: { tokensUsedThisMonth: tokensToDeduct },
          $set: { updatedAt: new Date() },
        },
        { new: true }
      ).lean();

      const newRemaining = Math.max(0, effectiveLimit - (result?.tokensUsedThisMonth || 0));

      console.log(`📊 Deducted ${tokensToDeduct} Convitsa tokens for user ${userId}. Remaining: ${newRemaining}`);

      // Send low tokens warning if needed
      this.checkAndSendLowTokensWarning(userId, result as ISubscription).catch((err) => {
        console.error('Failed to send low tokens warning:', err);
      });

      return {
        success: true,
        data: {
          tokensDeducted: tokensToDeduct,
          tokensRemaining: newRemaining,
          openAITokensUsed: openAITokens,
        },
      };
    } catch (error) {
      console.error('Deduct tokens error:', error);
      return {
        success: false,
        error: 'Failed to deduct tokens',
        code: 'DEDUCT_FAILED',
      };
    }
  }

  /**
   * Reset monthly usage when period ends
   */
  static async resetPeriod(userId: string): Promise<ISubscription> {
    const now = new Date();
    const newPeriodEnd = new Date(now);
    newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);

    const subscription = await Subscription.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          tokensUsedThisMonth: 0,
          currentPeriodStart: now,
          currentPeriodEnd: newPeriodEnd,
          updatedAt: now,
        },
      },
      { new: true }
    ).lean();

    console.log(`🔄 Reset monthly usage for user ${userId}`);

    return subscription as ISubscription;
  }

  /**
   * Get usage statistics for dashboard
   */
  static async getUsageStats(userId: string): Promise<UsageStats> {
    const subscription = await this.getSubscription(userId);
    const effectiveLimit = subscription.tokensLimit + subscription.bonusTokens;
    const tokensRemaining = Math.max(0, effectiveLimit - subscription.tokensUsedThisMonth);
    const usagePercent = effectiveLimit > 0 
      ? Math.round((subscription.tokensUsedThisMonth / effectiveLimit) * 100) 
      : 0;

    // Count user's projects
    const projectsUsed = await Project.countDocuments({ 
      userId: new Types.ObjectId(userId) 
    });

    // Calculate days remaining in period
    const now = new Date();
    const daysRemaining = Math.max(0, Math.ceil(
      (subscription.currentPeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    ));

    return {
      tier: subscription.tier,
      status: subscription.status,
      tokensUsed: subscription.tokensUsedThisMonth,
      tokensLimit: subscription.tokensLimit,
      bonusTokens: subscription.bonusTokens,
      effectiveLimit,
      tokensRemaining,
      usagePercent,
      projectsUsed,
      projectsLimit: subscription.projectsLimit,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      daysRemaining,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    };
  }

  /**
   * Check if user can create more projects
   */
  static async canCreateProject(userId: string): Promise<boolean> {
    const subscription = await this.getSubscription(userId);
    const projectsCount = await Project.countDocuments({ 
      userId: new Types.ObjectId(userId) 
    });
    return projectsCount < subscription.projectsLimit;
  }

  /**
   * Add bonus tokens (e.g., from promotion or migration)
   */
  static async addBonusTokens(userId: string, tokens: number, reason: string): Promise<ServiceResult<ISubscription>> {
    try {
      const subscription = await Subscription.findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $inc: { bonusTokens: tokens },
          $set: { updatedAt: new Date() },
        },
        { new: true }
      ).lean();

      if (!subscription) {
        return {
          success: false,
          error: 'Subscription not found',
          code: 'NOT_FOUND',
        };
      }

      console.log(`🎁 Added ${tokens} bonus tokens to user ${userId}: ${reason}`);

      return {
        success: true,
        data: subscription as ISubscription,
      };
    } catch (error) {
      console.error('Add bonus tokens error:', error);
      return {
        success: false,
        error: 'Failed to add bonus tokens',
        code: 'ADD_FAILED',
      };
    }
  }

  /**
   * Check and send low tokens warning email
   */
  private static async checkAndSendLowTokensWarning(
    userId: string,
    subscription: ISubscription
  ): Promise<void> {
    const effectiveLimit = subscription.tokensLimit + subscription.bonusTokens;
    const tokensRemaining = effectiveLimit - subscription.tokensUsedThisMonth;
    const usagePercent = (subscription.tokensUsedThisMonth / effectiveLimit) * 100;

    // Only warn if usage is above threshold
    if (usagePercent < (100 - LOW_TOKENS_THRESHOLD_PERCENT)) {
      return;
    }

    // Get user email
    const user = await User.findById(userId).select('email').lean();
    if (!user?.email) return;

    // Check if we already sent a warning recently (within last 24 hours)
    // We could track this in the subscription document or use Redis
    // For simplicity, we'll just warn once when crossing the threshold

    if (tokensRemaining === 0) {
      // Tokens depleted
      console.log(`⚠️ Tokens depleted for user ${userId}`);
      // TODO: Send tokens depleted email
    } else if (usagePercent >= (100 - LOW_TOKENS_THRESHOLD_PERCENT)) {
      // Low tokens warning
      console.log(`⚠️ Low tokens warning for user ${userId}: ${tokensRemaining} remaining`);
      // TODO: Send low tokens warning email
    }
  }

  /**
   * Find subscription by Dodo Payments subscription ID
   */
  static async findByDodoSubscriptionId(subscriptionId: string): Promise<ISubscription | null> {
    const subscription = await Subscription.findOne({
      dodoSubscriptionId: subscriptionId,
    }).lean();
    return subscription as ISubscription | null;
  }

  /**
   * Find subscription by Dodo Payments customer ID
   */
  static async findByDodoCustomerId(customerId: string): Promise<ISubscription | null> {
    const subscription = await Subscription.findOne({
      dodoCustomerId: customerId,
    }).lean();
    return subscription as ISubscription | null;
  }

  /**
   * Handle subscription expiration (for cancelled subscriptions)
   */
  static async handleExpiration(userId: string): Promise<void> {
    const subscription = await this.getSubscription(userId);
    
    if (subscription.cancelAtPeriodEnd && new Date() >= subscription.currentPeriodEnd) {
      // Downgrade to free tier
      const freePlan = getSubscriptionPlan('free');
      await this.updateSubscription(userId, {
        tier: 'free',
        status: 'active',
        cancelAtPeriodEnd: false,
      });

      // Reset to free tier limits
      await Subscription.findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        {
          $set: {
            tokensLimit: freePlan.tokensPerMonth,
            projectsLimit: freePlan.projectsLimit,
            tokensUsedThisMonth: 0,
          },
        }
      );

      console.log(`⏰ Subscription expired for user ${userId}, downgraded to free`);
    }
  }
}
