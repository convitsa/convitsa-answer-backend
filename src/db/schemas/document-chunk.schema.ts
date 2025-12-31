import mongoose, { Schema, Document, Model } from 'mongoose';
import type { IDocumentChunk } from '../../types';

export interface DocumentChunkDocument extends Omit<IDocumentChunk, '_id'>, Document {}

const documentChunkSchema = new Schema<DocumentChunkDocument>(
  {
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    chunkIndex: {
      type: Number,
      required: true,
      default: 0,
    },
    embedding: {
      type: [Number],
      required: true,
    },
    metadata: {
      fileName: {
        type: String,
        required: true,
      },
      pageNumber: {
        type: Number,
      },
      sheetName: {
        type: String,
      },
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

// Indexes
documentChunkSchema.index({ projectId: 1 });
documentChunkSchema.index({ documentId: 1 });
documentChunkSchema.index({ documentId: 1, chunkIndex: 1 }, { unique: true });

// Note: Vector search index for documentchunks collection must be created in MongoDB Atlas manually:
// {
//   "name": "document_vector_index",
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
//       },
//       {
//         "type": "filter",
//         "path": "documentId"
//       }
//     ]
//   }
// }

export const DocumentChunk: Model<DocumentChunkDocument> = mongoose.model<DocumentChunkDocument>('DocumentChunk', documentChunkSchema);

