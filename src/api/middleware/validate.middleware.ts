import type { Context, Next } from 'hono';
import { z } from 'zod';

/**
 * Request validation middleware factory
 * Validates request body against provided Zod schema
 */
export function validate<T extends z.ZodType>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const body = await c.req.json();
      const result = schema.safeParse(body);

      if (!result.success) {
        const errors = result.error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        return c.json(
          {
            error: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details: errors,
          },
          400
        );
      }

      // Attach validated data to context
      c.set('validatedBody', result.data);
      await next();
    } catch (error) {
      return c.json(
        {
          error: 'Invalid JSON body',
          code: 'INVALID_JSON',
        },
        400
      );
    }
  };
}

/**
 * Query parameter validation middleware factory
 */
export function validateQuery<T extends z.ZodType>(schema: T) {
  return async (c: Context, next: Next) => {
    const query = c.req.query();
    const result = schema.safeParse(query);

    if (!result.success) {
      const errors = result.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      }));

      return c.json(
        {
          error: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: errors,
        },
        400
      );
    }

    c.set('validatedQuery', result.data);
    await next();
  };
}

// Extend Hono context type
declare module 'hono' {
  interface ContextVariableMap {
    validatedBody: unknown;
    validatedQuery: unknown;
  }
}


