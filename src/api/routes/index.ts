import { Hono } from 'hono';
import { authRoutes } from './auth.routes';
import { projectRoutes } from './project.routes';
import { apiKeyRoutes } from './api-key.routes';
import { userRoutes } from './user.routes';
import { analyticsRoutes } from './analytics.routes';
import { feedbackRoutes } from './feedback.routes';
import { documentRoutes } from './document.routes';
import { webhookRoutes } from './webhook.routes';
import { authRateLimit, signupRateLimit, apiRateLimit } from '../middleware/rate-limit.middleware';

const api = new Hono();

// Health check
api.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// Auth routes with rate limiting
const authWithRateLimit = new Hono();
authWithRateLimit.use('/signup', signupRateLimit);
authWithRateLimit.use('*', authRateLimit);
authWithRateLimit.route('/', authRoutes);
api.route('/auth', authWithRateLimit);

// Feedback route (public, rate limited to prevent spam)
const feedbackWithRateLimit = new Hono();
feedbackWithRateLimit.use('*', signupRateLimit); // Same strict limit as signup (5/min)
feedbackWithRateLimit.route('/', feedbackRoutes);
api.route('/feedback', feedbackWithRateLimit);

// Webhook routes (public, no rate limiting - called by external services)
api.route('/webhooks', webhookRoutes);

// Protected routes with general rate limiting
const protectedRoutes = new Hono();
protectedRoutes.use('*', apiRateLimit);
protectedRoutes.route('/users', userRoutes);
protectedRoutes.route('/projects', projectRoutes);
protectedRoutes.route('/projects', analyticsRoutes); // /projects/:id/analytics, /projects/:id/sessions
protectedRoutes.route('/projects', documentRoutes); // /projects/:id/documents
protectedRoutes.route('/api-keys', apiKeyRoutes);

api.route('/', protectedRoutes);

export { api };

