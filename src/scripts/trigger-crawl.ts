/**
 * Manually trigger a site crawl for a project.
 * 
 * Usage:
 *   bun run src/scripts/trigger-crawl.ts <projectId>
 *   bun run src/scripts/trigger-crawl.ts <projectId> [websiteUrl]
 * 
 * Examples:
 *   bun run src/scripts/trigger-crawl.ts 6651a2b3c4d5e6f7g8h9i0j1
 *   bun run src/scripts/trigger-crawl.ts 6651a2b3c4d5e6f7g8h9i0j1 https://example.com
 */

import mongoose from 'mongoose';
import { CrawlService } from '../services/crawl.service';
import { Project } from '../db/schemas';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

const projectId = process.argv[2];
const overrideUrl = process.argv[3];

if (!projectId) {
  console.error('❌ Usage: bun run src/scripts/trigger-crawl.ts <projectId> [websiteUrl]');
  process.exit(1);
}

async function main() {
  try {
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI as string);
    console.log('✅ Connected\n');

    const project = await Project.findById(projectId).lean();

    if (!project) {
      console.error(`❌ Project not found: ${projectId}`);
      process.exit(1);
    }

    const websiteUrl = overrideUrl || project.websiteUrl;

    console.log(`📌 Project: ${project.name}`);
    console.log(`🌐 URL: ${websiteUrl}`);
    console.log(`📊 Current crawl status: ${project.crawlStatus}\n`);

    console.log('🚀 Starting crawl...\n');
    await CrawlService.startCrawl(projectId, websiteUrl);

    console.log('\n✅ Script finished');
  } catch (error) {
    console.error('❌ Script error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main();
