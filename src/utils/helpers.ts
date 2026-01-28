import { createHash, randomBytes } from 'crypto';
import { env } from '../config/env';

/**
 * Generate a cryptographically secure random string
 */
export function generateSecureToken(length: number = 32): string {
  return randomBytes(length).toString('hex');
}

/**
 * Generate a 6-digit verification code
 */
export function generateVerificationCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Hash a string using SHA-256
 */
export function hashSHA256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Generate an API key with prefix for identification
 * Format: ca_live_xxxxxxxxxxxxxxxxxxxx
 */
export function generateApiKey(): { fullKey: string; prefix: string; keyHash: string } {
  const prefix = 'ca_live_';
  const randomPart = generateSecureToken(24);
  const fullKey = `${prefix}${randomPart}`;
  const keyHash = hashSHA256(fullKey);
  
  return {
    fullKey,
    prefix: fullKey.substring(0, 12), // ca_live_xxxx for display
    keyHash,
  };
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chunk text into smaller pieces with overlap
 */
export function chunkText(
  text: string,
  chunkSize: number = 1000,
  overlap: number = 200
): string[] {
  const chunks: string[] = [];
  
  if (text.length <= chunkSize) {
    return [text.trim()];
  }
  
  let start = 0;
  while (start < text.length) {
    let end = start + chunkSize;
    
    // Try to break at sentence boundaries
    if (end < text.length) {
      const lastPeriod = text.lastIndexOf('.', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastPeriod, lastNewline);
      
      if (breakPoint > start + chunkSize / 2) {
        end = breakPoint + 1;
      }
    }
    
    const chunk = text.substring(start, end).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    
    start = end - overlap;
    if (start >= text.length) break;
  }
  
  return chunks;
}

/**
 * Clean and normalize text content
 */
export function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Get platform commission rate from config (default 25%)
 */
export function getPlatformCommissionRate(): number {
  return env.PLATFORM_COMMISSION_PERCENT / 100;
}

/**
 * Get tokens per credit from config (default 1000)
 */
export function getTokensPerCredit(): number {
  return env.TOKENS_PER_CREDIT;
}

/**
 * Calculate cost in credits based on token usage
 * Base: 1 credit = 1000 tokens (configurable)
 * Pro tier includes platform commission (default 25%)
 * 
 * @param tokens - Number of tokens used
 * @param includeCommission - Whether to include platform commission (Pro tier)
 * @returns Credits to deduct
 */
export function calculateCredits(tokens: number, includeCommission: boolean = true): number {
  const tokensPerCredit = getTokensPerCredit();
  const baseCredits = tokens / tokensPerCredit;
  
  if (includeCommission) {
    // Add platform commission for Pro tier
    const commissionRate = getPlatformCommissionRate();
    const totalCredits = baseCredits * (1 + commissionRate);
    return Math.ceil(totalCredits);
  }
  
  return Math.ceil(baseCredits);
}

/**
 * Get detailed cost breakdown
 * @param tokens - Number of tokens used
 * @returns Cost breakdown with base cost, commission, and total
 */
export function getCostBreakdown(tokens: number): {
  tokens: number;
  baseCredits: number;
  commissionRate: number;
  commission: number;
  totalCredits: number;
} {
  const tokensPerCredit = getTokensPerCredit();
  const commissionRate = getPlatformCommissionRate();
  
  const baseCredits = tokens / tokensPerCredit;
  const commission = baseCredits * commissionRate;
  const totalCredits = Math.ceil(baseCredits + commission);
  
  return {
    tokens,
    baseCredits: Math.round(baseCredits * 100) / 100,
    commissionRate,
    commission: Math.round(commission * 100) / 100,
    totalCredits,
  };
}

/**
 * Sanitize user input to prevent injection attacks
 */
export function sanitizeInput(input: string, maxLength: number = 4096): string {
  return input
    .substring(0, maxLength)
    .replace(/[<>]/g, '')
    .trim();
}

/**
 * Create a rate limit key for Redis
 */
export function createRateLimitKey(prefix: string, identifier: string): string {
  return `ratelimit:${prefix}:${identifier}`;
}

/**
 * Parse WebSocket query parameters
 */
export function parseWSQuery(url: string): { 
  token?: string; 
  tier?: string;
  visitorId?: string;
  userAgent?: string;
  referrer?: string;
  pageUrl?: string;
} {
  try {
    const searchParams = new URL(url, 'http://localhost').searchParams;
    return {
      token: searchParams.get('token') || undefined,
      tier: searchParams.get('tier') || undefined,
      visitorId: searchParams.get('visitorId') || searchParams.get('visitor_id') || undefined,
      userAgent: searchParams.get('userAgent') || searchParams.get('user_agent') || undefined,
      referrer: searchParams.get('referrer') || searchParams.get('ref') || undefined,
      pageUrl: searchParams.get('pageUrl') || searchParams.get('page_url') || searchParams.get('page') || undefined,
    };
  } catch {
    return {};
  }
}

