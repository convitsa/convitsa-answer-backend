import mammoth from 'mammoth';

// pdf-parse doesn't have proper ESM exports, use require
const pdfParse = require('pdf-parse');
import * as XLSX from 'xlsx';
import officeParser from 'officeparser';
import * as cheerio from 'cheerio';
import { env } from '../config/env';
import { BlobService } from './blob.service';

interface ExtractedContent {
  text: string;
  metadata?: {
    pageCount?: number;
    sheetNames?: string[];
    slideCount?: number;
  };
}

export class FileProcessorService {
  /**
   * Extract text content from a file based on its MIME type
   */
  static async extractText(
    fileBuffer: Buffer,
    mimeType: string,
    blobUrl?: string
  ): Promise<ExtractedContent> {
    const category = BlobService.getFileCategory(mimeType);

    switch (category) {
      case 'document':
        return this.extractDocumentText(fileBuffer, mimeType);
      case 'spreadsheet':
        return this.extractSpreadsheetText(fileBuffer, mimeType);
      case 'presentation':
        return this.extractPresentationText(fileBuffer);
      case 'image':
        return this.extractImageText(fileBuffer, mimeType, blobUrl);
      case 'other':
        return this.extractOtherText(fileBuffer, mimeType);
      default:
        throw new Error(`Unsupported file category: ${category}`);
    }
  }

  /**
   * Extract text from document files (PDF, DOCX, DOC, TXT, MD, RTF)
   */
  private static async extractDocumentText(
    buffer: Buffer,
    mimeType: string
  ): Promise<ExtractedContent> {
    switch (mimeType) {
      case 'application/pdf':
        return this.extractPdfText(buffer);
      
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.extractDocxText(buffer);
      
      case 'application/msword':
        return this.extractDocText(buffer);
      
      case 'text/plain':
      case 'text/markdown':
        return { text: buffer.toString('utf-8') };
      
      case 'application/rtf':
        return this.extractRtfText(buffer);
      
      default:
        throw new Error(`Unsupported document type: ${mimeType}`);
    }
  }

  /**
   * Extract text from PDF files
   */
  private static async extractPdfText(buffer: Buffer): Promise<ExtractedContent> {
    try {
      const data = await pdfParse(buffer);
      return {
        text: data.text,
        metadata: {
          pageCount: data.numpages,
        },
      };
    } catch (error) {
      console.error('PDF extraction error:', error);
      throw new Error('Failed to extract text from PDF');
    }
  }

  /**
   * Extract text from DOCX files
   */
  private static async extractDocxText(buffer: Buffer): Promise<ExtractedContent> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value };
    } catch (error) {
      console.error('DOCX extraction error:', error);
      throw new Error('Failed to extract text from DOCX');
    }
  }

  /**
   * Extract text from DOC files using officeparser
   */
  private static async extractDocText(buffer: Buffer): Promise<ExtractedContent> {
    try {
      const text = await officeParser.parseOfficeAsync(buffer);
      return { text };
    } catch (error) {
      console.error('DOC extraction error:', error);
      throw new Error('Failed to extract text from DOC');
    }
  }

  /**
   * Extract text from RTF files using officeparser
   */
  private static async extractRtfText(buffer: Buffer): Promise<ExtractedContent> {
    try {
      // RTF is basically text with markup, try to extract plain text
      const text = buffer.toString('utf-8')
        .replace(/\\[a-z]+\d*\s?/gi, '') // Remove RTF commands
        .replace(/[{}]/g, '') // Remove braces
        .replace(/\r\n|\r|\n/g, '\n') // Normalize newlines
        .trim();
      return { text };
    } catch (error) {
      console.error('RTF extraction error:', error);
      throw new Error('Failed to extract text from RTF');
    }
  }

  /**
   * Extract text from spreadsheet files (XLSX, XLS, CSV)
   */
  private static async extractSpreadsheetText(
    buffer: Buffer,
    mimeType: string
  ): Promise<ExtractedContent> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheetNames = workbook.SheetNames;
      
      const textParts: string[] = [];
      
      for (const sheetName of sheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(sheet);
        
        if (csv.trim()) {
          textParts.push(`[Sheet: ${sheetName}]\n${csv}`);
        }
      }
      
      return {
        text: textParts.join('\n\n'),
        metadata: {
          sheetNames,
        },
      };
    } catch (error) {
      console.error('Spreadsheet extraction error:', error);
      throw new Error('Failed to extract text from spreadsheet');
    }
  }

  /**
   * Extract text from presentation files (PPTX, PPT)
   */
  private static async extractPresentationText(buffer: Buffer): Promise<ExtractedContent> {
    try {
      const text = await officeParser.parseOfficeAsync(buffer);
      return { text };
    } catch (error) {
      console.error('Presentation extraction error:', error);
      throw new Error('Failed to extract text from presentation');
    }
  }

  /**
   * Extract text from images using Azure Computer Vision OCR
   */
  private static async extractImageText(
    buffer: Buffer,
    mimeType: string,
    blobUrl?: string
  ): Promise<ExtractedContent> {
    try {
      const endpoint = env.AZURE_VISION_ENDPOINT;
      const key = env.AZURE_VISION_KEY;
      
      // Use the Read API for OCR
      const analyzeUrl = `${endpoint}/computervision/imageanalysis:analyze?api-version=2023-10-01&features=read`;
      
      // Convert Buffer to Uint8Array for fetch body
      const body = new Uint8Array(buffer);
      
      const response = await fetch(analyzeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': mimeType,
          'Ocp-Apim-Subscription-Key': key,
        },
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Azure Vision API error:', response.status, errorText);
        // Return empty text instead of throwing - image might just have no text
        console.log('Azure Vision API failed, returning empty text');
        return { text: '' };
      }

      const result = await response.json() as {
        readResult?: {
          blocks?: Array<{
            lines?: Array<{
              text?: string;
            }>;
          }>;
        };
      };
      
      // Extract text from the read result
      const textLines: string[] = [];
      if (result.readResult?.blocks) {
        for (const block of result.readResult.blocks) {
          if (block.lines) {
            for (const line of block.lines) {
              if (line.text) {
                textLines.push(line.text);
              }
            }
          }
        }
      }

      console.log(`  🖼️ OCR found ${textLines.length} lines of text`);
      return { text: textLines.join('\n') };
    } catch (error) {
      console.error('Image OCR extraction error:', error);
      // Return empty text instead of failing - allows graceful handling
      return { text: '' };
    }
  }

  /**
   * Extract text from other file types (JSON, XML, HTML)
   */
  private static async extractOtherText(
    buffer: Buffer,
    mimeType: string
  ): Promise<ExtractedContent> {
    const content = buffer.toString('utf-8');

    switch (mimeType) {
      case 'application/json':
        return this.extractJsonText(content);
      
      case 'text/xml':
      case 'application/xml':
        return this.extractXmlText(content);
      
      case 'text/html':
        return this.extractHtmlText(content);
      
      default:
        return { text: content };
    }
  }

  /**
   * Extract readable text from JSON
   */
  private static extractJsonText(content: string): ExtractedContent {
    try {
      const json = JSON.parse(content);
      const text = this.flattenJsonToText(json);
      return { text };
    } catch {
      // If not valid JSON, return as-is
      return { text: content };
    }
  }

  /**
   * Flatten JSON object to readable text
   */
  private static flattenJsonToText(obj: unknown, prefix = ''): string {
    const lines: string[] = [];
    
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        lines.push(this.flattenJsonToText(item, `${prefix}[${index}]`));
      });
    } else if (obj !== null && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        const newPrefix = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
          lines.push(this.flattenJsonToText(value, newPrefix));
        } else {
          lines.push(`${newPrefix}: ${value}`);
        }
      }
    } else {
      lines.push(`${prefix}: ${obj}`);
    }
    
    return lines.filter(l => l.trim()).join('\n');
  }

  /**
   * Extract readable text from XML
   */
  private static extractXmlText(content: string): ExtractedContent {
    const $ = cheerio.load(content, { xmlMode: true });
    
    // Remove script and style elements
    $('script, style').remove();
    
    // Get text content
    const text = $.root().text()
      .replace(/\s+/g, ' ')
      .trim();
    
    return { text };
  }

  /**
   * Extract readable text from HTML
   */
  private static extractHtmlText(content: string): ExtractedContent {
    const $ = cheerio.load(content);
    
    // Remove script, style, and other non-content elements
    $('script, style, nav, footer, header, aside').remove();
    
    // Get text content
    const text = $('body').text()
      .replace(/\s+/g, ' ')
      .trim();
    
    return { text };
  }

  /**
   * Clean and normalize extracted text
   */
  static cleanText(text: string): string {
    return text
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Remove non-printable characters except newlines
      .replace(/[^\x20-\x7E\n\t]/g, '')
      // Normalize multiple newlines
      .replace(/\n{3,}/g, '\n\n')
      // Trim
      .trim();
  }
}

