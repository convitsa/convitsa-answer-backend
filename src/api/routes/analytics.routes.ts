import { Hono } from 'hono';
import { Types } from 'mongoose';
import { authMiddleware } from '../middleware/auth.middleware';
import { Project, ChatSession, ChatMessage, Page, ApiKey } from '../../db/schemas';

const analytics = new Hono();

// All routes require authentication
analytics.use('*', authMiddleware);

/**
 * GET /projects/:id/analytics
 * Get analytics for a project
 */
analytics.get('/:id/analytics', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');

  // Verify ownership
  const project = await Project.findOne({
    _id: new Types.ObjectId(projectId),
    userId: new Types.ObjectId(user.userId),
  });

  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const projectObjId = new Types.ObjectId(projectId);
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Get various stats
  const [
    totalSessions,
    totalMessages,
    totalTokens,
    sessionsLast7Days,
    sessionsLast30Days,
    pagesCount,
    activeApiKeys,
    tierBreakdown,
  ] = await Promise.all([
    // Total sessions
    ChatSession.countDocuments({ projectId: projectObjId }),
    
    // Total messages (from sessions)
    ChatSession.aggregate([
      { $match: { projectId: projectObjId } },
      { $group: { _id: null, total: { $sum: '$messageCount' } } },
    ]).then((r) => r[0]?.total || 0),
    
    // Total tokens
    ChatSession.aggregate([
      { $match: { projectId: projectObjId } },
      { $group: { _id: null, total: { $sum: '$totalTokens' } } },
    ]).then((r) => r[0]?.total || 0),
    
    // Sessions last 7 days
    ChatSession.countDocuments({
      projectId: projectObjId,
      startedAt: { $gte: sevenDaysAgo },
    }),
    
    // Sessions last 30 days
    ChatSession.countDocuments({
      projectId: projectObjId,
      startedAt: { $gte: thirtyDaysAgo },
    }),
    
    // Pages count
    Page.countDocuments({ projectId: projectObjId }),
    
    // Active API keys
    ApiKey.countDocuments({ projectId: projectObjId, active: true }),
    
    // Tier breakdown
    ChatSession.aggregate([
      { $match: { projectId: projectObjId } },
      { $group: { _id: '$tier', count: { $sum: 1 } } },
    ]),
  ]);

  // Calculate tier breakdown
  const tiers = tierBreakdown.reduce(
    (acc, { _id, count }) => {
      acc[_id as 'free' | 'pro'] = count;
      return acc;
    },
    { free: 0, pro: 0 }
  );

  // Get daily session counts for the last 30 days
  const dailyStats = await ChatSession.aggregate([
    {
      $match: {
        projectId: projectObjId,
        startedAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%d', date: '$startedAt' },
        },
        sessions: { $sum: 1 },
        messages: { $sum: '$messageCount' },
        tokens: { $sum: '$totalTokens' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return c.json({
    overview: {
      totalSessions,
      totalMessages,
      totalTokens,
      sessionsLast7Days,
      sessionsLast30Days,
      pagesIndexed: pagesCount,
      activeApiKeys,
    },
    tierBreakdown: tiers,
    dailyStats: dailyStats.map((d) => ({
      date: d._id,
      sessions: d.sessions,
      messages: d.messages,
      tokens: d.tokens,
    })),
    crawlStatus: project.crawlStatus,
    lastCrawledAt: project.lastCrawledAt,
  });
});

/**
 * GET /projects/:id/sessions
 * List chat sessions for a project
 */
analytics.get('/:id/sessions', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);

  // Verify ownership
  const project = await Project.findOne({
    _id: new Types.ObjectId(projectId),
    userId: new Types.ObjectId(user.userId),
  });

  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const projectObjId = new Types.ObjectId(projectId);
  const skip = (page - 1) * limit;

  const [sessions, total] = await Promise.all([
    ChatSession.find({ projectId: projectObjId })
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ChatSession.countDocuments({ projectId: projectObjId }),
  ]);

  return c.json({
    sessions: sessions.map((s) => ({
      id: s._id.toString(),
      tier: s.tier,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      messageCount: s.messageCount,
      totalTokens: s.totalTokens,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});

/**
 * GET /projects/:id/sessions/:sessionId/messages
 * Get messages for a specific session
 */
analytics.get('/:id/sessions/:sessionId/messages', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('id');
  const sessionId = c.req.param('sessionId');

  // Verify ownership
  const project = await Project.findOne({
    _id: new Types.ObjectId(projectId),
    userId: new Types.ObjectId(user.userId),
  });

  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify session belongs to project
  const session = await ChatSession.findOne({
    _id: new Types.ObjectId(sessionId),
    projectId: new Types.ObjectId(projectId),
  });

  if (!session) {
    return c.json({ error: 'Session not found', code: 'NOT_FOUND' }, 404);
  }

  const messages = await ChatMessage.find({ sessionId: new Types.ObjectId(sessionId) })
    .sort({ createdAt: 1 })
    .lean();

  return c.json({
    session: {
      id: session._id.toString(),
      tier: session.tier,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      totalTokens: session.totalTokens,
    },
    messages: messages.map((m) => ({
      id: m._id.toString(),
      role: m.role,
      content: m.content,
      tokenCount: m.tokenCount,
      createdAt: m.createdAt,
    })),
  });
});

export { analytics as analyticsRoutes };


