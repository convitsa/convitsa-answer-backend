import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ILead, LeadStatus, LeadSource } from '../../types';

export interface LeadDocument extends Omit<ILead, '_id'>, Document {}

const leadSchema = new Schema<LeadDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    // Visitor ID for tracking across sessions
    visitorId: {
      type: String,
      trim: true,
    },
    // All sessions this visitor had before converting
    sessionIds: {
      type: [Schema.Types.ObjectId],
      ref: 'ChatSession',
      default: [],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    company: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    source: {
      type: String,
      enum: ['chat', 'form'] as LeadSource[],
      required: true,
      default: 'chat',
    },
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'converted'] as LeadStatus[],
      default: 'new',
    },
    notes: {
      type: String,
      maxlength: 2000,
    },
    capturedAt: {
      type: Date,
      default: Date.now,
    },
    // AI-generated conversation analysis
    conversationSummary: {
      type: String,
      maxlength: 2000,
    },
    intentScore: {
      type: Number,
      min: 0,
      max: 100,
    },
    intentSignals: {
      type: [String],
      default: [],
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes
leadSchema.index({ projectId: 1, capturedAt: -1 });
leadSchema.index({ projectId: 1, status: 1 });
leadSchema.index({ projectId: 1, email: 1 });
leadSchema.index({ visitorId: 1 });
leadSchema.index({ projectId: 1, visitorId: 1 });

export const Lead: Model<LeadDocument> = mongoose.model<LeadDocument>('Lead', leadSchema);
