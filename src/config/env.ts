import { z } from 'zod';

const envSchema = z.object({
  // Server
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // MongoDB
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Gemini (Google AI)
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_CHAT_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),

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

  // Local file storage (replaces Azure Blob Storage)
  STORAGE_PATH: z.string().default('/app/uploads'),
  PUBLIC_BASE_URL: z.string().url('PUBLIC_BASE_URL must be a valid URL').default('http://localhost:3000'),

  // Document Upload Configuration
  MAX_FILE_SIZE_MB: z.string().default('50').transform(Number),
  MAX_FILES_PER_PROJECT: z.string().default('100').transform(Number),
  MAX_STORAGE_PER_PROJECT_MB: z.string().default('500').transform(Number),

  // Gumroad (for payment webhooks) - DEPRECATED, kept for backwards compatibility
  GUMROAD_SELLER_ID: z.string().optional(),
  GUMROAD_WEBHOOK_TOKEN: z.string().optional(),

  // Stripe (for subscription payments)
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),
  STRIPE_SUCCESS_URL: z.string().url().optional(), // Redirect after successful payment
  STRIPE_CANCEL_URL: z.string().url().optional(), // Redirect if payment cancelled

  // Subscription Plan Configuration (Convitsa tokens per month)
  // Optimized for 60% profit margin with rate 30
  FREE_TOKENS_PER_MONTH: z.string().default('5000').transform(Number),
  PRO_TOKENS_PER_MONTH: z.string().default('100000').transform(Number),
  BUSINESS_TOKENS_PER_MONTH: z.string().default('250000').transform(Number),

  // Project Limits per Tier
  FREE_PROJECTS_LIMIT: z.string().default('1').transform(Number),
  PRO_PROJECTS_LIMIT: z.string().default('5').transform(Number),
  BUSINESS_PROJECTS_LIMIT: z.string().default('999').transform(Number), // Effectively unlimited

  // Stripe Price IDs (for checkout)
  // Monthly plans
  STRIPE_PRO_PRICE_ID: z.string().optional(),
  STRIPE_BUSINESS_PRICE_ID: z.string().optional(),
  // Yearly plans
  STRIPE_PRO_YEARLY_PRICE_ID: z.string().optional(),
  STRIPE_BUSINESS_YEARLY_PRICE_ID: z.string().optional(),

  // Affiliate Configuration
  AFFILIATE_BONUS_TOKENS: z.string().default('5000').transform(Number),

  // Magic Link Configuration
  MAGIC_LINK_EXPIRY_HOURS: z.string().default('24').transform(Number),
  PASSWORD_SETUP_URL: z.string().default('https://answer.convitsa.com/password/reset'),
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

// Billing interval type
export type BillingInterval = 'monthly' | 'yearly';

// Subscription plan configuration (all token values are Convitsa tokens)
export const subscriptionPlans = {
  free: {
    tier: 'free' as const,
    name: 'Free',
    price: 0,
    yearlyPrice: 0,
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
    price: 29, // Monthly price
    yearlyPrice: 276, // Yearly price (20% discount)
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
    price: 79, // Monthly price
    yearlyPrice: 756, // Yearly price (20% discount)
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
 * Get Stripe price ID for a tier and billing interval
 */
export function getPriceId(tier: 'pro' | 'business', interval: BillingInterval): string | undefined {
  if (tier === 'pro') {
    return interval === 'yearly' ? env.STRIPE_PRO_YEARLY_PRICE_ID : env.STRIPE_PRO_PRICE_ID;
  }
  return interval === 'yearly' ? env.STRIPE_BUSINESS_YEARLY_PRICE_ID : env.STRIPE_BUSINESS_PRICE_ID;
}

/**
 * Get tier and billing interval from Stripe price ID
 */
export function getTierFromPriceId(priceId: string): { tier: 'free' | 'pro' | 'business'; billingInterval: BillingInterval } {
  // Monthly prices
  if (priceId === env.STRIPE_PRO_PRICE_ID) {
    return { tier: 'pro', billingInterval: 'monthly' };
  }
  if (priceId === env.STRIPE_BUSINESS_PRICE_ID) {
    return { tier: 'business', billingInterval: 'monthly' };
  }
  
  // Yearly prices
  if (priceId === env.STRIPE_PRO_YEARLY_PRICE_ID) {
    return { tier: 'pro', billingInterval: 'yearly' };
  }
  if (priceId === env.STRIPE_BUSINESS_YEARLY_PRICE_ID) {
    return { tier: 'business', billingInterval: 'yearly' };
  }
  
  // Default to free
  return { tier: 'free', billingInterval: 'monthly' };
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
