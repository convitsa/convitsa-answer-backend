import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IEmailVerification } from '../../types';

export interface EmailVerificationDocument extends Omit<IEmailVerification, '_id'>, Document {}

const emailVerificationSchema = new Schema<EmailVerificationDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
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
emailVerificationSchema.index({ userId: 1 });
emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup

export const EmailVerification: Model<EmailVerificationDocument> = mongoose.model<EmailVerificationDocument>(
  'EmailVerification',
  emailVerificationSchema
);
