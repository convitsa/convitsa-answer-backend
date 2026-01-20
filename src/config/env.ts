import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // MongoDB
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Azure OpenAI
  AZURE_OPENAI_ENDPOINT: z.string().url('AZURE_OPENAI_ENDPOINT must be a valid URL'),
  AZURE_OPENAI_API_KEY: z.string().min(1, 'AZURE_OPENAI_API_KEY is required'),
  AZURE_OPENAI_API_VERSION: z.string().default('2024-02-15-preview'),
  AZURE_OPENAI_CHAT_DEPLOYMENT: z.string().min(1, 'AZURE_OPENAI_CHAT_DEPLOYMENT is required'),
  AZURE_OPENAI_EMBEDDING_DEPLOYMENT: z.string().min(1, 'AZURE_OPENAI_EMBEDDING_DEPLOYMENT is required'),

  // Firecrawl
  FIRECRAWL_API_KEY: z.string().min(1, 'FIRECRAWL_API_KEY is required'),

  // Resend
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  RESEND_FROM_EMAIL: z.string().email('RESEND_FROM_EMAIL must be a valid email'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Rate Limiting
  RATE_LIMIT_FREE_MESSAGES_PER_MIN: z.string().default('5').transform(Number),
  RATE_LIMIT_PRO_MESSAGES_PER_MIN: z.string().default('30').transform(Number),
  MAX_WS_CONNECTIONS_PER_KEY: z.string().default('100').transform(Number),

  // Tier Configuration
  FREE_CONTEXT_CHUNKS: z.string().default('3').transform(Number),
  PRO_CONTEXT_CHUNKS: z.string().default('10').transform(Number),
  FREE_MAX_TOKENS: z.string().default('500').transform(Number),
  PRO_MAX_TOKENS: z.string().default('2000').transform(Number),
  FREE_MAX_MESSAGES_PER_SESSION: z.string().default('15').transform(Number),

  // Pricing Configuration
  TOKENS_PER_CREDIT: z.string().default('1000').transform(Number),
  PLATFORM_COMMISSION_PERCENT: z.string().default('25').transform(Number), // 25% commission
  
  // Token Conversion: How many OpenAI tokens = 1 Convitsa token
  // Default: 30 OpenAI tokens = 1 Convitsa token (optimized for 60% profit margin)
  // So a message using 2500 OpenAI tokens = ~83 Convitsa tokens
  OPENAI_TO_CONVITSA_RATE: z.string().default('30').transform(Number),

  // Crawl Configuration
  CRAWL_MAX_PAGES: z.string().default('20').transform(Number),
  CRAWL_TIMEOUT_SECONDS: z.string().default('120').transform(Number),

  // Azure Blob Storage
  AZURE_BLOB_CONNECTION_STRING: z.string().min(1, 'AZURE_BLOB_CONNECTION_STRING is required'),
  AZURE_BLOB_CONTAINER_NAME: z.string().default('convitsa-documents'),

  // Azure Computer Vision (for OCR)
  AZURE_VISION_ENDPOINT: z.string().url('AZURE_VISION_ENDPOINT must be a valid URL'),
  AZURE_VISION_KEY: z.string().min(1, 'AZURE_VISION_KEY is required'),

  // Document Upload Configuration
  MAX_FILE_SIZE_MB: z.string().default('50').transform(Number),
  MAX_FILES_PER_PROJECT: z.string().default('100').transform(Number),
  MAX_STORAGE_PER_PROJECT_MB: z.string().default('500').transform(Number),

  // Gumroad (for payment webhooks) - DEPRECATED, kept for backwards compatibility
  GUMROAD_SELLER_ID: z.string().optional(),
  GUMROAD_WEBHOOK_TOKEN: z.string().optional(),

  // Lemon Squeezy (for subscription payments)
  LEMONSQUEEZY_API_KEY: z.string().min(1, 'LEMONSQUEEZY_API_KEY is required'),
  LEMONSQUEEZY_STORE_ID: z.string().min(1, 'LEMONSQUEEZY_STORE_ID is required'),
  LEMONSQUEEZY_WEBHOOK_SECRET: z.string().min(16, 'LEMONSQUEEZY_WEBHOOK_SECRET must be at least 16 characters'),

  // Subscription Plan Configuration (Convitsa tokens per month)
  // Optimized for 60% profit margin with rate 30
  FREE_TOKENS_PER_MONTH: z.string().default('5000').transform(Number),
  PRO_TOKENS_PER_MONTH: z.string().default('100000').transform(Number),
  BUSINESS_TOKENS_PER_MONTH: z.string().default('250000').transform(Number),

  // Project Limits per Tier
  FREE_PROJECTS_LIMIT: z.string().default('1').transform(Number),
  PRO_PROJECTS_LIMIT: z.string().default('5').transform(Number),
  BUSINESS_PROJECTS_LIMIT: z.string().default('999').transform(Number), // Effectively unlimited

  // Lemon Squeezy Variant IDs (for checkout)
  LEMONSQUEEZY_PRO_VARIANT_ID: z.string().optional(),
  LEMONSQUEEZY_BUSINESS_VARIANT_ID: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Environment validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();

// Tier configuration helpers (chat settings)
export const tierConfig = {
  free: {
    contextChunks: env.FREE_CONTEXT_CHUNKS,
    maxTokens: env.FREE_MAX_TOKENS,
    messagesPerMin: env.RATE_LIMIT_FREE_MESSAGES_PER_MIN,
    maxMessagesPerSession: env.FREE_MAX_MESSAGES_PER_SESSION,
  },
  pro: {
    contextChunks: env.PRO_CONTEXT_CHUNKS,
    maxTokens: env.PRO_MAX_TOKENS,
    messagesPerMin: env.RATE_LIMIT_PRO_MESSAGES_PER_MIN,
    maxMessagesPerSession: null, // Unlimited for Pro
  },
  business: {
    contextChunks: env.PRO_CONTEXT_CHUNKS, // Same as Pro
    maxTokens: env.PRO_MAX_TOKENS, // Same as Pro
    messagesPerMin: env.RATE_LIMIT_PRO_MESSAGES_PER_MIN * 2, // 2x rate limit
    maxMessagesPerSession: null, // Unlimited
  },
} as const;

export function getTierConfig(tier: 'free' | 'pro' | 'business') {
  return tierConfig[tier];
}

// Helper to format numbers with commas
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

// Subscription plan configuration (all token values are Convitsa tokens)
export const subscriptionPlans = {
  free: {
    tier: 'free' as const,
    name: 'Free',
    price: 0,
    tokensPerMonth: env.FREE_TOKENS_PER_MONTH, // Convitsa tokens
    projectsLimit: env.FREE_PROJECTS_LIMIT,
    maxMessagesPerSession: env.FREE_MAX_MESSAGES_PER_SESSION,
    features: [
      'Basic AI chat',
      `${formatNumber(env.FREE_TOKENS_PER_MONTH)} Convitsa tokens/month`,
      `${env.FREE_PROJECTS_LIMIT} project`,
      `${env.FREE_MAX_MESSAGES_PER_SESSION} messages per session`,
      'Community support',
    ],
  },
  pro: {
    tier: 'pro' as const,
    name: 'Pro',
    price: 29,
    tokensPerMonth: env.PRO_TOKENS_PER_MONTH, // Convitsa tokens
    projectsLimit: env.PRO_PROJECTS_LIMIT,
    maxMessagesPerSession: null,
    features: [
      'Marketing AI personality',
      `${formatNumber(env.PRO_TOKENS_PER_MONTH)} Convitsa tokens/month`,
      `${env.PRO_PROJECTS_LIMIT} projects`,
      'Unlimited messages per session',
      'Lead capture & tracking',
      'Unanswered questions management',
      'Custom contact options',
      'Email support',
    ],
  },
  business: {
    tier: 'business' as const,
    name: 'Business',
    price: 79,
    tokensPerMonth: env.BUSINESS_TOKENS_PER_MONTH, // Convitsa tokens
    projectsLimit: env.BUSINESS_PROJECTS_LIMIT,
    maxMessagesPerSession: null,
    features: [
      'All Pro features',
      `${formatNumber(env.BUSINESS_TOKENS_PER_MONTH)} Convitsa tokens/month`,
      'Unlimited projects',
      'Priority support',
      'Custom AI training',
      'Webhook integrations',
      'Advanced analytics',
    ],
  },
};

export function getSubscriptionPlan(tier: 'free' | 'pro' | 'business') {
  return subscriptionPlans[tier];
}

/**
 * Convert OpenAI tokens to Convitsa tokens
 * Default: 100 OpenAI tokens = 1 Convitsa token
 */
export function openAIToConvitsaTokens(openAITokens: number): number {
  return Math.ceil(openAITokens / env.OPENAI_TO_CONVITSA_RATE);
}

/**
 * Convert Convitsa tokens to OpenAI tokens (for display/estimation)
 */
export function convitsaToOpenAITokens(convitsaTokens: number): number {
  return convitsaTokens * env.OPENAI_TO_CONVITSA_RATE;
}
