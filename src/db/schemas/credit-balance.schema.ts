import mongoose, { Schema, Document, Model } from 'mongoose';
import type { ICreditBalance, ICreditTransaction } from '../../types';

// Credit Balance Schema
export interface CreditBalanceDocument extends Omit<ICreditBalance, '_id'>, Document {}

const creditBalanceSchema = new Schema<CreditBalanceDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Update timestamp on save
creditBalanceSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export const CreditBalance: Model<CreditBalanceDocument> = mongoose.model<CreditBalanceDocument>(
  'CreditBalance',
  creditBalanceSchema
);

// Credit Transaction Schema for audit trail
export interface CreditTransactionDocument extends Omit<ICreditTransaction, '_id'>, Document {}

const creditTransactionSchema = new Schema<CreditTransactionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatSession',
      default: undefined,
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
creditTransactionSchema.index({ userId: 1, createdAt: -1 });
creditTransactionSchema.index({ createdAt: -1 });

export const CreditTransaction: Model<CreditTransactionDocument> = mongoose.model<CreditTransactionDocument>(
  'CreditTransaction',
  creditTransactionSchema
);
