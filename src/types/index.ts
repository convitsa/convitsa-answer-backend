import type { Context } from 'hono';
import type { WebSocket } from 'ws';
import type { Types } from 'mongoose';

// ============================================================
// User Types
// ============================================================

export type UserCreatedVia = 'registration' | 'payment';

export interface IUser {
  _id: Types.ObjectId;
  email: string;
  passwordHash?: string; // Optional for users created via payment (set later via magic link)
  emailVerified: boolean;
  createdVia: UserCreatedVia;
  createdAt: Date;
}

export interface IEmailVerification {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
}

// ============================================================
// Project Types
// ============================================================

export type CrawlStatus = 'idle' | 'pending' | 'crawling' | 'completed' | 'failed';

export interface IProject {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  name: string;
  websiteUrl: string;
  crawlStatus: CrawlStatus;
  crawlError?: string;
  lastCrawledAt?: Date;
  marketingConfig?: MarketingConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface IApiKey {
  _id: Types.ObjectId;
  keyHash: string;
  keyPrefix: string;
  userId: Types.ObjectId;
  projectId: Types.ObjectId;
  name: string;
  active: boolean;
  createdAt: Date;
}

// ============================================================
// Page & Embedding Types
// ============================================================

export interface IPage {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  url: string;
  title: string;
  content: string;
  embedding: number[];
  chunkIndex: number;
  crawledAt: Date;
}

// ============================================================
// Document Types (File Uploads)
// ============================================================

export type DocumentStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface IDocument {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  blobUrl: string;
  status: DocumentStatus;
  errorMessage?: string;
  extractedText?: string;
  chunkCount: number;
  processedAt?: Date;
  createdAt: Date;
}

export interface IDocumentChunk {
  _id: Types.ObjectId;
  documentId: Types.ObjectId;
  projectId: Types.ObjectId;
  content: string;
  chunkIndex: number;
  embedding: number[];
  metadata: {
    fileName: string;
    pageNumber?: number;
    sheetName?: string;
  };
}

export interface DocumentProcessingJob {
  documentId: string;
  projectId: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
}

// ============================================================
// Subscription Types
// ============================================================

export type SubscriptionTier = 'free' | 'pro' | 'business';
export type BillingInterval = 'monthly' | 'yearly';
// Stripe subscription statuses
export type SubscriptionStatus = 'pending' | 'active' | 'on_hold' | 'cancelled' | 'failed' | 'expired';

export interface ISubscription {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  billingInterval: BillingInterval;
  // Stripe fields
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date; // End of billing period (from Stripe)
  tokenResetDate?: Date; // When tokens refresh (always monthly)
  trialEnd?: Date | null; // When trial ends (from Stripe) - next billing date during trial
  cancelAtPeriodEnd: boolean;
  tokensUsedThisMonth: number;
  tokensLimit: number;
  projectsLimit: number;
  // Migration fields for credit users
  migratedFromCredits?: number;
  bonusTokens: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionPlan {
  tier: SubscriptionTier;
  name: string;
  price: number; // Monthly price in USD
  yearlyPrice: number; // Yearly price in USD
  tokensPerMonth: number;
  projectsLimit: number;
  maxMessagesPerSession: number | null;
  features: string[];
}

// ============================================================
// Chat Types
// ============================================================

export type ChatTier = 'free' | 'pro' | 'business';

export interface SessionMetadata {
  userAgent?: string;
  referrer?: string;
  pageUrl?: string;
}

export interface IChatSession {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  apiKeyId: Types.ObjectId;
  tier: ChatTier;
  visitorId?: string;
  startedAt: Date;
  endedAt?: Date;
  totalTokens: number;
  messageCount: number;
  metadata?: SessionMetadata;
  leadCaptured?: boolean;
}

export type MessageRole = 'user' | 'assistant' | 'system';

export interface IChatMessage {
  _id: Types.ObjectId;
  sessionId: Types.ObjectId;
  role: MessageRole;
  content: string;
  tokenCount: number;
  createdAt: Date;
}

// ============================================================
// Credit Types
// ============================================================

export interface ICreditBalance {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  balance: number;
  updatedAt: Date;
}

export interface ICreditTransaction {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  type: 'credit' | 'debit';
  reason: string;
  sessionId?: Types.ObjectId;
  createdAt: Date;
}

// ============================================================
// API Types
// ============================================================

export interface JwtPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface AuthContext extends Context {
  user?: JwtPayload;
}

// ============================================================
// WebSocket Types
// ============================================================

export interface WSClientMessage {
  type: 'message';
  content: string;
}

export interface WSChunkResponse {
  type: 'chunk';
  content: string;
}

export interface WSDoneResponse {
  type: 'done';
  tokensUsed: number;
}

export interface WSErrorResponse {
  type: 'error';
  message: string;
  code?: string;
}

export interface WSReadyResponse {
  type: 'ready';
  sessionId: string;
  tier: ChatTier;
  visitorId: string;
}

export type WSServerMessage = WSChunkResponse | WSDoneResponse | WSErrorResponse | WSReadyResponse;

export interface AuthenticatedWebSocket extends WebSocket {
  apiKeyId: Types.ObjectId;
  projectId: Types.ObjectId;
  tier: ChatTier;
  sessionId: Types.ObjectId;
  visitorId: string;
  isAlive: boolean;
}

// ============================================================
// RAG Types
// ============================================================

export interface RetrievedContext {
  content: string;
  url: string;
  title: string;
  score: number;
  source?: 'website' | 'document';
  metadata?: {
    fileName?: string;
    pageNumber?: number;
  };
}

export interface TierConfig {
  contextChunks: number;
  maxTokens: number;
  messagesPerMin: number;
}

// ============================================================
// Service Response Types
// ============================================================

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

// ============================================================
// Crawl Types
// ============================================================

export interface CrawledPage {
  url: string;
  title: string;
  markdown: string;
}

export interface ContentChunk {
  content: string;
  index: number;
}

// ============================================================
// Marketing AI Types
// ============================================================

export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted';
export type LeadSource = 'chat' | 'form';

export interface ILead {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  visitorId?: string;
  sessionIds: Types.ObjectId[];
  email?: string;
  phone?: string;
  name?: string;
  company?: string;
  source: LeadSource;
  status: LeadStatus;
  notes?: string;
  capturedAt: Date;
  // AI-generated conversation analysis
  conversationSummary?: string;
  intentScore?: number;
  intentSignals?: string[];
  metadata?: Record<string, any>;
}

export type ConversionEventType = 'lead_captured' | 'meeting_booked' | 'link_clicked' | 'cta_clicked' | 'contact_clicked';

export interface IConversionEvent {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  sessionId?: Types.ObjectId;
  leadId?: Types.ObjectId;
  eventType: ConversionEventType;
  eventData?: Record<string, any>;
  createdAt: Date;
}

export type UnansweredQuestionStatus = 'pending' | 'answered' | 'ignored';

export interface IUnansweredQuestion {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  sessionId?: Types.ObjectId;
  question: string;
  aiResponse?: string;
  status: UnansweredQuestionStatus;
  businessAnswer?: string;
  answeredBy?: Types.ObjectId;
  answeredAt?: Date;
  createdAt: Date;
}

// ============================================================
// Lost Lead Intelligence Types
// ============================================================

export type LostLeadStatus = 'lost' | 'converted' | 'archived';

export interface DropOffPoint {
  lastUserMessage?: string;
  lastAiResponse?: string;
  messageIndex: number;
  timestamp?: Date;
}

export interface LostLeadMetadata {
  userAgent?: string;
  referrer?: string;
  pageUrl?: string;
}

export interface ILostLead {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  visitorId: string;
  sessionIds: Types.ObjectId[];
  intentScore: number;
  intentSignals: string[];
  intentSummary?: string;
  dropOffPoint?: DropOffPoint;
  status: LostLeadStatus;
  totalMessages: number;
  totalSessions: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  metadata?: LostLeadMetadata;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IntentScoreResult {
  score: number;
  signals: string[];
  summary: string;
}

export type AIPersonality = 'friendly_sales' | 'consultative' | 'urgency_driven';
export type FallbackBehavior = 'book_meeting' | 'show_contacts' | 'both';

export interface ContactOptions {
  whatsapp?: string;
  instagram?: string;
  telegram?: string;
  email?: string;
  phone?: string;
  custom?: Array<{ label: string; url: string; icon?: string }>;
}

export interface CTAButton {
  label: string;
  url: string;
}

export interface MarketingConfig {
  aiPersonality: AIPersonality;
  calendlyUrl?: string;
  webhookUrl?: string;
  notifyEmail?: string;
  ctaButtons?: CTAButton[];
  leadCaptureFields: ('email' | 'phone' | 'name' | 'company')[];
  contactOptions?: ContactOptions;
  fallbackBehavior: FallbackBehavior;
}


