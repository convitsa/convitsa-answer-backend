import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env';

// Initialize Gemini client for embeddings
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

// Matches the dimensionality of the existing MongoDB Atlas vector search
// indexes (vector_index / document_vector_index), so no index changes are
// needed when switching providers - only the stored vector values change.
const EMBEDDING_DIMENSIONS = 3072;
const MAX_BATCH_SIZE = 16;

export class EmbeddingService {
  /**
   * Generate embedding for a single text
   */
  static async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await ai.models.embedContent({
        model: env.GEMINI_EMBEDDING_MODEL,
        contents: text.slice(0, 8000),
        config: { outputDimensionality: EMBEDDING_DIMENSIONS },
      });

      const embedding = response.embeddings?.[0]?.values;
      if (!embedding) {
        throw new Error('No embedding returned');
      }
      return embedding;
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
        const response = await ai.models.embedContent({
          model: env.GEMINI_EMBEDDING_MODEL,
          contents: truncatedBatch,
          config: { outputDimensionality: EMBEDDING_DIMENSIONS },
        });

        const batchEmbeddings = response.embeddings?.map((e) => e.values || []) || [];
        if (batchEmbeddings.length !== batch.length) {
          throw new Error(`Expected ${batch.length} embeddings, got ${batchEmbeddings.length}`);
        }
        embeddings.push(...batchEmbeddings);

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
