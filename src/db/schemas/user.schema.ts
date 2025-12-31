import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IUser } from '../../types';

export interface UserDocument extends Omit<IUser, '_id'>, Document {}

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
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

// Indexes (unique: true on field already creates index, so only add compound/other indexes)
userSchema.index({ createdAt: -1 });

export const User: Model<UserDocument> = mongoose.model<UserDocument>('User', userSchema);
