import { Hono } from 'hono';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
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
// LEMON SQUEEZY WEBHOOKS
// ============================================================

/**
 * Lemon Squeezy variant ID to tier mapping
 */
function getTierFromVariantId(variantId: string): SubscriptionTier {
  if (variantId === env.LEMONSQUEEZY_PRO_VARIANT_ID) return 'pro';
  if (variantId === env.LEMONSQUEEZY_BUSINESS_VARIANT_ID) return 'business';
  return 'free';
}

/**
 * Verify Lemon Squeezy webhook signature
 */
function verifyLemonSqueezySignature(payload: string, signature: string): boolean {
  const hmac = crypto.createHmac('sha256', env.LEMONSQUEEZY_WEBHOOK_SECRET);
  const digest = hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

/**
 * POST /webhooks/lemonsqueezy
 * Handle Lemon Squeezy subscription webhooks
 * 
 * Events:
 * - subscription_created: New subscription
 * - subscription_updated: Plan change, renewal
 * - subscription_cancelled: Cancellation requested
 * - subscription_resumed: Reactivated after cancellation
 * - subscription_expired: Subscription ended
 * - subscription_paused: Subscription paused
 * - subscription_unpaused: Subscription unpaused
 * - subscription_payment_success: Successful payment
 * - subscription_payment_failed: Failed payment
 */
webhooks.post('/lemonsqueezy', async (c) => {
  try {
    // Get raw body for signature verification
    const rawBody = await c.req.text();
    const signature = c.req.header('x-signature') || '';

    // Verify webhook signature
    if (!verifyLemonSqueezySignature(rawBody, signature)) {
      console.error('❌ Lemon Squeezy webhook: Invalid signature');
      return c.json({ error: 'Invalid signature' }, 401);
    }

    // Parse webhook payload
    const payload = JSON.parse(rawBody);
    const { meta, data } = payload;

    const eventName = meta.event_name;
    const customData = meta.custom_data || {};
    
    // Get user identifiers from custom data (passed during checkout from our app)
    const customUserId = customData.user_id;
    const customUserEmail = customData.user_email?.toLowerCase().trim();
    
    // Get attributes from Lemon Squeezy payload
    const attributes = data.attributes || {};
    
    // Get customer email from Lemon Squeezy (for affiliate purchases without custom_data)
    const lsCustomerEmail = attributes.user_email?.toLowerCase().trim();
    
    // Check if this is an affiliate referral
    const isAffiliateReferral = !!data.relationships?.affiliate?.data?.id;
    const affiliateId = data.relationships?.affiliate?.data?.id;
    
    console.log(`🍋 Lemon Squeezy webhook: ${eventName}`, {
      subscriptionId: data.id,
      customerId: attributes.customer_id,
      userId: customUserId,
      customUserEmail: customUserEmail,
      lsCustomerEmail: lsCustomerEmail,
      isAffiliateReferral,
      affiliateId,
    });

    // Find user - prefer user_id over email for reliability
    let user;
    let isNewUser = false;
    
    if (customUserId) {
      // Primary: Find by user ID (from our checkout flow)
      user = await User.findById(customUserId).lean();
    }
    
    // Fallback: Find by email from custom data
    if (!user && customUserEmail) {
      user = await User.findOne({ email: customUserEmail }).lean();
    }
    
    // Fallback: Find by email from Lemon Squeezy (affiliate/direct purchases)
    if (!user && lsCustomerEmail) {
      user = await User.findOne({ email: lsCustomerEmail }).lean();
    }
    
    // If user still not found, create a new one (for affiliate/direct Lemon Squeezy purchases)
    const finalEmail = customUserEmail || lsCustomerEmail;
    let generatedPassword: string | null = null;
    
    if (!user && finalEmail && eventName === 'subscription_created') {
      console.log(`📝 Creating new user for payment: ${finalEmail}`);
      
      // Generate a simple random password
      generatedPassword = generateSimplePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 10);
      
      const newUser = await User.create({
        email: finalEmail,
        passwordHash,
        emailVerified: true, // They paid, trust the email
        createdVia: 'payment',
      });
      
      user = newUser.toObject();
      isNewUser = true;
      
      console.log(`✅ New user created: ${finalEmail} (password generated)`);
    }
    
    if (!user) {
      console.error('❌ Lemon Squeezy webhook: No user found and cannot create one');
      return c.json({ error: 'User not found' }, 404);
    }

    const userId = user._id.toString();
    const resolvedEmail = user.email; // Use email from database

    // Extract subscription details
    const subscriptionId = data.id?.toString();
    const customerId = attributes.customer_id?.toString();
    const variantId = attributes.variant_id?.toString();
    const status = attributes.status;
    const renewsAt = attributes.renews_at ? new Date(attributes.renews_at) : null;
    const endsAt = attributes.ends_at ? new Date(attributes.ends_at) : null;
    const cancelledAt = attributes.cancelled ? new Date() : null;

    // Determine tier from variant
    const tier = getTierFromVariantId(variantId || '');

    switch (eventName) {
      case 'subscription_created': {
        // New subscription created
        const plan = getSubscriptionPlan(tier);
        const periodEnd = renewsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        // Calculate bonus tokens for affiliate referrals
        const bonusTokens = isAffiliateReferral ? env.AFFILIATE_BONUS_TOKENS : 0;

        await SubscriptionService.createSubscription(userId, {
          tier,
          lemonSqueezyCustomerId: customerId,
          lemonSqueezySubscriptionId: subscriptionId,
          lemonSqueezyVariantId: variantId,
          currentPeriodEnd: periodEnd,
          bonusTokens,
        });

        console.log(`✅ Subscription created for ${resolvedEmail}: ${tier}${bonusTokens > 0 ? ` (+${bonusTokens} bonus tokens)` : ''}`);
        
        // Handle email sending based on whether user is new or existing
        if (isNewUser && generatedPassword) {
          // New user from payment - send welcome email with generated password
          EmailService.sendPaymentWelcomeEmail(
            resolvedEmail,
            generatedPassword,
            plan.name,
            bonusTokens
          ).catch((err) => {
            console.error('Failed to send payment welcome email:', err);
          });
        } else {
          // Existing user - send regular subscription started email
          EmailService.sendSubscriptionStartedEmail(
            resolvedEmail,
            plan.name,
            plan.price,
            plan.tokensPerMonth + bonusTokens,
            periodEnd
          ).catch((err) => {
            console.error('Failed to send subscription started email:', err);
          });
        }
        break;
      }

      case 'subscription_updated': {
        // Subscription updated (could be plan change)
        const plan = getSubscriptionPlan(tier);
        const periodEnd = renewsAt || endsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await SubscriptionService.updateSubscription(userId, {
          tier,
          lemonSqueezyVariantId: variantId,
          currentPeriodEnd: periodEnd,
          status: status === 'active' ? 'active' : 'paused',
        });

        console.log(`✅ Subscription updated for ${resolvedEmail}: ${tier}`);
        break;
      }

      case 'subscription_cancelled': {
        // User cancelled - will end at period end
        const currentSub = await Subscription.findOne({ userId: user._id }).lean();
        const accessEnds = endsAt || currentSub?.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        
        await SubscriptionService.updateSubscription(userId, {
          cancelAtPeriodEnd: true,
        });

        console.log(`⚠️ Subscription cancelled for ${resolvedEmail} (ends at period end)`);
        
        // Send cancellation email
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

      case 'subscription_resumed': {
        // Subscription reactivated
        await SubscriptionService.updateSubscription(userId, {
          status: 'active',
          cancelAtPeriodEnd: false,
        });

        console.log(`✅ Subscription resumed for ${resolvedEmail}`);
        
        // Send reactivation email
        const resumePlan = getSubscriptionPlan(tier);
        EmailService.sendSubscriptionReactivatedEmail(resolvedEmail, resumePlan.name).catch((err) => {
          console.error('Failed to send subscription reactivated email:', err);
        });
        break;
      }

      case 'subscription_expired': {
        // Subscription ended - downgrade to free
        const freePlan = getSubscriptionPlan('free');
        
        await SubscriptionService.updateSubscription(userId, {
          tier: 'free',
          status: 'active',
          cancelAtPeriodEnd: false,
        });

        // Reset to free tier limits
        await Subscription.findOneAndUpdate(
          { userId: user._id },
          {
            $set: {
              tokensLimit: freePlan.tokensPerMonth,
              projectsLimit: freePlan.projectsLimit,
              tokensUsedThisMonth: 0,
            },
          }
        );

        console.log(`⚠️ Subscription expired for ${resolvedEmail}, downgraded to free`);
        break;
      }

      case 'subscription_paused': {
        await SubscriptionService.updateSubscription(userId, {
          status: 'paused',
        });

        console.log(`⏸️ Subscription paused for ${resolvedEmail}`);
        break;
      }

      case 'subscription_unpaused': {
        await SubscriptionService.updateSubscription(userId, {
          status: 'active',
        });

        console.log(`▶️ Subscription unpaused for ${resolvedEmail}`);
        break;
      }

      case 'subscription_payment_success': {
        // Payment successful - reset monthly usage for new period
        const periodEnd = renewsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        // Check if this is the first payment (subscription just created)
        // by looking at when the subscription was created
        const existingSub = await Subscription.findOne({ userId: user._id }).lean();
        const isFirstPayment = existingSub && 
          (Date.now() - new Date(existingSub.createdAt).getTime()) < 5 * 60 * 1000; // Within 5 minutes

        await SubscriptionService.updateSubscription(userId, {
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
        });

        // Reset monthly tokens
        const paymentSub = await Subscription.findOneAndUpdate(
          { userId: user._id },
          { $set: { tokensUsedThisMonth: 0 } },
          { new: true }
        ).lean();

        console.log(`💳 Payment successful for ${resolvedEmail}, usage reset${isFirstPayment ? ' (first payment, skipping renewal email)' : ''}`);
        
        // Only send renewal email for actual renewals (not first payment)
        // First payment already gets a welcome email from subscription_created
        if (paymentSub && !isFirstPayment) {
          const renewPlan = getSubscriptionPlan(paymentSub.tier as SubscriptionTier);
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

      case 'subscription_payment_failed': {
        const failedSub = await Subscription.findOne({ userId: user._id }).lean();
        
        await SubscriptionService.updateSubscription(userId, {
          status: 'past_due',
        });

        console.log(`❌ Payment failed for ${resolvedEmail}`);

        // Send payment failed email
        const failedPlan = getSubscriptionPlan(failedSub?.tier as SubscriptionTier || tier);
        const retryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // Retry in 3 days
        EmailService.sendPaymentFailedEmail(resolvedEmail, failedPlan.name, retryDate).catch((err) => {
          console.error('Failed to send payment failed email:', err);
        });
        break;
      }

      default:
        console.log(`🍋 Unhandled Lemon Squeezy event: ${eventName}`);
    }

    return c.json({ success: true, event: eventName });

  } catch (error) {
    console.error('❌ Lemon Squeezy webhook error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /webhooks/lemonsqueezy/test
 * Test endpoint to verify webhook is accessible
 */
webhooks.get('/lemonsqueezy/test', (c) => {
  return c.json({
    status: 'ok',
    message: 'Lemon Squeezy webhook endpoint is active',
    plans: {
      free: '$0/mo - 10,000 tokens',
      pro: '$29/mo - 100,000 tokens',
      business: '$79/mo - 500,000 tokens',
    },
  });
});

export { webhooks as webhookRoutes };

