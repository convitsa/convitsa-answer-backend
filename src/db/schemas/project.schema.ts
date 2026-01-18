import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IProject, CrawlStatus, AIPersonality, FallbackBehavior } from '../../types';

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
    marketingConfig: {
      aiPersonality: {
        type: String,
        enum: ['friendly_sales', 'consultative', 'urgency_driven'] as AIPersonality[],
        default: 'friendly_sales',
      },
      calendlyUrl: {
        type: String,
        trim: true,
      },
      webhookUrl: {
        type: String,
        trim: true,
      },
      notifyEmail: {
        type: String,
        trim: true,
        lowercase: true,
      },
      ctaButtons: [{
        label: { type: String, required: true },
        url: { type: String, required: true },
      }],
      leadCaptureFields: {
        type: [String],
        enum: ['email', 'phone', 'name', 'company'],
        default: ['email', 'name'],
      },
      contactOptions: {
        whatsapp: { type: String, trim: true },
        instagram: { type: String, trim: true },
        telegram: { type: String, trim: true },
        email: { type: String, trim: true },
        phone: { type: String, trim: true },
        custom: [{
          label: { type: String, required: true },
          url: { type: String, required: true },
          icon: { type: String },
        }],
      },
      fallbackBehavior: {
        type: String,
        enum: ['book_meeting', 'show_contacts', 'both'] as FallbackBehavior[],
        default: 'both',
      },
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
