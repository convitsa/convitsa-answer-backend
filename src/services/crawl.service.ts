import FirecrawlApp from '@mendable/firecrawl-js';
import { env } from '../config/env';
import { ProjectService } from './project.service';
import { EmbeddingService } from './embedding.service';
import { RAGService } from './rag.service';
import { EmailService } from './email.service';
import { Page, Project, User } from '../db/schemas';
import { Types } from 'mongoose';
import { chunkText, cleanText } from '../utils/helpers';
import type { CrawledPage, ContentChunk } from '../types';

const firecrawl = new FirecrawlApp({ apiKey: env.FIRECRAWL_API_KEY });

// Chunk configuration
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// Crawl configuration (from env)
const getMaxPages = () => env.CRAWL_MAX_PAGES;
const getCrawlTimeoutMs = () => env.CRAWL_TIMEOUT_SECONDS * 1000;

export class CrawlService {
  /**
   * Start crawling a website
   * This is an async operation that updates project status
   */
  static async startCrawl(projectId: string, websiteUrl: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Update status to pending
      await ProjectService.updateCrawlStatus(projectId, 'pending');

      console.log(`\n${'='.repeat(60)}`);
      console.log(`🕷️  CRAWL STARTED`);
      console.log(`${'='.repeat(60)}`);
      console.log(`📌 Project: ${projectId}`);
      console.log(`🌐 URL: ${websiteUrl}`);
      console.log(`⏰ Started at: ${new Date().toISOString()}`);
      console.log(`${'='.repeat(60)}\n`);

      // Update status to crawling
      await ProjectService.updateCrawlStatus(projectId, 'crawling');

      // Crawl the website using Firecrawl
      console.log(`🔄 [Step 1/4] Calling Firecrawl API...`);
      const crawlStartTime = Date.now();
      const crawlResult = await this.crawlWebsite(websiteUrl);
      const crawlDuration = ((Date.now() - crawlStartTime) / 1000).toFixed(2);
      console.log(`✅ [Step 1/4] Firecrawl completed in ${crawlDuration}s - Found ${crawlResult.length} pages`);

      if (crawlResult.length === 0) {
        console.log(`❌ No pages found, marking as failed`);
        await ProjectService.updateCrawlStatus(projectId, 'failed', 'No pages found');
        return;
      }

      // List pages found
      console.log(`\n📄 Pages found:`);
      crawlResult.forEach((page, i) => {
        console.log(`   ${i + 1}. ${page.title} (${page.url})`);
      });
      console.log('');

      // Delete existing pages for this project
      console.log(`🔄 [Step 2/4] Deleting old pages from database...`);
      const deleteResult = await Page.deleteMany({ projectId: new Types.ObjectId(projectId) });
      console.log(`✅ [Step 2/4] Deleted ${deleteResult.deletedCount} old pages\n`);

      // Process each page
      console.log(`🔄 [Step 3/4] Processing pages (chunking + embedding)...`);
      let totalChunks = 0;
      for (let i = 0; i < crawlResult.length; i++) {
        const page = crawlResult[i];
        const pageStartTime = Date.now();
        try {
          console.log(`   📝 Processing page ${i + 1}/${crawlResult.length}: ${page.title}...`);
          const chunks = await this.processPage(projectId, page);
          const pageDuration = ((Date.now() - pageStartTime) / 1000).toFixed(2);
          totalChunks += chunks;
          console.log(`   ✅ Page ${i + 1}/${crawlResult.length}: ${chunks} chunks created (${pageDuration}s)`);
        } catch (error) {
          console.error(`   ❌ Page ${i + 1}/${crawlResult.length} failed:`, error);
          // Continue with other pages
        }
      }

      console.log(`\n✅ [Step 3/4] All pages processed: ${totalChunks} total chunks\n`);

      // Invalidate RAG cache for this project
      RAGService.invalidateCache(projectId);

      // Update status to completed
      console.log(`🔄 [Step 4/4] Updating project status...`);
      await ProjectService.updateCrawlStatus(projectId, 'completed');
      console.log(`✅ [Step 4/4] Status updated to 'completed'\n`);

      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`${'='.repeat(60)}`);
      console.log(`🎉 CRAWL COMPLETED SUCCESSFULLY`);
      console.log(`${'='.repeat(60)}`);
      console.log(`📊 Summary:`);
      console.log(`   • Pages crawled: ${crawlResult.length}`);
      console.log(`   • Chunks indexed: ${totalChunks}`);
      console.log(`   • Total time: ${totalDuration}s`);
      console.log(`${'='.repeat(60)}\n`);

      // Send crawl completed email (non-blocking)
      this.sendCrawlEmail(projectId, true, crawlResult.length).catch((err) => {
        console.error('Failed to send crawl completed email:', err);
      });

    } catch (error) {
      const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.error(`\n${'='.repeat(60)}`);
      console.error(`❌ CRAWL FAILED after ${totalDuration}s`);
      console.error(`${'='.repeat(60)}`);
      console.error(`Error:`, error);
      console.error(`${'='.repeat(60)}\n`);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await ProjectService.updateCrawlStatus(projectId, 'failed', errorMessage);

      // Send crawl failed email (non-blocking)
      this.sendCrawlEmail(projectId, false, 0, errorMessage).catch((err) => {
        console.error('Failed to send crawl failed email:', err);
      });
    }
  }

  /**
   * Crawl website using Firecrawl API
   */
  private static async crawlWebsite(url: string): Promise<CrawledPage[]> {
    const maxPages = getMaxPages();
    const timeoutMs = getCrawlTimeoutMs();
    
    console.log(`   🌐 Firecrawl: Initiating crawl for ${url}`);
    console.log(`   ⚙️  Firecrawl: Max pages = ${maxPages}, Timeout = ${timeoutMs / 1000}s`);
    console.log(`   ⏳ Firecrawl: Waiting for response...`);
    
    // Start a progress indicator
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    let isCompleted = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      // Progress logger
      progressInterval = setInterval(() => {
        if (!isCompleted) {
          console.log(`   ⏳ Firecrawl: Still waiting... (this is normal for larger sites)`);
        }
      }, 15000);

      // Create crawl promise
      const crawlPromise = (async () => {
        try {
          const result = await firecrawl.crawlUrl(url, {
            limit: maxPages,
            scrapeOptions: {
              formats: ['markdown'],
            },
          });
          return { success: true, data: result };
        } catch (err) {
          return { success: false, error: err };
        }
      })();

      // Create timeout promise
      const timeoutPromise = new Promise<{ success: false; error: Error }>((resolve) => {
        timeoutId = setTimeout(() => {
          resolve({ success: false, error: new Error(`Firecrawl timeout after ${timeoutMs / 1000} seconds`) });
        }, timeoutMs);
      });

      // Race between crawl and timeout
      const result = await Promise.race([crawlPromise, timeoutPromise]);
      
      // Mark as completed to stop progress logs
      isCompleted = true;

      // Clear timeout if crawl finished first
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      if (!result.success) {
        throw result.error;
      }

      const response = result.data;
      console.log(`   📥 Firecrawl: Response received, success=${response?.success}`);

      if (!response?.success) {
        throw new Error('Firecrawl returned unsuccessful response');
      }

      const pages: CrawledPage[] = [];

      // Handle the crawl response
      if (response.data && Array.isArray(response.data)) {
        console.log(`   📊 Firecrawl: Processing ${response.data.length} documents...`);
        
        for (const doc of response.data) {
          if (doc.markdown && doc.markdown.trim()) {
            pages.push({
              url: doc.url || (doc.metadata as Record<string, unknown>)?.sourceURL as string || url,
              title: doc.metadata?.title || this.extractTitle(doc.markdown) || 'Untitled',
              markdown: doc.markdown,
            });
          } else {
            console.log(`   ⚠️  Firecrawl: Skipping empty document`);
          }
        }
      }

      console.log(`   ✅ Firecrawl: Extracted ${pages.length} valid pages with content`);
      return pages;

    } catch (error) {
      isCompleted = true;
      console.error('   ❌ Firecrawl error:', error);
      throw new Error(`Failed to crawl website: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Always cleanup
      if (progressInterval) {
        clearInterval(progressInterval);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Process a single page: chunk and embed
   */
  private static async processPage(projectId: string, page: CrawledPage): Promise<number> {
    // Clean the content
    const cleanedContent = cleanText(page.markdown);
    console.log(`      📄 Content: ${cleanedContent.length} chars`);

    if (cleanedContent.length < 50) {
      console.log(`      ⚠️  Skipping (content too short)`);
      return 0;
    }

    // Chunk the content
    const chunks = chunkText(cleanedContent, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(`      ✂️  Chunks: ${chunks.length} (size=${CHUNK_SIZE}, overlap=${CHUNK_OVERLAP})`);

    // Generate embeddings for all chunks
    console.log(`      🧠 Generating embeddings for ${chunks.length} chunks...`);
    const embeddingStartTime = Date.now();
    const embeddings = await EmbeddingService.generateEmbeddings(chunks);
    const embeddingDuration = ((Date.now() - embeddingStartTime) / 1000).toFixed(2);
    console.log(`      🧠 Embeddings generated in ${embeddingDuration}s`);

    // Store each chunk with its embedding
    const pageDocuments = chunks.map((content, index) => ({
      projectId: new Types.ObjectId(projectId),
      url: page.url,
      title: page.title,
      content,
      embedding: embeddings[index],
      chunkIndex: index,
      crawledAt: new Date(),
    }));

    // Bulk insert
    console.log(`      💾 Saving ${pageDocuments.length} chunks to database...`);
    await Page.insertMany(pageDocuments);
    console.log(`      💾 Saved successfully`);

    return chunks.length;
  }

  /**
   * Extract title from markdown content
   */
  private static extractTitle(markdown: string): string {
    // Try to find first h1
    const h1Match = markdown.match(/^#\s+(.+)$/m);
    if (h1Match) {
      return h1Match[1].trim();
    }

    // Try to find first heading
    const headingMatch = markdown.match(/^#+\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1].trim();
    }

    // Use first line as fallback
    const firstLine = markdown.split('\n')[0]?.trim();
    if (firstLine && firstLine.length > 0 && firstLine.length < 100) {
      return firstLine;
    }

    return 'Untitled';
  }

  /**
   * Scrape a single page (for manual add)
   */
  static async scrapeSinglePage(url: string): Promise<CrawledPage | null> {
    try {
      const response = await firecrawl.scrapeUrl(url, {
        formats: ['markdown'],
      });

      if (!response.success || !response.markdown) {
        return null;
      }

      return {
        url,
        title: response.metadata?.title || this.extractTitle(response.markdown) || 'Untitled',
        markdown: response.markdown,
      };
    } catch (error) {
      console.error('Scrape error:', error);
      return null;
    }
  }

  /**
   * Send crawl email notification
   */
  private static async sendCrawlEmail(
    projectId: string,
    success: boolean,
    pagesCount: number = 0,
    errorMessage?: string
  ): Promise<void> {
    try {
      // Get project and user info
      const project = await Project.findById(projectId).lean();
      if (!project) return;

      const user = await User.findById(project.userId).select('email').lean();
      if (!user?.email) return;

      if (success) {
        await EmailService.sendCrawlCompletedEmail(user.email, project.name, pagesCount);
        console.log(`✉️ Sent crawl completed email to ${user.email}`);
      } else {
        await EmailService.sendCrawlFailedEmail(user.email, project.name, errorMessage || 'Unknown error');
        console.log(`✉️ Sent crawl failed email to ${user.email}`);
      }
    } catch (error) {
      console.error('Error sending crawl email:', error);
    }
  }
}

