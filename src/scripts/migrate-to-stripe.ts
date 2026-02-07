/**
 * Migration script: Dodo Payments → Stripe
 * 
 * This script renames database fields:
 * - dodoCustomerId → stripeCustomerId
 * - dodoSubscriptionId → stripeSubscriptionId
 * - dodoProductId → stripePriceId
 * 
 * Run with: bun run src/scripts/migrate-to-stripe.ts
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

async function migrate() {
  console.log('🔄 Starting Dodo → Stripe migration...\n');

  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI as string);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    const subscriptions = db.collection('subscriptions');

    // Step 1: Count documents to migrate
    const docsWithDodo = await subscriptions.countDocuments({
      $or: [
        { dodoCustomerId: { $exists: true } },
        { dodoSubscriptionId: { $exists: true } },
        { dodoProductId: { $exists: true } },
      ],
    });

    console.log(`📊 Found ${docsWithDodo} documents with Dodo fields\n`);

    if (docsWithDodo === 0) {
      console.log('✅ No documents need migration');
      await mongoose.disconnect();
      return;
    }

    // Step 2: Rename fields
    console.log('🔄 Renaming fields...');

    // Rename dodoCustomerId → stripeCustomerId
    const customerIdResult = await subscriptions.updateMany(
      { dodoCustomerId: { $exists: true } },
      { $rename: { 'dodoCustomerId': 'stripeCustomerId' } }
    );
    console.log(`   - Renamed dodoCustomerId: ${customerIdResult.modifiedCount} documents`);

    // Rename dodoSubscriptionId → stripeSubscriptionId
    const subIdResult = await subscriptions.updateMany(
      { dodoSubscriptionId: { $exists: true } },
      { $rename: { 'dodoSubscriptionId': 'stripeSubscriptionId' } }
    );
    console.log(`   - Renamed dodoSubscriptionId: ${subIdResult.modifiedCount} documents`);

    // Rename dodoProductId → stripePriceId
    const productIdResult = await subscriptions.updateMany(
      { dodoProductId: { $exists: true } },
      { $rename: { 'dodoProductId': 'stripePriceId' } }
    );
    console.log(`   - Renamed dodoProductId: ${productIdResult.modifiedCount} documents`);

    // Step 3: Update indexes
    console.log('\n🔄 Updating indexes...');

    // Drop old indexes (if they exist)
    try {
      await subscriptions.dropIndex('dodoCustomerId_1');
      console.log('   - Dropped dodoCustomerId index');
    } catch (e) {
      console.log('   - dodoCustomerId index did not exist');
    }

    try {
      await subscriptions.dropIndex('dodoSubscriptionId_1');
      console.log('   - Dropped dodoSubscriptionId index');
    } catch (e) {
      console.log('   - dodoSubscriptionId index did not exist');
    }

    // Create new indexes
    await subscriptions.createIndex({ stripeCustomerId: 1 }, { sparse: true });
    console.log('   - Created stripeCustomerId index');

    await subscriptions.createIndex({ stripeSubscriptionId: 1 }, { sparse: true });
    console.log('   - Created stripeSubscriptionId index');

    // Step 4: Verify migration
    console.log('\n🔍 Verifying migration...');

    const docsWithStripe = await subscriptions.countDocuments({
      $or: [
        { stripeCustomerId: { $exists: true, $ne: null } },
        { stripeSubscriptionId: { $exists: true, $ne: null } },
      ],
    });

    const remainingDodo = await subscriptions.countDocuments({
      $or: [
        { dodoCustomerId: { $exists: true } },
        { dodoSubscriptionId: { $exists: true } },
        { dodoProductId: { $exists: true } },
      ],
    });

    console.log(`   - Documents with Stripe fields: ${docsWithStripe}`);
    console.log(`   - Documents with remaining Dodo fields: ${remainingDodo}`);

    if (remainingDodo > 0) {
      console.log('\n⚠️ Warning: Some documents still have Dodo fields');
    }

    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Disconnected from MongoDB');
  }
}

// Run migration
migrate();
