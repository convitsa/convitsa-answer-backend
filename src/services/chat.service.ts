import { AzureOpenAI } from 'openai';
import { env, getTierConfig } from '../config/env';
import type { ChatTier } from '../types';

// Initialize Azure OpenAI client for chat
const client = new AzureOpenAI({
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiKey: env.AZURE_OPENAI_API_KEY,
  apiVersion: '2024-08-01-preview',
});

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

export class ChatService {
  /**
   * Generate chat completion with streaming
   */
  static async streamCompletion(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    tier: ChatTier,
    callbacks: StreamCallbacks
  ): Promise<void> {
    const config = getTierConfig(tier);

    try {
      const stream = await client.chat.completions.create({
        model: env.AZURE_OPENAI_CHAT_DEPLOYMENT,
        messages,
        max_tokens: config.maxTokens,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
      });

      let usage: TokenUsage = {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      };

      for await (const chunk of stream) {
        // Check for content
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          callbacks.onChunk(delta.content);
        }

        // Check for usage (comes at the end when stream_options.include_usage is true)
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens,
            completionTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
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
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    tier: ChatTier
  ): Promise<{ content: string; tokens: number }> {
    const config = getTierConfig(tier);

    try {
      const response = await client.chat.completions.create({
        model: env.AZURE_OPENAI_CHAT_DEPLOYMENT,
        messages,
        max_tokens: config.maxTokens,
        temperature: 0.7,
      });

      return {
        content: response.choices[0]?.message?.content || '',
        tokens: response.usage?.total_tokens || 0,
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
   * More accurate counting would use tiktoken
   */
  static estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}

