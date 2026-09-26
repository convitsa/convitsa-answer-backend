import { Hono } from 'hono';
import { Types } from 'mongoose';
import { authMiddleware } from '../middleware/auth.middleware';
import { ProjectService } from '../../services/project.service';
import { StorageService, SUPPORTED_MIME_TYPES } from '../../services/storage.service';
import { DocumentQueueService } from '../../services/document-queue.service';
import { DocumentWorker } from '../../workers/document.worker';
import { DocumentModel, DocumentChunk } from '../../db/schemas';
import { env } from '../../config/env';

const documents = new Hono();

// All routes require authentication
documents.use('*', authMiddleware);

/**
 * GET /projects/:projectId/documents
 * List all documents for a project
 */
documents.get('/:projectId/documents', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const projectResult = await ProjectService.getProject(user.userId, projectId);
  if (!projectResult.success) {
    const status = projectResult.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: projectResult.error, code: projectResult.code }, status);
  }

  const docs = await DocumentModel.find({ projectId: new Types.ObjectId(projectId) })
    .select('-extractedText')
    .sort({ createdAt: -1 })
    .lean();

  // Get total storage used
  const totalStorage = docs.reduce((sum, doc) => sum + doc.fileSize, 0);

  return c.json({
    documents: docs.map((doc) => ({
      id: doc._id.toString(),
      fileName: doc.originalName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      status: doc.status,
      errorMessage: doc.errorMessage,
      chunkCount: doc.chunkCount,
      processedAt: doc.processedAt,
      createdAt: doc.createdAt,
    })),
    total: docs.length,
    totalStorageBytes: totalStorage,
    maxFiles: env.MAX_FILES_PER_PROJECT,
    maxStorageBytes: env.MAX_STORAGE_PER_PROJECT_MB * 1024 * 1024,
  });
});

/**
 * POST /projects/:projectId/documents
 * Upload one or more documents
 */
documents.post('/:projectId/documents', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const projectResult = await ProjectService.getProject(user.userId, projectId);
  if (!projectResult.success) {
    const status = projectResult.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: projectResult.error, code: projectResult.code }, status);
  }

  // Check if storage service is initialized
  if (!StorageService.isInitialized()) {
    return c.json(
      { error: 'File upload service not available', code: 'SERVICE_UNAVAILABLE' },
      503
    );
  }

  // Parse multipart form data
  const formData = await c.req.formData();
  const files = formData.getAll('files') as File[];

  if (!files || files.length === 0) {
    return c.json(
      { error: 'No files provided', code: 'NO_FILES' },
      400
    );
  }

  // Check existing documents
  const existingDocs = await DocumentModel.countDocuments({
    projectId: new Types.ObjectId(projectId),
  });

  if (existingDocs + files.length > env.MAX_FILES_PER_PROJECT) {
    return c.json(
      {
        error: `File limit exceeded. Maximum ${env.MAX_FILES_PER_PROJECT} files per project. Current: ${existingDocs}`,
        code: 'FILE_LIMIT_EXCEEDED',
      },
      400
    );
  }

  // Check total storage
  const existingStorage = await DocumentModel.aggregate([
    { $match: { projectId: new Types.ObjectId(projectId) } },
    { $group: { _id: null, total: { $sum: '$fileSize' } } },
  ]);
  const currentStorage = existingStorage[0]?.total || 0;
  const newFilesSize = files.reduce((sum, f) => sum + f.size, 0);
  const maxStorage = env.MAX_STORAGE_PER_PROJECT_MB * 1024 * 1024;

  if (currentStorage + newFilesSize > maxStorage) {
    return c.json(
      {
        error: `Storage limit exceeded. Maximum ${env.MAX_STORAGE_PER_PROJECT_MB}MB per project`,
        code: 'STORAGE_LIMIT_EXCEEDED',
      },
      400
    );
  }

  const results: Array<{
    fileName: string;
    status: 'queued' | 'error';
    documentId?: string;
    error?: string;
  }> = [];

  for (const file of files) {
    try {
      // Validate file type and size
      const validation = StorageService.validateFile(file.type, file.size);
      if (!validation.valid) {
        results.push({
          fileName: file.name,
          status: 'error',
          error: validation.error,
        });
        continue;
      }

      // Upload to local storage
      const { fileName, blobUrl } = await StorageService.uploadFile(
        projectId,
        file,
        file.name,
        file.type
      );

      // Create document record
      const doc = await DocumentModel.create({
        projectId: new Types.ObjectId(projectId),
        fileName,
        originalName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        blobUrl,
        status: 'pending',
        chunkCount: 0,
      });

      // Queue for processing
      await DocumentQueueService.enqueue({
        documentId: doc._id.toString(),
        projectId,
        fileName,
        blobUrl,
        mimeType: file.type,
      });

      results.push({
        fileName: file.name,
        status: 'queued',
        documentId: doc._id.toString(),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      results.push({
        fileName: file.name,
        status: 'error',
        error: errorMessage,
      });
    }
  }

  const successful = results.filter((r) => r.status === 'queued').length;
  const failed = results.filter((r) => r.status === 'error').length;

  return c.json(
    {
      message: `${successful} file(s) queued for processing${failed > 0 ? `, ${failed} failed` : ''}`,
      results,
    },
    successful > 0 ? 202 : 400
  );
});

/**
 * GET /projects/:projectId/documents/:documentId
 * Get document details
 */
documents.get('/:projectId/documents/:documentId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const documentId = c.req.param('documentId');

  // Verify ownership
  const projectResult = await ProjectService.getProject(user.userId, projectId);
  if (!projectResult.success) {
    const status = projectResult.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: projectResult.error, code: projectResult.code }, status);
  }

  const doc = await DocumentModel.findOne({
    _id: documentId,
    projectId: new Types.ObjectId(projectId),
  }).lean();

  if (!doc) {
    return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404);
  }

  // Get chunk count
  const chunkCount = await DocumentChunk.countDocuments({
    documentId: new Types.ObjectId(documentId),
  });

  return c.json({
    document: {
      id: doc._id.toString(),
      fileName: doc.originalName,
      mimeType: doc.mimeType,
      fileSize: doc.fileSize,
      status: doc.status,
      errorMessage: doc.errorMessage,
      chunkCount,
      extractedTextPreview: doc.extractedText?.substring(0, 500),
      processedAt: doc.processedAt,
      createdAt: doc.createdAt,
    },
  });
});

/**
 * DELETE /projects/:projectId/documents/:documentId
 * Delete a document
 */
documents.delete('/:projectId/documents/:documentId', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const documentId = c.req.param('documentId');

  // Verify ownership
  const projectResult = await ProjectService.getProject(user.userId, projectId);
  if (!projectResult.success) {
    const status = projectResult.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: projectResult.error, code: projectResult.code }, status);
  }

  // Check document exists and belongs to project
  const doc = await DocumentModel.findOne({
    _id: documentId,
    projectId: new Types.ObjectId(projectId),
  }).lean();

  if (!doc) {
    return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404);
  }

  try {
    await DocumentWorker.deleteDocument(documentId);
    return c.json({ message: 'Document deleted successfully' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Delete failed';
    return c.json({ error: errorMessage, code: 'DELETE_FAILED' }, 500);
  }
});

/**
 * POST /projects/:projectId/documents/:documentId/reprocess
 * Reprocess a failed document
 */
documents.post('/:projectId/documents/:documentId/reprocess', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');
  const documentId = c.req.param('documentId');

  // Verify ownership
  const projectResult = await ProjectService.getProject(user.userId, projectId);
  if (!projectResult.success) {
    const status = projectResult.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: projectResult.error, code: projectResult.code }, status);
  }

  // Check document exists and belongs to project
  const doc = await DocumentModel.findOne({
    _id: documentId,
    projectId: new Types.ObjectId(projectId),
  }).lean();

  if (!doc) {
    return c.json({ error: 'Document not found', code: 'NOT_FOUND' }, 404);
  }

  if (doc.status === 'processing') {
    return c.json(
      { error: 'Document is already being processed', code: 'ALREADY_PROCESSING' },
      409
    );
  }

  try {
    await DocumentWorker.reprocessDocument(documentId);
    return c.json({ message: 'Document queued for reprocessing' }, 202);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Reprocess failed';
    return c.json({ error: errorMessage, code: 'REPROCESS_FAILED' }, 500);
  }
});

/**
 * GET /projects/:projectId/documents/stats
 * Get document processing stats
 */
documents.get('/:projectId/documents/stats', async (c) => {
  const user = c.get('user');
  const projectId = c.req.param('projectId');

  // Verify ownership
  const projectResult = await ProjectService.getProject(user.userId, projectId);
  if (!projectResult.success) {
    const status = projectResult.code === 'NOT_FOUND' ? 404 : 500;
    return c.json({ error: projectResult.error, code: projectResult.code }, status);
  }

  // Get document stats by status
  const statusStats = await DocumentModel.aggregate([
    { $match: { projectId: new Types.ObjectId(projectId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  const stats: Record<string, number> = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
  };

  for (const s of statusStats) {
    stats[s._id] = s.count;
  }

  // Get total storage
  const storageStats = await DocumentModel.aggregate([
    { $match: { projectId: new Types.ObjectId(projectId) } },
    { $group: { _id: null, totalSize: { $sum: '$fileSize' }, totalChunks: { $sum: '$chunkCount' } } },
  ]);

  const totalSize = storageStats[0]?.totalSize || 0;
  const totalChunks = storageStats[0]?.totalChunks || 0;

  // Get queue stats
  const queueStats = await DocumentQueueService.getStats();

  return c.json({
    documents: stats,
    totalDocuments: Object.values(stats).reduce((a, b) => a + b, 0),
    totalChunks,
    storageUsedBytes: totalSize,
    storageLimitBytes: env.MAX_STORAGE_PER_PROJECT_MB * 1024 * 1024,
    storageUsedPercent: Math.round((totalSize / (env.MAX_STORAGE_PER_PROJECT_MB * 1024 * 1024)) * 100),
    queue: queueStats,
  });
});

/**
 * GET /projects/:projectId/documents/supported-types
 * Get list of supported file types
 */
documents.get('/:projectId/documents/supported-types', async (c) => {
  const types = Object.entries(SUPPORTED_MIME_TYPES).map(([mimeType, config]) => ({
    mimeType,
    extension: config.extension,
    category: config.category,
    maxSizeMB: config.maxSizeMB,
  }));

  // Group by category
  const byCategory: Record<string, typeof types> = {};
  for (const type of types) {
    if (!byCategory[type.category]) {
      byCategory[type.category] = [];
    }
    byCategory[type.category].push(type);
  }

  return c.json({
    supportedTypes: types,
    byCategory,
    limits: {
      maxFileSizeMB: env.MAX_FILE_SIZE_MB,
      maxFilesPerProject: env.MAX_FILES_PER_PROJECT,
      maxStoragePerProjectMB: env.MAX_STORAGE_PER_PROJECT_MB,
    },
  });
});

export { documents as documentRoutes };

