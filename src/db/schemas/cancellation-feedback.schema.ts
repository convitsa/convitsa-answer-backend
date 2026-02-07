import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export type CancellationReason = 'missing_features' | 'price' | 'not_using' | 'switching' | 'other';

export interface ICancellationFeedback {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  userEmail: string;
  subscriptionTier: string;
  billingInterval: string;
  reason?: CancellationReason;
  feedback?: string;
  createdAt: Date;
}

export interface CancellationFeedbackDocument extends Omit<ICancellationFeedback, '_id'>, Document {}

const cancellationFeedbackSchema = new Schema<CancellationFeedbackDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    subscriptionTier: {
      type: String,
      required: true,
    },
    billingInterval: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
      enum: ['missing_features', 'price', 'not_using', 'switching', 'other'],
    },
    feedback: {
      type: String,
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
cancellationFeedbackSchema.index({ userId: 1 });
cancellationFeedbackSchema.index({ reason: 1 });
cancellationFeedbackSchema.index({ createdAt: -1 });

export const CancellationFeedback: Model<CancellationFeedbackDocument> = mongoose.model<CancellationFeedbackDocument>(
  'CancellationFeedback',
  cancellationFeedbackSchema
);
