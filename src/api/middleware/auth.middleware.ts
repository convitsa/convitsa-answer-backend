import type { Context, Next } from 'hono';
import { AuthService } from '../../services/auth.service';
import type { JwtPayload } from '../../types';

// Extend Hono context type to include user
declare module 'hono' {
  interface ContextVariableMap {
    user: JwtPayload;
  }
}

/**
 * JWT Authentication middleware
 * Extracts and validates JWT from Authorization header
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      { error: 'Authorization header required', code: 'UNAUTHORIZED' },
      401
    );
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return c.json(
      { error: 'Invalid authorization format. Use: Bearer <token>', code: 'INVALID_AUTH_FORMAT' },
      401
    );
  }

  const payload = AuthService.verifyToken(token);

  if (!payload) {
    return c.json(
      { error: 'Invalid or expired token', code: 'INVALID_TOKEN' },
      401
    );
  }

  // Attach user to context
  c.set('user', payload);

  await next();
}

/**
 * Optional auth middleware - doesn't reject if no token
 */
export async function optionalAuthMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (authHeader) {
    const [scheme, token] = authHeader.split(' ');

    if (scheme === 'Bearer' && token) {
      const payload = AuthService.verifyToken(token);
      if (payload) {
        c.set('user', payload);
      }
    }
  }

  await next();
}


