import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IConversionEvent, ConversionEventType } from '../../types';

export interface ConversionEventDocument extends Omit<IConversionEvent, '_id'>, Document {}

const conversionEventSchema = new Schema<ConversionEventDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'ChatSession',
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
    },
    eventType: {
      type: String,
      enum: ['lead_captured', 'meeting_booked', 'link_clicked', 'cta_clicked', 'contact_clicked'] as ConversionEventType[],
      required: true,
    },
    eventData: {
      type: Schema.Types.Mixed,
      default: {},
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
conversionEventSchema.index({ projectId: 1, createdAt: -1 });
conversionEventSchema.index({ projectId: 1, eventType: 1 });
conversionEventSchema.index({ leadId: 1 });
conversionEventSchema.index({ sessionId: 1 });

export const ConversionEvent: Model<ConversionEventDocument> = mongoose.model<ConversionEventDocument>(
  'ConversionEvent',
  conversionEventSchema
);
