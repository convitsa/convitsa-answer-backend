import mongoose, { Schema, Document, Model, Types } from 'mongoose';

export interface IFeatureRequest {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  userEmail: string;
  subscriptionTier: string;
  text: string;
  status: 'pending' | 'reviewed' | 'planned' | 'completed' | 'rejected';
  createdAt: Date;
  updatedAt: Date;
}

export interface FeatureRequestDocument extends Omit<IFeatureRequest, '_id'>, Document {}

const featureRequestSchema = new Schema<FeatureRequestDocument>(
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
    text: {
      type: String,
      required: true,
      maxlength: 5000,
    },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'planned', 'completed', 'rejected'],
      default: 'pending',
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Indexes
featureRequestSchema.index({ userId: 1 });
featureRequestSchema.index({ status: 1 });
featureRequestSchema.index({ createdAt: -1 });

export const FeatureRequest: Model<FeatureRequestDocument> = mongoose.model<FeatureRequestDocument>(
  'FeatureRequest',
  featureRequestSchema
);
