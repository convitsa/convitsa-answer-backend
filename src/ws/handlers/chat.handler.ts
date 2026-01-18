import { WebSocket } from 'ws';
import { Types } from 'mongoose';
import { RAGService } from '../../services/rag.service';
import { ChatService } from '../../services/chat.service';
import { CreditService } from '../../services/credit.service';
import { LeadService } from '../../services/lead.service';
import { UnansweredQuestionService } from '../../services/unanswered-question.service';
import { ChatSession, ChatMessage, Project } from '../../db/schemas';
import { getTierConfig } from '../../config/env';
import type {
  AuthenticatedWebSocket,
  WSChunkResponse,
  WSDoneResponse,
  WSErrorResponse,
  MarketingConfig,
} from '../../types';

// Store conversation history per session (in-memory for simplicity)
// In production, consider using Redis or the database
const conversationHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();

/**
 * Handle incoming chat message
 */
export async function handleChatMessage(
  ws: AuthenticatedWebSocket,
  content: string,
  websiteUrl: string,
  userId: string
): Promise<void> {
  // Validate WebSocket connection data
  if (!ws.sessionId || !ws.projectId || !ws.tier) {
    console.error('❌ Chat handler: Missing connection data', {
      hasSessionId: !!ws.sessionId,
      hasProjectId: !!ws.projectId,
      hasTier: !!ws.tier,
    });
    sendError(ws, 'Connection not properly initialized. Please reconnect.', 'CONNECTION_ERROR');
    return;
  }

  const sessionId = ws.sessionId.toString();
  const projectId = ws.projectId.toString();
  const tier = ws.tier;

  try {
    // For Pro tier, check if user has credits
    if (tier === 'pro') {
      const hasCredits = await CreditService.hasCredits(userId);
      if (!hasCredits) {
        sendError(ws, ChatService.getNoCreditsMessage(), 'NO_CREDITS');
        return;
      }
    }

    // For Free tier, check message limit per session
    if (tier === 'free') {
      const config = getTierConfig('free');
      const session = await ChatSession.findById(ws.sessionId).select('messageCount').lean();
      const currentMessageCount = session?.messageCount || 0;
      
      // messageCount counts both user and assistant messages, so divide by 2 for user message count
      const userMessageCount = Math.floor(currentMessageCount / 2);
      
      if (config.maxMessagesPerSession && userMessageCount >= config.maxMessagesPerSession) {
        sendError(
          ws,
          `You've reached the free tier limit of ${config.maxMessagesPerSession} messages per session. Please start a new session or upgrade to Pro for unlimited messages.`,
          'MESSAGE_LIMIT_REACHED'
        );
        return;
      }
    }

    // Get project's marketing config
    const project = await Project.findById(projectId).select('marketingConfig').lean();
    const marketingConfig = project?.marketingConfig as MarketingConfig | undefined;

    // Detect contact info from user message and create lead
    if (LeadService.hasContactInfo(content)) {
      const contactInfo = LeadService.extractContactInfo(content);
      console.log(`📞 Lead detected in chat:`, contactInfo);
      
      try {
        await LeadService.createLead({
          projectId: new Types.ObjectId(projectId),
          sessionId: new Types.ObjectId(sessionId),
          email: contactInfo.email,
          phone: contactInfo.phone,
          name: contactInfo.name,
          source: 'chat',
          metadata: {
            detectedFrom: 'chat_message',
          },
        });
        console.log(`✅ Lead created from chat message`);
      } catch (leadError) {
        console.error('Failed to create lead:', leadError);
        // Don't fail the chat if lead creation fails
      }
    }

    // Get or initialize conversation history
    let history = conversationHistory.get(sessionId) || [];

    // Retrieve relevant context using RAG
    console.log(`📝 Chat: Processing message for project ${projectId}`);
    const contexts = await RAGService.retrieveContext(projectId, content, tier);
    const contextText = RAGService.assembleContext(contexts);
    console.log(`📝 Chat: Context assembled, length=${contextText.length}, contexts=${contexts.length}`);

    // Build system prompt and messages (pass marketing config)
    const systemPrompt = RAGService.buildSystemPrompt(websiteUrl, tier as 'free' | 'pro', marketingConfig);
    const messages = RAGService.buildMessages(systemPrompt, contextText, content, history);
    
    // Check if this might be an unanswered question (no context found)
    const mightBeUnanswered = contexts.length === 0;

    // Stream the response
    let fullResponse = '';

    await ChatService.streamCompletion(messages, tier, {
      onChunk: (chunk) => {
        fullResponse += chunk;
        sendChunk(ws, chunk);
      },
      onDone: async (usage) => {
        // Use actual token counts from Azure OpenAI
        const { promptTokens, completionTokens, totalTokens } = usage;
        
        console.log(`📊 Token usage - Prompt: ${promptTokens}, Completion: ${completionTokens}, Total: ${totalTokens}`);

        // Save user message with actual prompt tokens (includes context)
        await ChatMessage.create({
          sessionId: ws.sessionId,
          role: 'user',
          content,
          tokenCount: promptTokens, // Actual tokens from Azure
          createdAt: new Date(),
        });

        // Save assistant message with actual completion tokens
        await ChatMessage.create({
          sessionId: ws.sessionId,
          role: 'assistant',
          content: fullResponse,
          tokenCount: completionTokens, // Actual tokens from Azure
          createdAt: new Date(),
        });

        // Update session stats with actual total tokens
        await ChatSession.updateOne(
          { _id: ws.sessionId },
          {
            $inc: {
              totalTokens: totalTokens,
              messageCount: 2, // user + assistant
            },
          }
        );

        // Update conversation history
        history.push({ role: 'user', content });
        history.push({ role: 'assistant', content: fullResponse });

        // Keep only last 20 messages in history
        if (history.length > 20) {
          history = history.slice(-20);
        }
        conversationHistory.set(sessionId, history);

        // For Pro tier, deduct credits based on actual token usage
        if (tier === 'pro' && totalTokens > 0) {
          await CreditService.deductCredits(userId, totalTokens, sessionId, 'Chat completion');
        }

        // Track unanswered questions if AI couldn't answer
        if (mightBeUnanswered || UnansweredQuestionService.isUnansweredResponse(fullResponse)) {
          try {
            await UnansweredQuestionService.trackQuestion(
              new Types.ObjectId(projectId),
              content,
              fullResponse,
              new Types.ObjectId(sessionId)
            );
            console.log(`📝 Tracked unanswered question: "${content.slice(0, 50)}..."`);
          } catch (trackError) {
            console.error('Failed to track unanswered question:', trackError);
          }
        }

        // Send done message with actual tokens
        sendDone(ws, totalTokens);
      },
      onError: (error) => {
        console.error('Chat completion error:', error);
        sendError(ws, 'Failed to generate response. Please try again.', 'COMPLETION_ERROR');
      },
    });
  } catch (error) {
    console.error('Chat handler error:', error);
    sendError(ws, 'An error occurred. Please try again.', 'HANDLER_ERROR');
  }
}

/**
 * Clean up conversation history when session ends
 */
export function cleanupSession(sessionId: string): void {
  conversationHistory.delete(sessionId);
}

/**
 * Send chunk to client
 */
function sendChunk(ws: WebSocket, content: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const response: WSChunkResponse = {
    type: 'chunk',
    content,
  };
  ws.send(JSON.stringify(response));
}

/**
 * Send done message to client
 */
function sendDone(ws: WebSocket, tokensUsed: number): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const response: WSDoneResponse = {
    type: 'done',
    tokensUsed,
  };
  ws.send(JSON.stringify(response));
}

/**
 * Send error to client
 */
function sendError(ws: WebSocket, message: string, code: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  const response: WSErrorResponse = {
    type: 'error',
    message,
    code,
  };
  ws.send(JSON.stringify(response));
}

