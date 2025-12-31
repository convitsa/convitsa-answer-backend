import { Hono } from 'hono';
import { User, CreditBalance, CreditTransaction } from '../../db/schemas';
import { env } from '../../config/env';
import { EmailService } from '../../services/email.service';

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
    message: 'Gumroad webhook endpoint is active',
    packages: {
      '$9': '500 credits',
      '$15': '1000 credits',
      '$25': '2000 credits',
      '$49': '5000 credits',
    },
  });
});

export { webhooks as webhookRoutes };

