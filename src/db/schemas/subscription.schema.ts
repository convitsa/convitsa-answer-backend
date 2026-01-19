import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ISubscription, SubscriptionTier, SubscriptionStatus } from '../../types';

export interface SubscriptionDocument extends Omit<ISubscription, '_id'>, Document {}

const subscriptionSchema = new Schema<SubscriptionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    tier: {
      type: String,
      enum: ['free', 'pro', 'business'] as SubscriptionTier[],
      default: 'free',
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'cancelled', 'past_due', 'paused', 'trialing'] as SubscriptionStatus[],
      default: 'active',
      required: true,
    },
    lemonSqueezyCustomerId: {
      type: String,
      trim: true,
      sparse: true,
    },
    lemonSqueezySubscriptionId: {
      type: String,
      trim: true,
      sparse: true,
    },
    lemonSqueezyVariantId: {
      type: String,
      trim: true,
    },
    currentPeriodStart: {
      type: Date,
      default: Date.now,
      required: true,
    },
    currentPeriodEnd: {
      type: Date,
      required: true,
    },
    cancelAtPeriodEnd: {
      type: Boolean,
      default: false,
    },
    tokensUsedThisMonth: {
      type: Number,
      default: 0,
      min: 0,
    },
    tokensLimit: {
      type: Number,
      required: true,
      default: 10000, // Free tier default
    },
    projectsLimit: {
      type: Number,
      required: true,
      default: 1, // Free tier default
    },
    // Migration fields for existing credit users
    migratedFromCredits: {
      type: Number,
      default: 0,
    },
    bonusTokens: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
subscriptionSchema.index({ lemonSqueezyCustomerId: 1 }, { sparse: true });
subscriptionSchema.index({ lemonSqueezySubscriptionId: 1 }, { sparse: true });
subscriptionSchema.index({ status: 1 });
subscriptionSchema.index({ tier: 1 });
subscriptionSchema.index({ currentPeriodEnd: 1 });

// Virtual to get effective token limit (includes bonus tokens)
subscriptionSchema.virtual('effectiveTokensLimit').get(function () {
  return this.tokensLimit + this.bonusTokens;
});

// Virtual to get remaining tokens
subscriptionSchema.virtual('tokensRemaining').get(function () {
  const effectiveLimit = this.tokensLimit + this.bonusTokens;
  return Math.max(0, effectiveLimit - this.tokensUsedThisMonth);
});

// Method to check if subscription needs period reset
subscriptionSchema.methods.needsPeriodReset = function (): boolean {
  return new Date() >= this.currentPeriodEnd;
};

// Method to reset monthly usage
subscriptionSchema.methods.resetMonthlyUsage = function (newPeriodEnd: Date): void {
  this.currentPeriodStart = new Date();
  this.currentPeriodEnd = newPeriodEnd;
  this.tokensUsedThisMonth = 0;
};

export const Subscription: Model<SubscriptionDocument> = mongoose.model<SubscriptionDocument>(
  'Subscription',
  subscriptionSchema
);
