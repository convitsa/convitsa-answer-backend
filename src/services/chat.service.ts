import OpenAI from 'openai';
import { env, getTierConfig } from '../config/env';
import type { ChatTier } from '../types';

// DeepSeek exposes an OpenAI-compatible API, so the standard OpenAI SDK works
// by just pointing it at DeepSeek's base URL.
const client = new OpenAI({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL,
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

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

// DeepSeek enables "thinking" by default, which bills reasoning tokens as
// output and ignores temperature. This is a short customer-support chat, so
// thinking is disabled. `thinking` is a DeepSeek-specific body field the
// OpenAI SDK's types don't know about, but the SDK forwards it as-is.
const deepseekExtras = { thinking: { type: 'disabled' } };

// DeepSeek's docs warn that JSON-mode responses may occasionally come back
// empty. Nothing has been streamed to the caller yet in that case, so retrying
// once is safe.
const MAX_ATTEMPTS = 2;

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

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const stream = await client.chat.completions.create({
          model: env.DEEPSEEK_CHAT_MODEL,
          messages,
          max_tokens: config.maxTokens,
          temperature: 0.7,
          stream: true,
          stream_options: { include_usage: true },
          response_format: { type: 'json_object' },
          ...deepseekExtras,
        } as OpenAI.Chat.ChatCompletionCreateParamsStreaming);

        let usage: TokenUsage = {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        };
        let output = '';

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) {
            output += delta.content;
            callbacks.onChunk(delta.content);
          }

          // Usage arrives in the final chunk when include_usage is set
          if (chunk.usage) {
            usage = {
              promptTokens: chunk.usage.prompt_tokens,
              completionTokens: chunk.usage.completion_tokens,
              totalTokens: chunk.usage.total_tokens,
            };
          }
        }

        if (!output && attempt < MAX_ATTEMPTS) {
          console.warn('DeepSeek returned empty content, retrying once');
          continue;
        }

        // Usage drives token billing; never let a missing usage block bill zero.
        if (usage.totalTokens === 0) {
          const promptTokens = this.estimateTokens(messages.map((m) => m.content).join('\n'));
          const completionTokens = this.estimateTokens(output);
          usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
        }

        callbacks.onDone(usage);
        return;
      }
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

    try {
      const response = await client.chat.completions.create({
        model: env.DEEPSEEK_CHAT_MODEL,
        messages,
        max_tokens: config.maxTokens,
        temperature: 0.7,
        ...deepseekExtras,
      } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);

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
   */
  static estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }
}
