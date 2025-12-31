import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IChatMessage, MessageRole } from '../../types';

export interface ChatMessageDocument extends Omit<IChatMessage, '_id'>, Document {}

const chatMessageSchema = new Schema<ChatMessageDocument>(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatSession',
      required: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant', 'system'] as MessageRole[],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    tokenCount: {
      type: Number,
      default: 0,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes
chatMessageSchema.index({ sessionId: 1, createdAt: 1 });

export const ChatMessage: Model<ChatMessageDocument> = mongoose.model<ChatMessageDocument>(
  'ChatMessage',
  chatMessageSchema
);
