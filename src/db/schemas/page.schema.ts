import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IPage } from '../../types';

export interface PageDocument extends Omit<IPage, '_id'>, Document {}

const pageSchema = new Schema<PageDocument>(
  {
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      default: 'Untitled',
    },
    content: {
      type: String,
      required: true,
    },
    embedding: {
      type: [Number],
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
      default: 0,
    },
    crawledAt: {
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
pageSchema.index({ projectId: 1 });
pageSchema.index({ projectId: 1, url: 1, chunkIndex: 1 }, { unique: true });
pageSchema.index({ crawledAt: -1 });

// Note: Vector search index must be created in MongoDB Atlas manually or via Atlas API:
// {
//   "name": "vector_index",
//   "type": "vectorSearch",
//   "definition": {
//     "fields": [
//       {
//         "type": "vector",
//         "path": "embedding",
//         "numDimensions": 3072,
//         "similarity": "cosine"
//       },
//       {
//         "type": "filter",
//         "path": "projectId"
//       }
//     ]
//   }
// }

export const Page: Model<PageDocument> = mongoose.model<PageDocument>('Page', pageSchema);
