import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IMagicLink {
  _id: string;
  userId: mongoose.Types.ObjectId;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface MagicLinkDocument extends Omit<IMagicLink, '_id'>, Document {}

const magicLinkSchema = new Schema<MagicLinkDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
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

// Note: token index is already created by unique: true
// Index for cleanup of expired tokens
magicLinkSchema.index({ expiresAt: 1 });
// Index for finding user's tokens
magicLinkSchema.index({ userId: 1 });

export const MagicLink: Model<MagicLinkDocument> = mongoose.model<MagicLinkDocument>('MagicLink', magicLinkSchema);
