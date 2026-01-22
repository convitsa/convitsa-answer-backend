import { Hono } from 'hono';
import { Types } from 'mongoose';
import { authMiddleware } from '../middleware/auth.middleware';
import { Project, Lead } from '../../db/schemas';
import { LeadService } from '../../services/lead.service';
import type { LeadStatus, LeadSource } from '../../types';

const leads = new Hono();

// All routes require authentication
leads.use('*', authMiddleware);

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
 * GET /projects/:projectId/leads
 * List all leads for a project with pagination and filters
 */
leads.get('/:projectId/leads', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
  const status = c.req.query('status') as LeadStatus | undefined;
  const source = c.req.query('source') as LeadSource | undefined;

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const result = await LeadService.getLeads(
    new Types.ObjectId(projectId),
    { status, source },
    page,
    limit
  );

  return c.json({
    leads: result.leads.map((lead) => ({
      id: lead._id.toString(),
      email: lead.email,
      phone: lead.phone,
      name: lead.name,
      company: lead.company,
      source: lead.source,
      status: lead.status,
      notes: lead.notes,
      capturedAt: lead.capturedAt,
      metadata: lead.metadata,
    })),
    total: result.total,
    page,
    limit,
    totalPages: result.pages,
  });
});

/**
 * POST /projects/:projectId/leads
 * Manually create a new lead
 */
leads.post('/:projectId/leads', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json();
  const { email, phone, name, company, source, notes, metadata } = body;

  // Require at least email or phone
  if (!email && !phone) {
    return c.json({ error: 'Email or phone is required', code: 'VALIDATION_ERROR' }, 400);
  }

  const lead = await LeadService.createLead({
    projectId: new Types.ObjectId(projectId),
    email,
    phone,
    name,
    company,
    source: source || 'form',
    metadata: {
      ...metadata,
      notes,
      manuallyCreated: true,
    },
  });

  return c.json(
    {
      lead: {
        id: lead._id.toString(),
        email: lead.email,
        phone: lead.phone,
        name: lead.name,
        company: lead.company,
        source: lead.source,
        status: lead.status,
        capturedAt: lead.capturedAt,
      },
    },
    201
  );
});

/**
 * GET /projects/:projectId/leads/stats
 * Get lead statistics for a project
 * NOTE: This MUST be defined before /:leadId to prevent "stats" matching as leadId
 */
leads.get('/:projectId/leads/stats', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const stats = await LeadService.getLeadStats(new Types.ObjectId(projectId));

  return c.json({ stats });
});

/**
 * POST /projects/:projectId/leads/export
 * Export leads as CSV
 * NOTE: This MUST be defined before /:leadId to prevent "export" matching as leadId
 */
leads.post('/:projectId/leads/export', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json().catch(() => ({}));
  const { status, source } = body;

  const csv = await LeadService.exportLeadsCSV(new Types.ObjectId(projectId), {
    status,
    source,
  });

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="leads-${projectId}-${Date.now()}.csv"`,
    },
  });
});

/**
 * GET /projects/:projectId/leads/:leadId
 * Get a single lead by ID
 */
leads.get('/:projectId/leads/:leadId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const leadId = c.req.param('leadId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  const lead = await LeadService.getLeadById(new Types.ObjectId(leadId));

  if (!lead || lead.projectId.toString() !== projectId) {
    return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404);
  }

  return c.json({
    lead: {
      id: lead._id.toString(),
      email: lead.email,
      phone: lead.phone,
      name: lead.name,
      company: lead.company,
      source: lead.source,
      status: lead.status,
      notes: lead.notes,
      capturedAt: lead.capturedAt,
      metadata: lead.metadata,
    },
  });
});

/**
 * PATCH /projects/:projectId/leads/:leadId
 * Update a lead's details (email, phone, name, company, status, notes)
 */
leads.patch('/:projectId/leads/:leadId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const leadId = c.req.param('leadId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify lead belongs to project
  const existingLead = await Lead.findOne({
    _id: new Types.ObjectId(leadId),
    projectId: new Types.ObjectId(projectId),
  });

  if (!existingLead) {
    return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404);
  }

  const body = await c.req.json();
  const { email, phone, name, company, status, notes } = body;

  // Validate status if provided
  if (status && !['new', 'contacted', 'qualified', 'converted'].includes(status)) {
    return c.json({ error: 'Invalid status', code: 'VALIDATION_ERROR' }, 400);
  }

  // Validate email format if provided
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email format', code: 'VALIDATION_ERROR' }, 400);
  }

  const lead = await LeadService.updateLead(
    new Types.ObjectId(leadId),
    { email, phone, name, company, status, notes }
  );

  if (!lead) {
    return c.json({ error: 'Failed to update lead', code: 'UPDATE_FAILED' }, 500);
  }

  return c.json({
    lead: {
      id: lead._id.toString(),
      email: lead.email,
      phone: lead.phone,
      name: lead.name,
      company: lead.company,
      source: lead.source,
      status: lead.status,
      notes: lead.notes,
      capturedAt: lead.capturedAt,
      metadata: lead.metadata,
    },
  });
});

/**
 * DELETE /projects/:projectId/leads/:leadId
 * Delete a lead
 */
leads.delete('/:projectId/leads/:leadId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const leadId = c.req.param('leadId');

  // Verify ownership
  const project = await verifyProjectOwnership(user.userId, projectId);
  if (!project) {
    return c.json({ error: 'Project not found', code: 'NOT_FOUND' }, 404);
  }

  // Verify lead belongs to project
  const existingLead = await Lead.findOne({
    _id: new Types.ObjectId(leadId),
    projectId: new Types.ObjectId(projectId),
  });

  if (!existingLead) {
    return c.json({ error: 'Lead not found', code: 'NOT_FOUND' }, 404);
  }

  await LeadService.deleteLead(new Types.ObjectId(leadId));

  return c.json({ message: 'Lead deleted successfully' });
});

export { leads as leadRoutes };
