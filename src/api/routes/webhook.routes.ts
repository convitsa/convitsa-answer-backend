import { Hono } from 'hono';
import bcrypt from 'bcrypt';
import Stripe from 'stripe';
import { User, CreditBalance, CreditTransaction, Subscription } from '../../db/schemas';
import { env, getSubscriptionPlan, getTierFromPriceId } from '../../config/env';
import { EmailService, SubscriptionService } from '../../services';
import type { SubscriptionTier, BillingInterval } from '../../types';

// Initialize Stripe client
const stripe = new Stripe(env.STRIPE_SECRET_KEY);

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
// STRIPE WEBHOOKS
// ============================================================

/**
 * POST /webhooks/stripe
 * Handle Stripe subscription webhooks
 * 
 * Events:
 * - checkout.session.completed: New subscription checkout completed
 * - customer.subscription.created: Subscription created
 * - customer.subscription.updated: Subscription updated (plan change, cancel, etc.)
 * - customer.subscription.deleted: Subscription cancelled/expired
 * - invoice.paid: Payment successful (for renewals)
 * - invoice.payment_failed: Payment failed
 */
webhooks.post('/stripe', async (c) => {
  try {
    // Get raw body as Buffer for signature verification
    const arrayBuffer = await c.req.arrayBuffer();
    const rawBody = Buffer.from(arrayBuffer);
    
    // Get Stripe signature header
    const sig = c.req.header('stripe-signature');
    if (!sig) {
      console.error('❌ Stripe webhook: Missing signature');
      return c.json({ error: 'Missing signature' }, 401);
    }

    // Verify webhook signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error('❌ Stripe webhook: Invalid signature');
      console.error('   Error:', err.message);
      console.error('   Signature header:', sig.substring(0, 50) + '...');
      console.error('   Body length:', rawBody.length);
      console.error('   Webhook secret configured:', env.STRIPE_WEBHOOK_SECRET ? 'Yes (starts with ' + env.STRIPE_WEBHOOK_SECRET.substring(0, 10) + '...)' : 'No');
      return c.json({ error: 'Invalid signature' }, 401);
    }

    console.log(`🔷 Stripe webhook: ${event.type}`);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        
        if (session.mode !== 'subscription') {
          console.log('⏭️ Ignoring non-subscription checkout');
          break;
        }

        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;
        const customerEmail = session.customer_email?.toLowerCase().trim() || session.customer_details?.email?.toLowerCase().trim();
        const metadata = session.metadata || {};
        const customUserId = metadata.user_id;

        console.log(`📋 Checkout completed:`, {
          customerId,
          subscriptionId,
          customerEmail,
          customUserId,
        });

        // Find user - prefer user_id from metadata over email
        let user;
        let isNewUser = false;
        let generatedPassword: string | null = null;

        if (customUserId) {
          user = await User.findById(customUserId).lean();
        }
        
        if (!user && customerEmail) {
          user = await User.findOne({ email: customerEmail }).lean();
        }

        // Create new user for affiliate/direct purchases
        if (!user && customerEmail) {
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
          
          // Create free subscription first (will be upgraded by subscription.created event)
          await SubscriptionService.createFreeSubscription(user._id.toString());
          
          console.log(`✅ New user created: ${customerEmail}`);
        }

        if (!user) {
          console.error('❌ Stripe webhook: No user found');
          return c.json({ error: 'User not found' }, 404);
        }

        // Store the generated password for use in subscription.created
        if (isNewUser && generatedPassword) {
          // Store temporarily in metadata for the subscription event
          try {
            await stripe.subscriptions.update(subscriptionId, {
              metadata: {
                ...metadata,
                is_new_user: 'true',
                temp_password: generatedPassword,
              },
            });
          } catch (err) {
            console.error('Failed to update subscription metadata:', err);
          }
        }
        
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;
        const subscriptionId = subscription.id;
        const priceId = subscription.items.data[0]?.price.id;
        const metadata = subscription.metadata || {};
        const customUserId = metadata.user_id;
        const isNewUser = metadata.is_new_user === 'true';
        const generatedPassword = metadata.temp_password;

        console.log(`📋 Subscription ${event.type}:`, {
          subscriptionId,
          customerId,
          priceId,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        });

        // Get tier and billing interval from price ID
        const { tier, billingInterval } = getTierFromPriceId(priceId || '');
        
        if (tier === 'free') {
          console.log('⏭️ Free tier, skipping subscription update');
          break;
        }

        // Find user
        let user;
        if (customUserId) {
          user = await User.findById(customUserId).lean();
        }
        
        if (!user) {
          // Try to find by Stripe customer ID
          const existingSub = await SubscriptionService.findByStripeCustomerId(customerId);
          if (existingSub) {
            user = await User.findById(existingSub.userId).lean();
          }
        }

        if (!user) {
          // Try to get email from Stripe customer
          try {
            const customer = await stripe.customers.retrieve(customerId);
            if (customer && !customer.deleted && customer.email) {
              user = await User.findOne({ email: customer.email.toLowerCase().trim() }).lean();
            }
          } catch (err) {
            console.error('Failed to retrieve Stripe customer:', err);
          }
        }

        if (!user) {
          console.error('❌ Stripe webhook: No user found for subscription');
          return c.json({ error: 'User not found' }, 404);
        }

        const userId = user._id.toString();
        const resolvedEmail = user.email;

        // Calculate period end
        const periodEnd = new Date(subscription.current_period_end * 1000);
        const periodStart = new Date(subscription.current_period_start * 1000);

        // Check if this is a reactivation
        const existingSub = await Subscription.findOne({ userId: user._id }).lean();
        const isReactivation = existingSub && existingSub.status !== 'active' && (subscription.status === 'active' || subscription.status === 'trialing');

        // Cancel old subscriptions when switching plans
        if (existingSub?.stripeSubscriptionId && existingSub.stripeSubscriptionId !== subscriptionId) {
          await SubscriptionService.cancelOldStripeSubscriptions(userId, subscriptionId);
        }

        // Check if subscription is in trial
        const isTrialing = subscription.status === 'trialing';
        const trialEnd = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;

        // Handle different subscription statuses (active or trialing both grant access)
        if (subscription.status === 'active' || subscription.status === 'trialing') {
          const plan = getSubscriptionPlan(tier);

          await SubscriptionService.createSubscription(userId, {
            tier,
            billingInterval,
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: priceId,
            currentPeriodEnd: periodEnd,
            bonusTokens: 0,
          });

          // Update period start (and trial end if applicable)
          await Subscription.findOneAndUpdate(
            { userId: user._id },
            { $set: { currentPeriodStart: periodStart } }
          );

          console.log(`✅ Subscription ${isTrialing ? 'trialing' : 'active'} for ${resolvedEmail}: ${tier} (${billingInterval})${isTrialing && trialEnd ? ` - trial ends ${trialEnd.toISOString()}` : ''}`);

          // Send appropriate email
          const displayPrice = billingInterval === 'yearly' ? plan.yearlyPrice : plan.price;
          
          if (isNewUser && generatedPassword) {
            EmailService.sendPaymentWelcomeEmail(
              resolvedEmail,
              generatedPassword,
              `${plan.name} (${billingInterval === 'yearly' ? 'Yearly' : 'Monthly'})`,
              0
            ).catch((err) => {
              console.error('Failed to send payment welcome email:', err);
            });
            
            // Clear temp password from metadata
            try {
              await stripe.subscriptions.update(subscriptionId, {
                metadata: { ...metadata, temp_password: null, is_new_user: null },
              });
            } catch (err) {
              console.error('Failed to clear temp metadata:', err);
            }
          } else if (isReactivation) {
            EmailService.sendSubscriptionReactivatedEmail(resolvedEmail, plan.name).catch((err) => {
              console.error('Failed to send subscription reactivated email:', err);
            });
          } else if (event.type === 'customer.subscription.created') {
            EmailService.sendSubscriptionStartedEmail(
              resolvedEmail,
              `${plan.name} (${billingInterval === 'yearly' ? 'Yearly' : 'Monthly'})`,
              displayPrice,
              plan.tokensPerMonth,
              periodEnd
            ).catch((err) => {
              console.error('Failed to send subscription started email:', err);
            });
          }
        } else if (subscription.status === 'past_due') {
          await SubscriptionService.updateSubscription(userId, {
            status: 'on_hold',
          });

          console.log(`❌ Subscription past due for ${resolvedEmail}`);

          const holdPlan = getSubscriptionPlan(tier);
          const retryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
          EmailService.sendPaymentFailedEmail(resolvedEmail, holdPlan.name, retryDate).catch((err) => {
            console.error('Failed to send payment failed email:', err);
          });
        }

        // Handle cancel_at_period_end changes
        if (subscription.cancel_at_period_end) {
          await SubscriptionService.updateSubscription(userId, {
            cancelAtPeriodEnd: true,
          });
          console.log(`⚠️ Subscription scheduled for cancellation: ${resolvedEmail}`);
        } else if (existingSub?.cancelAtPeriodEnd && !subscription.cancel_at_period_end) {
          // Reactivated
          await SubscriptionService.updateSubscription(userId, {
            cancelAtPeriodEnd: false,
            status: 'active',
          });
          console.log(`✅ Subscription reactivated: ${resolvedEmail}`);
        }

        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const subscriptionId = subscription.id;
        const customerId = subscription.customer as string;

        console.log(`📋 Subscription deleted:`, { subscriptionId, customerId });

        // Find user by subscription ID
        const existingSub = await SubscriptionService.findByStripeSubscriptionId(subscriptionId);
        
        if (!existingSub) {
          console.log('⏭️ No matching subscription found in database');
          break;
        }

        const user = await User.findById(existingSub.userId).lean();
        if (!user) {
          console.error('❌ User not found for deleted subscription');
          break;
        }

        const userId = user._id.toString();
        const resolvedEmail = user.email;
        const freePlan = getSubscriptionPlan('free');

        // Downgrade to free tier
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
              stripeSubscriptionId: null,
              stripePriceId: null,
            },
          }
        );

        console.log(`⚠️ Subscription expired for ${resolvedEmail}, downgraded to free`);

        // Send cancellation email
        const cancelPlan = getSubscriptionPlan(existingSub.tier);
        EmailService.sendSubscriptionCancelledEmail(
          resolvedEmail,
          cancelPlan.name,
          new Date()
        ).catch((err) => {
          console.error('Failed to send subscription cancelled email:', err);
        });

        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        
        if (invoice.billing_reason !== 'subscription_cycle') {
          console.log('⏭️ Not a renewal invoice, skipping');
          break;
        }

        const subscriptionId = invoice.subscription as string;
        const customerId = invoice.customer as string;

        console.log(`📋 Invoice paid (renewal):`, { subscriptionId, customerId });

        // Find user
        const existingSub = await SubscriptionService.findByStripeSubscriptionId(subscriptionId);
        
        if (!existingSub) {
          console.log('⏭️ No matching subscription found');
          break;
        }

        const user = await User.findById(existingSub.userId).lean();
        if (!user) {
          console.error('❌ User not found for renewal');
          break;
        }

        const userId = user._id.toString();
        const resolvedEmail = user.email;

        // Get subscription details from Stripe
        const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
        const periodEnd = new Date(stripeSubscription.current_period_end * 1000);
        const periodStart = new Date(stripeSubscription.current_period_start * 1000);

        // Update subscription and reset usage
        await SubscriptionService.updateSubscription(userId, {
          status: 'active',
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        });

        await Subscription.findOneAndUpdate(
          { userId: user._id },
          { $set: { tokensUsedThisMonth: 0 } }
        );

        console.log(`💳 Subscription renewed for ${resolvedEmail}, usage reset`);

        const renewPlan = getSubscriptionPlan(existingSub.tier);
        EmailService.sendSubscriptionRenewedEmail(
          resolvedEmail,
          renewPlan.name,
          renewPlan.tokensPerMonth,
          periodEnd
        ).catch((err) => {
          console.error('Failed to send subscription renewed email:', err);
        });

        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;

        if (!subscriptionId) {
          console.log('⏭️ No subscription on failed invoice');
          break;
        }

        console.log(`📋 Invoice payment failed:`, { subscriptionId });

        const existingSub = await SubscriptionService.findByStripeSubscriptionId(subscriptionId);
        
        if (!existingSub) {
          console.log('⏭️ No matching subscription found');
          break;
        }

        const user = await User.findById(existingSub.userId).lean();
        if (!user) break;

        const resolvedEmail = user.email;

        await SubscriptionService.updateSubscription(user._id.toString(), {
          status: 'on_hold',
        });

        console.log(`❌ Payment failed for ${resolvedEmail}`);

        const holdPlan = getSubscriptionPlan(existingSub.tier);
        const retryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        EmailService.sendPaymentFailedEmail(resolvedEmail, holdPlan.name, retryDate).catch((err) => {
          console.error('Failed to send payment failed email:', err);
        });

        break;
      }

      default:
        console.log(`🔷 Unhandled Stripe event: ${event.type}`);
    }

    return c.json({ received: true });

  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

/**
 * GET /webhooks/stripe/test
 * Test endpoint to verify webhook is accessible
 */
webhooks.get('/stripe/test', (c) => {
  return c.json({
    status: 'ok',
    message: 'Stripe webhook endpoint is active',
    plans: {
      free: '$0/mo - 5,000 tokens',
      pro: '$29/mo - 100,000 tokens',
      business: '$79/mo - 250,000 tokens',
    },
  });
});

export { webhooks as webhookRoutes };

