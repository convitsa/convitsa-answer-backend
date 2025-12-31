import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IApiKey } from '../../types';

export interface ApiKeyDocument extends Omit<IApiKey, '_id'>, Document {}

const apiKeySchema = new Schema<ApiKeyDocument>(
  {
    keyHash: {
      type: String,
      required: true,
      unique: true,
    },
    keyPrefix: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
      default: 'Default Key',
    },
    active: {
      type: Boolean,
      default: true,
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

// Indexes (unique: true on keyHash already creates index)
apiKeySchema.index({ projectId: 1, active: 1 });
apiKeySchema.index({ userId: 1 });

export const ApiKey: Model<ApiKeyDocument> = mongoose.model<ApiKeyDocument>('ApiKey', apiKeySchema);
