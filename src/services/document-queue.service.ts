import { getRedisClient } from '../db/redis';
import type { DocumentProcessingJob } from '../types';

const QUEUE_KEY = 'document_processing_queue';
const PROCESSING_KEY = 'document_processing_active';

export class DocumentQueueService {
  /**
   * Add a document processing job to the queue
   */
  static async enqueue(job: DocumentProcessingJob): Promise<void> {
    const client = getRedisClient();
    await client.rpush(QUEUE_KEY, JSON.stringify(job));
    console.log(`📥 Queued document for processing: ${job.fileName}`);
  }

  /**
   * Add multiple jobs to the queue
   */
  static async enqueueMany(jobs: DocumentProcessingJob[]): Promise<void> {
    if (jobs.length === 0) return;
    
    const client = getRedisClient();
    const serialized = jobs.map(j => JSON.stringify(j));
    await client.rpush(QUEUE_KEY, ...serialized);
    console.log(`📥 Queued ${jobs.length} documents for processing`);
  }

  /**
   * Get the next job from the queue (blocking pop with timeout)
   */
  static async dequeue(timeoutSeconds: number = 5): Promise<DocumentProcessingJob | null> {
    const client = getRedisClient();
    const result = await client.blpop(QUEUE_KEY, timeoutSeconds);
    
    if (!result) {
      return null;
    }

    try {
      return JSON.parse(result[1]) as DocumentProcessingJob;
    } catch {
      console.error('Failed to parse job from queue:', result[1]);
      return null;
    }
  }

  /**
   * Get queue length
   */
  static async getQueueLength(): Promise<number> {
    const client = getRedisClient();
    return client.llen(QUEUE_KEY);
  }

  /**
   * Mark a job as actively processing
   */
  static async markProcessing(documentId: string): Promise<void> {
    const client = getRedisClient();
    await client.hset(PROCESSING_KEY, documentId, Date.now().toString());
  }

  /**
   * Mark a job as completed (remove from processing set)
   */
  static async markCompleted(documentId: string): Promise<void> {
    const client = getRedisClient();
    await client.hdel(PROCESSING_KEY, documentId);
  }

  /**
   * Check if a document is currently being processed
   */
  static async isProcessing(documentId: string): Promise<boolean> {
    const client = getRedisClient();
    const exists = await client.hexists(PROCESSING_KEY, documentId);
    return exists === 1;
  }

  /**
   * Get all currently processing document IDs
   */
  static async getProcessingDocuments(): Promise<string[]> {
    const client = getRedisClient();
    const all = await client.hgetall(PROCESSING_KEY);
    return Object.keys(all);
  }

  /**
   * Clear stale processing entries (older than given minutes)
   */
  static async clearStaleProcessing(maxAgeMinutes: number = 30): Promise<number> {
    const client = getRedisClient();
    const all = await client.hgetall(PROCESSING_KEY);
    const now = Date.now();
    const maxAge = maxAgeMinutes * 60 * 1000;
    
    let cleared = 0;
    for (const [documentId, timestamp] of Object.entries(all)) {
      const startTime = parseInt(timestamp, 10);
      if (now - startTime > maxAge) {
        await client.hdel(PROCESSING_KEY, documentId);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(`🧹 Cleared ${cleared} stale processing entries`);
    }
    
    return cleared;
  }

  /**
   * Get queue stats
   */
  static async getStats(): Promise<{
    queueLength: number;
    processing: number;
  }> {
    const client = getRedisClient();
    const [queueLength, processingCount] = await Promise.all([
      client.llen(QUEUE_KEY),
      client.hlen(PROCESSING_KEY),
    ]);
    
    return {
      queueLength,
      processing: processingCount,
    };
  }
}

