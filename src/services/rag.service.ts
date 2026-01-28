import { Types } from 'mongoose';
import { Page, DocumentChunk } from '../db/schemas';
import { EmbeddingService } from './embedding.service';
import { ChatService } from './chat.service';
import { getTierConfig } from '../config/env';
import type { RetrievedContext, ChatTier, MarketingConfig, AIPersonality, IntentScoreResult, IChatMessage } from '../types';

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

**Mission**
- Answer questions accurately
- Educate and guide visitors
- Build trust and credibility
- Lead high-intent users naturally toward conversion

**Marketing Personality**
${personalityInstructions}

**Primary Objectives**
1. Answer visitor questions using only the knowledge base
2. Highlight value and benefits clearly
3. Identify visitor intent during conversation
4. Encourage action naturally and confidently

**Marketing Behavior Rules**
- Helpful first, sales second
- Match visitor's tone, intent, and energy
- Never oversell, exaggerate, or fabricate results
- When visitor shows buying intent → guide to conversion fast
- When visitor explores → educate, plant seeds for future conversion
- Provide specific, actionable insights whenever possible

**Lead Capture & Conversion Strategy**
- Use context-aware transitions, no sudden CTAs
- Encourage email/demo only after value is delivered
- Example transitions:
  • "If you'd like, I can send you more details — what's the best email?"
  • "Want to see how this would work for your specific site or use case?"
  • "Would it help to have someone from our team walk you through it?"

**Subtle Contact Capture (IMPORTANT)**
When the conversation shows genuine interest (pricing questions, specific use cases, timeline discussions), naturally suggest helpful next steps that involve contact:
- "I can have our team send you detailed pricing — what's your email?"
- "Want me to set up a quick call to walk through this? Just share your email."
- "I'd love to share some case studies with you — where should I send them?"

Do this only ONCE per conversation, and only when intent is clearly high. Never be pushy or repeat the ask if declined.
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
        return `Warm, approachable, and human. Conversational and clear. Encourages action gently.`;
      
      case 'consultative':
        return `Acts like a trusted advisor. Asks questions to understand visitor needs. Explains "why" before recommending solutions. Focuses on solving problems, not just selling.`;
      
      case 'urgency_driven':
        return `Highlights opportunity and benefits. Uses real urgency (limited access, early adoption perks). Never fake countdowns or false scarcity.`;
      
      default:
        return `Professional, neutral, helpful. Focused on clarity, guidance, and actionable next steps.`;
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
- Acknowledge clearly
- Provide a path to human support
- Ensure user is never left without a next step`;
    }

    return `

**When You Can't Answer**
If a question cannot be answered from the knowledge base:
- Acknowledge clearly
- Provide a path to human support
- Ensure user is never left without a next step

Response template:
"I don't have specific details about that in my knowledge base, but I can connect you directly with our team.

You can:
${options.map(o => `• ${o}`).join('\n')}

They'll give you the exact information you need."`;
  }

  /**
   * Get Convitsa Answer promotion (for free tier)
   */
  private static getConvitsaPromotion(websiteUrl: string): string {
    return `

**About This AI Assistant (Convitsa Answer)**
Trigger ONLY when user asks: "Who built you?", "How can I add this AI?", or "How do I get a similar chatbot?"

Response:
"I'm powered by **Convitsa Answer** — a no-code AI assistant designed for Framer websites.

It learns from your site content and helps you:
- Answer visitor questions instantly
- Capture leads and visitor intent
- Book meetings seamlessly
- Increase conversions without extra effort

You can add it to your site in minutes, no coding required.

👉 Get it here: https://framer.com/marketplace/plugins/convitsa-answer

Would you like to explore ${websiteUrl} further and see it in action?"`;
  }

  /**
   * Build support-focused system prompt (original behavior)
   */
  private static buildSupportPrompt(websiteUrl: string, tier: 'free' | 'pro' | 'business'): string {
    const convitsaPromotion = tier === 'free' ? `

**About This AI Assistant (Convitsa Answer)**
Trigger ONLY when user asks: "Who built you?", "How can I add this AI?", or "How do I get a similar chatbot?"

Response:
"I'm powered by **Convitsa Answer** — a no-code AI assistant designed for Framer websites.

It learns from your site content and helps you:
- Answer visitor questions instantly
- Capture leads and visitor intent
- Book meetings seamlessly
- Increase conversions without extra effort

You can add it to your site in minutes, no coding required.

👉 Get it here: https://framer.com/marketplace/plugins/convitsa-answer

Would you like to explore ${websiteUrl} further and see it in action?"
` : '';

    return `You are a highly skilled customer support assistant for ${websiteUrl}.

**Role**
- Help visitors find accurate, clear information using the provided knowledge base, which includes:
  • Website content
  • Uploaded official documents
- Treat all context as 100% accurate and authoritative.
- This context is the single source of truth.

**Objective**
- Resolve user questions clearly and efficiently
- Provide concise, accurate, and actionable answers
- Maintain a professional, friendly, and human-like tone

**Source & Trust Rules**
- Always rely on the provided context as your source
- Never doubt, apologize for, or fabricate information
- If asked about source, say confidently:
  "This information comes from the knowledge base I was trained on, which includes the website content and uploaded documents."
- Only say you lack information if it is genuinely not in the context

**Behavioral Rules**
1. Confidently provide answers when context exists
2. Keep responses concise but complete
3. Avoid marketing language unless user asks about the AI/product itself
4. Redirect politely using fallback instructions if information is missing
5. Always give actionable guidance if possible
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

  /**
   * Score the intent of a conversation session using AI
   * Returns a score from 0-100 and detected intent signals
   */
  static async scoreSessionIntent(messages: IChatMessage[]): Promise<IntentScoreResult> {
    if (messages.length === 0) {
      return { score: 0, signals: [], summary: 'No messages to analyze' };
    }

    // Filter to only user and assistant messages
    const conversationMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    const systemPrompt = `You are an expert at analyzing sales conversations to determine buyer intent.

Analyze the following conversation and provide:
1. An intent score from 0-100:
   - 0-30: Low intent (casual browsing, general questions)
   - 31-60: Medium intent (specific questions, comparing options)
   - 61-80: High intent (pricing questions, timeline discussions, specific use cases)
   - 81-100: Very high intent (ready to buy, asking about next steps)

2. A list of intent signals detected (return as comma-separated list):
   - pricing_interest: Asked about cost, pricing, or budget
   - timeline_mentioned: Mentioned deadlines or timelines
   - specific_use_case: Described a specific problem or use case
   - comparison_shopping: Mentioned competitors or alternatives
   - decision_maker: Indicated they have buying authority
   - objection_raised: Expressed concerns or objections
   - demo_interest: Showed interest in demo or trial
   - multiple_sessions: Returned for multiple conversations
   - detailed_questions: Asked specific technical or implementation questions
   - urgency_expressed: Indicated time pressure or urgency

3. A brief summary (1-2 sentences) of the visitor's intent and what they were looking for.

Respond ONLY in this exact JSON format:
{
  "score": <number 0-100>,
  "signals": ["signal1", "signal2"],
  "summary": "<brief summary>"
}`;

    try {
      // Use pro tier for intent scoring to get enough tokens
      const response = await ChatService.generateCompletion([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analyze this conversation:\n\n${conversationMessages}` },
      ], 'pro');

      // Parse the JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('Failed to parse intent scoring response:', response.content);
        return { score: 0, signals: [], summary: 'Analysis failed' };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.min(100, Math.max(0, parseInt(parsed.score) || 0)),
        signals: Array.isArray(parsed.signals) ? parsed.signals : [],
        summary: parsed.summary || 'No summary available',
      };
    } catch (error) {
      console.error('Intent scoring error:', error);
      return { score: 0, signals: [], summary: 'Analysis failed' };
    }
  }
}

