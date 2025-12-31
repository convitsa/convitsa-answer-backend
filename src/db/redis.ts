import Redis from 'ioredis';
import { env } from '../config/env';

let redis: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redis.on('error', (err) => {
      console.error('❌ Redis error:', err);
    });

    redis.on('close', () => {
      console.warn('⚠️ Redis connection closed');
    });
  }

  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  
  if (client.status === 'ready') {
    console.log('📦 Redis already connected');
    return;
  }

  try {
    await client.connect();
  } catch (error) {
    // Already connected or connecting
    if ((error as Error).message?.includes('already')) {
      return;
    }
    throw error;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    console.log('📦 Redis disconnected');
  }
}

// Rate limiting utilities
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Sliding window rate limiter
 * @param key Unique identifier (e.g., api_key_id)
 * @param limit Maximum requests allowed
 * @param windowSeconds Time window in seconds
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const now = Date.now();
  
  // Skip rate limiting in development for faster responses
  if (env.NODE_ENV === 'development') {
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: now + windowSeconds * 1000,
    };
  }
  
  const client = getRedisClient();
  const windowStart = now - windowSeconds * 1000;
  const rateLimitKey = `ratelimit:${key}`;

  // Use a transaction for atomic operations
  const multi = client.multi();
  
  // Remove old entries outside the window
  multi.zremrangebyscore(rateLimitKey, 0, windowStart);
  
  // Count current entries in window
  multi.zcard(rateLimitKey);
  
  // Add current request
  multi.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
  
  // Set expiry on the key
  multi.expire(rateLimitKey, windowSeconds);

  const results = await multi.exec();
  
  if (!results) {
    return { allowed: false, remaining: 0, resetAt: now + windowSeconds * 1000 };
  }

  const currentCount = (results[1]?.[1] as number) || 0;
  const allowed = currentCount < limit;
  const remaining = Math.max(0, limit - currentCount - 1);

  return {
    allowed,
    remaining,
    resetAt: now + windowSeconds * 1000,
  };
}

/**
 * Track WebSocket connections per API key
 */
export async function incrementConnections(apiKeyId: string): Promise<number> {
  const client = getRedisClient();
  const key = `ws_connections:${apiKeyId}`;
  const count = await client.incr(key);
  await client.expire(key, 3600); // 1 hour expiry as safety
  return count;
}

export async function decrementConnections(apiKeyId: string): Promise<number> {
  const client = getRedisClient();
  const key = `ws_connections:${apiKeyId}`;
  const count = await client.decr(key);
  if (count <= 0) {
    await client.del(key);
    return 0;
  }
  return count;
}

export async function getConnectionCount(apiKeyId: string): Promise<number> {
  const client = getRedisClient();
  const key = `ws_connections:${apiKeyId}`;
  const count = await client.get(key);
  return parseInt(count || '0', 10);
}

/**
 * Simple cache operations
 */
export async function setCache(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = getRedisClient();
  await client.setex(`cache:${key}`, ttlSeconds, value);
}

export async function getCache(key: string): Promise<string | null> {
  const client = getRedisClient();
  return client.get(`cache:${key}`);
}

export async function deleteCache(key: string): Promise<void> {
  const client = getRedisClient();
  await client.del(`cache:${key}`);
}

/**
 * Verification code cooldown tracking
 */
export async function canResendVerification(userId: string, cooldownSeconds: number = 60): Promise<boolean> {
  const client = getRedisClient();
  const key = `verification_cooldown:${userId}`;
  const exists = await client.exists(key);
  return exists === 0;
}

export async function setVerificationCooldown(userId: string, cooldownSeconds: number = 60): Promise<void> {
  const client = getRedisClient();
  const key = `verification_cooldown:${userId}`;
  await client.setex(key, cooldownSeconds, '1');
}

