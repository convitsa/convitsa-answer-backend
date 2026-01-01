import Redis, { Cluster } from 'ioredis';
import { env } from '../config/env';

// Support both single Redis and Cluster mode
let redis: Redis | Cluster | null = null;

/**
 * Parse Redis URL to extract host, port, and password
 */
function parseRedisUrl(url: string): { host: string; port: number; password?: string; useTls: boolean } {
  const useTls = url.startsWith('rediss://');
  const cleanUrl = url.replace(/^rediss?:\/\//, '');
  
  // Format: :password@host:port or host:port
  const match = cleanUrl.match(/^(?::([^@]+)@)?([^:]+):(\d+)/);
  
  if (!match) {
    throw new Error(`Invalid Redis URL format: ${url}`);
  }
  
  return {
    password: match[1],
    host: match[2],
    port: parseInt(match[3], 10),
    useTls,
  };
}

/**
 * Check if this is Azure Redis Enterprise (cluster mode)
 * Azure Enterprise uses ports like 10000, 10001, etc.
 */
function isAzureEnterpriseRedis(port: number): boolean {
  return port >= 10000;
}

/**
 * Get Redis client configured for Azure Managed Redis
 * Supports both standard Azure Redis (port 6380) and Enterprise (port 10000+)
 */
export function getRedisClient(): Redis | Cluster {
  if (!redis) {
    const { host, port, password, useTls } = parseRedisUrl(env.REDIS_URL);
    const isEnterprise = isAzureEnterpriseRedis(port);
    
    console.log(`🔧 Redis config: host=${host}, port=${port}, tls=${useTls}, enterprise=${isEnterprise}`);

    if (isEnterprise) {
      // Azure Redis Enterprise uses cluster mode
      redis = new Cluster(
        [{ host, port }],
        {
          redisOptions: {
            password,
            tls: useTls ? { rejectUnauthorized: false } : undefined,
            connectTimeout: 20000,
          },
          // Enable cluster mode features
          enableReadyCheck: true,
          scaleReads: 'slave',
          // Cluster retry strategy
          clusterRetryStrategy: (times: number) => {
            if (times > 10) {
              console.error('❌ Redis Cluster: Max retries reached');
              return null;
            }
            const delay = Math.min(times * 500, 5000);
            console.log(`⏳ Redis Cluster: Retrying in ${delay}ms (attempt ${times})`);
            return delay;
          },
          // Required for Azure Redis Enterprise
          dnsLookup: (address, callback) => callback(null, address),
          natMap: {},
        }
      );

      redis.on('connect', () => {
        console.log('✅ Redis Cluster connected (Azure Enterprise)');
      });

      redis.on('ready', () => {
        console.log('✅ Redis Cluster ready to accept commands');
      });

      redis.on('error', (err) => {
        console.error('❌ Redis Cluster error:', err.message);
      });

      redis.on('node error', (err, address) => {
        console.error(`❌ Redis Cluster node error [${address}]:`, err.message);
      });

      redis.on('close', () => {
        console.warn('⚠️ Redis Cluster connection closed');
      });

    } else {
      // Standard Azure Redis or local Redis
      redis = new Redis({
        host,
        port,
        password,
        tls: useTls ? { rejectUnauthorized: false } : undefined,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 20000,
        retryStrategy: (times: number) => {
          if (times > 10) {
            console.error('❌ Redis: Max retries reached');
            return null;
          }
          const delay = Math.min(times * 500, 5000);
          console.log(`⏳ Redis: Retrying in ${delay}ms (attempt ${times})`);
          return delay;
        },
      });

      redis.on('connect', () => {
        console.log(`✅ Redis connected${useTls ? ' (TLS)' : ''}`);
      });

      redis.on('ready', () => {
        console.log('✅ Redis ready to accept commands');
      });

      redis.on('error', (err) => {
        console.error('❌ Redis error:', err.message);
      });

      redis.on('close', () => {
        console.warn('⚠️ Redis connection closed');
      });

      redis.on('reconnecting', () => {
        console.log('🔄 Redis reconnecting...');
      });
    }
  }

  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  
  // Cluster connects automatically, check if it's a regular Redis client
  if (client instanceof Redis) {
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
  } else {
    // For Cluster, wait for ready state
    if (client.status === 'ready') {
      console.log('📦 Redis Cluster already connected');
      return;
    }
    
    // Cluster connects automatically, just wait a bit for it to be ready
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis Cluster connection timeout'));
      }, 30000);

      if (client.status === 'ready') {
        clearTimeout(timeout);
        resolve();
        return;
      }

      client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      client.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
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

  try {
    // For cluster, we need to use pipeline instead of multi for cross-slot operations
    // But since all operations are on the same key, multi should work
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
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // On error, allow the request but don't cache
    return { allowed: true, remaining: limit - 1, resetAt: now + windowSeconds * 1000 };
  }
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
