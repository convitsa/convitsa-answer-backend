import { Types } from 'mongoose';
import { DocumentModel, DocumentChunk, Project, User } from '../db/schemas';
import { DocumentQueueService } from '../services/document-queue.service';
import { StorageService } from '../services/storage.service';
import { FileProcessorService } from '../services/file-processor.service';
import { EmbeddingService } from '../services/embedding.service';
import { RAGService } from '../services/rag.service';
import { EmailService } from '../services/email.service';
import { chunkText } from '../utils/helpers';
import type { DocumentProcessingJob } from '../types';

let isRunning = false;
let shouldStop = false;

export class DocumentWorker {
  /**
   * Start the document processing worker
   */
  static async start(): Promise<void> {
    if (isRunning) {
      console.log('📄 Document worker already running');
      return;
    }

    isRunning = true;
    shouldStop = false;
    console.log('📄 Document worker started');

    // Clear any stale processing entries on start
    await DocumentQueueService.clearStaleProcessing(30);

    while (!shouldStop) {
      try {
        // Get next job from queue (blocking with 5 second timeout)
        const job = await DocumentQueueService.dequeue(5);
        
        if (job) {
          await this.processJob(job);
        }
      } catch (error) {
        console.error('Document worker error:', error);
        // Continue processing after error
      }
    }

    isRunning = false;
    console.log('📄 Document worker stopped');
  }

  /**
   * Stop the worker gracefully
   */
  static stop(): void {
    console.log('📄 Stopping document worker...');
    shouldStop = true;
  }

  /**
   * Check if worker is running
   */
  static isWorkerRunning(): boolean {
    return isRunning;
  }

  /**
   * Process a single document job
   */
  private static async processJob(job: DocumentProcessingJob): Promise<void> {
    const { documentId, projectId, fileName, blobUrl, mimeType } = job;
    const startTime = Date.now();

    console.log(`📄 Processing document: ${fileName} (${documentId})`);

    try {
      // Mark as processing
      await DocumentQueueService.markProcessing(documentId);
      await DocumentModel.updateOne(
        { _id: documentId },
        { $set: { status: 'processing' } }
      );

      // Step 1: Download file from local storage
      console.log(`  📥 Reading file from local storage...`);
      const fileBuffer = await StorageService.downloadFile(fileName);
      console.log(`  ✅ Downloaded ${fileBuffer.length} bytes`);

      // Step 2: Extract text content
      console.log(`  📝 Extracting text content...`);
      const extracted = await FileProcessorService.extractText(fileBuffer, mimeType, blobUrl);
      let cleanedText = FileProcessorService.cleanText(extracted.text);
      console.log(`  ✅ Extracted ${cleanedText.length} characters`);

      // Handle files with no extractable text (like images without text)
      const isImage = mimeType.startsWith('image/');
      if (!cleanedText || cleanedText.length < 10) {
        if (isImage) {
          // For images without text, mark as completed but with no chunks
          console.log(`  ⚠️ Image has no readable text - marking as completed without chunks`);
          
          const doc = await DocumentModel.findById(documentId).lean();
          await DocumentModel.updateOne(
            { _id: documentId },
            {
              $set: {
                status: 'completed',
                extractedText: `[Image file: ${doc?.originalName || fileName}] - Images are stored without text extraction.`,
                chunkCount: 0,
                processedAt: new Date(),
              },
            }
          );
          
          await DocumentQueueService.markCompleted(documentId);
          console.log(`✅ Image processed (no text): ${fileName}`);
          return;
        }
        
        throw new Error('No readable text content found in file. The document may be empty, scanned without OCR, or in an unsupported format.');
      }

      // Step 3: Chunk the text
      console.log(`  ✂️ Chunking text...`);
      const chunks = chunkText(cleanedText, 1000, 200);
      console.log(`  ✅ Created ${chunks.length} chunks`);

      // Step 4: Generate embeddings for each chunk
      console.log(`  🧠 Generating embeddings...`);
      const embeddings = await EmbeddingService.generateEmbeddings(chunks);
      console.log(`  ✅ Generated ${embeddings.length} embeddings`);

      // Step 5: Store chunks in database
      console.log(`  💾 Storing chunks in database...`);
      
      // Delete existing chunks for this document (in case of reprocessing)
      await DocumentChunk.deleteMany({ documentId: new Types.ObjectId(documentId) });

      // Get original file name from document
      const doc = await DocumentModel.findById(documentId).lean();
      const originalName = doc?.originalName || fileName;

      // Create chunk documents
      const chunkDocs = chunks.map((content, index) => ({
        documentId: new Types.ObjectId(documentId),
        projectId: new Types.ObjectId(projectId),
        content,
        chunkIndex: index,
        embedding: embeddings[index],
        metadata: {
          fileName: originalName,
          pageNumber: extracted.metadata?.pageCount 
            ? Math.floor((index / chunks.length) * extracted.metadata.pageCount) + 1 
            : undefined,
          sheetName: extracted.metadata?.sheetNames?.[0],
        },
      }));

      // Batch insert
      await DocumentChunk.insertMany(chunkDocs);
      console.log(`  ✅ Stored ${chunkDocs.length} chunks`);

      // Step 6: Update document status
      await DocumentModel.updateOne(
        { _id: documentId },
        {
          $set: {
            status: 'completed',
            extractedText: cleanedText.substring(0, 5000), // Store preview
            chunkCount: chunks.length,
            processedAt: new Date(),
          },
        }
      );

      // Invalidate RAG cache for this project
      RAGService.invalidateCache(projectId);

      const duration = Date.now() - startTime;
      console.log(`✅ Document processed successfully: ${fileName} (${duration}ms)`);

      // Send document completed email (non-blocking)
      this.sendDocumentEmail(projectId, originalName, true).catch((err) => {
        console.error('Failed to send document completed email:', err);
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Failed to process document ${fileName}:`, errorMessage);

      // Update document with error status
      await DocumentModel.updateOne(
        { _id: documentId },
        {
          $set: {
            status: 'failed',
            errorMessage: errorMessage.substring(0, 500),
          },
        }
      );

      // Get original name for email
      const doc = await DocumentModel.findById(documentId).lean();
      const originalName = doc?.originalName || fileName;

      // Send document failed email (non-blocking)
      this.sendDocumentEmail(projectId, originalName, false, errorMessage).catch((err) => {
        console.error('Failed to send document failed email:', err);
      });
    } finally {
      // Remove from processing set
      await DocumentQueueService.markCompleted(documentId);
    }
  }

  /**
   * Reprocess a failed document
   */
  static async reprocessDocument(documentId: string): Promise<void> {
    const doc = await DocumentModel.findById(documentId).lean();
    if (!doc) {
      throw new Error('Document not found');
    }

    if (doc.status === 'processing') {
      throw new Error('Document is already being processed');
    }

    // Reset status and re-queue
    await DocumentModel.updateOne(
      { _id: documentId },
      {
        $set: { status: 'pending' },
        $unset: { errorMessage: 1 },
      }
    );

    await DocumentQueueService.enqueue({
      documentId: doc._id.toString(),
      projectId: doc.projectId.toString(),
      fileName: doc.fileName,
      blobUrl: doc.blobUrl,
      mimeType: doc.mimeType,
    });

    console.log(`📄 Document queued for reprocessing: ${doc.originalName}`);
  }

  /**
   * Delete a document and its chunks
   */
  static async deleteDocument(documentId: string): Promise<void> {
    const doc = await DocumentModel.findById(documentId).lean();
    if (!doc) {
      throw new Error('Document not found');
    }

    // Delete from local storage
    try {
      await StorageService.deleteFile(doc.fileName);
    } catch (error) {
      console.warn(`Failed to delete file: ${doc.fileName}`, error);
    }

    // Delete chunks
    await DocumentChunk.deleteMany({ documentId: new Types.ObjectId(documentId) });

    // Delete document record
    await DocumentModel.deleteOne({ _id: documentId });

    // Invalidate cache
    RAGService.invalidateCache(doc.projectId.toString());

    console.log(`🗑️ Deleted document: ${doc.originalName}`);
  }

  /**
   * Delete all documents for a project
   */
  static async deleteProjectDocuments(projectId: string): Promise<number> {
    const docs = await DocumentModel.find({ projectId: new Types.ObjectId(projectId) }).lean();
    
    // Delete from local storage
    await StorageService.deleteProjectFiles(projectId);

    // Delete all chunks
    await DocumentChunk.deleteMany({ projectId: new Types.ObjectId(projectId) });

    // Delete all documents
    const result = await DocumentModel.deleteMany({ projectId: new Types.ObjectId(projectId) });

    // Invalidate cache
    RAGService.invalidateCache(projectId);

    console.log(`🗑️ Deleted ${result.deletedCount} documents for project ${projectId}`);
    return result.deletedCount;
  }

  /**
   * Send document processing email notification
   */
  private static async sendDocumentEmail(
    projectId: string,
    fileName: string,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      // Get project and user info
      const project = await Project.findById(projectId).lean();
      if (!project) return;

      const user = await User.findById(project.userId).select('email').lean();
      if (!user?.email) return;

      if (success) {
        await EmailService.sendDocumentCompletedEmail(user.email, fileName, project.name);
        console.log(`✉️ Sent document completed email to ${user.email}`);
      } else {
        await EmailService.sendDocumentFailedEmail(user.email, fileName, errorMessage || 'Unknown error');
        console.log(`✉️ Sent document failed email to ${user.email}`);
      }
    } catch (error) {
      console.error('Error sending document email:', error);
    }
  }
}

