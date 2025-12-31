import type { Context, Next } from 'hono';
import { checkRateLimit } from '../../db/redis';

interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
  keyPrefix: string;
  keyExtractor?: (c: Context) => string;
}

/**
 * Rate limiting middleware factory
 */
export function rateLimit(options: RateLimitOptions) {
  const { limit, windowSeconds, keyPrefix, keyExtractor } = options;

  return async (c: Context, next: Next) => {
    // Extract rate limit key
    let key: string;
    
    if (keyExtractor) {
      key = keyExtractor(c);
    } else {
      // Default: use IP address
      const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() 
        || c.req.header('x-real-ip') 
        || 'unknown';
      key = ip;
    }

    const rateLimitKey = `${keyPrefix}:${key}`;
    const result = await checkRateLimit(rateLimitKey, limit, windowSeconds);

    // Set rate limit headers
    c.header('X-RateLimit-Limit', limit.toString());
    c.header('X-RateLimit-Remaining', result.remaining.toString());
    c.header('X-RateLimit-Reset', result.resetAt.toString());

    if (!result.allowed) {
      return c.json(
        {
          error: 'Too many requests',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        },
        429
      );
    }

    await next();
  };
}

/**
 * Auth routes rate limiter (prevent brute force)
 * 10 requests per minute per IP
 */
export const authRateLimit = rateLimit({
  limit: 10,
  windowSeconds: 60,
  keyPrefix: 'auth',
});

/**
 * Signup rate limiter (stricter)
 * 5 signups per hour per IP
 */
export const signupRateLimit = rateLimit({
  limit: 5,
  windowSeconds: 3600,
  keyPrefix: 'signup',
});

/**
 * General API rate limiter
 * 100 requests per minute per user
 */
export const apiRateLimit = rateLimit({
  limit: 100,
  windowSeconds: 60,
  keyPrefix: 'api',
  keyExtractor: (c) => {
    const user = c.get('user');
    return user?.userId || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  },
});

/**
 * Crawl rate limiter
 * 5 crawls per hour per user
 */
export const crawlRateLimit = rateLimit({
  limit: 5,
  windowSeconds: 3600,
  keyPrefix: 'crawl',
  keyExtractor: (c) => {
    const user = c.get('user');
    return user?.userId || 'unknown';
  },
});


