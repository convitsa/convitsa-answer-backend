import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IProject, CrawlStatus } from '../../types';

export interface ProjectDocument extends Omit<IProject, '_id'>, Document {}

const projectSchema = new Schema<ProjectDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    websiteUrl: {
      type: String,
      required: true,
      trim: true,
    },
    crawlStatus: {
      type: String,
      enum: ['idle', 'pending', 'crawling', 'completed', 'failed'] as CrawlStatus[],
      default: 'idle',
    },
    crawlError: {
      type: String,
      default: undefined,
    },
    lastCrawledAt: {
      type: Date,
      default: undefined,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    versionKey: false,
  }
);

// Indexes
projectSchema.index({ userId: 1, createdAt: -1 });
projectSchema.index({ crawlStatus: 1 });

// Update timestamp on save
projectSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export const Project: Model<ProjectDocument> = mongoose.model<ProjectDocument>('Project', projectSchema);
