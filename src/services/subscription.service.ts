import { Types } from 'mongoose';
import Stripe from 'stripe';
import { Subscription, User, Project } from '../db/schemas';
import { getSubscriptionPlan, env, openAIToConvitsaTokens } from '../config/env';
import { EmailService } from './email.service';
import type { ISubscription, SubscriptionTier, SubscriptionStatus, BillingInterval, ServiceResult } from '../types';

// Initialize Stripe client for subscription management
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// Low tokens warning threshold (% of limit)
const LOW_TOKENS_THRESHOLD_PERCENT = 10;

export interface CreateSubscriptionInput {
  tier: SubscriptionTier;
  billingInterval?: BillingInterval;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  currentPeriodEnd: Date;
  bonusTokens?: number; // For affiliate referrals
}

export interface UpdateSubscriptionInput {
  tier?: SubscriptionTier;
  status?: SubscriptionStatus;
  billingInterval?: BillingInterval;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
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
      // Log error but DO NOT auto-create free subscription
      console.error(`❌ No subscription found for userId=${userId}. User must have a subscription record.`);
      throw new Error(`No subscription found for user ${userId}`);
    }
    
    console.log(`📋 Found subscription for userId=${userId}: tier=${subscription.tier}, status=${subscription.status}`);

    // Check if tokens need to be reset (based on tokenResetDate, always monthly)
    const tokenResetDate = subscription.tokenResetDate || subscription.currentPeriodEnd;
    if (new Date() >= tokenResetDate) {
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
      tokenResetDate: periodEnd, // Tokens reset monthly
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
      const billingInterval = input.billingInterval || 'monthly';

      // Calculate token reset date (always 1 month from now, regardless of billing interval)
      const tokenResetDate = new Date(now);
      tokenResetDate.setMonth(tokenResetDate.getMonth() + 1);

      // Build update object
      const updateSet: Record<string, any> = {
        tier: input.tier,
        status: 'active',
        billingInterval,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        stripePriceId: input.stripePriceId,
        currentPeriodStart: now,
        currentPeriodEnd: input.currentPeriodEnd,
        tokenResetDate: tokenResetDate, // Tokens always refresh monthly
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

      console.log(`✅ Created/updated subscription for user ${userId}: ${input.tier} (${billingInterval})`);

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
      if (input.billingInterval) updateData.billingInterval = input.billingInterval;
      if (input.status) updateData.status = input.status;
      if (input.stripeCustomerId) updateData.stripeCustomerId = input.stripeCustomerId;
      if (input.stripeSubscriptionId) updateData.stripeSubscriptionId = input.stripeSubscriptionId;
      if (input.stripePriceId) updateData.stripePriceId = input.stripePriceId;
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
   * Cancel old Stripe subscriptions when user switches to a new plan
   * This is called before creating a new subscription to avoid duplicate billing
   */
  static async cancelOldStripeSubscriptions(
    userId: string,
    newSubscriptionId: string
  ): Promise<void> {
    try {
      // Find existing subscription for this user
      const existingSub = await Subscription.findOne({
        userId: new Types.ObjectId(userId),
      }).lean();

      // If there's an existing Stripe subscription that's different from the new one, cancel it
      if (
        existingSub?.stripeSubscriptionId &&
        existingSub.stripeSubscriptionId !== newSubscriptionId &&
        existingSub.status === 'active'
      ) {
        console.log(`🔄 Cancelling old Stripe subscription ${existingSub.stripeSubscriptionId} for user ${userId}`);
        
        try {
          // Cancel immediately in Stripe (not at period end)
          await stripe.subscriptions.cancel(existingSub.stripeSubscriptionId);
          
          console.log(`✅ Successfully cancelled old subscription ${existingSub.stripeSubscriptionId}`);
        } catch (cancelError) {
          // Log but don't fail - the subscription might already be cancelled
          console.error(`⚠️ Failed to cancel old subscription ${existingSub.stripeSubscriptionId}:`, cancelError);
        }
      }
    } catch (error) {
      console.error('Error checking for old subscriptions:', error);
      // Don't throw - we still want to create the new subscription
    }
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
   * Reset monthly token usage
   * Note: This only resets tokens, not the billing period (which is handled by Stripe webhooks)
   */
  static async resetPeriod(userId: string): Promise<ISubscription> {
    const now = new Date();
    const newTokenResetDate = new Date(now);
    newTokenResetDate.setMonth(newTokenResetDate.getMonth() + 1);

    const subscription = await Subscription.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          tokensUsedThisMonth: 0,
          tokenResetDate: newTokenResetDate,
          updatedAt: now,
        },
      },
      { new: true }
    ).lean();

    console.log(`🔄 Reset monthly token usage for user ${userId}`);

    return subscription as ISubscription;
  }

  /**
   * Check and reset tokens if needed (called when getting subscription)
   */
  static async checkAndResetTokens(subscription: ISubscription): Promise<ISubscription> {
    const now = new Date();
    const tokenResetDate = subscription.tokenResetDate || subscription.currentPeriodEnd;

    if (now >= tokenResetDate) {
      return await this.resetPeriod(subscription.userId.toString());
    }

    return subscription;
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
   * Find subscription by Stripe subscription ID
   */
  static async findByStripeSubscriptionId(subscriptionId: string): Promise<ISubscription | null> {
    const subscription = await Subscription.findOne({
      stripeSubscriptionId: subscriptionId,
    }).lean();
    return subscription as ISubscription | null;
  }

  /**
   * Find subscription by Stripe customer ID
   */
  static async findByStripeCustomerId(customerId: string): Promise<ISubscription | null> {
    const subscription = await Subscription.findOne({
      stripeCustomerId: customerId,
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
