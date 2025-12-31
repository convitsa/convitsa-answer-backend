import { BlobServiceClient, ContainerClient, BlockBlobClient } from '@azure/storage-blob';
import { env } from '../config/env';
import { nanoid } from 'nanoid';

let containerClient: ContainerClient | null = null;

/**
 * Supported MIME types and their extensions
 */
export const SUPPORTED_MIME_TYPES: Record<string, { extension: string; category: string; maxSizeMB: number }> = {
  // Documents
  'application/pdf': { extension: 'pdf', category: 'document', maxSizeMB: 50 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', category: 'document', maxSizeMB: 25 },
  'application/msword': { extension: 'doc', category: 'document', maxSizeMB: 25 },
  'text/plain': { extension: 'txt', category: 'document', maxSizeMB: 10 },
  'text/markdown': { extension: 'md', category: 'document', maxSizeMB: 10 },
  'application/rtf': { extension: 'rtf', category: 'document', maxSizeMB: 10 },
  
  // Spreadsheets
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', category: 'spreadsheet', maxSizeMB: 25 },
  'application/vnd.ms-excel': { extension: 'xls', category: 'spreadsheet', maxSizeMB: 25 },
  'text/csv': { extension: 'csv', category: 'spreadsheet', maxSizeMB: 25 },
  
  // Presentations
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { extension: 'pptx', category: 'presentation', maxSizeMB: 50 },
  'application/vnd.ms-powerpoint': { extension: 'ppt', category: 'presentation', maxSizeMB: 50 },
  
  // Images (for OCR)
  'image/png': { extension: 'png', category: 'image', maxSizeMB: 20 },
  'image/jpeg': { extension: 'jpg', category: 'image', maxSizeMB: 20 },
  'image/gif': { extension: 'gif', category: 'image', maxSizeMB: 20 },
  'image/webp': { extension: 'webp', category: 'image', maxSizeMB: 20 },
  'image/bmp': { extension: 'bmp', category: 'image', maxSizeMB: 20 },
  'image/tiff': { extension: 'tiff', category: 'image', maxSizeMB: 20 },
  
  // Other
  'application/json': { extension: 'json', category: 'other', maxSizeMB: 10 },
  'text/xml': { extension: 'xml', category: 'other', maxSizeMB: 10 },
  'application/xml': { extension: 'xml', category: 'other', maxSizeMB: 10 },
  'text/html': { extension: 'html', category: 'other', maxSizeMB: 10 },
};

export class BlobService {
  /**
   * Initialize the blob service connection
   */
  static async initialize(): Promise<void> {
    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(
        env.AZURE_BLOB_CONNECTION_STRING
      );
      
      containerClient = blobServiceClient.getContainerClient(env.AZURE_BLOB_CONTAINER_NAME);
      
      // Create container if it doesn't exist
      const exists = await containerClient.exists();
      if (!exists) {
        await containerClient.create({ access: 'blob' });
        console.log(`📦 Created blob container: ${env.AZURE_BLOB_CONTAINER_NAME}`);
      }
      
      console.log('✅ Azure Blob Storage initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Azure Blob Storage:', error);
      throw error;
    }
  }

  /**
   * Validate file type and size
   */
  static validateFile(
    mimeType: string,
    fileSize: number
  ): { valid: boolean; error?: string } {
    const config = SUPPORTED_MIME_TYPES[mimeType];
    
    if (!config) {
      return {
        valid: false,
        error: `Unsupported file type: ${mimeType}. Supported types: PDF, DOCX, DOC, TXT, MD, RTF, XLSX, XLS, CSV, PPTX, PPT, PNG, JPG, GIF, WEBP, BMP, TIFF, JSON, XML, HTML`,
      };
    }
    
    const maxBytes = config.maxSizeMB * 1024 * 1024;
    if (fileSize > maxBytes) {
      return {
        valid: false,
        error: `File too large. Maximum size for ${config.extension.toUpperCase()} is ${config.maxSizeMB}MB`,
      };
    }
    
    return { valid: true };
  }

  /**
   * Upload a file to Azure Blob Storage
   */
  static async uploadFile(
    projectId: string,
    file: File | Blob,
    originalName: string,
    mimeType: string
  ): Promise<{ fileName: string; blobUrl: string }> {
    if (!containerClient) {
      throw new Error('Blob service not initialized');
    }

    const config = SUPPORTED_MIME_TYPES[mimeType];
    if (!config) {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Generate unique file name
    const uniqueId = nanoid(12);
    const fileName = `${projectId}/${uniqueId}.${config.extension}`;
    
    const blockBlobClient: BlockBlobClient = containerClient.getBlockBlobClient(fileName);
    
    // Convert File/Blob to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Upload with content type
    await blockBlobClient.upload(buffer, buffer.length, {
      blobHTTPHeaders: {
        blobContentType: mimeType,
      },
      metadata: {
        originalName: encodeURIComponent(originalName),
        projectId,
      },
    });

    return {
      fileName,
      blobUrl: blockBlobClient.url,
    };
  }

  /**
   * Download a file from Azure Blob Storage
   */
  static async downloadFile(fileName: string): Promise<Buffer> {
    if (!containerClient) {
      throw new Error('Blob service not initialized');
    }

    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    const downloadResponse = await blockBlobClient.download(0);
    
    if (!downloadResponse.readableStreamBody) {
      throw new Error('Failed to download file');
    }

    // Convert stream to buffer
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody) {
      chunks.push(Buffer.from(chunk));
    }
    
    return Buffer.concat(chunks);
  }

  /**
   * Delete a file from Azure Blob Storage
   */
  static async deleteFile(fileName: string): Promise<void> {
    if (!containerClient) {
      throw new Error('Blob service not initialized');
    }

    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    await blockBlobClient.deleteIfExists();
  }

  /**
   * Delete all files for a project
   */
  static async deleteProjectFiles(projectId: string): Promise<number> {
    if (!containerClient) {
      throw new Error('Blob service not initialized');
    }

    let deletedCount = 0;
    const prefix = `${projectId}/`;
    
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
      await blockBlobClient.deleteIfExists();
      deletedCount++;
    }

    return deletedCount;
  }

  /**
   * Get the category of a file by its MIME type
   */
  static getFileCategory(mimeType: string): string {
    return SUPPORTED_MIME_TYPES[mimeType]?.category || 'unknown';
  }

  /**
   * Check if blob service is initialized
   */
  static isInitialized(): boolean {
    return containerClient !== null;
  }
}

