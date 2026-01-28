import { Hono } from 'hono';
import { Types } from 'mongoose';
import { authMiddleware } from '../middleware/auth.middleware';
import { Project, Subscription } from '../../db/schemas';
import { LostLeadService } from '../../services/lost-lead.service';
import type { LostLeadStatus } from '../../types';

const lostLeads = new Hono();

// All routes require authentication
lostLeads.use('*', authMiddleware);

/**
 * Helper to verify project ownership
 */
async function verifyProjectOwnership(userId: string, projectId: string) {
  const project = await Project.findOne({
    _id: new Types.ObjectId(projectId),
    userId: new Types.ObjectId(userId),
  });
  return project;
}

/**
 * Helper to check if user has access to Lost Lead Intelligence (Pro/Business only)
 */
async function checkTierAccess(userId: string): Promise<{ allowed: boolean; tier: string }> {
  const subscription = await Subscription.findOne({ userId: new Types.ObjectId(userId) }).lean();
  const tier = subscription?.tier || 'free';
  const allowed = tier === 'pro' || tier === 'business';
  return { allowed, tier };
}

/**
 * Middleware to check tier access
 */
const tierMiddleware = async (c: any, next: any) => {
  const user = c.get('user');
  const { allowed, tier } = await checkTierAccess(user.userId);
  
  if (!allowed) {
    return c.json({ 
      error: 'Lost Lead Intelligence is available for Pro and Business plans only', 
      code: 'TIER_REQUIRED',
      currentTier: tier,
    }, 403);
  }
  
  await next();
};

/**
 * GET /projects/:projectId/lost-leads
 * List all lost leads for a project with pagination and filters
 */
lostLeads.get('/:projectId/lost-leads', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const status = c.req.query('status') as LostLeadStatus | undefined;
  const minScore = c.req.query('minScore') ? parseInt(c.req.query('minScore')!, 10) : undefined;
  const maxScore = c.req.query('maxScore') ? parseInt(c.req.query('maxScore')!, 10) : undefined;
  const sortBy = (c.req.query('sortBy') || 'lastSeenAt') as 'lastSeenAt' | 'intentScore' | 'totalSessions';
  const sortOrder = (c.req.query('sortOrder') || 'desc') as 'asc' | 'desc';

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const result = await LostLeadService.getLostLeads(
    new Types.ObjectId(projectId),
    { status, minIntentScore: minScore, maxIntentScore: maxScore },
    page,
    limit,
    sortBy,
    sortOrder
  );

  return c.json({
    lostLeads: result.lostLeads.map((lead) => ({
      id: lead._id.toString(),
      visitorId: lead.visitorId,
      intentScore: lead.intentScore,
      intentSignals: lead.intentSignals,
      intentSummary: lead.intentSummary,
      status: lead.status,
      totalSessions: lead.totalSessions,
      totalMessages: lead.totalMessages,
      dropOffPoint: lead.dropOffPoint ? {
        lastUserMessage: lead.dropOffPoint.lastUserMessage,
        messageIndex: lead.dropOffPoint.messageIndex,
        timestamp: lead.dropOffPoint.timestamp,
      } : null,
      firstSeenAt: lead.firstSeenAt,
      lastSeenAt: lead.lastSeenAt,
    })),
    total: result.total,
    page,
    limit,
    totalPages: result.pages,
  });
});

/**
 * GET /projects/:projectId/lost-leads/stats
 * Get lost lead statistics
 */
lostLeads.get('/:projectId/lost-leads/stats', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const stats = await LostLeadService.getStats(new Types.ObjectId(projectId));

  return c.json({ stats });
});

/**
 * GET /projects/:projectId/lost-leads/analytics/dropoff
 * Get drop-off point analysis
 */
lostLeads.get('/:projectId/lost-leads/analytics/dropoff', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const analysis = await LostLeadService.getDropOffAnalysis(new Types.ObjectId(projectId));

  return c.json({ analysis });
});

/**
 * GET /projects/:projectId/lost-leads/analytics/patterns
 * Get common patterns and objections analysis
 */
lostLeads.get('/:projectId/lost-leads/analytics/patterns', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const patterns = await LostLeadService.getPatternAnalysis(new Types.ObjectId(projectId));

  return c.json({ patterns });
});

/**
 * GET /projects/:projectId/lost-leads/export
 * Export lost leads as CSV
 */
lostLeads.get('/:projectId/lost-leads/export', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const status = c.req.query('status') as LostLeadStatus | undefined;
  const minScore = c.req.query('minScore') ? parseInt(c.req.query('minScore')!, 10) : undefined;

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const csv = await LostLeadService.exportToCSV(new Types.ObjectId(projectId), {
    status,
    minIntentScore: minScore,
  });

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="lost-leads-${projectId}-${Date.now()}.csv"`,
    },
  });
});

/**
 * GET /projects/:projectId/lost-leads/:visitorId
 * Get a single lost lead by visitor ID
 */
lostLeads.get('/:projectId/lost-leads/:visitorId', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const visitorId = c.req.param('visitorId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const lostLead = await LostLeadService.getLostLeadByVisitor(
    new Types.ObjectId(projectId),
    visitorId
  );

  if (!lostLead) {
    return c.json({ error: 'Lost lead not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    lostLead: {
      id: lostLead._id.toString(),
      visitorId: lostLead.visitorId,
      sessionIds: lostLead.sessionIds.map((id) => id.toString()),
      intentScore: lostLead.intentScore,
      intentSignals: lostLead.intentSignals,
      intentSummary: lostLead.intentSummary,
      dropOffPoint: lostLead.dropOffPoint,
      status: lostLead.status,
      totalSessions: lostLead.totalSessions,
      totalMessages: lostLead.totalMessages,
      firstSeenAt: lostLead.firstSeenAt,
      lastSeenAt: lostLead.lastSeenAt,
      metadata: lostLead.metadata,
    },
  });
});

/**
 * GET /projects/:projectId/lost-leads/:visitorId/conversation
 * Get full conversation history for a lost lead
 */
lostLeads.get('/:projectId/lost-leads/:visitorId/conversation', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const visitorId = c.req.param('visitorId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const { sessions } = await LostLeadService.getConversationHistory(
    new Types.ObjectId(projectId),
    visitorId
  );

  if (sessions.length === 0) {
    return c.json({ error: 'Lost lead not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    visitorId,
    sessions: sessions.map((session) => ({
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      messages: session.messages.map((msg) => ({
        id: msg._id.toString(),
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt,
      })),
    })),
  });
});

/**
 * PATCH /projects/:projectId/lost-leads/:visitorId
 * Update a lost lead's status (archive, etc.)
 */
lostLeads.patch('/:projectId/lost-leads/:visitorId', tierMiddleware, async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const visitorId = c.req.param('visitorId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json();
  const { status } = body;

  // Validate status
  if (!status || !['lost', 'converted', 'archived'].includes(status)) {
    return c.json({ error: 'Invalid status', code: 'VALIDATION_ERROR' }, 400);
  }

  const lostLead = await LostLeadService.updateStatus(
    new Types.ObjectId(projectId),
    visitorId,
    status as LostLeadStatus
  );

  if (!lostLead) {
    return c.json({ error: 'Lost lead not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    lostLead: {
      id: lostLead._id.toString(),
      visitorId: lostLead.visitorId,
      status: lostLead.status,
    },
  });
});

export { lostLeads as lostLeadRoutes };
