/**
 * Migration Script: Credits to Subscription
 * 
 * This script migrates existing credit balances to the new subscription model.
 * 
 * Conversion logic:
 * - Credits are converted to bonus tokens (1 credit = 1000 tokens)
 * - Users with credits get a Pro subscription for the value of their credits
 * - Partial credits become bonus tokens
 * 
 * Usage:
 *   bun run src/scripts/migrate-credits-to-subscription.ts
 *   
 * Options:
 *   --dry-run    Preview changes without applying them
 *   --verbose    Show detailed output
 */

import { connectMongoDB } from '../db/mongodb';
import { User, CreditBalance, Subscription } from '../db/schemas';
import { getSubscriptionPlan } from '../config/env';

// Configuration
const TOKENS_PER_CREDIT = 1000; // 1 credit = 1000 tokens
const PRO_TOKENS_PER_MONTH = 100000; // Pro tier tokens

interface MigrationResult {
  userId: string;
  email: string;
  creditBalance: number;
  tokensGranted: number;
  tier: 'free' | 'pro' | 'business';
  bonusTokens: number;
  success: boolean;
  error?: string;
}

async function migrateCreditsToSubscription(dryRun = false, verbose = false): Promise<void> {
  console.log('🚀 Starting credit to subscription migration...');
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}`);
  console.log('');

  // Get all users with credit balances
  const creditBalances = await CreditBalance.find({ balance: { $gt: 0 } }).lean();
  
  console.log(`📊 Found ${creditBalances.length} users with credit balances`);
  console.log('');

  const results: MigrationResult[] = [];
  let totalCredits = 0;
  let totalTokensGranted = 0;
  let migratedCount = 0;
  let errorCount = 0;

  for (const creditBalance of creditBalances) {
    try {
      const userId = creditBalance.userId.toString();
      const credits = creditBalance.balance;
      totalCredits += credits;

      // Get user email
      const user = await User.findById(userId).select('email').lean();
      if (!user) {
        console.error(`❌ User not found: ${userId}`);
        results.push({
          userId,
          email: 'unknown',
          creditBalance: credits,
          tokensGranted: 0,
          tier: 'free',
          bonusTokens: 0,
          success: false,
          error: 'User not found',
        });
        errorCount++;
        continue;
      }

      // Calculate tokens from credits
      const totalTokens = credits * TOKENS_PER_CREDIT;
      totalTokensGranted += totalTokens;

      // Determine tier and bonus tokens
      // If user has enough for at least 1 month of Pro, give them Pro
      // All their tokens become bonus tokens
      let tier: 'free' | 'pro' | 'business' = 'free';
      let bonusTokens = totalTokens;

      if (totalTokens >= PRO_TOKENS_PER_MONTH) {
        tier = 'pro';
      }

      if (verbose) {
        console.log(`👤 ${user.email}`);
        console.log(`   Credits: ${credits}`);
        console.log(`   Tokens: ${totalTokens.toLocaleString()}`);
        console.log(`   Tier: ${tier}`);
        console.log(`   Bonus tokens: ${bonusTokens.toLocaleString()}`);
        console.log('');
      }

      if (!dryRun) {
        // Check if subscription already exists
        const existingSub = await Subscription.findOne({ userId: creditBalance.userId }).lean();

        if (existingSub && existingSub.migratedFromCredits && existingSub.migratedFromCredits > 0) {
          console.log(`⚠️  ${user.email}: Already migrated (${existingSub.migratedFromCredits} credits)`);
          results.push({
            userId,
            email: user.email,
            creditBalance: credits,
            tokensGranted: 0,
            tier: existingSub.tier,
            bonusTokens: 0,
            success: true,
            error: 'Already migrated',
          });
          continue;
        }

        // Create or update subscription
        const plan = getSubscriptionPlan(tier);
        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await Subscription.findOneAndUpdate(
          { userId: creditBalance.userId },
          {
            $set: {
              tier,
              status: 'active',
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: false,
              tokensUsedThisMonth: 0,
              tokensLimit: plan.tokensPerMonth,
              projectsLimit: plan.projectsLimit,
              migratedFromCredits: credits,
              bonusTokens,
              updatedAt: now,
            },
          },
          { upsert: true }
        );

        // Mark credit balance as migrated (set to 0)
        await CreditBalance.findOneAndUpdate(
          { userId: creditBalance.userId },
          { 
            $set: { 
              balance: 0,
              updatedAt: now,
            } 
          }
        );

        console.log(`✅ Migrated ${user.email}: ${credits} credits → ${bonusTokens.toLocaleString()} bonus tokens (${tier})`);
        migratedCount++;
      }

      results.push({
        userId,
        email: user.email,
        creditBalance: credits,
        tokensGranted: totalTokens,
        tier,
        bonusTokens,
        success: true,
      });

    } catch (error) {
      console.error(`❌ Error migrating user ${creditBalance.userId}:`, error);
      results.push({
        userId: creditBalance.userId.toString(),
        email: 'error',
        creditBalance: creditBalance.balance,
        tokensGranted: 0,
        tier: 'free',
        bonusTokens: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      errorCount++;
    }
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    MIGRATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   Total users with credits: ${creditBalances.length}`);
  console.log(`   Total credits: ${totalCredits.toLocaleString()}`);
  console.log(`   Total tokens granted: ${totalTokensGranted.toLocaleString()}`);
  console.log(`   Successfully migrated: ${migratedCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log('');

  // Breakdown by tier
  const tierBreakdown = results.reduce((acc, r) => {
    acc[r.tier] = (acc[r.tier] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('   Tier breakdown:');
  Object.entries(tierBreakdown).forEach(([tier, count]) => {
    console.log(`     - ${tier}: ${count} users`);
  });

  console.log('');
  if (dryRun) {
    console.log('💡 This was a DRY RUN. No changes were made.');
    console.log('   Run without --dry-run to apply changes.');
  } else {
    console.log('✅ Migration complete!');
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  try {
    // Connect to MongoDB
    await connectMongoDB();

    // Run migration
    await migrateCreditsToSubscription(dryRun, verbose);

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

main();
