import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware';
import { SubscriptionService } from '../../services/subscription.service';
import { env, subscriptionPlans, getSubscriptionPlan } from '../../config/env';
import type { SubscriptionTier } from '../../types';

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
 * Generate a Lemon Squeezy checkout URL via API
 */
subscription.post('/checkout', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { tier, redirectUrl } = body as { tier: SubscriptionTier; redirectUrl?: string };

  // Validate tier
  if (!tier || !['pro', 'business'].includes(tier)) {
    return c.json({ error: 'Invalid tier. Must be "pro" or "business"', code: 'INVALID_TIER' }, 400);
  }

  // Get variant ID for the tier
  const variantId = tier === 'pro' 
    ? env.LEMONSQUEEZY_PRO_VARIANT_ID 
    : env.LEMONSQUEEZY_BUSINESS_VARIANT_ID;

  if (!variantId) {
    return c.json({ 
      error: `Variant ID not configured for ${tier} plan`, 
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
    // Create checkout via Lemon Squeezy API
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24); // Checkout expires in 24 hours

    // Build checkout attributes
    const checkoutAttributes: Record<string, any> = {
      checkout_data: {
        email: user.email,
        name: user.email.split('@')[0],
        custom: {
          user_email: user.email,
          user_id: user.userId,
        },
      },
      expires_at: expiresAt.toISOString(),
    };

    // Add redirect URL if provided
    if (redirectUrl) {
      checkoutAttributes.product_options = {
        redirect_url: redirectUrl,
      };
    }

    const checkoutResponse = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: checkoutAttributes,
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: env.LEMONSQUEEZY_STORE_ID,
              },
            },
            variant: {
              data: {
                type: 'variants',
                id: variantId,
              },
            },
          },
        },
      }),
    });

    if (!checkoutResponse.ok) {
      const errorData = await checkoutResponse.text();
      console.error('❌ Lemon Squeezy API error:', errorData);
      return c.json({ 
        error: 'Failed to create checkout', 
        code: 'CHECKOUT_FAILED' 
      }, 500);
    }

    const checkoutData = await checkoutResponse.json() as {
      data: {
        attributes: {
          url: string;
        };
      };
    };

    const checkoutUrl = checkoutData.data.attributes.url;

    console.log(`🛒 Generated checkout URL for ${user.email}: ${tier}`);

    return c.json({
      checkoutUrl,
      tier,
      plan: getSubscriptionPlan(tier),
    });
  } catch (error) {
    console.error('❌ Checkout creation error:', error);
    return c.json({ 
      error: 'Failed to create checkout', 
      code: 'CHECKOUT_FAILED' 
    }, 500);
  }
});

/**
 * POST /subscription/portal
 * Generate a Lemon Squeezy customer portal URL
 * Users can manage their subscription, update payment, cancel, etc.
 */
subscription.post('/portal', async (c) => {
  const user = c.get('user');

  // Get user's subscription
  const sub = await SubscriptionService.getSubscription(user.userId);

  if (!sub.lemonSqueezyCustomerId) {
    return c.json({ 
      error: 'No active paid subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  // Lemon Squeezy customer portal URL
  // Note: In production, you should use the Lemon Squeezy API to generate a secure portal URL
  // For now, we return a message directing users to their email
  // The proper way is to use: POST /v1/customer-portal to get a one-time URL

  // For now, return instructions
  return c.json({
    message: 'To manage your subscription, please check your email for the Lemon Squeezy customer portal link, or visit your Lemon Squeezy dashboard.',
    customerId: sub.lemonSqueezyCustomerId,
    // In production, implement this:
    // portalUrl: await generateLemonSqueezyPortalUrl(sub.lemonSqueezyCustomerId),
  });
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

  if (!sub.lemonSqueezySubscriptionId) {
    return c.json({ 
      error: 'No Lemon Squeezy subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Cancel subscription in Lemon Squeezy (at period end)
    const lsResponse = await fetch(
      `https://api.lemonsqueezy.com/v1/subscriptions/${sub.lemonSqueezySubscriptionId}`,
      {
        method: 'DELETE',
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          'Authorization': `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
        },
      }
    );

    if (!lsResponse.ok) {
      const errorData = await lsResponse.text();
      console.error('❌ Lemon Squeezy cancel error:', errorData);
      return c.json({ 
        error: 'Failed to cancel subscription in Lemon Squeezy', 
        code: 'CANCEL_FAILED' 
      }, 500);
    }

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

  if (!sub.lemonSqueezySubscriptionId) {
    return c.json({ 
      error: 'No Lemon Squeezy subscription found', 
      code: 'NO_SUBSCRIPTION' 
    }, 400);
  }

  try {
    // Reactivate subscription in Lemon Squeezy (un-cancel)
    const lsResponse = await fetch(
      `https://api.lemonsqueezy.com/v1/subscriptions/${sub.lemonSqueezySubscriptionId}`,
      {
        method: 'PATCH',
        headers: {
          'Accept': 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          'Authorization': `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
        },
        body: JSON.stringify({
          data: {
            type: 'subscriptions',
            id: sub.lemonSqueezySubscriptionId,
            attributes: {
              cancelled: false,
            },
          },
        }),
      }
    );

    if (!lsResponse.ok) {
      const errorData = await lsResponse.text();
      console.error('❌ Lemon Squeezy reactivate error:', errorData);
      return c.json({ 
        error: 'Failed to reactivate subscription in Lemon Squeezy', 
        code: 'REACTIVATE_FAILED' 
      }, 500);
    }

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
