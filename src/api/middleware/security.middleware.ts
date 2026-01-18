import type { Context, Next } from 'hono';

/**
 * Security headers middleware
 */
export async function securityHeaders(c: Context, next: Next) {
  // Set security headers
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Remove server identification
  c.header('X-Powered-By', '');

  await next();
}

/**
 * Request size limit middleware
 * Allows larger uploads for document routes
 */
export function requestSizeLimit(maxSize: number = 1024 * 100) { // 100KB default
  const FILE_UPLOAD_MAX = 1024 * 1024 * 55; // 55MB for file uploads
  
  return async (c: Context, next: Next) => {
    const path = c.req.path;
    const contentLength = c.req.header('content-length');
    
    if (!contentLength) {
      await next();
      return;
    }
    
    const size = parseInt(contentLength, 10);
    
    // Use larger limit for document upload routes
    const isDocumentUpload = path.includes('/documents') && c.req.method === 'POST';
    const effectiveLimit = isDocumentUpload ? FILE_UPLOAD_MAX : maxSize;
    
    if (size > effectiveLimit) {
      return c.json(
        {
          error: 'Request body too large',
          code: 'PAYLOAD_TOO_LARGE',
          maxSize: effectiveLimit,
          maxSizeMB: Math.round(effectiveLimit / 1024 / 1024),
        },
        413
      );
    }

    await next();
  };
}

/**
 * Request timeout middleware
 */
export function requestTimeout(timeoutMs: number = 30000) {
  return async (c: Context, next: Next) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await next();
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

/**
 * Error handling middleware
 */
export async function errorHandler(c: Context, next: Next) {
  try {
    await next();
  } catch (error) {
    console.error('Unhandled error:', error);

    // Don't expose internal errors in production
    const isProduction = process.env.NODE_ENV === 'production';
    const message = isProduction
      ? 'An internal error occurred'
      : error instanceof Error
        ? error.message
        : 'Unknown error';

    return c.json(
      {
        error: message,
        code: 'INTERNAL_ERROR',
      },
      500
    );
  }
}

/**
 * CORS middleware for production
 */
export function corsMiddleware(allowedOrigins: string[]) {
  return async (c: Context, next: Next) => {
    const origin = c.req.header('origin');

    if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      c.header('Access-Control-Max-Age', '86400');
      c.header('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight requests
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }

    await next();
  };
}

/**
 * Sanitize MongoDB IDs in params
 */
export function validateObjectId(paramName: string) {
  return async (c: Context, next: Next) => {
    const id = c.req.param(paramName);
    
    if (id && !/^[a-fA-F0-9]{24}$/.test(id)) {
      return c.json(
        {
          error: `Invalid ${paramName} format`,
          code: 'INVALID_ID',
        },
        400
      );
    }

    await next();
  };
}


