import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ILostLead, LostLeadStatus } from '../../types';

export interface LostLeadDocument extends Omit<ILostLead, '_id'>, Document {}

const lostLeadSchema = new Schema<LostLeadDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    visitorId: {
      type: String,
      required: true,
      trim: true,
    },
    sessionIds: [{
      type: Schema.Types.ObjectId,
      ref: 'ChatSession',
    }],
    intentScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    intentSignals: [{
      type: String,
      trim: true,
    }],
    intentSummary: {
      type: String,
      maxlength: 1000,
    },
    dropOffPoint: {
      lastUserMessage: {
        type: String,
        maxlength: 2000,
      },
      lastAiResponse: {
        type: String,
        maxlength: 2000,
      },
      messageIndex: {
        type: Number,
        default: 0,
      },
      timestamp: {
        type: Date,
      },
    },
    status: {
      type: String,
      enum: ['lost', 'converted', 'archived'] as LostLeadStatus[],
      default: 'lost',
    },
    totalMessages: {
      type: Number,
      default: 0,
    },
    totalSessions: {
      type: Number,
      default: 0,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      userAgent: String,
      referrer: String,
      pageUrl: String,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
lostLeadSchema.index({ projectId: 1, lastSeenAt: -1 });
lostLeadSchema.index({ projectId: 1, visitorId: 1 }, { unique: true });
lostLeadSchema.index({ projectId: 1, intentScore: -1 });
lostLeadSchema.index({ projectId: 1, status: 1 });
lostLeadSchema.index({ visitorId: 1 });

export const LostLead: Model<LostLeadDocument> = mongoose.model<LostLeadDocument>(
  'LostLead',
  lostLeadSchema
);
