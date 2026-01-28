import { Types } from 'mongoose';
import { LostLead, ChatSession, ChatMessage, Lead } from '../db/schemas';
import type { 
  ILostLead, 
  LostLeadStatus, 
  DropOffPoint, 
  LostLeadMetadata,
  IntentScoreResult,
  IChatMessage 
} from '../types';

export interface LostLeadFilters {
  status?: LostLeadStatus;
  minIntentScore?: number;
  maxIntentScore?: number;
  startDate?: Date;
  endDate?: Date;
}

export interface DropOffAnalysis {
  commonDropOffMessages: Array<{
    message: string;
    count: number;
    averageMessageIndex: number;
  }>;
  averageDropOffIndex: number;
  totalAnalyzed: number;
}

export interface PatternAnalysis {
  commonQuestions: Array<{
    pattern: string;
    count: number;
    examples: string[];
  }>;
  commonObjections: Array<{
    pattern: string;
    count: number;
    examples: string[];
  }>;
  intentSignalDistribution: Record<string, number>;
}

export class LostLeadService {
  /**
   * Find or create a lost lead record for a visitor
   */
  static async findOrCreateByVisitor(
    projectId: Types.ObjectId,
    visitorId: string,
    metadata?: LostLeadMetadata
  ): Promise<ILostLead> {
    let lostLead = await LostLead.findOne({ projectId, visitorId });

    if (!lostLead) {
      lostLead = await LostLead.create({
        projectId,
        visitorId,
        sessionIds: [],
        intentScore: 0,
        intentSignals: [],
        status: 'lost',
        totalMessages: 0,
        totalSessions: 0,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        metadata: metadata || {},
      });
    }

    return lostLead.toObject() as ILostLead;
  }

  /**
   * Update lost lead from a completed session
   * Called when a session ends without lead capture
   */
  static async updateFromSession(
    sessionId: Types.ObjectId,
    intentResult?: IntentScoreResult
  ): Promise<ILostLead | null> {
    // Get session details
    const session = await ChatSession.findById(sessionId).lean();
    if (!session || !session.visitorId) {
      return null;
    }

    // Check if a lead was captured for this session
    const leadExists = await Lead.findOne({ sessionId });
    if (leadExists) {
      // Mark as converted if lead was captured
      const lostLead = await LostLead.findOne({
        projectId: session.projectId,
        visitorId: session.visitorId,
      });

      if (lostLead) {
        lostLead.status = 'converted';
        await lostLead.save();
        return lostLead.toObject() as ILostLead;
      }
      return null;
    }

    // Get messages for this session
    const messages = await ChatMessage.find({ sessionId })
      .sort({ createdAt: 1 })
      .lean() as IChatMessage[];

    if (messages.length === 0) {
      return null;
    }

    // Find last user message and AI response for drop-off point
    let lastUserMessage = '';
    let lastAiResponse = '';
    let messageIndex = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && !lastUserMessage) {
        lastUserMessage = messages[i].content;
        messageIndex = i;
      }
      if (messages[i].role === 'assistant' && !lastAiResponse) {
        lastAiResponse = messages[i].content;
      }
      if (lastUserMessage && lastAiResponse) break;
    }

    const dropOffPoint: DropOffPoint = {
      lastUserMessage: lastUserMessage.substring(0, 2000),
      lastAiResponse: lastAiResponse.substring(0, 2000),
      messageIndex,
      timestamp: messages[messages.length - 1]?.createdAt || new Date(),
    };

    // Update or create lost lead record
    const lostLead = await LostLead.findOneAndUpdate(
      {
        projectId: session.projectId,
        visitorId: session.visitorId,
      },
      {
        $addToSet: { sessionIds: sessionId },
        $inc: { 
          totalMessages: messages.filter(m => m.role === 'user').length,
          totalSessions: 1,
        },
        $set: {
          lastSeenAt: new Date(),
          dropOffPoint,
          ...(intentResult && {
            intentScore: intentResult.score,
            intentSignals: intentResult.signals,
            intentSummary: intentResult.summary,
          }),
          metadata: {
            ...((session as any).metadata || {}),
          },
        },
        $setOnInsert: {
          projectId: session.projectId,
          visitorId: session.visitorId,
          status: 'lost',
          firstSeenAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return lostLead.toObject() as ILostLead;
  }

  /**
   * Get lost leads for a project with pagination
   */
  static async getLostLeads(
    projectId: Types.ObjectId,
    filters: LostLeadFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: 'lastSeenAt' | 'intentScore' | 'totalSessions' = 'lastSeenAt',
    sortOrder: 'asc' | 'desc' = 'desc'
  ): Promise<{ lostLeads: ILostLead[]; total: number; pages: number }> {
    const query: any = { projectId };

    if (filters.status) query.status = filters.status;
    if (filters.minIntentScore !== undefined || filters.maxIntentScore !== undefined) {
      query.intentScore = {};
      if (filters.minIntentScore !== undefined) query.intentScore.$gte = filters.minIntentScore;
      if (filters.maxIntentScore !== undefined) query.intentScore.$lte = filters.maxIntentScore;
    }
    if (filters.startDate || filters.endDate) {
      query.lastSeenAt = {};
      if (filters.startDate) query.lastSeenAt.$gte = filters.startDate;
      if (filters.endDate) query.lastSeenAt.$lte = filters.endDate;
    }

    const total = await LostLead.countDocuments(query);
    const pages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const sortOptions: Record<string, 1 | -1> = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const lostLeads = await LostLead.find(query)
      .sort(sortOptions)
      .skip(skip)
      .limit(limit)
      .lean();

    return { lostLeads: lostLeads as ILostLead[], total, pages };
  }

  /**
   * Get a single lost lead by visitor ID with all conversation history
   */
  static async getLostLeadByVisitor(
    projectId: Types.ObjectId,
    visitorId: string
  ): Promise<ILostLead | null> {
    const lostLead = await LostLead.findOne({ projectId, visitorId }).lean();
    return lostLead as ILostLead | null;
  }

  /**
   * Get full conversation history for a lost lead
   */
  static async getConversationHistory(
    projectId: Types.ObjectId,
    visitorId: string
  ): Promise<{
    sessions: Array<{
      sessionId: string;
      startedAt: Date;
      endedAt?: Date;
      messages: IChatMessage[];
    }>;
  }> {
    const lostLead = await LostLead.findOne({ projectId, visitorId }).lean();
    if (!lostLead) {
      return { sessions: [] };
    }

    const sessions = await ChatSession.find({
      _id: { $in: lostLead.sessionIds },
    })
      .sort({ startedAt: -1 })
      .lean();

    const result = await Promise.all(
      sessions.map(async (session) => {
        const messages = await ChatMessage.find({ sessionId: session._id })
          .sort({ createdAt: 1 })
          .lean();

        return {
          sessionId: session._id.toString(),
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          messages: messages as IChatMessage[],
        };
      })
    );

    return { sessions: result };
  }

  /**
   * Get drop-off point analysis for a project
   */
  static async getDropOffAnalysis(projectId: Types.ObjectId): Promise<DropOffAnalysis> {
    const lostLeads = await LostLead.find({
      projectId,
      status: 'lost',
      'dropOffPoint.lastUserMessage': { $exists: true, $ne: '' },
    }).lean();

    if (lostLeads.length === 0) {
      return {
        commonDropOffMessages: [],
        averageDropOffIndex: 0,
        totalAnalyzed: 0,
      };
    }

    // Group similar messages (simple approach - exact match for now)
    const messageGroups: Map<string, { count: number; indices: number[] }> = new Map();
    let totalIndex = 0;

    for (const lead of lostLeads) {
      if (lead.dropOffPoint?.lastUserMessage) {
        const msg = lead.dropOffPoint.lastUserMessage.toLowerCase().trim();
        const existing = messageGroups.get(msg) || { count: 0, indices: [] };
        existing.count++;
        existing.indices.push(lead.dropOffPoint.messageIndex || 0);
        messageGroups.set(msg, existing);
        totalIndex += lead.dropOffPoint.messageIndex || 0;
      }
    }

    // Sort by count and take top 10
    const sortedMessages = Array.from(messageGroups.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([message, data]) => ({
        message: message.substring(0, 200),
        count: data.count,
        averageMessageIndex: data.indices.reduce((a, b) => a + b, 0) / data.indices.length,
      }));

    return {
      commonDropOffMessages: sortedMessages,
      averageDropOffIndex: lostLeads.length > 0 ? totalIndex / lostLeads.length : 0,
      totalAnalyzed: lostLeads.length,
    };
  }

  /**
   * Get common patterns and objections analysis
   */
  static async getPatternAnalysis(projectId: Types.ObjectId): Promise<PatternAnalysis> {
    const lostLeads = await LostLead.find({
      projectId,
      status: 'lost',
    }).lean();

    // Aggregate intent signals
    const signalCounts: Record<string, number> = {};
    for (const lead of lostLeads) {
      for (const signal of lead.intentSignals || []) {
        signalCounts[signal] = (signalCounts[signal] || 0) + 1;
      }
    }

    // Get all messages from lost lead sessions for pattern analysis
    const allSessionIds = lostLeads.flatMap((l) => l.sessionIds);
    const messages = await ChatMessage.find({
      sessionId: { $in: allSessionIds },
      role: 'user',
    }).lean();

    // Simple keyword-based pattern detection
    const questionPatterns: Map<string, { count: number; examples: string[] }> = new Map();
    const objectionPatterns: Map<string, { count: number; examples: string[] }> = new Map();

    const questionKeywords = ['how', 'what', 'when', 'where', 'why', 'can', 'do you', 'is there', 'price', 'cost', 'how much'];
    const objectionKeywords = ['expensive', 'too much', 'not sure', 'maybe later', 'competitor', 'alternative', 'already have', 'don\'t need'];

    for (const msg of messages) {
      const content = msg.content.toLowerCase();

      // Detect questions
      for (const keyword of questionKeywords) {
        if (content.includes(keyword)) {
          const existing = questionPatterns.get(keyword) || { count: 0, examples: [] };
          existing.count++;
          if (existing.examples.length < 3) {
            existing.examples.push(msg.content.substring(0, 100));
          }
          questionPatterns.set(keyword, existing);
        }
      }

      // Detect objections
      for (const keyword of objectionKeywords) {
        if (content.includes(keyword)) {
          const existing = objectionPatterns.get(keyword) || { count: 0, examples: [] };
          existing.count++;
          if (existing.examples.length < 3) {
            existing.examples.push(msg.content.substring(0, 100));
          }
          objectionPatterns.set(keyword, existing);
        }
      }
    }

    const commonQuestions = Array.from(questionPatterns.entries())
      .filter(([_, data]) => data.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        examples: data.examples,
      }));

    const commonObjections = Array.from(objectionPatterns.entries())
      .filter(([_, data]) => data.count >= 2)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([pattern, data]) => ({
        pattern,
        count: data.count,
        examples: data.examples,
      }));

    return {
      commonQuestions,
      commonObjections,
      intentSignalDistribution: signalCounts,
    };
  }

  /**
   * Update lost lead status
   */
  static async updateStatus(
    projectId: Types.ObjectId,
    visitorId: string,
    status: LostLeadStatus
  ): Promise<ILostLead | null> {
    const lostLead = await LostLead.findOneAndUpdate(
      { projectId, visitorId },
      { $set: { status } },
      { new: true }
    ).lean();

    return lostLead as ILostLead | null;
  }

  /**
   * Export lost leads as CSV
   */
  static async exportToCSV(
    projectId: Types.ObjectId,
    filters: LostLeadFilters = {}
  ): Promise<string> {
    const query: any = { projectId };
    if (filters.status) query.status = filters.status;
    if (filters.minIntentScore !== undefined) {
      query.intentScore = { $gte: filters.minIntentScore };
    }

    const lostLeads = await LostLead.find(query)
      .sort({ intentScore: -1 })
      .lean();

    // CSV header
    const headers = [
      'Visitor ID',
      'Intent Score',
      'Intent Signals',
      'Status',
      'Total Sessions',
      'Total Messages',
      'Last User Message',
      'First Seen',
      'Last Seen',
    ];

    const rows = lostLeads.map((lead) => [
      lead.visitorId,
      lead.intentScore.toString(),
      (lead.intentSignals || []).join('; '),
      lead.status,
      lead.totalSessions.toString(),
      lead.totalMessages.toString(),
      (lead.dropOffPoint?.lastUserMessage || '').replace(/"/g, '""').substring(0, 200),
      lead.firstSeenAt.toISOString(),
      lead.lastSeenAt.toISOString(),
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * Get lost lead statistics for a project
   */
  static async getStats(projectId: Types.ObjectId): Promise<{
    total: number;
    byStatus: Record<LostLeadStatus, number>;
    averageIntentScore: number;
    highIntent: number;
    mediumIntent: number;
    lowIntent: number;
    last7Days: number;
    last30Days: number;
  }> {
    const total = await LostLead.countDocuments({ projectId });

    const statusAgg = await LostLead.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const scoreAgg = await LostLead.aggregate([
      { $match: { projectId } },
      { $group: { _id: null, avgScore: { $avg: '$intentScore' } } },
    ]);

    const now = new Date();
    const last7Days = await LostLead.countDocuments({
      projectId,
      lastSeenAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    });

    const last30Days = await LostLead.countDocuments({
      projectId,
      lastSeenAt: { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
    });

    const highIntent = await LostLead.countDocuments({ projectId, intentScore: { $gte: 70 } });
    const mediumIntent = await LostLead.countDocuments({
      projectId,
      intentScore: { $gte: 40, $lt: 70 },
    });
    const lowIntent = await LostLead.countDocuments({ projectId, intentScore: { $lt: 40 } });

    const byStatus: Record<LostLeadStatus, number> = {
      lost: 0,
      converted: 0,
      archived: 0,
    };
    statusAgg.forEach((s) => {
      byStatus[s._id as LostLeadStatus] = s.count;
    });

    return {
      total,
      byStatus,
      averageIntentScore: scoreAgg[0]?.avgScore || 0,
      highIntent,
      mediumIntent,
      lowIntent,
      last7Days,
      last30Days,
    };
  }
}
