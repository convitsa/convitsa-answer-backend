import { Types } from 'mongoose';
import { Lead, ConversionEvent, Project } from '../db/schemas';
import type { ILead, LeadStatus, LeadSource, MarketingConfig } from '../types';
import { EmailService } from './email.service';
import { WebhookService } from './webhook.service';

export interface ExtractedContactInfo {
  email?: string;
  phone?: string;
  name?: string;
}

export interface LeadCreateInput {
  projectId: Types.ObjectId;
  sessionId?: Types.ObjectId;
  email?: string;
  phone?: string;
  name?: string;
  company?: string;
  source?: LeadSource;
  metadata?: Record<string, any>;
}

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  startDate?: Date;
  endDate?: Date;
}

export class LeadService {
  // Email regex pattern
  private static readonly EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  
  // Phone patterns (international formats)
  private static readonly PHONE_PATTERNS = [
    /\+?1?[-.\s]?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g, // US/Canada
    /\+?[0-9]{1,3}[-.\s]?[0-9]{2,4}[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{3,4}/g, // International
    /\+?994[-.\s]?\d{2}[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}/g, // Azerbaijan
    /\+?44[-.\s]?\d{4}[-.\s]?\d{6}/g, // UK
    /\+?49[-.\s]?\d{3,4}[-.\s]?\d{7,8}/g, // Germany
  ];

  /**
   * Extract contact information from text
   */
  static extractContactInfo(text: string): ExtractedContactInfo {
    const extracted: ExtractedContactInfo = {};
    
    // Extract email
    const emailMatches = text.match(this.EMAIL_PATTERN);
    if (emailMatches && emailMatches.length > 0) {
      extracted.email = emailMatches[0].toLowerCase();
    }
    
    // Extract phone
    for (const pattern of this.PHONE_PATTERNS) {
      const phoneMatches = text.match(pattern);
      if (phoneMatches && phoneMatches.length > 0) {
        // Clean up phone number
        extracted.phone = phoneMatches[0].replace(/[\s.-]/g, '');
        break;
      }
    }
    
    // Try to extract name (simple heuristic - looks for "I'm X" or "My name is X")
    const namePatterns = [
      /(?:i'?m|my name is|this is|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /(?:name[:\s]+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    ];
    
    for (const pattern of namePatterns) {
      const nameMatch = text.match(pattern);
      if (nameMatch && nameMatch[1]) {
        extracted.name = nameMatch[1].trim();
        break;
      }
    }
    
    return extracted;
  }

  /**
   * Check if text contains contact info
   */
  static hasContactInfo(text: string): boolean {
    const extracted = this.extractContactInfo(text);
    return !!(extracted.email || extracted.phone);
  }

  /**
   * Create a new lead
   */
  static async createLead(input: LeadCreateInput): Promise<ILead> {
    // Check if lead with same email already exists for this project
    if (input.email) {
      const existing = await Lead.findOne({
        projectId: input.projectId,
        email: input.email,
      });
      
      if (existing) {
        // Update existing lead with any new info
        if (input.phone && !existing.phone) existing.phone = input.phone;
        if (input.name && !existing.name) existing.name = input.name;
        if (input.company && !existing.company) existing.company = input.company;
        if (input.sessionId) existing.sessionId = input.sessionId;
        await existing.save();
        return existing.toObject() as ILead;
      }
    }

    const lead = new Lead({
      projectId: input.projectId,
      sessionId: input.sessionId,
      email: input.email,
      phone: input.phone,
      name: input.name,
      company: input.company,
      source: input.source || 'chat',
      status: 'new',
      metadata: input.metadata || {},
      capturedAt: new Date(),
    });

    await lead.save();

    // Track conversion event
    await ConversionEvent.create({
      projectId: input.projectId,
      sessionId: input.sessionId,
      leadId: lead._id,
      eventType: 'lead_captured',
      eventData: {
        email: input.email,
        phone: input.phone,
        name: input.name,
        source: input.source || 'chat',
      },
    });

    // Get project for notifications
    const project = await Project.findById(input.projectId).populate('userId', 'email');
    if (project && project.marketingConfig) {
      const config = project.marketingConfig as unknown as MarketingConfig;
      
      // Send webhook notification
      if (config.webhookUrl) {
        await WebhookService.sendLeadWebhook(config.webhookUrl, {
          leadId: lead._id.toString(),
          projectId: input.projectId.toString(),
          email: input.email,
          phone: input.phone,
          name: input.name,
          company: input.company,
          source: input.source || 'chat',
          capturedAt: lead.capturedAt,
        });
      }

      // Send email notification
      const notifyEmail = config.notifyEmail || (project.userId as any)?.email;
      if (notifyEmail) {
        await EmailService.sendNewLeadEmail(
          notifyEmail,
          project.name,
          input.email,
          input.phone,
          input.name
        );
      }
    }

    return lead.toObject() as ILead;
  }

  /**
   * Get leads for a project with pagination
   */
  static async getLeads(
    projectId: Types.ObjectId,
    filters: LeadFilters = {},
    page: number = 1,
    limit: number = 20
  ): Promise<{ leads: ILead[]; total: number; pages: number }> {
    const query: any = { projectId };

    if (filters.status) query.status = filters.status;
    if (filters.source) query.source = filters.source;
    if (filters.startDate || filters.endDate) {
      query.capturedAt = {};
      if (filters.startDate) query.capturedAt.$gte = filters.startDate;
      if (filters.endDate) query.capturedAt.$lte = filters.endDate;
    }

    const total = await Lead.countDocuments(query);
    const pages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const leads = await Lead.find(query)
      .sort({ capturedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return { leads: leads as ILead[], total, pages };
  }

  /**
   * Get lead by ID
   */
  static async getLeadById(leadId: Types.ObjectId): Promise<ILead | null> {
    const lead = await Lead.findById(leadId).lean();
    return lead as ILead | null;
  }

  /**
   * Update lead status
   */
  static async updateLeadStatus(
    leadId: Types.ObjectId,
    status: LeadStatus,
    notes?: string
  ): Promise<ILead | null> {
    const update: any = { status };
    if (notes !== undefined) update.notes = notes;

    const lead = await Lead.findByIdAndUpdate(
      leadId,
      { $set: update },
      { new: true }
    ).lean();

    return lead as ILead | null;
  }

  /**
   * Delete a lead
   */
  static async deleteLead(leadId: Types.ObjectId): Promise<boolean> {
    const result = await Lead.findByIdAndDelete(leadId);
    return !!result;
  }

  /**
   * Get lead statistics for a project
   */
  static async getLeadStats(projectId: Types.ObjectId): Promise<{
    total: number;
    byStatus: Record<LeadStatus, number>;
    bySource: Record<LeadSource, number>;
    last7Days: number;
    last30Days: number;
  }> {
    const total = await Lead.countDocuments({ projectId });

    const statusAgg = await Lead.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const sourceAgg = await Lead.aggregate([
      { $match: { projectId } },
      { $group: { _id: '$source', count: { $sum: 1 } } },
    ]);

    const now = new Date();
    const last7Days = await Lead.countDocuments({
      projectId,
      capturedAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    });

    const last30Days = await Lead.countDocuments({
      projectId,
      capturedAt: { $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
    });

    const byStatus: Record<LeadStatus, number> = {
      new: 0,
      contacted: 0,
      qualified: 0,
      converted: 0,
    };
    statusAgg.forEach((s) => {
      byStatus[s._id as LeadStatus] = s.count;
    });

    const bySource: Record<LeadSource, number> = {
      chat: 0,
      form: 0,
    };
    sourceAgg.forEach((s) => {
      bySource[s._id as LeadSource] = s.count;
    });

    return { total, byStatus, bySource, last7Days, last30Days };
  }

  /**
   * Export leads as CSV data
   */
  static async exportLeadsCSV(
    projectId: Types.ObjectId,
    filters: LeadFilters = {}
  ): Promise<string> {
    const query: any = { projectId };
    if (filters.status) query.status = filters.status;
    if (filters.source) query.source = filters.source;

    const leads = await Lead.find(query).sort({ capturedAt: -1 }).lean();

    // CSV header
    const headers = ['Email', 'Phone', 'Name', 'Company', 'Source', 'Status', 'Captured At', 'Notes'];
    const rows = leads.map((lead) => [
      lead.email || '',
      lead.phone || '',
      lead.name || '',
      lead.company || '',
      lead.source,
      lead.status,
      lead.capturedAt.toISOString(),
      (lead.notes || '').replace(/"/g, '""'),
    ]);

    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    return csv;
  }

  /**
   * Track a conversion event
   */
  static async trackEvent(
    projectId: Types.ObjectId,
    eventType: 'meeting_booked' | 'link_clicked' | 'cta_clicked' | 'contact_clicked',
    sessionId?: Types.ObjectId,
    leadId?: Types.ObjectId,
    eventData?: Record<string, any>
  ): Promise<void> {
    await ConversionEvent.create({
      projectId,
      sessionId,
      leadId,
      eventType,
      eventData,
    });
  }
}
