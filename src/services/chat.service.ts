import { GoogleGenAI } from '@google/genai';
import { env, getTierConfig } from '../config/env';
import type { ChatTier } from '../types';

// Initialize Gemini client for chat
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

export interface TokenUsage {
  promptTokens: number;      // Input tokens (user message + context)
  completionTokens: number;  // Output tokens (assistant response)
  totalTokens: number;       // Total
}

export interface StreamCallbacks {
  onChunk: (chunk: string) => void;
  onDone: (usage: TokenUsage) => void;
  onError: (error: Error) => void;
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/**
 * Split an OpenAI-style message array into a Gemini system instruction + contents.
 * Keeps the rest of the codebase (RAGService, chat handler) unaware of the provider.
 */
function toGeminiRequest(messages: ChatMessage[]): {
  systemInstruction?: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
} {
  const systemMessages = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    }));

  return {
    systemInstruction: systemMessages.length > 0 ? systemMessages.join('\n\n') : undefined,
    contents,
  };
}

export class ChatService {
  /**
   * Generate chat completion with streaming
   */
  static async streamCompletion(
    messages: ChatMessage[],
    tier: ChatTier,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const config = getTierConfig(tier);
    const { systemInstruction, contents } = toGeminiRequest(messages);

    try {
      const stream = await ai.models.generateContentStream({
        model: env.GEMINI_CHAT_MODEL,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: config.maxTokens,
          temperature: 0.7,
          responseMimeType: 'application/json',
        },
      });

      let usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          callbacks.onChunk(text);
        }

        if (chunk.usageMetadata) {
          usage = {
            promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          };
        }
      }

      callbacks.onDone(usage);
    } catch (error) {
      console.error('Chat completion error:', error);
      callbacks.onError(error instanceof Error ? error : new Error('Chat completion failed'));
    }
  }

  /**
   * Generate non-streaming completion (for simple responses)
   */
  static async generateCompletion(
    messages: ChatMessage[],
    tier: ChatTier
  ): Promise<{ content: string; tokens: number }> {
    const config = getTierConfig(tier);
    const { systemInstruction, contents } = toGeminiRequest(messages);

    try {
      const response = await ai.models.generateContent({
        model: env.GEMINI_CHAT_MODEL,
        contents,
        config: {
          systemInstruction,
          maxOutputTokens: config.maxTokens,
          temperature: 0.7,
        },
      });

      return {
        content: response.text || '',
        tokens: response.usageMetadata?.totalTokenCount || 0,
      };
    } catch (error) {
      console.error('Chat completion error:', error);
      throw new Error('Failed to generate response');
    }
  }

  /**
   * Generate a friendly error message for rate limit exceeded
   */
  static getFreeTierLimitMessage(): string {
    return "I'm sorry, but you've reached the free usage limit for this session. To continue chatting, please try again later or consider upgrading to Pro for unlimited conversations.";
  }

  /**
   * Generate a message when Pro user has no credits
   */
  static getNoCreditsMessage(): string {
    return "I'd love to help, but your credit balance has run out. Please add more credits to your account to continue using the Pro features.";
  }

  /**
   * Generate a message when free tier message limit is reached
   */
  static getMessageLimitMessage(limit: number): string {
    return `You've reached the free tier limit of ${limit} messages for this session. Start a new conversation or upgrade to Pro for unlimited messages!`;
  }

  /**
   * Estimate token count for messages (rough estimate)
   */
  static estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}
