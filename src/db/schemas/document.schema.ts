import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IDocument } from '../../types';

export interface DocumentDocument extends Omit<IDocument, '_id'>, Document {}

const documentSchema = new Schema<DocumentDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    originalName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    blobUrl: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    errorMessage: {
      type: String,
    },
    extractedText: {
      type: String,
    },
    chunkCount: {
      type: Number,
      default: 0,
    },
    processedAt: {
      type: Date,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

// Indexes
documentSchema.index({ projectId: 1 });
documentSchema.index({ projectId: 1, status: 1 });
documentSchema.index({ status: 1 });
documentSchema.index({ createdAt: -1 });

export const DocumentModel: Model<DocumentDocument> = mongoose.model<DocumentDocument>('Document', documentSchema);

