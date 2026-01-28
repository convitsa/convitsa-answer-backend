import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import { Types } from 'mongoose';
import { randomUUID } from 'crypto';
import { ApiKeyService } from '../services/project.service';
import { SubscriptionService } from '../services/subscription.service';
import { LostLeadService } from '../services/lost-lead.service';
import { RAGService } from '../services/rag.service';
import { ChatSession, ChatMessage, Lead, Project } from '../db/schemas';
import {
  checkRateLimit,
  incrementConnections,
  decrementConnections,
  getConnectionCount,
} from '../db/redis';
import { env, getTierConfig } from '../config/env';
import { parseWSQuery } from '../utils/helpers';
import { handleChatMessage } from './handlers/chat.handler';
import type { AuthenticatedWebSocket, ChatTier, WSClientMessage, WSErrorResponse, WSReadyResponse, IChatMessage } from '../types';

const HEARTBEAT_INTERVAL = 30000; // 30 seconds

export function createWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ 
    server, 
    path: '/chat',
  });

  console.log('🔌 WebSocket server initialized');

  // Heartbeat interval to detect dead connections
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      const authWs = ws as AuthenticatedWebSocket;
      if (!authWs.isAlive) {
        console.log('Terminating dead connection');
        return ws.terminate();
      }
      authWs.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', async (ws: WebSocket, req: IncomingMessage) => {
    const authWs = ws as AuthenticatedWebSocket;
    authWs.isAlive = true;

    // Parse query parameters
    const url = req.url || '';
    const { token, visitorId: providedVisitorId, userAgent, referrer, pageUrl } = parseWSQuery(url);

    // Generate visitor ID if not provided
    const visitorId = providedVisitorId || randomUUID();

    // Validate required parameters
    if (!token) {
      sendError(ws, 'API key is required', 'MISSING_API_KEY');
      ws.close(4001, 'Missing API key');
      return;
    }

    // Validate API key first (required for all other operations)
    const keyResult = await ApiKeyService.validateApiKey(token);
    if (!keyResult.success) {
      sendError(ws, 'Invalid or inactive API key', 'INVALID_API_KEY');
      ws.close(4002, 'Invalid API key');
      return;
    }

    const { apiKeyId, projectId, userId } = keyResult.data!;
    const apiKeyIdStr = apiKeyId.toString();

    // Get subscription - must exist
    let subscription;
    try {
      subscription = await SubscriptionService.getSubscription(userId.toString());
    } catch (error) {
      console.error(`❌ Subscription lookup failed for userId=${userId}:`, error);
      sendError(ws, 'No active subscription found for this account', 'NO_SUBSCRIPTION');
      ws.close(4005, 'No subscription');
      return;
    }

    // Run parallel operations to speed up initialization
    const [connectionCount, project] = await Promise.all([
      getConnectionCount(apiKeyIdStr),
      Project.findById(projectId).lean(),
    ]);

    const tier: ChatTier = subscription.tier as ChatTier;

    console.log(`🎫 User ${userId} subscription: tier=${tier}, status=${subscription.status}, dodoSubId=${subscription.dodoSubscriptionId || 'none'}`);

    // Check connection limit
    if (connectionCount >= env.MAX_WS_CONNECTIONS_PER_KEY) {
      sendError(ws, 'Maximum connections reached for this API key', 'CONNECTION_LIMIT');
      ws.close(4003, 'Connection limit reached');
      return;
    }

    // Validate project exists
    if (!project) {
      sendError(ws, 'Project not found', 'PROJECT_NOT_FOUND');
      ws.close(4004, 'Project not found');
      return;
    }

    // Increment connection count and create session in parallel
    const [, session] = await Promise.all([
      incrementConnections(apiKeyIdStr),
      ChatSession.create({
        projectId,
        apiKeyId,
        tier,
        visitorId,
        startedAt: new Date(),
        totalTokens: 0,
        messageCount: 0,
        leadCaptured: false,
        metadata: {
          userAgent: userAgent || req.headers['user-agent'],
          referrer,
          pageUrl,
        },
      }),
    ]);

    // Attach session info to WebSocket
    authWs.apiKeyId = apiKeyId;
    authWs.projectId = projectId;
    authWs.tier = tier;
    authWs.sessionId = session._id as Types.ObjectId;
    authWs.visitorId = visitorId;

    console.log(`🔗 New WS connection: project=${projectId}, tier=${tier}, session=${session._id}, visitor=${visitorId}`);

    // Send ready message to client so they know connection is initialized
    sendReady(ws, session._id.toString(), tier, visitorId);

    // Handle pong for heartbeat
    ws.on('pong', () => {
      authWs.isAlive = true;
    });

    // Handle messages
    ws.on('message', async (data) => {
      try {
        // Parse message
        let message: WSClientMessage;
        try {
          message = JSON.parse(data.toString());
        } catch {
          sendError(ws, 'Invalid JSON message', 'INVALID_JSON');
          return;
        }

        // Validate message type
        if (message.type !== 'message' || typeof message.content !== 'string') {
          sendError(ws, 'Invalid message format', 'INVALID_FORMAT');
          return;
        }

        // Check message size
        if (message.content.length > 4096) {
          sendError(ws, 'Message too long (max 4096 characters)', 'MESSAGE_TOO_LONG');
          return;
        }

        // Check rate limit
        const config = getTierConfig(tier);
        const rateLimitResult = await checkRateLimit(
          `chat:${apiKeyId.toString()}`,
          config.messagesPerMin,
          60
        );

        if (!rateLimitResult.allowed) {
          sendError(
            ws,
            tier === 'free'
              ? 'Free tier rate limit reached. Please wait a moment before sending more messages.'
              : 'Rate limit reached. Please slow down.',
            'RATE_LIMIT'
          );
          return;
        }

        // Process the message
        await handleChatMessage(authWs, message.content, project.websiteUrl, userId.toString());
      } catch (error) {
        console.error('Message handling error:', error);
        sendError(ws, 'Internal error processing message', 'INTERNAL_ERROR');
      }
    });

    // Handle close
    ws.on('close', async () => {
      console.log(`🔌 WS connection closed: session=${authWs.sessionId}`);

      // Decrement connection count
      await decrementConnections(apiKeyId.toString());

      // End the session
      await ChatSession.updateOne(
        { _id: authWs.sessionId },
        { $set: { endedAt: new Date() } }
      );

      // Process lost lead if no lead was captured (Pro/Business tiers only)
      console.log(`🔍 Lost lead check: tier=${tier}, visitorId=${authWs.visitorId ? 'yes' : 'no'}`);
      
      if (tier === 'free') {
        console.log(`⏭️ Skipping lost lead processing: Free tier (upgrade to Pro/Business for Lost Lead Intelligence)`);
      } else if (!authWs.visitorId) {
        console.log(`⏭️ Skipping lost lead processing: No visitorId`);
      }
      
      if (tier !== 'free' && authWs.visitorId) {
        try {
          // Check if a lead was captured for this session
          const leadExists = await Lead.findOne({ sessionId: authWs.sessionId });
          
          if (!leadExists) {
            // Get messages for intent scoring
            const messages = await ChatMessage.find({ sessionId: authWs.sessionId })
              .sort({ createdAt: 1 })
              .lean() as IChatMessage[];

            // Only process if there were actual messages
            if (messages.length >= 2) {
              console.log(`🔍 Processing lost lead for visitor=${authWs.visitorId}, messages=${messages.length}`);
              
              // Score intent using AI
              const intentResult = await RAGService.scoreSessionIntent(messages);
              
              console.log(`📊 Intent score for visitor=${authWs.visitorId}: ${intentResult.score} (${intentResult.signals.join(', ')})`);
              
              // Update lost lead record
              await LostLeadService.updateFromSession(authWs.sessionId, intentResult);
            } else {
              console.log(`⏭️ Skipping lost lead processing: Only ${messages.length} messages (need at least 2)`);
            }
          } else {
            // Mark session as having captured a lead
            await ChatSession.updateOne(
              { _id: authWs.sessionId },
              { $set: { leadCaptured: true } }
            );
          }
        } catch (error) {
          console.error('Lost lead processing error:', error);
        }
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
}

/**
 * Send ready message to client when connection is initialized
 */
function sendReady(ws: WebSocket, sessionId: string, tier: ChatTier, visitorId: string): void {
  const response: WSReadyResponse = {
    type: 'ready',
    sessionId,
    tier,
    visitorId,
  };
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
  }
}

/**
 * Send error message to client
 */
function sendError(ws: WebSocket, message: string, code: string): void {
  const response: WSErrorResponse = {
    type: 'error',
    message,
    code,
  };
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(response));
  }
}


