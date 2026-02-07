import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ISubscription, SubscriptionTier, SubscriptionStatus, BillingInterval } from '../../types';

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
      enum: ['pending', 'active', 'on_hold', 'cancelled', 'failed', 'expired'] as SubscriptionStatus[],
      default: 'active',
      required: true,
    },
    billingInterval: {
      type: String,
      enum: ['monthly', 'yearly'] as BillingInterval[],
      default: 'monthly',
    },
    // Stripe fields
    stripeCustomerId: {
      type: String,
      trim: true,
    },
    stripeSubscriptionId: {
      type: String,
      trim: true,
    },
    stripePriceId: {
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
subscriptionSchema.index({ stripeCustomerId: 1 }, { sparse: true });
subscriptionSchema.index({ stripeSubscriptionId: 1 }, { sparse: true });
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
