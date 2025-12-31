import { AzureOpenAI } from 'openai';
import { env } from '../config/env';

// Initialize Azure OpenAI client for embeddings
const client = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion:"2024-02-01"
});

// text-embedding-3-large produces 3072-dimensional vectors
const EMBEDDING_DIMENSIONS = 3072;
const MAX_BATCH_SIZE = 16; // Azure limit

export class EmbeddingService {
  /**
   * Generate embedding for a single text
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await client.embeddings.create({
        model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
        input: text.slice(0, 8000), // Limit input length
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error('Embedding generation error:', error);
      throw new Error('Failed to generate embedding');
    }
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  static async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const totalBatches = Math.ceil(texts.length / MAX_BATCH_SIZE);

    // Process in batches
    for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
      const batchNum = Math.floor(i / MAX_BATCH_SIZE) + 1;
      const batch = texts.slice(i, i + MAX_BATCH_SIZE);
      const truncatedBatch = batch.map((t) => t.slice(0, 8000));

      console.log(`         🔄 Embedding batch ${batchNum}/${totalBatches} (${batch.length} texts)...`);
      const batchStartTime = Date.now();

      try {
        const response = await client.embeddings.create({
          model: env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT,
          input: truncatedBatch,
        });

        // Sort by index to maintain order
        const sortedData = response.data.sort((a, b) => a.index - b.index);
        embeddings.push(...sortedData.map((d) => d.embedding));
        
        const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(2);
        console.log(`         ✅ Batch ${batchNum}/${totalBatches} completed in ${batchDuration}s`);
      } catch (error) {
        console.error(`         ❌ Batch ${batchNum} failed, falling back to one-by-one:`, error);
        // Fallback: process one by one
        for (const text of batch) {
          try {
            const embedding = await this.generateEmbedding(text);
            embeddings.push(embedding);
          } catch {
            // Use zero vector as fallback
            embeddings.push(new Array(EMBEDDING_DIMENSIONS).fill(0));
          }
        }
      }
    }

    return embeddings;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }
}

