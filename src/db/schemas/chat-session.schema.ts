import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IChatSession, ChatTier } from '../../types';

export interface ChatSessionDocument extends Omit<IChatSession, '_id'>, Document {}

const chatSessionSchema = new Schema<ChatSessionDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    apiKeyId: {
      type: Schema.Types.ObjectId,
      ref: 'ApiKey',
      required: true,
    },
    tier: {
      type: String,
      enum: ['free', 'pro', 'business'] as ChatTier[],
      required: true,
    },
    visitorId: {
      type: String,
      trim: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
      default: undefined,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    messageCount: {
      type: Number,
      default: 0,
    },
    // Lost Lead Intelligence metadata
    metadata: {
      userAgent: String,
      referrer: String,
      pageUrl: String,
    },
    // Whether a lead was captured from this session
    leadCaptured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes
chatSessionSchema.index({ projectId: 1, startedAt: -1 });
chatSessionSchema.index({ apiKeyId: 1 });
chatSessionSchema.index({ startedAt: -1 });
chatSessionSchema.index({ visitorId: 1 });
chatSessionSchema.index({ projectId: 1, visitorId: 1 });

export const ChatSession: Model<ChatSessionDocument> = mongoose.model<ChatSessionDocument>(
  'ChatSession',
  chatSessionSchema
);
