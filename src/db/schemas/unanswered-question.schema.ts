import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IUnansweredQuestion, UnansweredQuestionStatus } from '../../types';

export interface UnansweredQuestionDocument extends Omit<IUnansweredQuestion, '_id'>, Document {}

const unansweredQuestionSchema = new Schema<UnansweredQuestionDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatSession',
    },
    question: {
      type: String,
      required: true,
      maxlength: 2000,
    },
    aiResponse: {
      type: String,
      maxlength: 5000,
    },
    status: {
      type: String,
      enum: ['pending', 'answered', 'ignored'] as UnansweredQuestionStatus[],
      default: 'pending',
    },
    businessAnswer: {
      type: String,
      maxlength: 5000,
    },
    answeredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    answeredAt: {
      type: Date,
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
unansweredQuestionSchema.index({ projectId: 1, createdAt: -1 });
unansweredQuestionSchema.index({ projectId: 1, status: 1 });
unansweredQuestionSchema.index({ sessionId: 1 });

export const UnansweredQuestion: Model<UnansweredQuestionDocument> = mongoose.model<UnansweredQuestionDocument>(
  'UnansweredQuestion',
  unansweredQuestionSchema
);
