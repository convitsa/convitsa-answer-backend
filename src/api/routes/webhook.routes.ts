import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import { Webhook } from 'standardwebhooks';
import { User, CreditBalance, CreditTransaction, Subscription } from '../../db/schemas';
import { env, getSubscriptionPlan } from '../../config/env';
import { EmailService, SubscriptionService } from '../../services';
import type { SubscriptionTier } from '../../types';

/**
 * Generate a simple, easy-to-type random password
 * Format: 3 consonants + 3 digits + 4 consonants (e.g., "Kmr492Pxwt")
 */
function generateSimplePassword(): string {
  const consonants = 'bcdfghjkmnpqrstvwxyz';
  const vowels = 'aeiou';
  const digits = '0123456789';
  
  // Start with uppercase consonant
  let password = consonants[Math.floor(Math.random() * consonants.length)].toUpperCase();
  
  // Add 2 more lowercase consonants
  for (let i = 0; i < 2; i++) {
    password += consonants[Math.floor(Math.random() * consonants.length)];
  }
  
  // Add 3 digits
  for (let i = 0; i < 3; i++) {
    password += digits[Math.floor(Math.random() * digits.length)];
  }
  
  // Add 4 more lowercase consonants
  for (let i = 0; i < 4; i++) {
    password += consonants[Math.floor(Math.random() * consonants.length)];
  }
  
  return password;
}

const webhooks = new Hono();

/**
 * Credit packages mapping (price in cents -> credits)
 */
const CREDIT_PACKAGES: Record<number, number> = {
  900: 500,    // $9 -> 500 credits
  1500: 1000,  // $15 -> 1000 credits
  2500: 2000,  // $25 -> 2000 credits
  4900: 5000,  // $49 -> 5000 credits
};

/**
 * Get credits for a given price (with some tolerance for currency conversion)
 */
function getCreditsForPrice(priceInCents: number): number | null {
  // Exact match
  if (CREDIT_PACKAGES[priceInCents]) {
    return CREDIT_PACKAGES[priceInCents];
  }
  
  // Allow 5% tolerance for currency conversion differences
  for (const [price, credits] of Object.entries(CREDIT_PACKAGES)) {
    const priceNum = parseInt(price, 10);
    const tolerance = priceNum * 0.05;
    if (Math.abs(priceInCents - priceNum) <= tolerance) {
      return credits;
    }
  }
  
  return null;
}

/**
 * POST /webhooks/gumroad
 * Handle Gumroad payment webhook
 * 
 * Gumroad sends form-urlencoded data with:
 * - seller_id: Your Gumroad seller ID
 * - product_id: The product ID
 * - product_name: Name of the product
 * - email: Buyer's email
 * - price: Price in cents
 * - sale_id: Unique sale ID
 * - sale_timestamp: When the sale occurred
 * - is_recurring_charge: Boolean for subscriptions
 * - refunded: Boolean if refunded
 * - resource_name: "sale" or "refund"
 * - etc.
 */
webhooks.post('/gumroad', async (c) => {
  try {
    // Verify webhook token from query parameter
    const token = c.req.query('token');
    if (!token || token !== env.GUMROAD_WEBHOOK_TOKEN) {
      console.error('❌ Gumroad webhook: Invalid or missing token');
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Parse form data from Gumroad
    const formData = await c.req.formData();
    
    // Extract relevant fields
    const sellerId = formData.get('seller_id') as string;
    const email = formData.get('email') as string;
    const priceStr = formData.get('price') as string;
    const saleId = formData.get('sale_id') as string;
    const productName = formData.get('product_name') as string;
    const refunded = formData.get('refunded') === 'true';
    const resourceName = formData.get('resource_name') as string;
    
    console.log(`🛒 Gumroad webhook received:`, {
      sellerId,
      email,
      price: priceStr,
      saleId,
      productName,
      refunded,
      resourceName,
    });

    // Verify seller ID matches (basic security check)
    if (env.GUMROAD_SELLER_ID && sellerId !== env.GUMROAD_SELLER_ID) {
      console.error('❌ Gumroad webhook: Invalid seller ID');
      return c.json({ error: 'Invalid seller ID' }, 403);
    }

    // Skip refunds
    if (refunded || resourceName === 'refund') {
      console.log('⚠️ Gumroad webhook: Refund detected, skipping credit addition');
      return c.json({ success: true, message: 'Refund acknowledged' });
    }

    // Validate required fields
    if (!email || !priceStr || !saleId) {
      console.error('❌ Gumroad webhook: Missing required fields');
      return c.json({ error: 'Missing required fields' }, 400);
    }

    // Parse price (Gumroad sends price as string like "900" for $9.00 in cents)
    // Sometimes it's formatted as "9.00" or "9", so handle all cases
    let priceInCents: number;
    if (priceStr.includes('.')) {
      // Price is in dollars (e.g., "9.00")
      priceInCents = Math.round(parseFloat(priceStr) * 100);
    } else {
      // Price is already in cents (e.g., "900")
      priceInCents = parseInt(priceStr, 10);
    }

    // Get credits for this price
    const credits = getCreditsForPrice(priceInCents);
    if (!credits) {
      console.error(`❌ Gumroad webhook: Unknown price ${priceInCents} cents`);
      return c.json({ error: 'Unknown package price' }, 400);
    }

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
    if (!user) {
      console.error(`❌ Gumroad webhook: User not found for email ${email}`);
      // Store for later processing or send email to user to register
      return c.json({ 
        error: 'User not found', 
        message: 'Please ensure you use the same email as your Convitsa account' 
      }, 404);
    }

    const userId = user._id.toString();

    // Check if this sale was already processed (idempotency)
    const existingTransaction = await CreditTransaction.findOne({
      reason: { $regex: saleId },
    }).lean();
    
    if (existingTransaction) {
      console.log(`⚠️ Gumroad webhook: Sale ${saleId} already processed`);
      return c.json({ success: true, message: 'Sale already processed' });
    }

    // Add credits to user balance
    await CreditBalance.findOneAndUpdate(
      { userId: user._id },
      { 
        $inc: { balance: credits },
        $set: { updatedAt: new Date() }
      },
      { upsert: true }
    );

    // Record the transaction
    await CreditTransaction.create({
      userId: user._id,
      amount: credits,
      type: 'credit',
      reason: `Gumroad purchase: ${productName || `${credits} credits`} (Sale: ${saleId})`,
      createdAt: new Date(),
    });

    // Get new balance
    const newBalance = await CreditBalance.findOne({ userId: user._id }).lean();
    const finalBalance = newBalance?.balance || credits;

    console.log(`✅ Gumroad webhook: Added ${credits} credits to ${email}. New balance: ${finalBalance}`);

    // Send credits purchased email (non-blocking)
    EmailService.sendCreditsPurchasedEmail(email, credits, finalBalance).catch((err) => {
      console.error('Failed to send credits purchased email:', err);
    });

    return c.json({
      success: true,
      credits_added: credits,
      new_balance: finalBalance,
      email,
    });

  } catch (error) {
    console.error('❌ Gumroad webhook error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /webhooks/gumroad/test
 * Test endpoint to verify webhook is accessible
 */
webhooks.get('/gumroad/test', (c) => {
  return c.json({
    status: 'ok',
    message: 'Gumroad webhook endpoint is active (DEPRECATED)',
    packages: {
      '$9': '500 credits',
      '$15': '1000 credits',
      '$25': '2000 credits',
      '$49': '5000 credits',
    },
  });
});

// ============================================================
// DODO PAYMENTS WEBHOOKS
// ============================================================

/**
 * Dodo Payments product ID to tier mapping
 */
function getTierFromProductId(productId: string): SubscriptionTier {
  if (productId === env.DODO_PRO_PRODUCT_ID) return 'pro';
  if (productId === env.DODO_BUSINESS_PRODUCT_ID) return 'business';
  return 'free';
}

// Initialize Standard Webhooks verifier
const webhookVerifier = new Webhook(env.DODO_PAYMENTS_WEBHOOK_KEY);

/**
 * Dodo Payments subscription webhook payload type
 */
interface DodoSubscriptionPayload {
  subscription_id: string;
  product_id: string;
  status: 'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired';
  customer: {
    customer_id: string;
    email: string;
    name: string;
    metadata?: Record<string, any>;
  };
  metadata?: Record<string, any>;
  next_billing_date: string;
  previous_billing_date?: string;
  cancel_at_next_billing_date: boolean;
  quantity: number;
  recurring_pre_tax_amount: number;
  currency: string;
  created_at: string;
  cancelled_at?: string;
  expires_at?: string;
}

interface DodoWebhookPayload {
  type: string;
  data: DodoSubscriptionPayload;
}

/**
 * POST /webhooks/dodo
 * Handle Dodo Payments subscription webhooks
 * 
 * Events:
 * - subscription.active: New subscription activated or reactivated
 * - subscription.updated: Subscription updated (any field change)
 * - subscription.on_hold: Payment failed, subscription on hold
 * - subscription.renewed: Subscription renewed for next period
 * - subscription.plan_changed: Plan upgraded/downgraded
 * - subscription.cancelled: Subscription cancelled
 * - subscription.failed: Subscription creation failed
 * - subscription.expired: Subscription expired
 */
webhooks.post('/dodo', async (c) => {
  try {
    // Get raw body for signature verification
    const rawBody = await c.req.text();
    
    // Get Standard Webhooks headers
    const webhookHeaders = {
      'webhook-id': c.req.header('webhook-id') || '',
      'webhook-signature': c.req.header('webhook-signature') || '',
      'webhook-timestamp': c.req.header('webhook-timestamp') || '',
    };

    // Verify webhook signature using Standard Webhooks
    try {
      webhookVerifier.verify(rawBody, webhookHeaders);
    } catch (verifyError) {
      console.error('❌ Dodo Payments webhook: Invalid signature', verifyError);
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Parse webhook payload
    const payload: DodoWebhookPayload = JSON.parse(rawBody);
    const { type: eventType, data: subscription } = payload;

    // Get customer info
    const customer = subscription.customer;
    const customerId = customer.customer_id;
    const customerEmail = customer.email?.toLowerCase().trim();
    
    // Get custom metadata (user_id passed during checkout)
    const metadata = subscription.metadata || {};
    const customUserId = metadata.user_id;

    console.log(`🔷 Dodo Payments webhook: ${eventType}`, {
      subscriptionId: subscription.subscription_id,
      customerId,
      customerEmail,
      customUserId,
      productId: subscription.product_id,
      status: subscription.status,
    });

    // Find user - prefer user_id from metadata over email
    let user;
    let isNewUser = false;
    
    if (customUserId) {
      user = await User.findById(customUserId).lean();
    }
    
    if (!user && customerEmail) {
      user = await User.findOne({ email: customerEmail }).lean();
    }
    
    // Create new user for affiliate/direct purchases on subscription.active
    let generatedPassword: string | null = null;
    
    if (!user && customerEmail && eventType === 'subscription.active') {
      console.log(`📝 Creating new user for payment: ${customerEmail}`);
      
      generatedPassword = generateSimplePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 10);
      
      const newUser = await User.create({
        email: customerEmail,
        passwordHash,
        emailVerified: true,
        createdVia: 'payment',
      });
      
      user = newUser.toObject();
      isNewUser = true;
      
      console.log(`✅ New user created: ${customerEmail} (password generated)`);
    }
    
    if (!user) {
      console.error('❌ Dodo Payments webhook: No user found and cannot create one');
      return c.json({ error: 'User not found' }, 404);
    }

    const userId = user._id.toString();
    const resolvedEmail = user.email;

    // Extract subscription details
    const subscriptionId = subscription.subscription_id;
    const productId = subscription.product_id;
    const nextBillingDate = subscription.next_billing_date ? new Date(subscription.next_billing_date) : null;
    const expiresAt = subscription.expires_at ? new Date(subscription.expires_at) : null;

    // Determine tier from product ID
    const tier = getTierFromProductId(productId);

    switch (eventType) {
      case 'subscription.active': {
        // New subscription activated or reactivated
        const plan = getSubscriptionPlan(tier);
        const periodEnd = nextBillingDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        // Check if this is a reactivation by looking for existing subscription
        const existingSub = await Subscription.findOne({ userId: user._id }).lean();
        const isReactivation = existingSub && existingSub.status !== 'active';

        await SubscriptionService.createSubscription(userId, {
          tier,
          dodoCustomerId: customerId,
          dodoSubscriptionId: subscriptionId,
          dodoProductId: productId,
          currentPeriodEnd: periodEnd,
          bonusTokens: 0,
        });

        console.log(`✅ Subscription ${isReactivation ? 'reactivated' : 'created'} for ${resolvedEmail}: ${tier}`);
        
        if (isNewUser && generatedPassword) {
          EmailService.sendPaymentWelcomeEmail(
            resolvedEmail,
            generatedPassword,
            plan.name,
            0
          ).catch((err) => {
            console.error('Failed to send payment welcome email:', err);
          });
        } else if (isReactivation) {
          EmailService.sendSubscriptionReactivatedEmail(resolvedEmail, plan.name).catch((err) => {
            console.error('Failed to send subscription reactivated email:', err);
          });
        } else {
          EmailService.sendSubscriptionStartedEmail(
            resolvedEmail,
            plan.name,
            plan.price,
            plan.tokensPerMonth,
            periodEnd
          ).catch((err) => {
            console.error('Failed to send subscription started email:', err);
          });
        }
        break;
      }

      case 'subscription.renewed': {
        // Subscription renewed - reset monthly usage
        const periodEnd = nextBillingDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await SubscriptionService.updateSubscription(userId, {
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
        });

        // Reset monthly tokens
        const renewedSub = await Subscription.findOneAndUpdate(
          { userId: user._id },
          { $set: { tokensUsedThisMonth: 0 } },
          { new: true }
        ).lean();

        console.log(`💳 Subscription renewed for ${resolvedEmail}, usage reset`);
        
        if (renewedSub) {
          const renewPlan = getSubscriptionPlan(renewedSub.tier as SubscriptionTier);
          EmailService.sendSubscriptionRenewedEmail(
            resolvedEmail,
            renewPlan.name,
            renewPlan.tokensPerMonth,
            periodEnd
          ).catch((err) => {
            console.error('Failed to send subscription renewed email:', err);
          });
        }
        break;
      }

      case 'subscription.updated': {
        // Subscription updated (could be various changes)
        const updatedTier = getTierFromProductId(productId);
        const periodEnd = nextBillingDate || expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await SubscriptionService.updateSubscription(userId, {
          tier: updatedTier,
          dodoProductId: productId,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_next_billing_date,
        });

        console.log(`✅ Subscription updated for ${resolvedEmail}: ${updatedTier}`);
        break;
      }

      case 'subscription.plan_changed': {
        // Plan upgrade/downgrade
        const newTier = getTierFromProductId(productId);
        const plan = getSubscriptionPlan(newTier);
        const periodEnd = nextBillingDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await SubscriptionService.updateSubscription(userId, {
          tier: newTier,
          dodoProductId: productId,
          currentPeriodEnd: periodEnd,
        });

        // Update token and project limits
        await Subscription.findOneAndUpdate(
          { userId: user._id },
          {
            $set: {
              tokensLimit: plan.tokensPerMonth,
              projectsLimit: plan.projectsLimit,
            },
          }
        );

        console.log(`✅ Plan changed for ${resolvedEmail}: ${newTier}`);
        break;
      }

      case 'subscription.on_hold': {
        // Payment failed - subscription on hold
        const holdSub = await Subscription.findOne({ userId: user._id }).lean();
        
        await SubscriptionService.updateSubscription(userId, {
          status: 'on_hold',
        });

        console.log(`❌ Subscription on hold for ${resolvedEmail} (payment failed)`);

        const holdPlan = getSubscriptionPlan(holdSub?.tier as SubscriptionTier || tier);
        const retryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        EmailService.sendPaymentFailedEmail(resolvedEmail, holdPlan.name, retryDate).catch((err) => {
          console.error('Failed to send payment failed email:', err);
        });
        break;
      }

      case 'subscription.cancelled': {
        // User cancelled - may end immediately or at period end
        const currentSub = await Subscription.findOne({ userId: user._id }).lean();
        const accessEnds = expiresAt || nextBillingDate || currentSub?.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        await SubscriptionService.updateSubscription(userId, {
          status: 'cancelled',
          cancelAtPeriodEnd: subscription.cancel_at_next_billing_date,
        });

        console.log(`⚠️ Subscription cancelled for ${resolvedEmail}`);
        
        const cancelPlan = getSubscriptionPlan(currentSub?.tier || tier);
        EmailService.sendSubscriptionCancelledEmail(
          resolvedEmail,
          cancelPlan.name,
          accessEnds
        ).catch((err) => {
          console.error('Failed to send subscription cancelled email:', err);
        });
        break;
      }

      case 'subscription.expired': {
        // Subscription ended - downgrade to free
        const freePlan = getSubscriptionPlan('free');
        
        await SubscriptionService.updateSubscription(userId, {
          tier: 'free',
          status: 'expired',
          cancelAtPeriodEnd: false,
        });

        await Subscription.findOneAndUpdate(
          { userId: user._id },
          {
            $set: {
              tokensLimit: freePlan.tokensPerMonth,
              projectsLimit: freePlan.projectsLimit,
              tokensUsedThisMonth: 0,
              dodoSubscriptionId: null,
              dodoProductId: null,
            },
          }
        );

        console.log(`⚠️ Subscription expired for ${resolvedEmail}, downgraded to free`);
        break;
      }

      case 'subscription.failed': {
        // Subscription creation failed
        console.log(`❌ Subscription creation failed for ${resolvedEmail}`);
        break;
      }

      default:
        console.log(`🔷 Unhandled Dodo Payments event: ${eventType}`);
    }

    return c.json({ success: true, event: eventType });

  } catch (error) {
    console.error('❌ Dodo Payments webhook error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /webhooks/dodo/test
 * Test endpoint to verify webhook is accessible
 */
webhooks.get('/dodo/test', (c) => {
  return c.json({
    status: 'ok',
    message: 'Dodo Payments webhook endpoint is active',
    plans: {
      free: '$0/mo - 5,000 tokens',
      pro: '$29/mo - 100,000 tokens',
      business: '$79/mo - 250,000 tokens',
    },
  });
});

export { webhooks as webhookRoutes };

