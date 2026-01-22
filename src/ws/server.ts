import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import { Types } from 'mongoose';
import { ApiKeyService } from '../services/project.service';
import { SubscriptionService } from '../services/subscription.service';
import { ChatSession, Project } from '../db/schemas';
import {
  checkRateLimit,
  incrementConnections,
  decrementConnections,
  getConnectionCount,
} from '../db/redis';
import { env, getTierConfig } from '../config/env';
import { parseWSQuery } from '../utils/helpers';
import { handleChatMessage } from './handlers/chat.handler';
import type { AuthenticatedWebSocket, ChatTier, WSClientMessage, WSErrorResponse } from '../types';

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
    const { token } = parseWSQuery(url);

    // Validate required parameters
    if (!token) {
      sendError(ws, 'API key is required', 'MISSING_API_KEY');
      ws.close(4001, 'Missing API key');
      return;
    }

    // Validate API key
    const keyResult = await ApiKeyService.validateApiKey(token);
    if (!keyResult.success) {
      sendError(ws, 'Invalid or inactive API key', 'INVALID_API_KEY');
      ws.close(4002, 'Invalid API key');
      return;
    }

    const { apiKeyId, projectId, userId } = keyResult.data!;

    // Get tier from user's actual subscription (not from frontend parameter)
    const subscription = await SubscriptionService.getSubscription(userId.toString());
    const tier: ChatTier = subscription.tier as ChatTier;

    // Check connection limit
    const connectionCount = await getConnectionCount(apiKeyId.toString());
    if (connectionCount >= env.MAX_WS_CONNECTIONS_PER_KEY) {
      sendError(ws, 'Maximum connections reached for this API key', 'CONNECTION_LIMIT');
      ws.close(4003, 'Connection limit reached');
      return;
    }

    // Increment connection count
    await incrementConnections(apiKeyId.toString());

    // Get project info for RAG context
    const project = await Project.findById(projectId).lean();
    if (!project) {
      sendError(ws, 'Project not found', 'PROJECT_NOT_FOUND');
      ws.close(4004, 'Project not found');
      await decrementConnections(apiKeyId.toString());
      return;
    }

    // Create chat session
    const session = await ChatSession.create({
      projectId,
      apiKeyId,
      tier,
      startedAt: new Date(),
      totalTokens: 0,
      messageCount: 0,
    });

    // Attach session info to WebSocket
    authWs.apiKeyId = apiKeyId;
    authWs.projectId = projectId;
    authWs.tier = tier;
    authWs.sessionId = session._id as Types.ObjectId;

    console.log(`🔗 New WS connection: project=${projectId}, tier=${tier}, session=${session._id}`);

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
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
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


