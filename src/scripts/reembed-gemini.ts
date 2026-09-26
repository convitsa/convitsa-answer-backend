/**
 * One-time Migration Script: re-embed all Pages and DocumentChunks with Gemini
 *
 * Azure OpenAI embeddings are not comparable to Gemini embeddings even at the
 * same dimensionality, so every existing vector must be regenerated after
 * switching providers - otherwise RAG search silently returns nothing useful.
 *
 * Throttled between batches to stay under Gemini's free-tier rate limits.
 *
 * Usage:
 *   bun run src/scripts/reembed-gemini.ts
 *
 * Options:
 *   --dry-run           Count documents without calling Gemini or writing anything
 *   --verbose           Log every document as it's re-embedded
 *   --batch-size=N       Documents per Gemini batch call (default 16)
 *   --delay-ms=N         Delay between batches, in ms (default 4000)
 */

import type { Model } from 'mongoose';
import { connectMongoDB } from '../db/mongodb';
import { Page, DocumentChunk } from '../db/schemas';
import { EmbeddingService } from '../services/embedding.service';

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');
const batchSize = Number(process.argv.find((a) => a.startsWith('--batch-size='))?.split('=')[1] || 16);
const delayMs = Number(process.argv.find((a) => a.startsWith('--delay-ms='))?.split('=')[1] || 4000);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reembedCollection(
  label: string,
  model: Model<any>
): Promise<{ total: number; updated: number; failed: number }> {
  const total = await model.countDocuments();
  console.log(`\n📚 ${label}: ${total} documents to re-embed`);

  let updated = 0;
  let failed = 0;
  let processed = 0;

  // Cursor-based iteration so we never hold the whole collection in memory.
  const cursor = model.find().select('_id content').lean().cursor();

  let batch: Array<{ _id: unknown; content: string }> = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;

    try {
      if (dryRun) {
        if (verbose) {
          batch.forEach((doc) => console.log(`  [dry-run] would re-embed ${doc._id}`));
        }
      } else {
        const embeddings = await EmbeddingService.generateEmbeddings(batch.map((d) => d.content));
        await Promise.all(
          batch.map((doc, i) =>
            model.updateOne({ _id: doc._id }, { $set: { embedding: embeddings[i] } })
          )
        );
        if (verbose) {
          batch.forEach((doc) => console.log(`  ✅ re-embedded ${doc._id}`));
        }
      }
      updated += batch.length;
    } catch (error) {
      failed += batch.length;
      console.error(`  ❌ Batch failed (${batch.length} docs):`, error);
    }

    processed += batch.length;
    console.log(`  ${processed}/${total} processed`);
    batch = [];

    if (!dryRun) {
      await sleep(delayMs);
    }
  };

  for await (const doc of cursor) {
    batch.push(doc as unknown as { _id: unknown; content: string });
    if (batch.length >= batchSize) {
      await flushBatch();
    }
  }
  await flushBatch();

  return { total, updated, failed };
}

async function main(): Promise<void> {
  console.log('🚀 Starting re-embedding migration: Azure OpenAI -> Gemini');
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no writes, no Gemini calls)' : 'LIVE'}`);
  console.log(`   Batch size: ${batchSize}, delay between batches: ${delayMs}ms`);

  await connectMongoDB();

  const pageResult = await reembedCollection('Page (website content)', Page);
  const chunkResult = await reembedCollection('DocumentChunk (uploaded documents)', DocumentChunk);

  console.log('\n📊 Migration Summary');
  console.log(`   Pages:           ${pageResult.updated}/${pageResult.total} updated, ${pageResult.failed} failed`);
  console.log(`   Document chunks: ${chunkResult.updated}/${chunkResult.total} updated, ${chunkResult.failed} failed`);

  if (pageResult.failed > 0 || chunkResult.failed > 0) {
    process.exit(1);
  }
}

main()
  .then(() => {
    console.log('✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
