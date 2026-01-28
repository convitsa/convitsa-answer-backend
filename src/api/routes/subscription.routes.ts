import { Hono } from 'hono';
import DodoPayments from 'dodopayments';
import { authMiddleware } from '../middleware/auth.middleware';
import { SubscriptionService } from '../../services/subscription.service';
import { env, subscriptionPlans, getSubscriptionPlan } from '../../config/env';
import type { SubscriptionTier } from '../../types';

// Initialize Dodo Payments client
const dodoClient = new DodoPayments({
  bearerToken: env.DODO_PAYMENTS_API_KEY,
  environment: env.DODO_PAYMENTS_ENVIRONMENT as 'test_mode' | 'live_mode',
});

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

  return c.json({
    subscription: {
      id: sub._id.toString(),
      tier: sub.tier,
      status: sub.status,
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
      price: plan.price,
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
 * Get all available subscription plans
 */
subscription.get('/plans', async (c) => {
  const plans = Object.values(subscriptionPlans).map((plan) => ({
    tier: plan.tier,
    name: plan.name,
    price: plan.price,
    tokensPerMonth: plan.tokensPerMonth,
    projectsLimit: plan.projectsLimit,
    features: plan.features,
  }));

  return c.json({ plans });
});

/**
 * POST /subscription/checkout
 * Generate a Dodo Payments checkout URL using Checkout Sessions API
 */
subscription.post('/checkout', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { tier, redirectUrl } = body as { tier: SubscriptionTier; redirectUrl?: string };

  // Validate tier
  if (!tier || !['pro', 'business'].includes(tier)) {
    return c.json({ error: 'Invalid tier. Must be "pro" or "business"', code: 'INVALID_TIER' }, 400);
  }

  // Get product ID for the tier
  const productId = tier === 'pro' 
    ? env.DODO_PRO_PRODUCT_ID 
    : env.DODO_BUSINESS_PRODUCT_ID;

  if (!productId) {
    return c.json({ 
      error: `Product ID not configured for ${tier} plan`, 
      code: 'CONFIG_ERROR' 
    }, 500);
  }

  // Check current subscription
  const currentSub = await SubscriptionService.getSubscription(user.userId);
  if (currentSub.tier === tier && currentSub.status === 'active') {
    return c.json({ 
      error: 'You are already subscribed to this plan', 
      code: 'ALREADY_SUBSCRIBED' 
    }, 400);
  }

  try {
    // Create checkout session using Dodo Payments SDK
    const checkoutParams: Parameters<typeof dodoClient.checkoutSessions.create>[0] = {
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: {
        email: user.email,
        name: user.email.split('@')[0],
      },
      metadata: {
        user_id: user.userId,
        user_email: user.email,
      },
    };

    // Only add return_url if provided (optional - user stays on Dodo page if not set)
    const returnUrl = redirectUrl || env.DODO_PAYMENTS_RETURN_URL;
    if (returnUrl) {
      checkoutParams.return_url = returnUrl;
    }

    const session = await dodoClient.checkoutSessions.create(checkoutParams);

    const checkoutUrl = session.checkout_url;

    console.log(`🛒 Generated Dodo checkout URL for ${user.email}: ${tier}`);

    return c.json({
      checkoutUrl,
      tier,
      plan: getSubscriptionPlan(tier),
    });
  } catch (error) {
    console.error('❌ Dodo checkout creation error:', error);
    return c.json({ 
      error: 'Failed to create checkout', 
      code: 'CHECKOUT_FAILED' 
    }, 500);
  }
});

/**
 * POST /subscription/portal
 * Generate a Dodo Payments customer portal URL
 * Users can manage their subscription, update payment, cancel, etc.
 */
subscription.post('/portal', async (c) => {
  const user = c.get('user');

  // Get user's subscription
  const sub = await SubscriptionService.getSubscription(user.userId);

  if (!sub.dodoCustomerId) {
    return c.json({ 
      error: 'No active paid subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Generate customer portal URL using Dodo Payments API
    const portalResponse = await dodoClient.customers.customerPortal.create(sub.dodoCustomerId, {
      send_email: false,
    });

    console.log(`🔗 Generated Dodo portal URL for ${user.email}`);

    return c.json({
      portalUrl: portalResponse.link,
      customerId: sub.dodoCustomerId,
    });
  } catch (error) {
    console.error('❌ Dodo portal generation error:', error);
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

  if (!sub.dodoSubscriptionId) {
    return c.json({ 
      error: 'No Dodo Payments subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Cancel subscription in Dodo Payments (at period end)
    await dodoClient.subscriptions.update(sub.dodoSubscriptionId, {
      cancel_at_next_billing_date: true,
    } as any);

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

  if (!sub.dodoSubscriptionId) {
    return c.json({ 
      error: 'No Dodo Payments subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Reactivate subscription in Dodo Payments (un-cancel)
    await dodoClient.subscriptions.update(sub.dodoSubscriptionId, {
      cancel_at_next_billing_date: false,
    } as any);

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
