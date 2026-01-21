import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IUser, UserCreatedVia } from '../../types';

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
      required: false, // Optional for users created via payment (set later via magic link)
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    createdVia: {
      type: String,
      enum: ['registration', 'payment'] as UserCreatedVia[],
      default: 'registration',
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
