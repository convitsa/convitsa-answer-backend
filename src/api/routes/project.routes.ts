import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.middleware';
import { validate, validateQuery } from '../middleware/validate.middleware';
import { ProjectService, ApiKeyService } from '../../services/project.service';
import { CrawlService } from '../../services/crawl.service';
import {
  createProjectSchema,
  updateProjectSchema,
  createApiKeySchema,
  paginationSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
  type CreateApiKeyInput,
  type PaginationInput,
} from '../validators/project.validator';

const projects = new Hono();

// All routes require authentication
projects.use('*', authMiddleware);

/**
 * GET /projects
 * List all projects for the authenticated user
 */
projects.get('/', async (c) => {
  const user = c.get('user');

  const result = await ProjectService.getProjects(user.userId);

  if (!result.success) {
    return c.json({ error: result.error, code: result.code }, 500);
  }

  return c.json({ projects: result.data });
});

/**
 * POST /projects
 * Create a new project
 */
projects.post('/', validate(createProjectSchema), async (c) => {
  const user = c.get('user');
  const body = c.get('validatedBody') as CreateProjectInput;

  const result = await ProjectService.createProject(user.userId, body);

  if (!result.success) {
    const status = result.code === 'INVALID_URL' ? 400 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({ project: result.data }, 201);
});

/**
 * GET /projects/:id
 * Get a single project by ID
 */
projects.get('/:id', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  const result = await ProjectService.getProject(user.userId, projectId);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({ project: result.data });
});

/**
 * PUT /projects/:id
 * Update a project
 */
projects.put('/:id', validate(updateProjectSchema), async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const body = c.get('validatedBody') as UpdateProjectInput;

  const result = await ProjectService.updateProject(user.userId, projectId, body);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : result.code === 'INVALID_URL' ? 400 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({ project: result.data });
});

/**
 * DELETE /projects/:id
 * Delete a project and all associated data
 */
projects.delete('/:id', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  const result = await ProjectService.deleteProject(user.userId, projectId);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({ message: 'Project deleted successfully' });
});

/**
 * POST /projects/:id/crawl
 * Trigger website crawling
 */
projects.post('/:id/crawl', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  // Verify ownership and get project
  const projectResult = await ProjectService.getProject(user.userId, projectId);

  if (!projectResult.success) {
    const status = projectResult.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: projectResult.error, code: projectResult.code }, status);
  }

  const project = projectResult.data!;

  // Check if already crawling
  if (project.crawlStatus === 'crawling' || project.crawlStatus === 'pending') {
    return c.json(
      { error: 'Crawl already in progress', code: 'CRAWL_IN_PROGRESS' },
      409
    );
  }

  // Start crawl (async, non-blocking)
  CrawlService.startCrawl(projectId, project.websiteUrl).catch((error) => {
    console.error(`Crawl failed for project ${projectId}:`, error);
  });

  return c.json(
    { message: 'Crawl started', status: 'pending' },
    202
  );
});

/**
 * GET /projects/:id/crawl-status
 * Get crawl status
 */
projects.get('/:id/crawl-status', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  const result = await ProjectService.getProject(user.userId, projectId);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  const project = result.data!;

  return c.json({
    status: project.crawlStatus,
    lastCrawledAt: project.lastCrawledAt,
    crawlError: project.crawlError,
    pagesCount: project.pagesCount,
  });
});

/**
 * GET /projects/:id/pages
 * Get indexed pages for a project
 */
projects.get('/:id/pages', validateQuery(paginationSchema), async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const query = c.get('validatedQuery') as PaginationInput;

  const result = await ProjectService.getPages(user.userId, projectId, query.page, query.limit);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({
    pages: result.data!.pages,
    total: result.data!.total,
    page: query.page,
    limit: query.limit,
  });
});

// ============================================================
// API Key Routes
// ============================================================

/**
 * GET /projects/:id/api-keys
 * List all API keys for a project
 */
projects.get('/:id/api-keys', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  const result = await ApiKeyService.getApiKeys(user.userId, projectId);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json({ apiKeys: result.data });
});

/**
 * POST /projects/:id/api-keys
 * Create a new API key for a project
 */
projects.post('/:id/api-keys', validate(createApiKeySchema), async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const body = c.get('validatedBody') as CreateApiKeyInput;

  const result = await ApiKeyService.createApiKey(user.userId, projectId, body.name);

  if (!result.success) {
    const status = result.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: result.error, code: result.code }, status);
  }

  return c.json(
    {
      message: 'API key created. Store it securely - it will not be shown again.',
      apiKey: result.data!.apiKey,
      keyPrefix: result.data!.keyPrefix,
      id: result.data!.id,
    },
    201
  );
});

export { projects as projectRoutes };


