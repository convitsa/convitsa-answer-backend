import { Types } from 'mongoose';
import { Page, DocumentChunk } from '../db/schemas';
import { EmbeddingService } from './embedding.service';
import { getTierConfig } from '../config/env';
import type { RetrievedContext, ChatTier, MarketingConfig, AIPersonality } from '../types';

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

    // Log FAQ chunks found
    const faqChunks = cachedChunks.filter(c => c.title === 'FAQ - User Questions');
    if (faqChunks.length > 0) {
      console.log(`🔍 RAG Cache: Found ${faqChunks.length} FAQ chunks:`);
      faqChunks.forEach((faq, i) => {
        console.log(`   FAQ ${i + 1}: "${faq.content.slice(0, 100)}..."`);
      });
    }

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

    // Log what sources are being used
    const websiteContexts = contexts.filter(c => c.source === 'website');
    const documentContexts = contexts.filter(c => c.source === 'document');
    const faqContexts = documentContexts.filter(c => c.title === 'FAQ - User Questions');
    
    console.log(`🔍 Context Sources: ${websiteContexts.length} website, ${documentContexts.length} document (${faqContexts.length} FAQ)`);
    
    if (faqContexts.length > 0) {
      console.log(`🔍 FAQ context found and being used in prompt:`);
      faqContexts.forEach((faq, i) => {
        console.log(`   FAQ ${i + 1} (score=${faq.score.toFixed(3)}): "${faq.content.slice(0, 80)}..."`);
      });
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
   * @param tier - 'free', 'pro', or 'business' - Convitsa Answer promotion only shown for free tier
   * @param marketingConfig - Optional marketing configuration for sales-focused responses
   */
  static buildSystemPrompt(
    websiteUrl: string,
    tier: 'free' | 'pro' | 'business' = 'free',
    marketingConfig?: MarketingConfig
  ): string {
    // Use marketing personality if configured, otherwise use support personality
    if (marketingConfig) {
      return this.buildMarketingPrompt(websiteUrl, tier, marketingConfig);
    }
    return this.buildSupportPrompt(websiteUrl, tier);
  }

  /**
   * Build marketing/sales focused system prompt
   */
  private static buildMarketingPrompt(
    websiteUrl: string,
    tier: 'free' | 'pro' | 'business',
    config: MarketingConfig
  ): string {
    const personalityInstructions = this.getPersonalityInstructions(config.aiPersonality);
    const fallbackInstructions = this.getFallbackInstructions(config);
    const convitsaPromotion = tier === 'free' ? this.getConvitsaPromotion(websiteUrl) : '';

    return `You are a marketing and sales assistant for ${websiteUrl}.

Your mission is to:
- Answer visitor questions accurately
- Educate visitors
- Build trust
- Naturally guide high-intent users toward conversion

**Marketing Personality**
${personalityInstructions}

**Primary Objectives**
1. Answer questions using the knowledge base only
2. Clearly communicate value and benefits
3. Identify buying intent through conversation
4. Encourage action without being pushy

**Marketing Behavior Rules (CRITICAL)**
- Be helpful first, sales second
- Match the visitor's intent and energy
- Never oversell or exaggerate
- Never invent statistics, clients, or results
- If the visitor shows buying intent → guide them fast
- If the visitor is exploring → educate and plant seeds

**Lead Capture Strategy**
Use context-aware transitions, never sudden CTAs.

Examples:
- "If you'd like, I can send you more details — what's the best email?"
- "Want to see how this would work for your specific use case?"
- "Would it help to have someone from our team walk you through it?"

Only attempt lead capture after delivering value.
${fallbackInstructions}
${convitsaPromotion}
The context below contains accurate information from the knowledge base:`;
  }

  /**
   * Get personality-specific instructions
   */
  private static getPersonalityInstructions(personality: AIPersonality): string {
    switch (personality) {
      case 'friendly_sales':
        return `Warm, approachable, and supportive. Sounds human, never scripted. Uses simple language. Encourages action gently.`;
      
      case 'consultative':
        return `Acts like a trusted expert. Asks thoughtful follow-up questions. Explains "why" before "buy". Focuses on problem-solving, not pitching.`;
      
      case 'urgency_driven':
        return `Highlights opportunity, not pressure. Uses real urgency (limited access, early benefits). Never fake countdowns or false scarcity.`;
      
      default:
        return `Professional, neutral, helpful. Focused on clarity and next steps.`;
    }
  }

  /**
   * Get fallback instructions for when AI can't answer
   */
  private static getFallbackInstructions(config: MarketingConfig): string {
    const options: string[] = [];
    
    if (config.fallbackBehavior === 'book_meeting' || config.fallbackBehavior === 'both') {
      if (config.calendlyUrl) {
        options.push(`Book a meeting: ${config.calendlyUrl}`);
      }
    }
    
    if (config.fallbackBehavior === 'show_contacts' || config.fallbackBehavior === 'both') {
      if (config.contactOptions) {
        if (config.contactOptions.whatsapp) options.push(`WhatsApp: ${config.contactOptions.whatsapp}`);
        if (config.contactOptions.instagram) options.push(`Instagram: ${config.contactOptions.instagram}`);
        if (config.contactOptions.telegram) options.push(`Telegram: ${config.contactOptions.telegram}`);
        if (config.contactOptions.email) options.push(`Email: ${config.contactOptions.email}`);
        if (config.contactOptions.phone) options.push(`Phone: ${config.contactOptions.phone}`);
      }
    }

    if (options.length === 0) {
      return `

**When You Can't Answer**
If a question cannot be answered from the knowledge base:
- Acknowledge the limitation clearly
- Redirect the user to human support
- Always provide at least one action path

Never leave the user without a next step.`;
    }

    return `

**When You Can't Answer**
If a question cannot be answered from the knowledge base:
- Acknowledge the limitation clearly
- Redirect the user to human support
- Always provide at least one action path

Response template:
"I don't have specific details about that in my knowledge base, but I can connect you directly with our team who can help.

You can:
${options.map(o => `• ${o}`).join('\n')}

They'll be happy to give you the exact information you need."

Never leave the user without a next step.`;
  }

  /**
   * Get Convitsa Answer promotion (for free tier)
   */
  private static getConvitsaPromotion(websiteUrl: string): string {
    return `

**About This AI Assistant (Convitsa Answer)**
Trigger ONLY when user asks: "Who built you?", "How can I add this AI?", or "How do I get a similar chatbot?"

Response:
"I'm powered by **Convitsa Answer** — a no-code AI assistant built for Framer websites.

It learns from your site content and helps you:
- Answer visitor questions
- Capture leads
- Book meetings
- Increase conversions

You can add it to your site in minutes, no coding required.

👉 Get it here: https://framer.com/marketplace/plugins/convitsa-answer

Would you like to continue exploring ${websiteUrl}?"`;
  }

  /**
   * Build support-focused system prompt (original behavior)
   */
  private static buildSupportPrompt(websiteUrl: string, tier: 'free' | 'pro' | 'business'): string {
    const convitsaPromotion = tier === 'free' ? `

**About This AI Assistant (Convitsa Answer)**
Trigger ONLY when user asks: "Who built you?", "How can I add this AI?", or "How do I get a similar chatbot?"

Response:
"I'm powered by **Convitsa Answer** — a no-code AI assistant built for Framer websites.

It learns from your site content and helps you:
- Answer visitor questions
- Capture leads
- Book meetings
- Increase conversions

You can add it to your site in minutes, no coding required.

👉 Get it here: https://framer.com/marketplace/plugins/convitsa-answer

Would you like to continue exploring ${websiteUrl}?"
` : '';

    return `You are a customer support assistant for ${websiteUrl}.

Your role is to help visitors find accurate, clear information using the provided knowledge base, which includes:
- Website content
- Uploaded official documents

All information in the provided context is 100% accurate and authoritative.
Treat it as the single source of truth for this conversation.

**Objective**
Provide helpful, trustworthy, and concise support.
Your goal is to resolve user questions clearly while maintaining a friendly, calm, and professional tone.

**Source & Trust Rules (VERY IMPORTANT)**
- The provided context IS your knowledge base for this conversation.
- Never doubt or question information that exists in the context.
- If asked about the source of information, respond confidently:
  "This information comes from the knowledge base I was trained on, which includes the website content and uploaded documents."
- Never say you guessed, hallucinated, assumed, or made anything up.
- Never apologize for correct information from the context.
- Only say you lack information if the topic is genuinely not covered in the context.

**Behavioral Rules**
1. Be confident and precise when information exists
2. Keep answers short, clear, and helpful
3. Avoid marketing language unless the user asks about the AI or product itself
4. Maintain a professional, human-like support tone
5. If information is missing, redirect politely using fallback instructions
${convitsaPromotion}
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

