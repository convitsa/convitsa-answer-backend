import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware';
import { ApiKeyService } from '../../services/project.service';

const apiKeys = new Hono();

// All routes require authentication
apiKeys.use('*', authMiddleware);

/**
 * DELETE /api-keys/:id
 * Revoke (deactivate) an API key
 */
apiKeys.delete('/:id', async (c) => {
  const user = c.get('user');
  const keyId = c.req.param('id');

  const result = await ApiKeyService.revokeApiKey(user.userId, keyId);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({ message: 'API key revoked successfully' });
});

export { apiKeys as apiKeyRoutes };


