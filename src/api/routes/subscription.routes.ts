import { Hono } from 'hono';
import Stripe from 'stripe';
import { authMiddleware } from '../middleware/auth.middleware';
import { SubscriptionService } from '../../services/subscription.service';
import { env, subscriptionPlans, getSubscriptionPlan, getPriceId, type BillingInterval } from '../../config/env';
import type { SubscriptionTier } from '../../types';

// Initialize Stripe client
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const subscription = new Hono();

// All routes require authentication
subscription.use('*', authMiddleware);

/**
 * GET /subscription
 * Get current user's subscription details
 */
subscription.get('/', async (c) => {
  const user = c.get('user');
  
  const sub = await SubscriptionService.getSubscription(user.userId);
  const plan = getSubscriptionPlan(sub.tier);
  const billingInterval = sub.billingInterval || 'monthly';

  return c.json({
    subscription: {
      id: sub._id.toString(),
      tier: sub.tier,
      status: sub.status,
      billingInterval,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      tokensUsed: sub.tokensUsedThisMonth,
      tokensLimit: sub.tokensLimit,
      bonusTokens: sub.bonusTokens,
      effectiveLimit: sub.tokensLimit + sub.bonusTokens,
      tokensRemaining: Math.max(0, sub.tokensLimit + sub.bonusTokens - sub.tokensUsedThisMonth),
      projectsLimit: sub.projectsLimit,
    },
    plan: {
      name: plan.name,
      price: billingInterval === 'yearly' ? plan.yearlyPrice : plan.price,
      yearlyPrice: plan.yearlyPrice,
      monthlyPrice: plan.price,
      features: plan.features,
    },
  });
});

/**
 * GET /subscription/usage
 * Get detailed usage statistics
 */
subscription.get('/usage', async (c) => {
  const user = c.get('user');
  
  const stats = await SubscriptionService.getUsageStats(user.userId);

  return c.json({ usage: stats });
});

/**
 * GET /subscription/plans
 * Get all available subscription plans with monthly and yearly pricing
 */
subscription.get('/plans', async (c) => {
  const plans = Object.values(subscriptionPlans).map((plan) => ({
    tier: plan.tier,
    name: plan.name,
    monthlyPrice: plan.price,
    yearlyPrice: plan.yearlyPrice,
    // For backwards compatibility
    price: plan.price,
    // Yearly savings
    yearlySavings: plan.price > 0 ? (plan.price * 12) - plan.yearlyPrice : 0,
    yearlySavingsPercent: plan.price > 0 ? Math.round(((plan.price * 12 - plan.yearlyPrice) / (plan.price * 12)) * 100) : 0,
    tokensPerMonth: plan.tokensPerMonth,
    projectsLimit: plan.projectsLimit,
    features: plan.features,
  }));

  return c.json({ plans });
});

/**
 * POST /subscription/checkout
 * Generate a Stripe Checkout session URL
 */
subscription.post('/checkout', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { tier, billingInterval = 'monthly', redirectUrl } = body as { 
    tier: SubscriptionTier; 
    billingInterval?: BillingInterval;
    redirectUrl?: string;
  };

  // Validate tier
  if (!tier || !['pro', 'business'].includes(tier)) {
    return c.json({ error: 'Invalid tier. Must be "pro" or "business"', code: 'INVALID_TIER' }, 400);
  }

  // Validate billing interval
  if (billingInterval && !['monthly', 'yearly'].includes(billingInterval)) {
    return c.json({ error: 'Invalid billing interval. Must be "monthly" or "yearly"', code: 'INVALID_INTERVAL' }, 400);
  }

  // Get Stripe price ID for the tier and billing interval
  const priceId = getPriceId(tier as 'pro' | 'business', billingInterval);

  if (!priceId) {
    return c.json({ 
      error: `Price ID not configured for ${tier} ${billingInterval} plan`, 
      code: 'CONFIG_ERROR' 
    }, 500);
  }

  // Check current subscription
  const currentSub = await SubscriptionService.getSubscription(user.userId);
  if (currentSub.tier === tier && currentSub.billingInterval === billingInterval && currentSub.status === 'active') {
    return c.json({ 
      error: 'You are already subscribed to this plan', 
      code: 'ALREADY_SUBSCRIBED' 
    }, 400);
  }

  try {
    // Build success and cancel URLs
    const successUrl = redirectUrl || env.STRIPE_SUCCESS_URL || 'https://answer.convitsa.com/subscription?success=true';
    const cancelUrl = env.STRIPE_CANCEL_URL || 'https://answer.convitsa.com/subscription?cancelled=true';

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer_email: user.email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: user.userId,
        user_email: user.email,
        billing_interval: billingInterval,
      },
      subscription_data: {
        metadata: {
          user_id: user.userId,
          user_email: user.email,
          billing_interval: billingInterval,
        },
      },
    });

    const checkoutUrl = session.url;
    const plan = getSubscriptionPlan(tier);

    console.log(`🛒 Generated Stripe checkout URL for ${user.email}: ${tier} (${billingInterval})`);

    return c.json({
      checkoutUrl,
      tier,
      billingInterval,
      plan: {
        ...plan,
        price: billingInterval === 'yearly' ? plan.yearlyPrice : plan.price,
      },
    });
  } catch (error) {
    console.error('❌ Stripe checkout creation error:', error);
    return c.json({ 
      error: 'Failed to create checkout', 
      code: 'CHECKOUT_FAILED' 
    }, 500);
  }
});

/**
 * POST /subscription/portal
 * Generate a Stripe Billing Portal URL
 * Users can manage their subscription, update payment, cancel, etc.
 */
subscription.post('/portal', async (c) => {
  const user = c.get('user');

  // Get user's subscription
  const sub = await SubscriptionService.getSubscription(user.userId);

  if (!sub.stripeCustomerId) {
    return c.json({ 
      error: 'No active paid subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Generate Stripe Billing Portal session
    const returnUrl = env.STRIPE_SUCCESS_URL || 'https://answer.convitsa.com/subscription';
    
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl,
    });

    console.log(`🔗 Generated Stripe portal URL for ${user.email}`);

    return c.json({
      portalUrl: portalSession.url,
      customerId: sub.stripeCustomerId,
    });
  } catch (error) {
    console.error('❌ Stripe portal generation error:', error);
    return c.json({ 
      error: 'Failed to generate customer portal link', 
      code: 'PORTAL_FAILED' 
    }, 500);
  }
});

/**
 * POST /subscription/cancel
 * Request subscription cancellation (takes effect at period end)
 */
subscription.post('/cancel', async (c) => {
  const user = c.get('user');

  const sub = await SubscriptionService.getSubscription(user.userId);

  if (sub.tier === 'free') {
    return c.json({ 
      error: 'You are on the free plan and have no subscription to cancel', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  if (sub.cancelAtPeriodEnd) {
    return c.json({ 
      error: 'Your subscription is already scheduled for cancellation', 
      code: 'ALREADY_CANCELLED' 
    }, 400);
  }

  if (!sub.stripeSubscriptionId) {
    return c.json({ 
      error: 'No Stripe subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Cancel subscription in Stripe (at period end)
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    // Mark for cancellation locally
    const result = await SubscriptionService.cancelSubscription(user.userId);

    if (!result.success) {
      return c.json({ error: result.error, code: result.code }, 500);
    }

    console.log(`⚠️ Subscription cancellation requested for ${user.email}`);

    return c.json({
      message: 'Your subscription will be cancelled at the end of the current billing period',
      subscription: {
        cancelAtPeriodEnd: true,
        currentPeriodEnd: sub.currentPeriodEnd,
      },
    });
  } catch (error) {
    console.error('❌ Cancel subscription error:', error);
    return c.json({ 
      error: 'Failed to cancel subscription', 
      code: 'CANCEL_FAILED' 
    }, 500);
  }
});

/**
 * POST /subscription/reactivate
 * Reactivate a cancelled subscription
 */
subscription.post('/reactivate', async (c) => {
  const user = c.get('user');

  const sub = await SubscriptionService.getSubscription(user.userId);

  if (!sub.cancelAtPeriodEnd) {
    return c.json({ 
      error: 'Your subscription is not scheduled for cancellation', 
      code: 'NOT_CANCELLED' 
    }, 400);
  }

  if (!sub.stripeSubscriptionId) {
    return c.json({ 
      error: 'No Stripe subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Reactivate subscription in Stripe (un-cancel)
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });

    // Reactivate locally
    const result = await SubscriptionService.reactivateSubscription(user.userId);

    if (!result.success) {
      return c.json({ error: result.error, code: result.code }, 500);
    }

    console.log(`✅ Subscription reactivated for ${user.email}`);

    return c.json({
      message: 'Your subscription has been reactivated',
      subscription: {
        cancelAtPeriodEnd: false,
        tier: sub.tier,
        status: 'active',
      },
    });
  } catch (error) {
    console.error('❌ Reactivate subscription error:', error);
    return c.json({ 
      error: 'Failed to reactivate subscription', 
      code: 'REACTIVATE_FAILED' 
    }, 500);
  }
});

/**
 * GET /subscription/can-create-project
 * Check if user can create more projects based on their plan
 */
subscription.get('/can-create-project', async (c) => {
  const user = c.get('user');

  const canCreate = await SubscriptionService.canCreateProject(user.userId);
  const stats = await SubscriptionService.getUsageStats(user.userId);

  return c.json({
    canCreateProject: canCreate,
    projectsUsed: stats.projectsUsed,
    projectsLimit: stats.projectsLimit,
  });
});

export { subscription as subscriptionRoutes };
