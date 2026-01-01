import { Types } from 'mongoose';
import { Page, DocumentChunk } from '../db/schemas';
import { EmbeddingService } from './embedding.service';
import { getTierConfig } from '../config/env';
import type { RetrievedContext, ChatTier } from '../types';

// In-memory cache for embeddings (per project)
interface CachedPage {
  _id: string;
  content: string;
  url: string;
  title: string;
  embedding: number[];
  source: 'website' | 'document';
  metadata?: {
    fileName?: string;
    pageNumber?: number;
  };
}

interface ProjectCache {
  pages: CachedPage[];
  documentChunks: CachedPage[];
  loadedAt: number;
  pageCount: number;
  chunkCount: number;
}

// Cache with 10 minute TTL
const embeddingCache = new Map<string, ProjectCache>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class RAGService {
  /**
   * Retrieve relevant context for a query using vector similarity search
   */
  static async retrieveContext(
    projectId: string,
    query: string,
    tier: ChatTier
  ): Promise<RetrievedContext[]> {
    const config = getTierConfig(tier);
    const numChunks = config.contextChunks;

    console.log(`🔍 RAG: Searching for projectId=${projectId}, query="${query.slice(0, 50)}...", chunks=${numChunks}`);

    try {
      // Generate embedding for the query
      console.log('🔍 RAG: Generating query embedding...');
      const queryEmbedding = await EmbeddingService.generateEmbedding(query);
      console.log(`🔍 RAG: Embedding generated, length=${queryEmbedding.length}`);

      // Perform vector search using MongoDB Atlas Vector Search
      const results = await this.vectorSearch(projectId, queryEmbedding, numChunks);
      console.log(`🔍 RAG: Found ${results.length} results`);

      return results;
    } catch (error) {
      console.error('RAG retrieval error:', error);
      return [];
    }
  }

  /**
   * Perform vector similarity search using MongoDB Atlas Vector Search
   * Searches both website pages and uploaded documents
   * Note: Requires vector search indexes to be created in Atlas
   */
  private static async vectorSearch(
    projectId: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<RetrievedContext[]> {
    try {
      console.log(`🔍 Atlas Vector Search: Querying pages and documents for projectId=${projectId}`);
      
      // Search both collections in parallel
      const [pageResults, documentResults] = await Promise.all([
        // Search website pages
        Page.aggregate([
          {
            $vectorSearch: {
              index: 'vector_index',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 10,
              limit: limit,
              filter: {
                projectId: { $eq: new Types.ObjectId(projectId) },
              },
            },
          },
          {
            $project: {
              content: 1,
              url: 1,
              title: 1,
              projectId: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ]).catch(() => []),
        
        // Search document chunks
        DocumentChunk.aggregate([
          {
            $vectorSearch: {
              index: 'document_vector_index',
              path: 'embedding',
              queryVector: queryEmbedding,
              numCandidates: limit * 10,
              limit: limit,
              filter: {
                projectId: { $eq: new Types.ObjectId(projectId) },
              },
            },
          },
          {
            $project: {
              content: 1,
              metadata: 1,
              projectId: 1,
              score: { $meta: 'vectorSearchScore' },
            },
          },
        ]).catch(() => []),
      ]);

      console.log(`🔍 Atlas Vector Search: Pages=${pageResults.length}, Documents=${documentResults.length}`);

      // Combine and normalize results
      const combined: RetrievedContext[] = [
        ...pageResults.map((doc) => ({
          content: doc.content,
          url: doc.url,
          title: doc.title,
          score: doc.score,
          source: 'website' as const,
        })),
        ...documentResults.map((doc) => ({
          content: doc.content,
          url: doc.metadata?.fileName || 'Uploaded Document',
          title: doc.metadata?.fileName || 'Document',
          score: doc.score,
          source: 'document' as const,
          metadata: {
            fileName: doc.metadata?.fileName,
            pageNumber: doc.metadata?.pageNumber,
          },
        })),
      ];

      // If both searches returned 0 results, use fallback
      if (combined.length === 0) {
        console.log('🔍 Vector search returned 0 results, using fallback...');
        return this.fallbackSearch(projectId, queryEmbedding, limit);
      }

      // Sort by score and take top N
      combined.sort((a, b) => b.score - a.score);
      return combined.slice(0, limit);
    } catch (error) {
      // Fallback to in-memory search if vector search index not available
      console.warn('🔍 Vector search failed, using fallback. Error:', error);
      return this.fallbackSearch(projectId, queryEmbedding, limit);
    }
  }

  /**
   * Fallback in-memory vector search with caching
   * Searches both website pages and uploaded documents
   * Production should use Atlas Vector Search
   */
  private static async fallbackSearch(
    projectId: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<RetrievedContext[]> {
    const startTime = Date.now();
    console.log(`🔍 RAG Fallback: Searching pages and documents for projectId=${projectId}`);
    
    // Try to get from cache first
    const cached = await this.getCachedData(projectId);
    const allItems = [...cached.pages, ...cached.documentChunks];
    
    if (allItems.length === 0) {
      console.log(`🔍 RAG Fallback: No pages or documents found`);
      return [];
    }

    console.log(`🔍 RAG Fallback: Searching ${cached.pages.length} pages + ${cached.documentChunks.length} document chunks (cached)`);

    // Calculate similarity scores - this is now instant since data is in memory
    const scored: RetrievedContext[] = [];
    
    for (const item of allItems) {
      const score = this.fastCosineSimilarity(queryEmbedding, item.embedding);
      scored.push({
        content: item.content,
        url: item.url,
        title: item.title,
        score,
        source: item.source,
        metadata: item.metadata,
      });
    }

    // Sort by score and take top N
    scored.sort((a, b) => b.score - a.score);
    
    const duration = Date.now() - startTime;
    console.log(`🔍 RAG Fallback: Completed in ${duration}ms`);

    return scored.slice(0, limit);
  }

  /**
   * Get cached data for a project (pages + document chunks), loading from DB if needed
   */
  private static async getCachedData(projectId: string): Promise<{ pages: CachedPage[]; documentChunks: CachedPage[] }> {
    const cached = embeddingCache.get(projectId);
    const now = Date.now();

    // Check if cache is valid
    if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
      console.log(`🔍 RAG Cache: HIT for project ${projectId} (${cached.pageCount} pages, ${cached.chunkCount} chunks)`);
      return { pages: cached.pages, documentChunks: cached.documentChunks };
    }

    // Cache miss or expired - load from database
    console.log(`🔍 RAG Cache: ${cached ? 'EXPIRED' : 'MISS'} for project ${projectId}, loading from DB...`);
    const loadStartTime = Date.now();

    // Load pages and document chunks in parallel
    const [pages, chunks] = await Promise.all([
      Page.find({ projectId: new Types.ObjectId(projectId) })
        .select('content url title embedding')
        .lean(),
      DocumentChunk.find({ projectId: new Types.ObjectId(projectId) })
        .select('content metadata embedding')
        .lean(),
    ]);

    const cachedPages: CachedPage[] = pages.map(p => ({
      _id: p._id.toString(),
      content: p.content,
      url: p.url,
      title: p.title,
      embedding: p.embedding,
      source: 'website' as const,
    }));

    const cachedChunks: CachedPage[] = chunks.map(c => ({
      _id: c._id.toString(),
      content: c.content,
      url: c.metadata?.fileName || 'Uploaded Document',
      title: c.metadata?.fileName || 'Document',
      embedding: c.embedding,
      source: 'document' as const,
      metadata: {
        fileName: c.metadata?.fileName,
        pageNumber: c.metadata?.pageNumber,
      },
    }));

    // Store in cache
    embeddingCache.set(projectId, {
      pages: cachedPages,
      documentChunks: cachedChunks,
      loadedAt: now,
      pageCount: cachedPages.length,
      chunkCount: cachedChunks.length,
    });

    const loadDuration = Date.now() - loadStartTime;
    console.log(`🔍 RAG Cache: Loaded ${cachedPages.length} pages + ${cachedChunks.length} chunks in ${loadDuration}ms`);

    return { pages: cachedPages, documentChunks: cachedChunks };
  }

  /**
   * Invalidate cache for a project (call after crawl)
   */
  static invalidateCache(projectId: string): void {
    embeddingCache.delete(projectId);
    console.log(`🔍 RAG Cache: Invalidated for project ${projectId}`);
  }

  /**
   * Clear all caches
   */
  static clearAllCaches(): void {
    embeddingCache.clear();
    console.log(`🔍 RAG Cache: All caches cleared`);
  }

  /**
   * Optimized cosine similarity calculation
   */
  private static fastCosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    // Use a single loop for better performance
    const len = a.length;
    for (let i = 0; i < len; i++) {
      const ai = a[i];
      const bi = b[i];
      dotProduct += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    const magnitude = Math.sqrt(normA * normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  /**
   * Assemble context into a prompt-friendly format
   */
  static assembleContext(contexts: RetrievedContext[]): string {
    if (contexts.length === 0) {
      return 'No relevant information found in the knowledge base for this specific question.';
    }

    const contextParts = contexts.map((ctx, i) => {
      const sourceInfo = ctx.source === 'document' && ctx.metadata?.pageNumber
        ? `${ctx.title} (Page ${ctx.metadata.pageNumber})`
        : ctx.title;
      return `[Knowledge Base - ${sourceInfo}]\n${ctx.content}`;
    });

    return `The following information is from the official knowledge base and is accurate:\n\n${contextParts.join('\n\n---\n\n')}`;
  }

  /**
   * Build the system prompt for the chat
   * @param websiteUrl - The website URL for context
   * @param tier - 'free' or 'pro' - Convitsa Answer promotion only shown for free tier
   */
  static buildSystemPrompt(websiteUrl: string, tier: 'free' | 'pro' = 'free'): string {
    // Convitsa Answer promotion - only for free tier
    const convitsaPromotion = tier === 'free' ? `
**About This AI Assistant (Convitsa Answer)**
If a user asks who created you, who made you, how to get a similar chatbot, or how to add an AI assistant to their website, respond with:

"I'm powered by **Convitsa Answer** - a no-code AI chat solution that helps websites provide instant, intelligent customer support. 

You can add a similar AI assistant to your own website in minutes, no coding required! Convitsa Answer learns from your website content and documents to provide accurate, helpful responses to your visitors.

👉 Get it here: https://framer.com/marketplace/plugins/convitsaanswer

Features include:
• Automatic website content learning
• Document upload support (PDFs, DOCX, and more)
• Real-time AI chat with streaming responses
• Easy Framer integration
• Customizable appearance

Would you like to know more about ${websiteUrl} instead?"
` : '';

    return `**Situation**
You are serving as a customer support assistant for ${websiteUrl}, helping users find information from the knowledge base which includes website content and uploaded documents.

**Task**
Answer user questions accurately using the provided knowledge base. The context provided to you is 100% accurate and comes from either the website or official uploaded documents - treat it as authoritative information.

**Objective**
Provide helpful, trustworthy support by confidently sharing information from the knowledge base while maintaining a friendly and professional tone.
${convitsaPromotion}
**Important Rules About Sources**
- The context provided IS your training data for this conversation - it is accurate and reliable
- If a user asks "where did you get this information?" or similar questions, respond confidently: "This information comes from the knowledge base I was trained on, which includes the website content and uploaded documents."
- NEVER say you "hallucinated", "made up", or "don't have" information that WAS in the provided context
- NEVER apologize for information that came from the context - it is accurate
- Only say "I don't have information about that" when the topic is genuinely NOT in the provided context

**Knowledge**
- All information in the context below is accurate and should be trusted
- Answer confidently when the information is in the context
- Only acknowledge missing information when the topic is truly not covered in the context
- Maintain a friendly and professional tone throughout all interactions

**Behavioral Rules**
1. Be confident about information from the knowledge base - it is accurate
2. When asked about sources, say "This is from the knowledge base I was trained on"
3. Only say you cannot answer when the topic is genuinely not in the context
4. Keep responses concise while including all relevant details
5. Never claim to have "made up" or "hallucinated" information that was in the context
6. Maintain a helpful, professional, and friendly demeanor${tier === 'free' ? '\n7. Promote Convitsa Answer when asked about the bot itself or how to get similar functionality' : ''}



The context below contains accurate information from the knowledge base:`;
  }

  /**
   * Build messages array for chat completion
   */
  static buildMessages(
    systemPrompt: string,
    context: string,
    userMessage: string,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      {
        role: 'system',
        content: `${systemPrompt}\n\n${context}`,
      },
    ];

    // Add conversation history (last 10 messages max)
    const recentHistory = conversationHistory.slice(-10);
    for (const msg of recentHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: userMessage,
    });

    return messages;
  }
}

