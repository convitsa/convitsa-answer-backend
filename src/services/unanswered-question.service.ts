import { Types } from 'mongoose';
import { UnansweredQuestion, DocumentChunk, Project } from '../db/schemas';
import type { IUnansweredQuestion, UnansweredQuestionStatus, MarketingConfig } from '../types';
import { EmbeddingService } from './embedding.service';
import { chunkText } from '../utils/helpers';

export interface UnansweredQuestionFilters {
  status?: UnansweredQuestionStatus;
  startDate?: Date;
  endDate?: Date;
}

export class UnansweredQuestionService {
  // Phrases that indicate AI couldn't answer
  private static readonly UNANSWERED_INDICATORS = [
    "i don't have information",
    "i don't have specific information",
    "i'm not sure about",
    "i cannot find information",
    "i don't have details",
    "that topic isn't covered",
    "i couldn't find",
    "no information available",
    "i'm unable to find",
    "this isn't mentioned in",
    "not covered in my knowledge",
    "i don't have data about",
  ];

  /**
   * Check if an AI response indicates it couldn't answer
   */
  static isUnansweredResponse(response: string): boolean {
    const lowerResponse = response.toLowerCase();
    return this.UNANSWERED_INDICATORS.some((indicator) =>
      lowerResponse.includes(indicator)
    );
  }

  /**
   * Track an unanswered question
   */
  static async trackQuestion(
    projectId: Types.ObjectId,
    question: string,
    aiResponse: string,
    sessionId?: Types.ObjectId
  ): Promise<IUnansweredQuestion> {
    // Check for similar existing question (avoid duplicates)
    const existing = await UnansweredQuestion.findOne({
      projectId,
      question: { $regex: new RegExp(question.slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      status: 'pending',
    });

    if (existing) {
      return existing.toObject() as IUnansweredQuestion;
    }

    const unansweredQuestion = new UnansweredQuestion({
      projectId,
      sessionId,
      question,
      aiResponse,
      status: 'pending',
      createdAt: new Date(),
    });

    await unansweredQuestion.save();
    console.log(`📝 Tracked unanswered question: "${question.slice(0, 50)}..."`);

    return unansweredQuestion.toObject() as IUnansweredQuestion;
  }

  /**
   * Get unanswered questions for a project
   */
  static async getQuestions(
    projectId: Types.ObjectId,
    filters: UnansweredQuestionFilters = {},
    page: number = 1,
    limit: number = 20
  ): Promise<{ questions: IUnansweredQuestion[]; total: number; pages: number }> {
    const query: any = { projectId };

    if (filters.status) query.status = filters.status;
    if (filters.startDate || filters.endDate) {
      query.createdAt = {};
      if (filters.startDate) query.createdAt.$gte = filters.startDate;
      if (filters.endDate) query.createdAt.$lte = filters.endDate;
    }

    const total = await UnansweredQuestion.countDocuments(query);
    const pages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const questions = await UnansweredQuestion.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    return { questions: questions as IUnansweredQuestion[], total, pages };
  }

  /**
   * Get a single question by ID
   */
  static async getQuestionById(questionId: Types.ObjectId): Promise<IUnansweredQuestion | null> {
    const question = await UnansweredQuestion.findById(questionId).lean();
    return question as IUnansweredQuestion | null;
  }

  /**
   * Answer a question and add it to the knowledge base
   */
  static async answerQuestion(
    questionId: Types.ObjectId,
    businessAnswer: string,
    answeredBy: Types.ObjectId
  ): Promise<IUnansweredQuestion | null> {
    const question = await UnansweredQuestion.findById(questionId);
    if (!question) return null;

    // Update the question
    question.businessAnswer = businessAnswer;
    question.answeredBy = answeredBy;
    question.answeredAt = new Date();
    question.status = 'answered';
    await question.save();

    // Create knowledge base entry from the Q&A
    const knowledgeContent = `Q: ${question.question}\nA: ${businessAnswer}`;
    
    // Chunk the content (usually small, so likely 1 chunk)
    const chunks = chunkText(knowledgeContent, 500, 50);

    // Generate embeddings and store
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];
      const embedding = await EmbeddingService.generateEmbedding(chunkContent);
      
      await DocumentChunk.create({
        documentId: questionId, // Use question ID as document reference
        projectId: question.projectId,
        content: chunkContent,
        chunkIndex: i,
        embedding,
        metadata: {
          fileName: 'FAQ - User Questions',
          pageNumber: undefined,
          sheetName: undefined,
        },
      });
    }

    console.log(`✅ Answered question and added to knowledge base: "${question.question.slice(0, 50)}..."`);

    return question.toObject() as IUnansweredQuestion;
  }

  /**
   * Mark a question as ignored
   */
  static async ignoreQuestion(questionId: Types.ObjectId): Promise<IUnansweredQuestion | null> {
    const question = await UnansweredQuestion.findByIdAndUpdate(
      questionId,
      { $set: { status: 'ignored' } },
      { new: true }
    ).lean();

    return question as IUnansweredQuestion | null;
  }

  /**
   * Delete a question
   */
  static async deleteQuestion(questionId: Types.ObjectId): Promise<boolean> {
    // Also delete any associated chunks
    await DocumentChunk.deleteMany({ documentId: questionId });
    
    const result = await UnansweredQuestion.findByIdAndDelete(questionId);
    return !!result;
  }

  /**
   * Get statistics for unanswered questions
   */
  static async getStats(projectId: Types.ObjectId): Promise<{
    total: number;
    pending: number;
    answered: number;
    ignored: number;
    last7Days: number;
  }> {
    const total = await UnansweredQuestion.countDocuments({ projectId });
    const pending = await UnansweredQuestion.countDocuments({ projectId, status: 'pending' });
    const answered = await UnansweredQuestion.countDocuments({ projectId, status: 'answered' });
    const ignored = await UnansweredQuestion.countDocuments({ projectId, status: 'ignored' });

    const now = new Date();
    const last7Days = await UnansweredQuestion.countDocuments({
      projectId,
      status: 'pending',
      createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
    });

    return { total, pending, answered, ignored, last7Days };
  }

  /**
   * Build fallback response with contact options
   */
  static buildFallbackResponse(marketingConfig?: MarketingConfig, websiteUrl?: string): string {
    if (!marketingConfig) {
      return "I don't have specific information about that topic. Please contact the team directly for assistance.";
    }

    const { fallbackBehavior, calendlyUrl, contactOptions } = marketingConfig;
    let response = "I don't have specific information about that topic yet. However, I'd love to help you further!\n\n";

    const options: string[] = [];

    // Add Calendly option
    if ((fallbackBehavior === 'book_meeting' || fallbackBehavior === 'both') && calendlyUrl) {
      options.push(`📅 **Book a meeting**: ${calendlyUrl}`);
    }

    // Add contact options
    if ((fallbackBehavior === 'show_contacts' || fallbackBehavior === 'both') && contactOptions) {
      if (contactOptions.whatsapp) {
        const waLink = contactOptions.whatsapp.startsWith('http') 
          ? contactOptions.whatsapp 
          : `https://wa.me/${contactOptions.whatsapp.replace(/[^0-9]/g, '')}`;
        options.push(`💬 **WhatsApp**: ${waLink}`);
      }
      if (contactOptions.instagram) {
        const igLink = contactOptions.instagram.startsWith('http')
          ? contactOptions.instagram
          : `https://instagram.com/${contactOptions.instagram.replace('@', '')}`;
        options.push(`📸 **Instagram**: ${igLink}`);
      }
      if (contactOptions.telegram) {
        options.push(`✈️ **Telegram**: ${contactOptions.telegram}`);
      }
      if (contactOptions.email) {
        options.push(`📧 **Email**: ${contactOptions.email}`);
      }
      if (contactOptions.phone) {
        options.push(`📞 **Phone**: ${contactOptions.phone}`);
      }
      if (contactOptions.custom) {
        for (const custom of contactOptions.custom) {
          options.push(`🔗 **${custom.label}**: ${custom.url}`);
        }
      }
    }

    if (options.length > 0) {
      response += "You can reach us through:\n\n" + options.join('\n') + "\n\nOur team will be happy to assist you personally!";
    } else {
      response += "Please visit our website for more information or contact us directly.";
    }

    return response;
  }
}
