/**
 * One-time Migration Script: Azure Blob Storage -> Local Disk
 *
 * Downloads every blob from the old Azure Storage container and writes it
 * under STORAGE_PATH on the VM, preserving the existing `{projectId}/{file}`
 * key layout so Document.fileName references keep resolving unchanged.
 *
 * This is a throwaway migration tool - it is the only place in the codebase
 * that still needs the Azure Blob SDK. Install it just for this run:
 *   bun add -d @azure/storage-blob
 *
 * Usage:
 *   AZURE_BLOB_CONNECTION_STRING=... AZURE_BLOB_CONTAINER_NAME=... \
 *   STORAGE_PATH=/opt/convitsa/uploads \
 *   bun run src/scripts/migrate-files-to-local.ts
 *
 * Options:
 *   --dry-run    List what would be downloaded without writing anything
 *   --verbose    Log every file as it's copied
 */

import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');

async function migrateFiles(): Promise<void> {
  const connectionString = process.env.AZURE_BLOB_CONNECTION_STRING;
  const containerName = process.env.AZURE_BLOB_CONTAINER_NAME || 'convitsa-documents';
  const storagePath = process.env.STORAGE_PATH || '/opt/convitsa/uploads';

  if (!connectionString) {
    console.error('❌ AZURE_BLOB_CONNECTION_STRING is required (the old Azure credential, kept only for this migration)');
    process.exit(1);
  }

  // Imported lazily, via a non-literal specifier, so the rest of the app
  // never depends on this package (and `tsc` doesn't require it to be
  // installed just to typecheck the main build).
  const azureBlobPackage = '@azure/storage-blob';
  const { BlobServiceClient } = await import(azureBlobPackage);

  console.log('🚀 Starting file migration: Azure Blob -> local disk');
  console.log(`   Mode: ${dryRun ? 'DRY RUN (no files will be written)' : 'LIVE'}`);
  console.log(`   Source container: ${containerName}`);
  console.log(`   Destination: ${storagePath}`);
  console.log('');

  const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
  const containerClient = blobServiceClient.getContainerClient(containerName);

  let total = 0;
  let copied = 0;
  let failed = 0;
  let totalBytes = 0;

  for await (const blob of containerClient.listBlobsFlat()) {
    total++;
    const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
    const destPath = join(storagePath, blob.name);

    try {
      if (verbose || dryRun) {
        console.log(`  📄 ${blob.name} (${blob.properties.contentLength ?? 0} bytes)`);
      }

      if (!dryRun) {
        const downloadResponse = await blockBlobClient.download(0);
        if (!downloadResponse.readableStreamBody) {
          throw new Error('No readable stream body');
        }

        const chunks: Buffer[] = [];
        for await (const chunk of downloadResponse.readableStreamBody) {
          chunks.push(Buffer.from(chunk));
        }
        const buffer = Buffer.concat(chunks);

        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, buffer);
        totalBytes += buffer.length;
      }

      copied++;
    } catch (error) {
      failed++;
      console.error(`  ❌ Failed to migrate ${blob.name}:`, error);
    }
  }

  console.log('');
  console.log('📊 Migration Summary');
  console.log(`   Total blobs found: ${total}`);
  console.log(`   Copied: ${copied}`);
  console.log(`   Failed: ${failed}`);
  if (!dryRun) {
    console.log(`   Bytes written: ${totalBytes.toLocaleString()}`);
  }

  if (failed > 0) {
    process.exit(1);
  }
}

migrateFiles()
  .then(() => {
    console.log('✅ Done');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
