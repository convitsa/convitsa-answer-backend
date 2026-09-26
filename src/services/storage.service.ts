import { mkdir, readFile, writeFile, unlink, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { env } from '../config/env';
import { nanoid } from 'nanoid';

let initialized = false;

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

  // Images (stored as-is; no OCR/text extraction is performed on them)
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

/**
 * Local-disk file storage, replacing Azure Blob Storage.
 * Keeps the same public interface the rest of the app relies on
 * (initialize / validateFile / uploadFile / downloadFile / deleteFile /
 * deleteProjectFiles / getFileCategory / isInitialized).
 */
export class StorageService {
  /**
   * Initialize the storage service (ensure the root directory exists)
   */
  static async initialize(): Promise<void> {
    try {
      await mkdir(env.STORAGE_PATH, { recursive: true });
      initialized = true;
      console.log(`✅ Local file storage initialized at ${env.STORAGE_PATH}`);
    } catch (error) {
      console.error('❌ Failed to initialize local file storage:', error);
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
   * Upload (write) a file to local disk
   */
  static async uploadFile(
    projectId: string,
    file: File | Blob,
    originalName: string,
    mimeType: string
  ): Promise<{ fileName: string; blobUrl: string }> {
    const config = SUPPORTED_MIME_TYPES[mimeType];
    if (!config) {
      throw new Error(`Unsupported file type: ${mimeType}`);
    }

    // Generate unique file name (relative key, same layout as before: {projectId}/{id}.{ext})
    const uniqueId = nanoid(12);
    const fileName = `${projectId}/${uniqueId}.${config.extension}`;
    const filePath = join(env.STORAGE_PATH, fileName);

    await mkdir(dirname(filePath), { recursive: true });

    const arrayBuffer = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(arrayBuffer));

    return {
      fileName,
      blobUrl: `${env.PUBLIC_BASE_URL}/uploads/${fileName}`,
    };
  }

  /**
   * Download a file from local disk
   */
  static async downloadFile(fileName: string): Promise<Buffer> {
    const filePath = join(env.STORAGE_PATH, fileName);
    return readFile(filePath);
  }

  /**
   * Delete a file from local disk
   */
  static async deleteFile(fileName: string): Promise<void> {
    const filePath = join(env.STORAGE_PATH, fileName);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }

  /**
   * Delete all files for a project
   */
  static async deleteProjectFiles(projectId: string): Promise<number> {
    const projectDir = join(env.STORAGE_PATH, projectId);
    if (!existsSync(projectDir)) {
      return 0;
    }

    const { readdir } = await import('fs/promises');
    const files = await readdir(projectDir);
    await rm(projectDir, { recursive: true, force: true });
    return files.length;
  }

  /**
   * Get the category of a file by its MIME type
   */
  static getFileCategory(mimeType: string): string {
    return SUPPORTED_MIME_TYPES[mimeType]?.category || 'unknown';
  }

  /**
   * Check if storage service is initialized
   */
  static isInitialized(): boolean {
    return initialized;
  }
}
