/**
 * Migration script: Rename Lemon Squeezy fields to Dodo Payments fields
 * 
 * This script renames the following fields in the subscriptions collection:
 * - lemonSqueezyCustomerId -> dodoCustomerId
 * - lemonSqueezySubscriptionId -> dodoSubscriptionId
 * - lemonSqueezyVariantId -> dodoProductId
 * 
 * Also updates status values:
 * - past_due -> on_hold
 * - paused -> on_hold
 * - trialing -> active (since Dodo doesn't have trialing status separately)
 * 
 * Run this ONCE after deploying the new code:
 * bun run src/scripts/migrate-to-dodo.ts
 */

import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || '';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is required');
  process.exit(1);
}

async function migrate() {
  console.log('🚀 Starting Dodo Payments migration...');
  
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    const subscriptions = db.collection('subscriptions');

    // 1. Rename Lemon Squeezy fields to Dodo Payments fields
    console.log('\n📝 Step 1: Renaming fields...');
    
    const renameResult = await subscriptions.updateMany(
      {},
      {
        $rename: {
          'lemonSqueezyCustomerId': 'dodoCustomerId',
          'lemonSqueezySubscriptionId': 'dodoSubscriptionId',
          'lemonSqueezyVariantId': 'dodoProductId',
        },
      }
    );
    
    console.log(`   - Renamed fields in ${renameResult.modifiedCount} documents`);

    // 2. Update status values to match Dodo Payments
    console.log('\n📝 Step 2: Updating status values...');
    
    // past_due -> on_hold
    const pastDueResult = await subscriptions.updateMany(
      { status: 'past_due' },
      { $set: { status: 'on_hold' } }
    );
    console.log(`   - Updated ${pastDueResult.modifiedCount} 'past_due' -> 'on_hold'`);

    // paused -> on_hold
    const pausedResult = await subscriptions.updateMany(
      { status: 'paused' },
      { $set: { status: 'on_hold' } }
    );
    console.log(`   - Updated ${pausedResult.modifiedCount} 'paused' -> 'on_hold'`);

    // trialing -> active (Dodo handles trials differently)
    const trialingResult = await subscriptions.updateMany(
      { status: 'trialing' },
      { $set: { status: 'active' } }
    );
    console.log(`   - Updated ${trialingResult.modifiedCount} 'trialing' -> 'active'`);

    // 3. Drop old indexes and create new ones
    console.log('\n📝 Step 3: Updating indexes...');
    
    try {
      await subscriptions.dropIndex('lemonSqueezyCustomerId_1');
      console.log('   - Dropped old lemonSqueezyCustomerId index');
    } catch (e) {
      console.log('   - lemonSqueezyCustomerId index not found (ok)');
    }

    try {
      await subscriptions.dropIndex('lemonSqueezySubscriptionId_1');
      console.log('   - Dropped old lemonSqueezySubscriptionId index');
    } catch (e) {
      console.log('   - lemonSqueezySubscriptionId index not found (ok)');
    }

    // Create new indexes
    await subscriptions.createIndex({ dodoCustomerId: 1 }, { sparse: true });
    console.log('   - Created dodoCustomerId index');
    
    await subscriptions.createIndex({ dodoSubscriptionId: 1 }, { sparse: true });
    console.log('   - Created dodoSubscriptionId index');

    // 4. Summary
    console.log('\n✅ Migration completed successfully!');
    
    const totalDocs = await subscriptions.countDocuments();
    const docsWithDodo = await subscriptions.countDocuments({
      $or: [
        { dodoCustomerId: { $exists: true, $ne: null } },
        { dodoSubscriptionId: { $exists: true, $ne: null } },
      ],
    });
    
    console.log(`\n📊 Summary:`);
    console.log(`   - Total subscriptions: ${totalDocs}`);
    console.log(`   - With Dodo IDs: ${docsWithDodo}`);
    console.log(`   - Free tier (no payment IDs): ${totalDocs - docsWithDodo}`);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run migration
migrate();
